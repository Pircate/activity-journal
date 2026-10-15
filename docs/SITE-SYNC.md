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

确保本机运行环境已设置 `INTERVALS_ICU_API_KEY` 或 `INTERVALS_ICU_TOKEN`，凭据只在仓库外保存；禁止写入仓库、公开文件或日志。缺少授权时停止网站更新并报告，不得切回 COROS。

执行：

```sh
node scripts/update-data.mjs
node scripts/build.mjs
```

脚本先通过 `/athlete/0` 解析账号，再查询截至北京时间今天最近 365 天的完整活动并整体替换。API 字段为 `distance`（米）、`moving_time`（运动秒数）、`icu_training_load`；日期由 UTC 开始时间转换为北京时间。查询前后各扩大一天，再裁剪到最近 365 天，以覆盖时区边界。

只有查询成功、列表未达到上限、所有记录有效时才写入。API 失败、授权过期、超时、缺失运动时长、重复 ID 或疑似截断时保留旧文件并报告；不得把失败当作零条记录，不得复用 COROS 负荷补缺。同一天多次运动保留实际条数。

Strava API 明确返回的受限空壳只保留当地日期，在页面标注详情缺失，不计入总量；不得猜测详情或把它当成没有运动。

公开 JSON 顶层仅含 period:{start,end}、syncedAt、activities、unavailableActivities（仅含 date 的受限活动列表）；每条活动仅含 date、sport、distanceKm、duration、trainingLoad。缺失距离和负荷保留为 null。不发布活动标识、账号信息、坐标、心率、原始文件链接或凭据。

检查 git diff，日常数据更新应仅涉及 docs/activities.json 与 docs/index.html；出现异常删除先复核查询完整性。

## 提交与发布

用中文提交说明提交，push 更新 origin main；推送失败保留本地提交并报告，不得强推。不要调用 Sites/Cloudflare 发布，不要改动页面设计或新增功能。推送后检查该提交对应的 GitHub Pages 工作流直到成功或失败，成功后核对线上 activities.json 的 syncedAt、period.end 与本次一致。发布失败或线上未更新时在报告中说明。

## 报告

在最终报告中补充：网站是否已更新到最新数据；若未更新，说明原因。
