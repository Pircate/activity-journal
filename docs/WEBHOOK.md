# Strava webhook 部署与恢复

网站继续从 Intervals.icu、历史快照和 `data/strength-sets.json` 取数。Strava webhook 只触发更新，不读取 Strava 活动详情、不执行平台间同步。每日任务不负责网站更新。

## 1. 准备 Worker

需要自己的 Cloudflare 账号、可管理订阅的 Strava API 应用，以及该应用已获网站账号授权。账号必须与 `workers/strava-webhook/wrangler.jsonc` 的 `STRAVA_ATHLETE_ID` 一致（默认 `78720097`）。每个 Strava 应用仅允许一个 webhook 订阅，部署脚本不会替换别的订阅。

```sh
npm ci
npx wrangler login
```

准备三个互不相同的随机值（可用 `openssl rand -hex 32` 生成），分别作为 `WEBHOOK_PATH_SECRET`、`STRAVA_VERIFY_TOKEN`、`SYNC_TOKEN`，保存在密码管理器。`WEBHOOK_PATH_SECRET` 仅使用十六进制字符，不要公开完整 webhook URL；GET 验证 token 不会验证后续 POST。

逐项录入 Worker Secrets，命令会交互询问值：

```sh
npx wrangler secret put WEBHOOK_PATH_SECRET --config workers/strava-webhook/wrangler.jsonc
npx wrangler secret put STRAVA_VERIFY_TOKEN --config workers/strava-webhook/wrangler.jsonc
npx wrangler secret put SYNC_TOKEN --config workers/strava-webhook/wrangler.jsonc
npx wrangler secret put GITHUB_DISPATCH_TOKEN --config workers/strava-webhook/wrangler.jsonc
npm run worker:deploy
```

`GITHUB_DISPATCH_TOKEN` 使用仅允许访问 `Pircate/activity-journal`、具有 **Contents: write** 的 GitHub fine-grained PAT，用于 `repository_dispatch`。不要把 Strava client secret 或 Intervals.icu API Key 放入 Worker。Durable Object 自动创建，保存事件和成功状态；不要删除绑定、迁移记录或清空其存储。Worker URL 通常为 `https://activity-journal-strava.<账号>.workers.dev`。

## 2. 注册 Strava 订阅

将 `STRAVA_CLIENT_ID`、`STRAVA_CLIENT_SECRET`、`SYNC_WORKER_URL`（仅 HTTPS origin）、`WEBHOOK_PATH_SECRET`、`STRAVA_VERIFY_TOKEN` 安全导入 shell 环境，不将实际值写进命令历史或仓库。脚本只输出订阅 ID 和 callback 是否匹配，不输出含秘密路径的 URL。

```sh
# 只查询；不会修改订阅
node scripts/strava-subscription.mjs
# 没有订阅时创建；已有不同订阅时停止，绝不自动删除
node scripts/strava-subscription.mjs --create
```

将返回的订阅 ID 写入 Worker Secret 后再启用事件处理：

```sh
npx wrangler secret put STRAVA_SUBSCRIPTION_ID --config workers/strava-webhook/wrangler.jsonc
```

订阅创建时仅需 GET 验证，因此可以在拿到 ID 后配置 `STRAVA_SUBSCRIPTION_ID`。配置前 POST 返回 503；Strava 重试次数有限，首次上线完成后手动全量同步一次补齐部署窗口。

## 3. 配置 Actions 和 Pages

将实现提交至 `main`，然后配置以下 GitHub repository Secrets（仓库 Settings → Secrets and variables → Actions，或使用 `gh secret set NAME --repo Pircate/activity-journal` 交互录入）：

| Secret | 内容 |
| --- | --- |
| `SYNC_WORKER_URL` | Worker 的 HTTPS origin，不包含 webhook 路径 |
| `SYNC_TOKEN` | 与 Worker 相同的管理接口 token |
| `INTERVALS_ICU_API_KEY` | 现有 Intervals.icu API Key |

在 Settings → Actions → General 允许 workflow 读写仓库；如 main 有分支保护，允许该工作流提交数据，否则推送步骤会失败。`github-pages` environment 必须允许 `main` 自动部署；不要设置每次发布都需人工批准，否则 webhook 无法全自动运行。

在 Settings → Pages 将 **Source** 从 Deploy from a branch 改成 **GitHub Actions**。网站地址不变。工作流使用 `contents: write`、`pages: write`、`id-token: write`，部署 `docs/` artifact；不依赖 `GITHUB_TOKEN` 推送触发旧 Pages 构建。

