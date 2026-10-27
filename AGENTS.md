# Repository Guidelines

## 项目结构与模块组织

- `docs/`：GitHub Pages 发布目录，包含原生 JavaScript 模块、`style.css`、公开 JSON 快照和 `images/` 图片资源。
- `scripts/`：数据同步、HTML 构建、邮件通知及测试；`build.mjs` 生成 `docs/index.html`，页面结构应在构建脚本中修改。
- `data/`：个人资料、COROS 力量训练组数及本地同步状态。
- `workers/strava-webhook/`：Cloudflare Worker 与 Durable Object，负责事件合并和同步协调。
- `.github/workflows/site.yml`：云端同步、测试与发布；`output/` 存放忽略提交的临时产物。

## 构建、测试与本地开发

使用 Node.js 22 及以上版本和 Python 3，在仓库根目录执行：

```sh
npm ci
npm test
python -m unittest discover -s scripts -p 'test_*.py'
node scripts/build.mjs
python -m http.server 8787 --bind 127.0.0.1 --directory docs
```

以上依次安装锁定依赖、运行 JavaScript 与 Python 测试、重建 HTML、启动本地预览。访问 `http://127.0.0.1:8787/`。

Worker 开发使用 `npm run worker:dev`；修改后执行 `npm run worker:check`，以 dry-run 检查打包结果。同步机制参见 `docs/SITE-SYNC.md`，部署及 Secrets 配置参见 `docs/WEBHOOK.md`。

## 编码风格与命名

JavaScript 使用 ES modules、两空格缩进和单引号；Python 使用四空格缩进。沿用相邻代码风格，文件采用 `kebab-case.mjs`，函数和变量采用 `camelCase`。目前未配置独立 formatter 或 linter。

对话、文档和界面文案使用中文。保持实现简单、职责明确，移除废弃路径。界面使用 Radix UI Colors，边框宽度为 `0.5px`；减少说明和动画，不用中点分隔文案。字号最多四种且不小于 `12px`。

## 测试规范

JavaScript 使用 `node:test` 与 `node:assert/strict`，测试位于 `scripts/*.test.mjs`；Python 使用 `unittest`，命名为 `scripts/test_*.py`。未设置覆盖率门槛。

行为变更应覆盖正常输入、边界和失败场景；外部 API、SMTP 使用模拟，避免测试发送真实通知。提交前运行相关测试与构建；界面改动检查桌面、手机、键盘操作及溢出，并保留截图。

## 提交与 Pull Request

近期提交主要采用 `feat:`、`fix:`、`chore:` 前缀，例如 `feat: add activity filter`。每次提交聚焦一个主题，检查生成文件差异，排除临时输出。

PR 说明问题、行为变化、验证命令与结果；有关联问题时附链接，界面改动附截图。更改发布流程时说明部署影响。

## 数据与安全

保留北京时间日期及同日开始时间排序，区分未同步、指标缺失、详情不可读取与有效零值。Intervals.icu 提供活动主数据；Strava 事件触发云端更新，COROS 组数来自已保存数据。仅在 Pages 部署成功后推进云端游标。

凭据使用环境变量或 GitHub Secrets；禁止提交 `.env`、`.dev.vars`、令牌、原始平台响应、坐标及心率明细。修改数据合并或发布逻辑前，先阅读上述同步与部署文档。
