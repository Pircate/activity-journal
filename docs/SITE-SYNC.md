# 网站同步说明

自动网站更新完全在云端执行，每日任务已移除网站更新步骤。Strava activity.create 只触发 Cloudflare Worker；Worker 保存事件并调用 GitHub Actions，网站始终发布到 GitHub Pages。配置与恢复见 [WEBHOOK.md](WEBHOOK.md)。

## 数据与合并

网站从 Strava 分页查询活动，读取日期、开始时间、运动类型、距离、运动时间、爬升、平均心率和卡路里；从 Intervals.icu 查询训练负荷、装备与全历史成绩曲线。历史快照保留已核对的 Strava 链接与详情，data/strength-sets.json 保留 COROS 组数，云端不要求本机连接器。缺少指标时显示未知，不伪造零值。

scripts/fetch-site-data.mjs 以 Strava 活动为主数据，复用 scripts/update-data.mjs 的 Intervals.icu 查询和 scripts/activity-sync.mjs 的精确关联：保留 Strava 未返回的历史、已知负荷与组数，按真实平台 ID 及已有平台链接关联，冲突停止，不按日期或名称猜测。无法从 Strava 读取的历史列入修正报告，不自动删除。基础数据、装备、成绩、构建与测试任一失败不发布。

### 公开字段约定

- 活动 `sport` 使用平台代码，如 `Ride`、`Run`、`WeightTraining`；中文名称由展示层统一提供。未知的有效平台代码仍可保存并安全展示。
- `durationSeconds` 是非负整数秒，支持超过 24 小时；不再保存格式化的 `duration`。
- `distanceKm` 保留来源米数除以 1000 后的精度，汇总和里程碑不逐条舍入，仅展示时取两位小数。2026 年 10 月 27 日已按真实活动链接恢复上游仍可读取的距离；其余历史保留原有精度，不推算丢失数值。
- 距离、负荷的 `null` 表示未提供，数值 `0` 是有效零值。力量训练的距离不适用，不累计距离，也不计为距离缺失；组数、卡路里、心率与负荷仍按各自缺失情况统计。组数存在时包括 `0` 组均优先展示，否则展示卡路里。全部适用活动都缺距离时汇总为 `null`，无适用活动时累计为 0。
- `unavailableActivities` 每项为 `{id,date}`，`id` 是 Strava 活动标识加固定来源前缀的 SHA-256 摘要，不输出原始标识。按标识去重，允许同一天多条记录，不按日期匹配恢复的活动。
- PB 的 `sport` 使用 `Run` 或 `Ride`，`event` 使用 `run5k`、`run10k`、`halfMarathon`、`marathon`、`longestRide`、`cp5`、`cp20`。`value` 为正有限数：跑步用秒、最远骑行用公里、功率用瓦；单位由项目确定，不再保存带单位的 `result`。原始数值保留精度，页面统一格式化。

日历、近期摘要、趋势与报表共用 `docs/activity-data.mjs` 的指标适用性及汇总逻辑。北京时间日期、同日开始时间排序和三类缺失状态保持各自语义。

首次、规则版本升级和手动全量时查询全部历史；后续从 Worker 的成功同步开始时间游标对应北京时间日期向前重叠两天查询。Strava 活动列表分页读到空页，旧日期事件直接读取活动详情并扩大窗口；时区和任务开始时间裁剪后合并。仅对缺组数的力量训练补查 Strava 详情卡路里。Strava 限额按响应头等待，超时或鉴权失败保留旧发布数据。装备与成绩每次完整查询。

## 发布和恢复

.github/workflows/site.yml 串行执行同步、成绩、构建、测试和普通 push，冲突不强推。Actions 将 Strava OAuth 凭据交给持有当前同步租约的 Worker；Worker 持久保存轮换后的刷新令牌，只向 Actions 返回短期访问令牌。令牌不写入快照、报告或日志。Pages 从 Actions 的 docs artifact 发布。仅 deploy-pages 成功后向 Worker 回报 UTC 成功时间、同步开始时间游标和发布数据版本；只确认已领取事件，运行期间的新事件留到下一批。失败继续使用旧成功基线重试，旧 data/sync-state.json 不作为云端游标。

历史修正报告上传为 Actions artifact，列出 Strava 返回与更新数量、汇总前后变化，以及因缺少 Strava 关联或 Strava 未返回而保留的旧记录。报告不包含原始平台响应或凭据。

普通网站代码 push 使用成功数据快照构建，不推进数据游标。手动 workflow_dispatch 支持增量及 full=true 全量恢复。超过重试次数后仍保留事件；新事件或手动运行可恢复。不得用本机独立脚本替代云端发布回执。

本次格式切换使用 `data/snapshot-release.json` 记录旧成功来源与已核对新快照的文件摘要。只有两个来源文件及两个目标文件全部匹配才允许首发使用新快照，任一变化立即停止，避免将失败同步留在 main 上的数据发布。运行时不解析旧字段；成功基线采用新格式后直接使用该基线，不再依赖切换凭据。若首发前云端基线已更新，须先基于新的成功数据重新核对目标并更新摘要，不能跳过校验。普通代码发布仍不推进数据游标。