```sh
# 首次上线：无游标时也会全量查询
gh workflow run site.yml --repo Pircate/activity-journal --ref main -f full=true
gh run list --repo Pircate/activity-journal --workflow site.yml --limit 5
```

Worker 的秘密路径、verify token 和 GitHub PAT 不需要放入 GitHub Secrets。管理 token 仅在受信任的 main 工作流运行，不提供给 pull request 工作流。

## 4. 状态与恢复

先安全导入 `SYNC_WORKER_URL`、`SYNC_TOKEN` 到环境，再查询：

```sh
node --input-type=module -e 'import {workerRequest} from "./scripts/site-sync.mjs"; console.log(await workerRequest("/sync/status"))'
```

- `lastSuccessfulAt`：最近一次成功部署时间（UTC）。
- `cursor`：最近一次成功**数据同步开始**的时间（UTC），不会取部署完成时间；普通代码发布不推进。
- `publishedCommit`：成功同步数据的 Git 版本。代码发布复用该快照，避免发布失败同步留在 main 上的数据；补充文件改动后需触发全量同步才能完整生效。
- `pending`、`active`、`attempts`、`nextAt`、`lastError`：待处理数量、当前 Actions 运行、重试次数、下次重试时间（Unix 毫秒）及简要错误；具体原因查看 Actions 失败步骤。派发失败时 `lastError` 形如 `GitHub dispatch failed: Dispatch refused (HTTP 401)`，可区分 token 失效（401）、缺少 Contents 写权限（403）和网络/超时；`pending` 有值却长时间没有新 Actions 运行，就是派发环节出了问题。

首次事件后两分钟派发；活动级、API、构建、测试、推送或部署失败后等待 5、15、60 分钟重试。耗尽后保留事件并停止自动重试；新事件或手动 Actions 可以恢复。重复投递不重置重试计数。派发未被领取也会退避；Actions 取消或无法回报时，30 分钟租约到期后保留批次并重试。工作流总时限为 25 分钟。

```sh
# 手动增量恢复，包含尚未确认的全部事件
gh workflow run site.yml --repo Pircate/activity-journal --ref main
# 补齐漏通知、其他平台旧记录或历史指标修改
gh workflow run site.yml --repo Pircate/activity-journal --ref main -f full=true
```

增量以游标对应北京时间日期向前重叠两天为起点；API 当地日期下界额外扩两天、上界扩一天，最后按完整北京时间范围合并，保留未返回的历史和已知指标。旧日期新增事件先按真实 ID 或已核对的平台链接定位，无法定位时全量查询。旧记录的编辑、删除不属于本次 webhook 处理范围；保持远端现有的保守合并，不自动删除历史，超出增量窗口时需手动全量更新。

Strava 到达不代表 Intervals.icu 已准备好：目标活动未出现在查询结果中会重试；已收录但受限则保留“详情不可读取”，视为正常可发布快照。永久缺失的活动需要处理上游收录或人工补充真实关联；不能用 Strava ID 猜测另一平台活动，也不能把 API 失败当成没有运动。

数据文件和 HTML 在临时 Actions checkout 中生成，活动、装备、成绩、构建和测试全部通过才提交；推送冲突不会强推。只有 `deploy-pages` 成功后才向 Worker 确认批次；状态回写失败时从旧成功基线重试，同一回执重复提交是幂等的。运行期间新增事件不会被本批次确认。

## 5. 本地验证

```sh
npm ci
npm test
npm run worker:check
npm run worker:dev
```

本地 Worker Secrets 放在 `workers/strava-webhook/.dev.vars`（已被 Git 忽略），只使用测试账号和测试 token，不使用生产 GitHub PAT。不要用本机直接运行同步脚本来修改云端游标。本机调试脚本仍兼容仓库外凭据文件；正式更新只读取 GitHub Secrets。历史 COROS 组数保留，新活动缺少组数时显示未知，自动链路不要求本机 COROS 连接器。

端到端验收：在已授权的 Strava 账号新增活动，确认 Worker 待处理事件出现、Actions 被触发、Pages 部署成功，再核对线上 `activities.json` 与 `/sync/status`。部署期间再新增活动，应触发下一批，且不重复计数。生产凭据尚未配置时只能完成本地和模拟验证。

接口依据：[Strava webhook](https://developers.strava.com/docs/webhooks/)、[Intervals.icu API](https://intervals.icu/api-docs.html)、[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
