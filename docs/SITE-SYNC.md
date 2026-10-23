# 运动记录网站更新说明（供每日同步任务读取）

本文件描述如何在「每日同步 Strava/Garmin/COROS 运动数据」任务同步成功后，更新 https://pircate.github.io/activity-journal/ 和仓库 Pircate/activity-journal。

## 触发条件

仅当本次每日同步没有需要用户介入的阻塞、没有未处理的活动级失败时执行。存在阻塞或失败时跳过，并在报告里说明网站未更新及原因。用户已明确授权本流程自动提交、推送并发布该网站。

## 仓库与目录

- 仓库：https://github.com/Pircate/activity-journal.git（公开，GitHub Pages 从 main 分支 /docs 发布）
- 固定工作目录：/Users/gaoxiang/Workspace/github/activity-journal
- 目录不存在时，先从上面的仓库地址恢复到该路径。
- 更新前先读 README.md 和 docs/activities.json，检查 git status；仅在工作区干净且可 fast-forward 时更新 origin/main，保留他人修改，禁止 reset --hard、禁止强制推送。

## 取数与构建

运动基础数据优先来自 Intervals.icu；缺失或受限的历史活动使用 `data/strava-activities.json` 中已由 Strava API 全量核对的公开指标，力量训练组数通过下述 COROS 补充流程取得。

活动列表同时请求 `total_elevation_gain`（累计爬升，米），有值时保存为公开可选字段 `elevationGain`，保留原始精度和零值；缺失时省略该字段，卡片显示“未提供”，不按 0 补齐。最近一周卡片中的指标采用图标在左、数值在右的布局，单位与数值按基线对齐；中文标签保留供读屏使用。最近七天摘要展示次数、距离、时长与累计负荷，缺失负荷不计入合计并注明，全部缺失显示“—”。

凭据保存在本机 `~/.config/interval-icu/config.json` 的 `INTERVALS_ICU_API_KEY` 字段中，脚本运行时直接读取配置文件；目录权限为 `700`，文件权限为 `600`。禁止把密钥写入仓库、公开文件、自动化提示词或日志。配置缺失、无效或授权失败时停止网站更新并报告，不得切回 COROS。

执行：

```sh
node scripts/update-data.mjs
node scripts/update-personal-bests.mjs
node scripts/build.mjs
```

`update-personal-bests.mjs` 必须在上面的活动同步之后运行：它并发查询全历史配速曲线（`athlete/0/pace-curves.json?type=Run&curves=all`）与功率曲线（`athlete/0/power-curves.json?type=Ride&curves=all`），最远骑行、成绩对应日期与 Strava 链接都取自刚写入的活动快照，以 Intervals.icu 活动链接精确关联。跑步成绩取曲线上首个不短于目标距离的累计用时（5 公里、10 公里、半程马拉松 21097.5 米、全程马拉松 42195 米），骑行最远距离按快照中全部骑行类活动（含虚拟骑行）的最大距离，功率取 300 秒与 1200 秒处的原始最佳努力值。曲线按运动大类聚合，因此 `type=Run` 已含越野跑与虚拟跑步，`type=Ride` 已含虚拟骑行；不要按子类型重复查询或重复计项。功率值只能用秒数精确定位，曲线上存在小幅回弹，不做插值或单调性推断。任一请求、结构校验或解析失败时整次失败并保留旧文件。公开 JSON 顶层仅含 `source`、`syncedAt`、`records`；每条记录含 `sport`、`event`、`result`、`date`、`activityUrl`，有 Strava 关联时额外包含 `stravaUrl`，供成绩卡片跳转；无关联时不生成跳转并显示“Strava 链接未提供”。日期在活动快照中查不到时为 `null`；不发布曲线返回的体重、w/kg、功率模型、活动原始标识或其他字段。

