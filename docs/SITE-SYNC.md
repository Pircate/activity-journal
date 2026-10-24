# 网站增量更新说明（供每日同步任务读取）

每天北京时间 22:00，「每日同步 Strava/Garmin/COROS 运动数据」任务成功完成三端同步后执行本流程。存在未处理的阻塞或活动级失败时跳过网站更新并报告。用户已授权自动提交、推送和发布。

## 仓库与数据来源

- 仓库为 https://github.com/Pircate/activity-journal.git，Pages 从 main 分支 /docs 发布。使用任务实际检出的仓库目录，不硬编码 Mac 或 Windows 路径；不存在时先检出仓库。
- 先阅读 README、本说明、活动快照和同步状态，检查 Git 工作区；仅在干净且可 fast-forward 时更新远端，保留他人修改，禁止强推或 reset --hard。
- Strava 是活动主来源：日期、类型、距离、运动时长、爬升、力量训练平均心率及活动链接。读取私密活动需要 activity:read_all。
- Intervals.icu 补充训练负荷与真实关联，提供当前装备及维护信息、全历史配速／功率曲线。其距离、时长不能覆盖 Strava 主指标。
- COROS 仅补充力量训练组数，不替代 Intervals.icu 负荷。查询失败必须停止，不得改为空列表。

## 每次执行

1. 执行 `node scripts/sync.mjs --plan`，取得 full、oldest、corosOldest、end 及查询范围。首次 COROS 从已保存历史起点查询；若 Strava 发现更早历史，入口停止并要求扩大 COROS 范围后重试。首次全量核对；距离上次全量成功满 7 天时再次全量核对；其他情况从上次成功游标前 7 天查询，包含停机期间全部时间。
2. 使用 COROS 连接器查询 corosOldest 至 end 的力量训练，sportTypeCodes=[402]。覆盖完整范围；每段返回数量达到请求上限时拆为不重叠范围重查，不能把达到上限的列表视为完整。
3. 将结果写入 Git 忽略的 `output/sync/coros-strength.json`，结构为 `{startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD",queriedAt:"UTC ISO 完成时间",records:[{labelId:"字符串",sets:非负整数}]}`。查询成功且无记录才允许空数组，不保存完整响应。输入须在 24 小时内生成，范围覆盖本次 corosOldest 至 end；北京时间跨天后重新确认范围。
4. 运行统一入口并验证：

   ```sh
   node scripts/sync.mjs --coros-input output/sync/coros-strength.json
   node --test scripts/*.test.mjs
   ```

5. 检查模式、活动数、删除清单、保留的未关联历史数、COROS 匹配／未匹配数量及未关联负荷数量。无法关联的指标保持未知并报告，不按同日或名称猜测。

不要再另行运行旧的三条同步命令。网站入口不执行跨平台活动上传，必须在三端同步成功后运行。

## 合并、完整性与恢复

- 按真实 Strava ID 更新，分页至空页；重复、错误结构、时间越界使整次失败。查询上界固定为本次开始时刻，成功后写为下一次游标。
- 保留全部历史、已知负荷、组数和真实关联；无 Strava 链接的历史活动仍保留。新关联只使用 Intervals.icu strava_id、Strava 来源记录的真实 ID 或已核对链接。
- COROS 组数仅按 Intervals.icu source=COROS、external_id=labelId 精确关联，再合入活动。关联冲突、重复或无效值停止更新。核对组数以 `{activityUrl,sets}` 保存在原有来源文件，范围外条目保留。
- 日常不删除未返回活动。全量列表成功后，对消失活动逐条查询详情：仍可读取则更新；仅确认完整读取权限且返回 404 时删除。401、403、429、5xx、超时或权限不明均停止。Strava 时间筛选不是上传／修改时间，窗口外变化由每七天的全量核对发现。
- Intervals.icu 活动查询达到 10000 条时递归二分日期范围，单日仍满额则失败。装备完整获取，保留既有共享配件、退役过滤、唯一“更换”提醒及历史补录日期解析规则；日常只读，不重置或修改平台装备。
- 跑步 5 公里、10 公里、半马、全马继续使用全历史配速曲线；CP5／CP20 使用功率曲线 300／1200 秒原值；最远骑行由完整合并快照计算。曲线请求或解析失败整次停止。
- 公开活动结构及页面行为不变，缺失指标为 null，零值正常保留。不发布原始 COROS 标识、轨迹、心率流、账号信息、装备备注、凭据或内部字段。
- 所有结果先校验、构建和暂存，再替换活动、成绩、首页和组数来源，最后写 `data/sync-state.json`，仅含 UTC ISO 格式 cursor、lastSuccessfulSyncAt、lastFullReconcileAt，不放入 /docs。
- 替换失败自动回滚；进程中断后下次先恢复 `output/sync/rollback.json`。自动清理已退出进程的遗留锁；锁内容异常时，确认没有同步进程后删除 `output/sync.lock` 再重试；保留回滚日志供恢复。

## 凭据、提交与发布

- Strava 凭据复用 ~/.open-fit/strava.env，同名环境变量优先；401 刷新一次并原子保存新 token。权限不足需重新授权，刷新不能增加 scope。缺少 scope 元数据时，以实际私密活动返回确认删除权限，否则不根据 404 删除。
- Intervals.icu API Key 只从 ~/.config/interval-icu/config.json 的 INTERVALS_ICU_API_KEY 读取。缺失或失败停止，不切换来源补缺，不记录密钥。
- 日常变更仅应涉及活动／成绩快照、首页、组数来源和同步状态。异常删除或指标变化先核对，不盲目提交。旧 Strava 历史补充文件已被主数据源替代，不再维护。
- 用中文说明提交数据与状态，推送 origin main；失败保留本地提交并重试，不强推。Pages 失败重试发布，不把本地同步标为失败或回退游标。
- 等待对应提交的 Pages 结果，核对线上 activities.json 的 syncedAt、period.end 和 personal-bests.json 与本次一致。不要使用 Sites／Cloudflare，不改页面设计。
- 最终报告网站是否更新，失败说明阶段和原因。若未找到本机定时配置，明确报告尚未核实调度，不宣称已创建或迁移 22:00 任务。

## 悦跑圈历史导入

继续用 scripts/joyrun-to-fit.py 将核对后的记录转为 FIT 导入 Strava，原始资料、转换及上传清单保存在忽略目录 output/joyrun/。重复记录优先手机、两块表时优先 COROS，不覆盖 Strava 已有活动。旧轨迹时间为还原结果，Strava 会重算移动时间，原始汇总写入活动说明供核对。导入完成后由 Strava 主同步纳入，不再写历史补充文件；窗口外导入由下一次全量核对发现。
