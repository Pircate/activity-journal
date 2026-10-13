# 运动记录网站更新说明（供每日同步任务读取）

本文件描述如何在「每日同步 Strava/Garmin/COROS 运动数据」任务同步成功后，更新 https://pircate.github.io/movement-journal/ 和仓库 Pircate/movement-journal。

## 触发条件

仅当本次每日同步没有需要用户介入的阻塞、没有未处理的活动级失败时执行。存在阻塞或失败时跳过，并在报告里说明网站未更新及原因。用户已明确授权本流程自动提交、推送并发布该网站。

## 仓库与目录

- 仓库：https://github.com/Pircate/movement-journal.git（公开，GitHub Pages 从 main 分支 /docs 发布）
- 固定工作目录：/Users/gaoxiang/Workspace/github/movement-journal
- 目录不存在时，先从上面的仓库地址恢复到该路径。
- 更新前先读 README.md 和 docs/activities.json，检查 git status；仅在工作区干净且可 fast-forward 时更新 origin/main，保留他人修改，禁止 reset --hard、禁止强制推送。

## 取数

用当前可用的 COROS querySportRecords 连接器查询活动：sportTypeCodes=[65535]；timezone 支持时用 Asia/Shanghai；范围从现有数据 period.end 往前 6 天到北京时间今天，离线较久时补齐整个缺口。limit 要足够大，达到上限或疑似截断时分日期查询。只有查询明确成功且范围完整才继续；异常、未授权、超时或无法确认完整时不要改动网站并说明原因，不得把错误当成零条记录。

## 规范化与构建

生成 JSON：顶层仅含 period:{start,end}、syncedAt、activities。syncedAt 为本次查询成功的北京时间，格式 YYYY-MM-DD HH:mm:ss +08:00。每条 activities 仅含：

- date：YYYY-MM-DD
- sport：准确中文运动类型
- distanceKm：数字或 null
- duration：分钟:秒或小时:分钟:秒
- trainingLoad：数字或 null

使用运动时长（Workout/Duration），不要用 Total Time 或起止时间差。新增、变化或负荷缺失的活动用 getActivityDetail 取 Training Load，未提供则保留 null；完全相同的已有活动可复用此前负荷；同一天多条活动保留实际条数，不得按日期去重。不得写入 labelId、账号信息、坐标、心率、FIT 链接、token 或凭据。

把 JSON 写到网站仓库之外的目录（例如本任务目录下的 work/sync/latest.json），然后执行：

```sh
node scripts/update-data.mjs <该 JSON 的绝对路径>
node scripts/build.mjs
```

再检查 git diff，改动应仅限 docs/activities.json 与 docs/index.html 且数据合理；出现异常删除先复核查询完整性。

## 提交与发布

用中文提交说明提交，push 更新 origin main；推送失败保留本地提交并报告，不得强推。不要调用 Sites/Cloudflare 发布，不要改动页面设计或新增功能。推送后检查该提交对应的 GitHub Pages 工作流直到成功或失败，成功后核对线上 activities.json 的 syncedAt、period.end 与本次一致。发布失败或线上未更新时在报告中说明。

## 报告

在最终报告中补充：网站是否已更新到最新数据；若未更新，说明原因。
