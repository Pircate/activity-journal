import {sportLabel} from '../docs/activity-data.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createJournal, formatTime as time, formatDistance, escapeHtml as esc, validateData, renderGearLibrary, renderDayRecords, renderYearOptions, renderSportFilter, dayStateLabels, renderHeatmapStates} from '../docs/journal.mjs';
import {filterActivities, historyPageSize} from '../docs/history.mjs';
import {renderCalendar} from '../docs/calendar.mjs';
import {renderTrendPanel} from '../docs/trends.mjs';
import {renderPersonalBestsPanel, validatePersonalBests} from '../docs/personal-bests.mjs';
import {renderMilestonePanel} from '../docs/milestones.mjs';
import {renderReportPanel} from '../docs/reports.mjs';
export async function buildHtml({data, personalBests, profile}) {
validatePersonalBests(personalBests);
validateData(data);
profile ??= JSON.parse(await readFile(new URL('../data/profile.json',import.meta.url),'utf8'));
if (Object.keys(profile).sort().join(',') !== 'location,name,stravaUrl' || typeof profile.name!=='string' || !profile.name.trim() || typeof profile.location!=='string' || typeof profile.stravaUrl!=='string' || !/^https:\/\/www\.strava\.com\/athletes\/\d+$/.test(profile.stravaUrl)) throw new Error('个人资料格式无效');
const siteTitle=profile.name+'的运动日志';
const description=[siteTitle,profile.location].filter(Boolean).join('，')+'。查看近期运动与全年活动。';
const ogDescription=[profile.location,'日常运动记录'].filter(Boolean).join('，')+'。';
const journal = createJournal(data);
const {activities,recent,recentSummary,period,syncedAt,daily,distance,duration,activeDays,missingDistance,missingLoad,unavailableCount,sports,columns,cells,monthLabels,cards,initialDate}=journal;
const pretty=d=>d.replaceAll('-','.');
const initialRecords=daily.find(day=>day.date===initialDate).records;
const historyRecords=filterActivities(data.activities).slice(0,historyPageSize);
const historySports=[...new Set(data.activities.map(activity=>activity.sport))].sort((a,b)=>sportLabel(a).localeCompare(sportLabel(b),'zh-CN'));
assert.equal(daily.length,365);
assert.ok(Math.abs(daily.reduce((s,d)=>s+(d.distanceKm ?? 0),0)-(distance ?? 0)) <= 1e-9*Math.max(1,distance ?? 0));
// 用内容哈希做缓存失效：改样式或脚本后，浏览器一定会重新拉取。
const assetFiles=['activity-data.mjs','style.css','app.js','journal.mjs','history.mjs','trends.mjs','calendar.mjs','personal-bests.mjs','milestones.mjs','reports.mjs'];
const assetVersion=createHash('sha256').update((await Promise.all(assetFiles.map(name=>readFile(new URL('../docs/'+name,import.meta.url))))).join('\0')).digest('hex').slice(0,8);
const favicon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#fc4c02"/><path d="M6 22V16M12 22V10M18 22V6M24 22V13" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const html=`<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#131313">
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(siteTitle)}"><meta property="og:description" content="${esc(ogDescription)}"><meta property="og:type" content="website">
<title>${esc(siteTitle)} · 最近一年</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}"><link rel="stylesheet" href="style.css?v=${assetVersion}"><script type="module" src="app.js?v=${assetVersion}"></script></head>
<body><a class="skip" href="#main">跳转到运动概览</a><div class="wrap">
<header><a class="brand" href="#main" aria-label="${esc(siteTitle)}，回到概览"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${esc(siteTitle)}</a><nav aria-label="页面导航"><a href="#records">记录</a><a href="#rhythm">活动</a><a href="#trends">趋势</a><a href="#personal-bests">最佳</a><a href="#milestones">里程碑</a><a href="#reports">分享</a><a href="#gear">装备</a></nav></header>
<main id="main"><div class="intro"><section class="hero profile" aria-labelledby="title"><div class="profile-identity"><h1 id="title">${esc(profile.name)}</h1><div class="profile-meta">${profile.location ? `<p class="profile-location">${esc(profile.location)}</p>` : ''}<a class="strava-link" href="${esc(profile.stravaUrl)}" target="_blank" rel="noopener noreferrer">在 Strava 查看 <span aria-hidden="true">↗</span><span class="sr-only">（新标签页）</span></a></div></div></section>
<div class="recent-summary" aria-label="最近七天运动摘要">${recentSummary}</div></div>
<section class="records-section" id="records" aria-labelledby="records-title"><div class="section-head"><h2 id="records-title"><span class="section-number">01</span>最近一周</h2><p>${recent.length?recent.length+' 次运动':'最近一周还没有运动记录'}</p></div><div class="records-grid">${cards}</div>

