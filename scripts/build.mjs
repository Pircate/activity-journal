import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const data=JSON.parse(await readFile(new URL('../docs/activities.json',import.meta.url),'utf8'));
import {createJournal, formatTime as time, escapeHtml as esc, validateData, renderGearLibrary, renderDayRecords, renderYearOptions} from '../docs/journal.mjs';
import {filterActivities, historyPageSize} from '../docs/history.mjs';
validateData(data);
const {activities,recent,recentSummary,period,syncedAt,daily,distance,duration,activeDays,missingDistance,missingLoad,unavailableCount,sports,columns,cells,monthLabels,cards,initialDate}=createJournal(data);
const pretty=d=>d.replaceAll('-','.');
const initialRecords=daily.find(day=>day.date===initialDate).records;
const historyRecords=filterActivities(data.activities).slice(0,historyPageSize);
const historySports=[...new Set(data.activities.map(activity=>activity.sport))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
assert.equal(daily.length,365);
assert.equal(Math.round(daily.reduce((s,d)=>s+d.distanceKm,0)*100),Math.round(distance*100));
// 用内容哈希做缓存失效：改样式或脚本后，浏览器一定会重新拉取。
const assetFiles=['style.css','app.js','journal.mjs','history.mjs'];
const assetVersion=createHash('sha256').update((await Promise.all(assetFiles.map(name=>readFile(new URL('../docs/'+name,import.meta.url))))).join('\0')).digest('hex').slice(0,8);
const favicon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#fc4c02"/><path d="M6 22V16M12 22V10M18 22V6M24 22V13" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const html=`<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#131313">
<meta name="description" content="最近一年的真实运动记录：${activities.length} 次运动，${distance.toFixed(2)} 公里。查看距离、时长与训练负荷的全年活动热力图。">
<meta property="og:title" content="我的运动记录"><meta property="og:description" content="最近一年的运动累计与每日活动热力图。"><meta property="og:type" content="website">
<title>我的运动记录 · 最近一年</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}"><link rel="stylesheet" href="style.css?v=${assetVersion}"><script type="module" src="app.js?v=${assetVersion}"></script></head>
<body><a class="skip" href="#main">跳转到运动概览</a><div class="wrap">
<header><a class="brand" href="#main" aria-label="我的运动记录，回到概览"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>我的运动记录</a><nav aria-label="页面导航"><a href="#records">运动记录</a><a href="#rhythm">全年活动</a><a href="#gear">运动装备库</a></nav></header>
<main id="main"><section class="hero" aria-labelledby="title"><p class="eyebrow">个人运动日志</p><h1 id="title">我的运动记录</h1><div class="recent-summary" aria-label="最近七天运动摘要">${recentSummary}</div></section>
<section class="records-section" id="records" aria-labelledby="records-title"><div class="section-head"><h2 id="records-title"><span class="section-number">01</span>最近一周的运动记录</h2><p>${recent.length?'共 '+recent.length+' 条 · 最新记录在前':'最近一周还没有运动记录'}</p></div><div class="records-grid">${cards}</div>
<details class="history-panel" id="history"><summary class="history-heading"><span>查看全部历史记录</span><span><span id="history-total">${data.activities.length} 条活动</span><span class="history-toggle" aria-hidden="true">⌄</span></span></summary>
<div class="history-content"><p class="history-intro">查询全部已同步记录，不受年度统计范围影响。日期按北京时间筛选；设置距离条件后，仅显示已提供距离的记录。</p>
<form id="history-filters" class="history-filters" aria-label="历史运动筛选">
<div class="history-field"><label for="history-start">开始日期</label><input type="date" id="history-start"></div>
<div class="history-field"><label for="history-end">结束日期</label><input type="date" id="history-end"></div>
<div class="history-field"><label for="history-sport">运动类型</label><select id="history-sport"><option value="">全部运动</option>${historySports.map(sport=>`<option value="${esc(sport)}">${esc(sport)}</option>`).join('')}</select></div>
<div class="history-field"><label for="history-min-distance">最短距离（km）</label><input type="number" id="history-min-distance" min="0" step="any" inputmode="decimal" placeholder="不限"></div>
<div class="history-field"><label for="history-max-distance">最长距离（km）</label><input type="number" id="history-max-distance" min="0" step="any" inputmode="decimal" placeholder="不限"></div>
<div class="history-field"><label for="history-sort">排序方式</label><select id="history-sort"><option value="date-desc">日期：最新在前</option><option value="date-asc">日期：最早在前</option><option value="distance-desc">距离：从长到短</option><option value="distance-asc">距离：从短到长</option><option value="duration-desc">时长：从长到短</option><option value="duration-asc">时长：从短到长</option></select></div>
<div class="history-actions"><button type="submit" class="history-apply">应用筛选</button><button type="button" id="history-reset">重置</button></div></form>
<p id="history-error" class="history-error" role="alert" hidden></p>
<p id="history-count" class="history-count" role="status" aria-live="polite">共 ${data.activities.length} 条${data.activities.length?' · 显示第 1–'+historyRecords.length+' 条':''}</p>
<div id="history-results">${renderDayRecords(historyRecords,'历史运动记录') || '<p class="history-empty">尚无可读取的历史运动记录。</p>'}</div>
<nav class="history-pagination" aria-label="历史记录分页"><button type="button" id="history-previous" disabled>上一页</button><span id="history-page">第 1 / ${Math.max(1,Math.ceil(data.activities.length/historyPageSize))} 页</span><button type="button" id="history-next"${data.activities.length<=historyPageSize?' disabled':''}>下一页</button></nav>
<p id="history-note" class="history-intro"${data.unavailableActivities.length?'':' hidden'}>${data.unavailableActivities.length?'全部历史另有 '+data.unavailableActivities.length+' 条运动详情无法读取，未列入此列表。':''}</p>
<noscript><p>启用 JavaScript 后可使用筛选、排序和翻页。</p></noscript></div></details></section>
<section class="chart-section" id="rhythm" aria-labelledby="rhythm-title"><div class="section-head"><h2 id="rhythm-title"><span class="section-number">02</span>全年活动</h2><div class="activity-controls"><div class="year-filter"><label for="activity-year">查看范围</label><select id="activity-year">${renderYearOptions(data)}</select></div><div class="metric-switch" role="group" aria-label="热力图统计指标"><button type="button" data-metric="distanceKm" aria-pressed="true">距离</button><button type="button" data-metric="durationSeconds" aria-pressed="false">时长</button><button type="button" data-metric="trainingLoad" aria-pressed="false">负荷</button></div></div></div>
<div class="heatmap-card"><div class="annual-overview"><div class="overview-heading"><div><p class="overview-range">最近一年</p><p class="period"><time datetime="${period.start}">${pretty(period.start)}</time> — <time datetime="${period.end}">${pretty(period.end)}</time></p></div><div class="year-aside"><span class="year-number">365</span><span class="year-label">天的运动历程</span></div></div>
<section class="metrics" aria-label="最近一年运动概览"><div class="metric"><div class="metric-label">累计距离</div><div class="metric-value primary">${distance.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}<small>公里</small></div><div class="metric-note">${missingDistance?'已记录距离 · '+missingDistance+' 次运动未提供距离':'可读取运动的总距离'}</div></div><div class="metric"><div class="metric-label">运动时长</div><div class="metric-value" aria-label="${Math.floor(duration/3600)} 小时 ${Math.floor(duration%3600/60)} 分 ${duration%60} 秒">${Math.floor(duration/3600)}<small>小时</small></div><div class="metric-note">精确时长 ${time(duration)}</div></div><div class="metric"><div class="metric-label">运动次数</div><div class="metric-value">${activities.length}<small>次</small></div><div class="metric-note">${activeDays} 天记录了运动${unavailableCount?' · 另有 '+unavailableCount+' 次详情无法读取':''}</div></div></section>
<div class="legend" aria-label="运动类型分布">${sports.map(s=>'<span class="legend-item">'+esc(s.sport)+' <strong>'+s.count+'</strong> 次</span>').join('')}</div></div>
<div class="heatmap-scroll" tabindex="0" aria-label="全年活动热力图，可横向滚动"><div class="heatmap" style="--columns:${columns}"><div class="month-labels" aria-hidden="true">${monthLabels}</div><div class="weekday-labels" aria-hidden="true"><span>周一</span><span></span><span>周三</span><span></span><span>周五</span><span></span><span></span></div><div class="day-grid" role="group" aria-label="全年每日活动，使用方向键选择日期">${cells}</div><div class="weekday-labels weekday-labels-right" aria-hidden="true"><span></span><span>周二</span><span></span><span>周四</span><span></span><span>周六</span><span></span></div></div></div>
<div class="heatmap-bottom"><p id="metric-explanation">颜色越亮，代表当天累计距离越多。</p><div class="heatmap-scale" aria-label="活动强度从少到多"><span>少</span><i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i><span>多</span></div></div><p class="mobile-hint">可横向滑动查看全年记录。</p>
<div class="day-inspector"><label for="selected-date">查看某一天</label><input id="selected-date" type="date" min="${period.start}" max="${period.end}" value="${initialDate}"><p id="day-description" aria-live="polite"></p></div>
<div id="day-records"${initialRecords.length ? '' : ' hidden'}>${renderDayRecords(initialRecords)}</div>
<p class="chart-caption">每格代表一天，同一天的多次运动合并统计。灰色表示没有运动记录；斜线表示该指标未提供。负荷为 Intervals.icu 的活动训练负荷。${missingLoad?' '+missingLoad+' 次运动未提供负荷，统计时保留缺失标记。':''}${unavailableCount?' 另有 '+unavailableCount+' 次 Strava 运动详情无法读取，未计入距离、时长和次数；对应日期按平台当地日期标注缺失。':''}</p><noscript><p>启用 JavaScript 后可查看热力图和切换指标；上方为最近一周的运动记录。</p></noscript></div></section>
<section class="gear-section" id="gear" aria-labelledby="gear-title"><div class="section-head"><h2 id="gear-title"><span class="section-number">03</span>运动装备库</h2><p>累计使用 · 独立于年度统计</p></div>
<div class="gear-library">${renderGearLibrary(data.gearLibrary)}</div>
<p class="gear-caption">建议更换里程：链条、前后胎 5000 km，飞轮 10000 km，牙盘 30000 km。以上里程仅为维护参考，不代表实际磨损程度。更换后，在 Intervals.icu 重置配件的“更换”提醒；日期和里程随每日同步更新。</p></section>
</main>
<footer><div><p class="footer-title">每一程，都是记录。</p><p>数据来自 Intervals.icu · 力量训练组数来自 COROS</p><p>日期按北京时间展示</p></div><div class="footer-right"><p>同步于 <time id="sync-time">${syncedAt.replace(' +08:00','').replaceAll('-','.')}</time>（北京时间）</p><p class="footer-note">每天 22:00 同步后更新 · 打开时读取最新数据</p><p id="sync-status" role="status" aria-live="polite"></p></div></footer></div>
<script type="application/json" id="journal-data">${JSON.stringify(data).replaceAll('<','\\u003c')}</script></body></html>`;
await writeFile(new URL('../docs/index.html',import.meta.url),html);
console.log(JSON.stringify({records:activities.length,distanceKm:distance,durationSeconds:duration,activeDays,days:daily.length,missingDistance,missingLoad,privacyFieldsVerified:true}));