脚本先通过 `/athlete/0` 解析账号，再查询截至北京时间今天的全部历史活动，以及 `/athlete/{id}/gear` 装备列表，全部成功后原子替换同一份快照。API 字段为 `distance`（米）、`moving_time`（运动秒数）、`icu_training_load`、`average_heartrate`（仅力量训练使用）、`strava_id`（生成 Strava 跳转链接）；日期由 UTC 开始时间转换为北京时间。从 1900-01-01 起查询，上界扩大一天，再按北京时间裁剪至今天。单次达到 10000 条上限时自动二分不重叠的当地日期范围，递归查询至每段未达到上限；单日仍达上限时停止并保留旧快照。period.start 保存最早记录所在年的元旦，至少覆盖最近一年；period.end 保存同步当天。页面默认最近 365 天，可选择各自然年，历史记录不能裁剪掉。装备累计里程直接使用平台统计，不按年度活动重算。

只有活动与装备查询都成功、列表未达到上限、所有记录有效时才写入。API 失败、授权过期、超时、缺失运动时长、重复 ID、装备关联不完整或循环、无效里程或疑似截断时保留旧文件并报告；不得把失败当作零条记录，不得复用 COROS 负荷补缺。同一天多次运动保留实际条数。

Intervals.icu 返回的 Strava 受限空壳若尚无补充记录，只保留当地日期，在页面标注详情缺失，不计入总量；不得猜测详情或把它当成没有运动。仅存在于 Strava 补充文件的独立活动也须保留，不能因 Intervals.icu 没有对应条目而丢弃。

公开 JSON 顶层仅含 period:{start,end}、syncedAt、activities、unavailableActivities（仅含 date 的受限活动列表）、gearLibrary。每条活动含 date、sport、distanceKm、duration、trainingLoad；存在真实关联时包含可选 activityUrl，Strava 独有记录省略该字段；力量训练额外含 sets（组数）和 averageHeartRate（平均心率，bpm），缺失时为 null。activityUrl 为 https://intervals.icu/activities/ 加该条平台活动 ID，用于成绩与组数关联。有 strava_id 时额外保存 stravaUrl，为 https://www.strava.com/activities/ 加该 Strava 活动 ID，供最近一周、当天明细和历史查询跳转；无关联时省略 stravaUrl，不提供跳转。不得按日期猜测或混用其他平台 ID。缺失距离和负荷保留为 null。不发布额外的活动标识字段、原始装备标识、账号信息、装备备注、坐标、心率明细、原始文件链接或凭据。

gearLibrary 成功同步后为自行车数组，仅含 name、type、distanceKm、components；配件含 name、type、distanceKm、replacement；共享配件另含 sharedBy 车辆名称数组和 sharedGroup 正整数分组号。sharedGroup 由 normalizeGear 按同一原始平台配件的实际关联生成，仅在当前快照内标记共享实例，不写入原始装备标识，不按名称或数值推断共享。共享配件的各份使用信息和所属车辆必须一致，否则拒绝更新。首次尚未同步的仓库快照使用 null，禁止在同步失败时改为 null 或空列表。已退役装备隐藏，component_ids 只在脚本内部用于递归解析归属，不发布原始标识。

链条（Chain）、飞轮（Cassette）、外胎（Tyre）、牙盘（Chainrings）的 replacement 仅含 status、date、distanceKm。读取唯一一个名为“更换”的配件提醒，用 last_reset 转换北京时间日期，用 distance_used 转换公里数；名称重名或缺少该提醒分别标记 duplicate-reminder、missing-reminder，日期与更换后里程置 null；找到唯一提醒时标记 available，缺失字段仍保留 null。其他配件的 replacement 为 null。不得使用 purchased、配件总里程或其他保养提醒推断更换信息。

平台 API 不接受历史 last_reset。用户明确补录的历史更换日期保存在配件 notes 的单独一行：`运动装备库更换记录：` 后接 JSON，字段仅为 date、reminderId、resetAt、baseline（starting_distance、starting_time、starting_activities 的数值数组）。日期未知时 date 为 null，页面显示“未记录”。仅当当前“更换”提醒的 ID、重置时刻和起始计数全部匹配时使用此明确日期；后续重置提醒后该补录记录自动失效。不得把普通备注中的日期当作更换日期，也不得公开备注或内部标识。日常同步只读取这些记录，不创建配件、不修改备注或提醒、不重置计数。用户确认过的历史里程基准不能用不完整活动重算覆盖。