<details class="history-panel" id="history"><summary class="history-heading"><span>全部历史记录</span><span><span id="history-total">${data.activities.length} 条活动</span><svg class="history-toggle" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span></summary>
<div class="history-content">
<form id="history-filters" class="history-filters" aria-label="历史运动筛选">
<div class="history-field"><label for="history-start">开始日期</label><input type="date" id="history-start"></div>
<div class="history-field"><label for="history-end">结束日期</label><input type="date" id="history-end"></div>
<div class="history-field"><label for="history-sport">运动类型</label><select id="history-sport"><option value="">全部运动</option>${historySports.map(sport=>`<option value="${esc(sport)}">${esc(sportLabel(sport))}</option>`).join('')}</select></div>
<div class="history-field"><label for="history-min-distance">最短距离（km）</label><input type="number" id="history-min-distance" min="0" step="any" inputmode="decimal" placeholder="不限"></div>
<div class="history-field"><label for="history-max-distance">最长距离（km）</label><input type="number" id="history-max-distance" min="0" step="any" inputmode="decimal" placeholder="不限"></div>
<div class="history-field"><label for="history-sort">排序方式</label><select id="history-sort"><option value="date-desc">日期：最新在前</option><option value="date-asc">日期：最早在前</option><option value="distance-desc">距离：从长到短</option><option value="distance-asc">距离：从短到长</option><option value="duration-desc">时长：从长到短</option><option value="duration-asc">时长：从短到长</option></select></div>
<div class="history-actions"><button type="submit" class="history-apply">应用筛选</button><button type="button" id="history-reset">重置</button></div></form>
<p id="history-error" class="history-error" role="alert" hidden></p>
<p id="history-count" class="history-count" role="status" aria-live="polite">共 ${data.activities.length} 条${data.activities.length?' · 显示第 1–'+historyRecords.length+' 条':''}</p>
<div id="history-results">${renderDayRecords(historyRecords,'历史运动记录') || '<p class="history-empty">尚无可读取的历史运动记录。</p>'}</div>
<nav class="history-pagination" aria-label="历史记录分页"><button type="button" id="history-previous" disabled>上一页</button><span id="history-page">第 1 / ${Math.max(1,Math.ceil(data.activities.length/historyPageSize))} 页</span><button type="button" id="history-next"${data.activities.length<=historyPageSize?' disabled':''}>下一页</button></nav>
<p id="history-note" class="history-intro"${data.unavailableActivities.length?'':' hidden'}>${data.unavailableActivities.length?'全部历史另有 '+data.unavailableActivities.length+' 条'+dayStateLabels.unavailable+'的记录，未列入此列表。':''}</p>
<noscript><p>启用 JavaScript 后可使用筛选、排序和翻页。</p></noscript></div></details></section>
<section class="chart-section" id="rhythm" aria-labelledby="rhythm-title"><div class="section-head"><h2 id="rhythm-title"><span class="section-number">02</span>全年活动</h2><div class="activity-controls"><div class="year-filter"><label for="activity-year">查看范围</label><select id="activity-year">${renderYearOptions(data)}</select></div><div class="metric-switch" role="group" aria-label="每日活动统计指标"><button type="button" data-metric="distanceKm" aria-pressed="true">距离</button><button type="button" data-metric="durationSeconds" aria-pressed="false">时长</button><button type="button" data-metric="trainingLoad" aria-pressed="false">负荷</button></div></div></div>
<div class="heatmap-card" data-mobile-view="month"><div class="annual-overview"><div class="overview-heading"><div><p class="overview-range">最近一年</p><p class="period"><time datetime="${period.start}">${pretty(period.start)}</time> — <time datetime="${period.end}">${pretty(period.end)}</time></p></div><div class="year-aside"><span class="year-number">365</span><span class="year-label">天的运动历程</span></div></div>
<section class="metrics" aria-label="最近一年运动概览"><div class="metric"><div class="metric-label">累计距离</div><div class="metric-value primary">${distance === null ? '—' : formatDistance(distance)}<small>km</small></div><div class="metric-note"${missingDistance?'':' hidden'}>${missingDistance?missingDistance+' 次距离未提供':''}</div></div><div class="metric"><div class="metric-label">运动时长</div><div class="metric-value" aria-label="${Math.floor(duration/3600)} 小时 ${Math.floor(duration%3600/60)} 分 ${duration%60} 秒">${time(duration)}</div><div class="metric-note">时 : 分 : 秒</div></div><div class="metric"><div class="metric-label">运动次数</div><div class="metric-value">${activities.length}<small>次</small></div><div class="metric-note">${activeDays} 个活跃日${unavailableCount?' · '+unavailableCount+' 条详情不可读取':''}</div></div></section>
<div class="sport-filter"><p class="sport-filter-heading"><span>运动类型分布</span><span id="sport-filter-status"></span></p><div class="legend" id="sport-filter" role="group" aria-label="按运动类型筛选年度范围">${renderSportFilter(sports)}</div></div></div>
<div class="mobile-view-switch metric-switch" role="group" aria-label="每日活动视图"><button type="button" data-activity-view="month" aria-pressed="true">月历</button><button type="button" data-activity-view="year" aria-pressed="false">全年热力图</button></div>
<div class="calendar-view" id="calendar"><div class="calendar-toolbar"><button type="button" id="calendar-previous" aria-label="上个月"${initialDate.slice(0,7)===period.start.slice(0,7)?' disabled':''}>←</button><h3 id="calendar-month" aria-live="polite">${initialDate.slice(0,4)} 年 ${Number(initialDate.slice(5,7))} 月</h3><button type="button" id="calendar-next" aria-label="下个月"${initialDate.slice(0,7)===period.end.slice(0,7)?' disabled':''}>→</button></div><div class="calendar-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div id="calendar-days" class="calendar-days" role="group" aria-labelledby="calendar-month">${renderCalendar(daily,initialDate)}</div></div>
<div class="heatmap-scroll" tabindex="0" aria-label="全年活动热力图，可横向滚动"><div class="heatmap" style="--columns:${columns}"><div class="month-labels" aria-hidden="true">${monthLabels}</div><div class="weekday-labels" aria-hidden="true"><span>周一</span><span></span><span>周三</span><span></span><span>周五</span><span></span><span></span></div><div class="day-grid" role="group" aria-label="全年每日活动，使用方向键选择日期">${cells}</div><div class="weekday-labels weekday-labels-right" aria-hidden="true"><span></span><span>周二</span><span></span><span>周四</span><span></span><span>周六</span><span></span></div></div></div>
<div class="heatmap-bottom"><div class="heatmap-scale" aria-label="活动强度从少到多"><span>少</span><i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i><span>多</span></div></div>${renderHeatmapStates()}
<div class="day-inspector"><label for="selected-date">查看某一天</label><input id="selected-date" type="date" min="${period.start}" max="${period.end}" value="${initialDate}"><button type="button" id="back-to-today">回到今天</button><p id="day-description" aria-live="polite"></p></div>
<div id="day-records"${initialRecords.length ? '' : ' hidden'}>${renderDayRecords(initialRecords)}</div>
<noscript><p>启用 JavaScript 后可查看热力图和切换指标；上方为最近一周的运动记录。</p></noscript></div></section>
${renderTrendPanel(data)}
${renderPersonalBestsPanel(personalBests)}
${renderMilestonePanel(data)}
${renderReportPanel(data)}
<section class="gear-section" id="gear" aria-labelledby="gear-title"><div class="section-head"><h2 id="gear-title"><span class="section-number">07</span>运动装备</h2><p>累计使用</p></div>
<div class="gear-library">${renderGearLibrary(data.gearLibrary)}</div>
</section>
</main>
<footer><p>数据来自 Intervals.icu · Strava · COROS</p><div class="footer-right"><p>同步于 <time id="sync-time">${syncedAt.replace(' +08:00','').replaceAll('-','.')}</time>（北京时间）</p><p id="sync-status" role="status" aria-live="polite"></p></div></footer></div>
<script type="application/json" id="personal-bests-data">${JSON.stringify(personalBests).replaceAll('<','\\u003c')}</script>
<script type="application/json" id="journal-data">${JSON.stringify(data).replaceAll('<','\\u003c')}</script></body></html>`;
return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = JSON.parse(await readFile(new URL('../docs/activities.json', import.meta.url), 'utf8'));
  const personalBests = JSON.parse(await readFile(new URL('../docs/personal-bests.json', import.meta.url), 'utf8'));
  await writeFile(new URL('../docs/index.html', import.meta.url), await buildHtml({data, personalBests}));
  console.log(JSON.stringify({records:data.activities.length, privacyFieldsVerified:true}));
}
