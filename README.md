# 我的运动记录

使用 Intervals.icu 真实记录的中文运动日志：[访问网站](https://pircate.github.io/movement-journal/)。

## 页面内容

展示截至北京时间当天最近 365 天的累计距离、运动时长、运动次数、最近一周的运动记录和全年活动热力图。可切换距离、时长和 Intervals.icu 训练负荷，也可用日期选择器或方向键查看每天的指标。

## 自动更新

每天北京时间 22:00 的「每日同步 Strava/Garmin/COROS 运动数据」任务完成三端同步后，按 [网站更新说明](docs/SITE-SYNC.md) 从 Intervals.icu 获取最近 365 天完整记录、更新本仓库并触发 GitHub Pages 发布。同步存在阻塞或失败、Intervals.icu 查询失败或返回无效记录时保留上一版数据。任务在本机 Codex 中执行，需要本机与 Codex 可运行、网络畅通且 Intervals.icu 与 GitHub 授权有效。

页面打开、从后台返回时都会绕过浏览器缓存读取 `docs/activities.json`，页面保持打开时每 5 分钟再检查一次。热力图每日自动滚动，尚未同步的日期不算作已确认没有运动的日期。

每条公开记录仅含北京时间日期、中文运动类型、距离、运动时长和训练负荷。缺失距离或负荷保留为 `null`；不发布坐标、心率、账号信息、原始活动标识或凭据。

## 同步脚本

使用 Node.js 22 或更新版本。先在仓库外配置环境变量：

- `INTERVALS_ICU_API_KEY`：从 [Intervals.icu 设置](https://intervals.icu/settings) 底部 Developer Settings 获取的个人 API Key。
- 或 `INTERVALS_ICU_TOKEN`：具有活动读取权限的现有 OAuth Token；同时配置时优先使用此项。

不要将凭据写入代码、公开 JSON 或 Git。脚本先解析当前账号，再查询最近 365 天的完整活动，每次整体替换，重复运行不会累积重复记录，也不会混入此前 COROS 来源的数据。

```sh
node scripts/update-data.mjs
node scripts/build.mjs
node --test scripts/update-data.test.mjs
```

字段来自 [官方 API 文档](https://intervals.icu/api-docs.html)：`distance` 从米转为公里，`moving_time` 为运动秒数，`icu_training_load` 为活动训练负荷。使用 UTC 开始时间 `start_date` 转换北京时间日期；API 查询范围两端各扩大一天，以覆盖跨时区活动。保留同一天的多次运动，不按日期去重。

API 不提供部分 Strava 来源活动的完整内容；这些记录仅在 `unavailableActivities` 中保留平台提供的当地日期，页面明确标注缺失，不计入距离、时长和次数。其他缺失运动时长、重复活动 ID、无效记录或达到查询上限的情况会让整次同步失败并保留旧文件。不使用旧来源的数据补齐；可读取活动缺失的距离和负荷保留为空。

同步与构建成功后，将更新文件提交并推送到 `main`，GitHub Pages 从 `docs/` 自动发布。网页只读取同源公开 JSON，凭据仅在本机脚本运行时使用。

## 本地预览

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory docs
```

访问 `http://127.0.0.1:8787/`。
