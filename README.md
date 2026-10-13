# 我的运动记录

使用 COROS 真实记录的中文运动日志：[访问网站](https://pircate.github.io/movement-journal/)。

## 页面内容

展示截至北京时间当天最近 365 天的累计距离、运动时长、运动次数、每日活动热力图和运动明细。可切换距离、时长和 COROS 训练负荷，也可用日期选择器或方向键查看每天的指标。

## 自动更新

Codex 中的「每小时更新运动记录网站」自动任务，每小时通过已连接的 COROS 账号查询活动，将数据提交到本仓库，由 GitHub Pages 自动发布。任务在本机 Codex 中执行，需要本机与 Codex 可运行、网络畅通且 COROS 与 GitHub 授权有效。网站可以随时访问；本机离线时显示最近成功同步的数据。

页面打开、从后台返回时都会绕过浏览器缓存读取 `docs/activities.json`，页面保持打开时每 5 分钟再检查一次。页脚显示实际成功同步时间；超过两小时或尚未同步当天时显示等待提示。热力图每日自动滚动，尚未同步的日期不算作已确认没有运动的日期。

每条公开记录仅含日期、运动类型、距离、运动时长和训练负荷。缺失值保留为 `null`；不发布坐标、心率、账号信息、原始活动标识或凭据。

## 同步脚本

自动任务先将 COROS 结果规范化为 JSON 文件，保存在仓库外的工作目录，格式为：

```json
{
  "period": {"start": "2026-10-08", "end": "2026-10-13"},
  "syncedAt": "2026-10-13 15:44:58 +08:00",
  "activities": [
    {"date": "2026-10-11", "sport": "骑行", "distanceKm": 24.55, "duration": "1:00:04", "trainingLoad": 79}
  ]
}
```

此文件必须包含查询日期范围内的完整记录，包括同一天的多次运动。查询失败或截断时不得导入。`duration` 使用 COROS 的运动时长，不能用总时间或起止时间差替代。

使用 Node.js 22 或更新版本执行：

```sh
node scripts/update-data.mjs /绝对路径/latest.json
node scripts/build.mjs
```

`update-data.mjs` 校验数据、拒绝过期或存在日期缺口的输入，按完整日期范围替换已有记录，并保留最近 365 天。重复同步不会追加重复记录。`build.mjs` 与浏览器共享 `docs/journal.mjs` 的日期和汇总逻辑。

将更新后的 `docs/activities.json` 与 `docs/index.html` 一起提交并推送到 `main`。GitHub Pages 从 `docs/` 自动发布。网页直接读取同源 JSON，不依赖 Cloudflare 或 COROS 浏览器登录。

## 本地预览

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory docs
```

访问 `http://127.0.0.1:8787/`。
