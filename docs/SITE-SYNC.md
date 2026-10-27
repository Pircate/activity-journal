# 网站同步说明

自动网站更新完全在云端执行，每日任务已移除网站更新步骤。Strava activity.create 只触发 Cloudflare Worker；Worker 保存事件并调用 GitHub Actions，网站始终发布到 GitHub Pages。配置与恢复见 [WEBHOOK.md](WEBHOOK.md)。

## 数据与合并

网站从 Intervals.icu 查询活动、训练负荷、平均心率、装备与全历史成绩曲线；不读取 Strava 活动 API 或凭据。历史快照保留已核对的 Strava 链接与详情，data/strength-sets.json 保留 COROS 组数，云端不要求本机连接器。缺少新组数时显示未知，不伪造零值。

scripts/fetch-site-data.mjs 复用 scripts/update-data.mjs 的查询与 scripts/sync.mjs 的合并逻辑：保留未返回历史、有效零值、已知负荷、组数及开始时间，按真实平台 ID 关联，冲突停止，不按日期或名称猜测。受限空壳已有详情则保留，无详情仅发布缺失日期；已变得可读的记录替换缺失提示。基础数据、装备、成绩、构建与测试任一失败不发布。

首次查询全部历史；后续从 Worker 的成功同步开始时间游标对应北京时间日期向前重叠两天查询。API 当地日期下界额外扩两天、上界扩一天，最后按北京时间和本次开始时间裁剪。旧日期事件先定位，无法定位全量回退。查询满 10000 条继续分段，单日仍满则失败。尚未收录的事件活动保留重试，不把遗漏当作成功。装备与成绩每次完整查询。

## 发布和恢复

.github/workflows/site.yml 串行执行同步、成绩、构建、测试和普通 push，冲突不强推。Pages 从 Actions 的 docs artifact 发布。仅 deploy-pages 成功后向 Worker 回报 UTC 成功时间、同步开始时间游标和发布数据版本；只确认已领取事件，运行期间的新事件留到下一批。失败继续使用旧成功基线重试，旧 data/sync-state.json 不作为云端游标。

普通网站代码 push 使用成功数据快照构建，不推进数据游标。手动 workflow_dispatch 支持增量及 full=true 全量恢复。超过重试次数后仍保留事件；新事件或手动运行可恢复。不得用本机独立脚本替代云端发布回执。
