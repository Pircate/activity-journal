# 网站增量更新说明（供每日同步任务读取）

每天北京时间 22:00，「每日同步 Strava/Garmin/COROS 运动数据」任务成功完成三端同步后执行本流程。存在未处理的阻塞或活动级失败时跳过网站更新并报告。用户已授权自动提交、推送和发布。

## 仓库与数据来源

- 仓库为 https://github.com/Pircate/activity-journal.git，Pages 从 main 分支 /docs 发布。使用任务实际检出的仓库目录，不硬编码 Mac 或 Windows 路径；不存在时先检出仓库。
- 先阅读 README、本说明、活动快照和同步状态，检查 Git 工作区；仅在干净且可 fast-forward 时更新远端，保留他人修改，禁止强推或 reset --hard。
- 网站活动主来源为 Intervals.icu：日期、类型、距离、运动时长、爬升、力量训练平均心率、训练负荷及真实关联，同时提供当前装备及维护信息、全历史配速／功率曲线。
- 网站不读取 Strava API 或凭据；每日任务向 Strava 上传运动记录的流程仍保留。有真实 strava_id 或历史已核对链接时，页面继续提供 Strava 活动链接。
- COROS 仅补充力量训练组数，不替代 Intervals.icu 负荷。查询失败必须停止，不得改为空列表。

## 每次执行

1. 执行 `node scripts/sync.mjs --plan`，取得 full、oldest、corosOldest、end 及查询范围。首次 COROS 从已保存历史起点查询；若 Intervals.icu 发现更早历史，入口停止并要求扩大 COROS 范围后重试。首次全量读取；距离上次全量成功满 7 天时再次全量刷新；其他情况从上次成功游标前 7 天查询，包含停机期间全部时间。
2. 使用 COROS 连接器查询 corosOldest 至 end 的力量训练，sportTypeCodes=[402]。覆盖完整范围；每段返回数量达到请求上限时拆为不重叠范围重查，不能把达到上限的列表视为完整。
3. 将结果写入 Git 忽略的 `output/sync/coros-strength.json`，结构为 `{startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD",queriedAt:"UTC ISO 完成时间",records:[{labelId:"字符串",sets:非负整数}]}`。查询成功且无记录才允许空数组，不保存完整响应。输入须在 24 小时内生成，范围覆盖本次 corosOldest 至 end；北京时间跨天后重新确认范围。
4. 运行统一入口并验证：

   ```sh
   node scripts/sync.mjs --coros-input output/sync/coros-strength.json
   node --test scripts/*.test.mjs
   ```

5. 检查模式、活动总数、Intervals.icu 读取／新增／更新数、保留历史数、保留受限详情数、新增受限提示数及 COROS 匹配／未匹配数量。无法关联的指标保持未知并报告，不按同日或名称猜测。

不要再另行运行旧的三条同步命令。网站入口不执行跨平台活动上传，必须在三端同步成功后运行。

## 合并、完整性与恢复

- 优先按 Intervals.icu 活动 ID 更新，真实 Strava ID 仅用于精确补充关联与去重；关联冲突、重复或错误结构使整次失败。完整活动的查询上界固定为本次开始时刻，成功后写为下一次游标。
- 完整活动的基础指标由 Intervals.icu 更新；保留暂不可得的已知负荷、组数和真实关联。新关联只使用 Intervals.icu strava_id、Strava 来源记录的真实 ID 或已核对链接。
- COROS 组数仅按 Intervals.icu source=COROS、external_id=labelId 精确关联，再合入活动。关联冲突、重复或无效值停止更新。核对组数以 `{activityUrl,sets}` 保存在原有来源文件，范围外条目保留。
- 全量及增量都保留未返回的历史，不自动删除。窗口外的补传和修改由每七天全量刷新发现。
- 明确标记为 Strava API 受限空壳的记录，有历史详情时保留原详情；没有时仅将 API 返回的当地日期写入 unavailableActivities，不生成活动指标。查询范围内的日期提示每次重建，范围外保留，同日多条分别计数；变为完整活动后移除对应提示。其他不完整记录仍使整次失败。
- Intervals.icu 活动查询达到 10000 条时递归二分日期范围，单日仍满额则失败。装备完整获取，保留既有共享配件、退役过滤、唯一“更换”提醒及历史补录日期解析规则；日常只读，不重置或修改平台装备。
- 跑步 5 公里、10 公里、半马、全马继续使用全历史配速曲线；CP5／CP20 使用功率曲线 300／1200 秒原值；最远骑行由完整合并快照计算。曲线请求或解析失败整次停止。
- 公开活动结构及页面行为不变，缺失指标为 null，零值正常保留。不发布原始 COROS 标识、轨迹、心率流、账号信息、装备备注、凭据或内部字段。
- 所有结果先校验、构建和暂存，再替换活动、成绩、首页和组数来源，最后写 `data/sync-state.json`，仅含 UTC ISO 格式 cursor、lastSuccessfulSyncAt、lastFullReconcileAt，不放入 /docs。
- 替换失败自动回滚；进程中断后下次先恢复 `output/sync/rollback.json`。自动清理已退出进程的遗留锁；锁内容异常时，确认没有同步进程后删除 `output/sync.lock` 再重试；保留回滚日志供恢复。

## 凭据、提交与发布

- Intervals.icu API Key 只从 ~/.config/interval-icu/config.json 的 INTERVALS_ICU_API_KEY 读取。缺失或失败停止，不切换来源补缺，不记录密钥。
- 日常变更仅应涉及活动／成绩快照、首页、组数来源和同步状态。历史记录不应消失；基础指标切换后以 Intervals.icu 为准，异常变化先核对，不盲目提交。不维护额外的 Strava 历史补充文件。
- 用中文说明提交数据与状态，推送 origin main；失败保留本地提交并重试，不强推。Pages 失败重试发布，不把本地同步标为失败或回退游标。
- 等待对应提交的 Pages 结果，核对线上 activities.json 的 syncedAt、period.end 和 personal-bests.json 与本次一致。不要使用 Sites／Cloudflare，不改页面设计。
- 最终报告网站是否更新，失败说明阶段和原因。若未找到本机定时配置，明确报告尚未核实调度，不宣称已创建或迁移 22:00 任务。
