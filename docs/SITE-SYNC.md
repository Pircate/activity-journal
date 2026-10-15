# 运动记录网站更新说明（供每日同步任务读取）

本文件描述如何在「每日同步 Strava/Garmin/COROS 运动数据」任务同步成功后，更新 https://pircate.github.io/movement-journal/ 和仓库 Pircate/movement-journal。

## 触发条件

仅当本次每日同步没有需要用户介入的阻塞、没有未处理的活动级失败时执行。存在阻塞或失败时跳过，并在报告里说明网站未更新及原因。用户已明确授权本流程自动提交、推送并发布该网站。

## 仓库与目录

- 仓库：https://github.com/Pircate/movement-journal.git（公开，GitHub Pages 从 main 分支 /docs 发布）
- 固定工作目录：/Users/gaoxiang/Workspace/github/movement-journal
- 目录不存在时，先从上面的仓库地址恢复到该路径。
- 更新前先读 README.md 和 docs/activities.json，检查 git status；仅在工作区干净且可 fast-forward 时更新 origin/main，保留他人修改，禁止 reset --hard、禁止强制推送。

## 取数与构建

数据源为 Intervals.icu，网站更新不再从 COROS 连接器取数，也不再接收手工规范化 JSON。

凭据保存在本机 `~/.config/interval-icu/config.json` 的 `INTERVALS_ICU_API_KEY` 字段中，脚本运行时直接读取配置文件；目录权限为 `700`，文件权限为 `600`。禁止把密钥写入仓库、公开文件、自动化提示词或日志。配置缺失、无效或授权失败时停止网站更新并报告，不得切回 COROS。

执行：

```sh
node scripts/update-data.mjs
node scripts/build.mjs
```

脚本先通过 `/athlete/0` 解析账号，再查询截至北京时间今天最近 365 天的完整活动，以及 `/athlete/{id}/gear` 装备列表，全部成功后原子替换同一份快照。API 字段为 `distance`（米）、`moving_time`（运动秒数）、`icu_training_load`；日期由 UTC 开始时间转换为北京时间。查询前后各扩大一天，再裁剪到最近 365 天，以覆盖时区边界。装备累计里程直接使用平台统计，不按年度活动重算。

只有活动与装备查询都成功、列表未达到上限、所有记录有效时才写入。API 失败、授权过期、超时、缺失运动时长、重复 ID、装备关联不完整或循环、无效里程或疑似截断时保留旧文件并报告；不得把失败当作零条记录，不得复用 COROS 负荷补缺。同一天多次运动保留实际条数。

Strava API 明确返回的受限空壳只保留当地日期，在页面标注详情缺失，不计入总量；不得猜测详情或把它当成没有运动。

公开 JSON 顶层仅含 period:{start,end}、syncedAt、activities、unavailableActivities（仅含 date 的受限活动列表）、gearLibrary。每条活动仅含 date、sport、distanceKm、duration、trainingLoad。缺失距离和负荷保留为 null。不发布活动或装备标识、账号信息、装备备注、坐标、心率、原始文件链接或凭据。

gearLibrary 成功同步后为自行车数组，仅含 name、type、distanceKm、components；配件仅含 name、type、distanceKm、replacement。首次尚未同步的仓库快照使用 null，禁止在同步失败时改为 null 或空列表。已退役装备隐藏，component_ids 只在脚本内部用于递归解析归属，不发布原始标识。

链条（Chain）、飞轮（Cassette）、外胎（Tyre）、牙盘（Chainrings）的 replacement 仅含 status、date、distanceKm。读取唯一一个名为“更换”的配件提醒，用 last_reset 转换北京时间日期，用 distance_used 转换公里数；名称重名或缺少该提醒分别标记 duplicate-reminder、missing-reminder，日期与更换后里程置 null；找到唯一提醒时标记 available，缺失字段仍保留 null。其他配件的 replacement 为 null。不得使用 purchased、配件总里程或其他保养提醒推断更换信息。

平台 API 不接受历史 last_reset。用户明确补录的历史更换日期保存在配件 notes 的单独一行：`运动装备库更换记录：` 后接 JSON，字段仅为 date、reminderId、resetAt、baseline（starting_distance、starting_time、starting_activities 的数值数组）。日期未知时 date 为 null，页面显示“未记录”。仅当当前“更换”提醒的 ID、重置时刻和起始计数全部匹配时使用此明确日期；后续重置提醒后该补录记录自动失效。不得把普通备注中的日期当作更换日期，也不得公开备注或内部标识。日常同步只读取这些记录，不创建配件、不修改备注或提醒、不重置计数。用户确认过的历史里程基准不能用不完整活动重算覆盖。

用户在 Intervals.icu 换件后重置“更换”提醒。前后外胎分别建 Tyre 配件，名称以“前胎”“后胎”开头；未识别位置时只提示，不猜测。网站固定目标为链条及前后胎 5000 km、飞轮 10000 km、牙盘 30000 km，不改写平台提醒。青野的链条与牙盘同时关联青野和 R200，以平台共享配件计数累计室内外里程；外胎仅关联青野。

检查 git diff，日常数据更新应仅涉及 docs/activities.json 与 docs/index.html；出现异常删除先复核查询完整性。

## 提交与发布

用中文提交说明提交，push 更新 origin main；推送失败保留本地提交并报告，不得强推。不要调用 Sites/Cloudflare 发布，不要改动页面设计或新增功能。推送后检查该提交对应的 GitHub Pages 工作流直到成功或失败，成功后核对线上 activities.json 的 syncedAt、period.end 与本次一致。发布失败或线上未更新时在报告中说明。

## 报告

在最终报告中补充：网站是否已更新到最新数据；若未更新，说明原因。