用户在 Intervals.icu 换件后重置“更换”提醒。前后外胎分别建 Tyre 配件，名称以“前胎”“后胎”开头；未识别位置时只提示，不猜测。网站固定目标为链条及前后胎 5000 km、飞轮 10000 km、牙盘 30000 km，不改写平台提醒。青野的链条与牙盘同时关联青野和 R200，以平台共享配件计数累计室内外里程；外胎仅关联青野。

检查 git diff，日常数据更新应仅涉及 data/strength-sets.json、data/strava-activities.json、docs/activities.json、docs/personal-bests.json 与 docs/index.html；维护摘要在构建时从装备快照生成，共享提醒只计一次，前端的车辆内定位索引不作为平台标识使用；出现异常删除先复核查询完整性。

## Strava 全量历史活动补充

`data/strava-activities.json` 仅保存与网站相同的公开活动字段，不保存完整 API 响应、凭据、坐标或心率明细。通过 Strava API 分页读取全部历史，先按 Strava ID、原始文件标识核对已有活动；旧记录缺少共同标识时，用精确 UTC 开始时间、运动类型及指标交叉核对，时间存在偏差的记录逐条复核。禁止仅凭某天或名称批量关联。

已核对的关联保存为各自真实的 `activityUrl` 与 `stravaUrl`，两个平台的 ID 可以不同。完全未收录于 Intervals.icu 的活动仅保留真实 `stravaUrl`，省略 `activityUrl`，不能用 Strava ID 编造 Intervals.icu 链接。日期由 UTC 转换为北京时间，距离和运动时长沿用现有单位换算，运动类型使用 `sport_type`，补充文件的训练负荷必须为 `null`。

日常 `update-data.mjs` 自动读取该文件，优先保留原生记录的指标，仅补齐 Strava 链接；其余补充记录以 Strava URL 去重后独立保留，包括 Intervals.icu 从未列出的活动。受限空壳仍未补齐时继续标记详情不可读取。重复 Strava ID、重复 Intervals.icu 关联、与平台链接冲突、错误链接、无效指标或非空补充负荷均导致同步失败并保留旧快照；已有补充记录不能因授权或查询失败被清空。

全量补录后，必须验证 Strava 所有 ID 均被快照覆盖，核对最早开始日期，并确认跨平台已关联活动没有重复新增；不能仅以 `unavailableActivities` 为空判定完整。网站可保留其他平台独有的活动，因此网站总数不要求等于 Strava 总数。

## 悦跑圈历史迁移

本次范围为北京时间 2021-09-01 之前，不包含 9 月 1 日。通过 [running_page 悦跑圈导出实现](https://github.com/yihong0618/running_page/blob/master/run_page/joyrun_sync.py) 使用的接口读取全部记录，再按原始 UTC 开始时间转换北京时间筛选。认证仅在本机使用；原始详情只保存 `runrecord`，不保存接口响应中的会话字段。

1. 将筛选后的原始详情保存为 `output/joyrun/raw/<fid>.json`。核对清单数量、最早日期和详情中的开始时间、距离、时长与类型，列表或详情失败时停止，不将缺失视为无活动。
2. 按精确开始时间、来源、指标及重叠区间逐组核对重复，不能只按日期去重。本次用户选择手机优先、两块表时 COROS 优先，确认 `type=7` 为室内跑。Strava 已有记录通过开始时间和指标交叉核对后保留；存在指标差异时记录到本地复核清单，不覆盖旧活动。
3. 将尚未导入的选择保存为 `output/joyrun/strava-plan.json`，结构为 `{"selected":[{"fid":"原始记录标识"}]}`。脚本只转换已选记录，不负责猜测重复关系，也不登录或上传。

```sh
uv run --with fit-tool==0.9.16 --with geopy==2.5.0 python scripts/joyrun-to-fit.py \
  output/joyrun/raw output/joyrun/strava-plan.json output/joyrun/fit
uv run --with fit-tool==0.9.16 --with geopy==2.5.0 --with garmin-fit-sdk==21.218.0 \
  python scripts/joyrun-to-fit.test.py
```

4. 使用 Strava Upload API 上传，`external_id` 使用各自 FIT 文件名。先上传样本，核对北京时间、距离和轨迹，再继续批量；每次取得 upload ID 后立即保存，最终必须确认 `activity_id`。请求超时后先查询已知 upload ID 和对应活动，不盲目重新上传。上传结果清单存放于 `output/joyrun/strava-import/manifest.csv`。
5. 旧记录没有逐点时间，转换时按等间隔采样与已知暂停还原，对齐起止时刻；GPS 坐标保留原值，累计轨迹距离按原始总距离归一化。FIT 会分别写入原始运动时长与总历时，但 Strava 会自行重算移动时间与配速。用户已选择保留轨迹并接受重算，原始距离、运动时长和总历时写入 Strava 说明。起始暂停时 Strava 采用首个轨迹点作为开始时刻，应在说明中补充原始开始时间。室内跑没有坐标，文件仅保存已知起止时间、距离及汇总。
6. 完成后分页读取 Strava，逐个检查新增 ID、开始时间、类型和距离；起始暂停导致的时刻差异必须与原始暂停相符，并确认北京时间日期一致。列表没有 `summary_polyline` 时继续检查活动详情的完整 `polyline`，不能直接判定轨迹丢失。将已核对的真实活动链接与 Strava 指标加入 `data/strava-activities.json`，训练负荷为 `null`，没有真实 Intervals.icu 关联则省略 `activityUrl`。继续运行上面的同步与构建命令，验证最早日期和每个新增 Strava ID 的覆盖情况。

所有原始数据、轨迹文件和上传结果均在 Git 忽略目录中；凭据和登录会话不得写入公开文件。网站使用 Strava 重算后的运动时长，不能宣称与悦跑圈原始总时长完全一致。

## 力量训练组数补充

`data/strength-sets.json` 是 COROS 组数的独立来源文件，仅保存 `{activityUrl, sets}` 数组；同步脚本会按活动链接合并，重复链接、非法链接或无效组数导致更新失败并保留旧快照。

1. 在执行同步脚本前，使用 COROS 连接器查询力量训练（sportTypeCodes=[402]），从最早已同步年份至今天分段查询，确保每段返回数量小于请求上限；保留每条记录的 labelId 和实际 Sets。查询失败时停止更新并报告，已有来源文件保留。
2. 使用同一 Intervals.icu 账号查询对应日期范围的原始活动字段 id、type、source、external_id；沿用同步脚本的查询完整性检查，达到 10000 条时继续拆分范围。凭据仅在本机内存中使用。
3. 调用 `scripts/update-data.mjs` 导出的 `matchCorosStrengthSets(intervalsRecords, corosRecords)`，其中 corosRecords 仅含 `{labelId:字符串, sets:非负整数}`。它只匹配 WeightTraining、source=COROS 且 external_id 与 labelId 完全相同的记录；关联不唯一时停止。仅将返回的 `{activityUrl, sets}` 合并到来源文件，不发布 COROS 标识或完整响应。查询范围内已核对的值使用本次结果更新，范围外条目保留；未匹配记录保留未知并在报告中说明。
4. 完成来源文件更新后，再运行上面的数据同步与构建命令。验证已匹配组数与 COROS 一致；平均心率、时长和训练负荷仍使用 Intervals.icu 的值。

## 提交与发布

用中文提交说明提交，push 更新 origin main；推送失败保留本地提交并报告，不得强推。不要调用 Sites/Cloudflare 发布，不要改动页面设计或新增功能。推送后检查该提交对应的 GitHub Pages 工作流直到成功或失败，成功后核对线上 activities.json 的 syncedAt、period.end 与本次一致。发布失败或线上未更新时在报告中说明。

## 报告

在最终报告中补充：网站是否已更新到最新数据；若未更新，说明原因。
