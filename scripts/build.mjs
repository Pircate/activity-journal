import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const data=JSON.parse(await readFile(new URL('../docs/activities.json',import.meta.url),'utf8'));
const {activities,period,syncedAt}=data;
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seconds=d=>d.split(':').reduce((s,v)=>s*60+Number(v),0);
const pretty=d=>d.replaceAll('-','.');
const time=s=>Math.floor(s/3600)+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
for(const a of activities){assert.deepEqual(Object.keys(a).sort(),['date','distanceKm','duration','sport','trainingLoad']);assert(a.date>=period.start&&a.date<=period.end);assert(a.distanceKm===null||Number.isFinite(a.distanceKm)&&a.distanceKm>=0);assert(a.trainingLoad===null||Number.isFinite(a.trainingLoad)&&a.trainingLoad>=0);}
const distance=activities.reduce((s,a)=>s+Math.round((a.distanceKm??0)*100),0)/100;
const duration=activities.reduce((s,a)=>s+seconds(a.duration),0);
const missingDistance=activities.filter(a=>a.distanceKm===null).length,missingLoad=activities.filter(a=>a.trainingLoad===null).length;
const sports=[...new Set(activities.map(a=>a.sport))].map(sport=>({sport,count:activities.filter(a=>a.sport===sport).length}));
const daily=[];
for(let date=new Date(period.start+'T00:00:00Z');date.toISOString().slice(0,10)<=period.end;date.setUTCDate(date.getUTCDate()+1)){
const d=date.toISOString().slice(0,10),records=activities.filter(a=>a.date===d);
daily.push({date:d,count:records.length,distanceKm:records.reduce((s,a)=>s+Math.round((a.distanceKm??0)*100),0)/100,durationSeconds:records.reduce((s,a)=>s+seconds(a.duration),0),trainingLoad:records.length&&records.every(a=>a.trainingLoad===null)?null:records.reduce((s,a)=>s+(a.trainingLoad??0),0),missingDistance:records.filter(a=>a.distanceKm===null).length,missingLoad:records.filter(a=>a.trainingLoad===null).length});
}
assert.equal(daily.length,365);assert.equal(Math.round(daily.reduce((s,d)=>s+d.distanceKm,0)*100),Math.round(distance*100));assert.equal(daily.reduce((s,d)=>s+d.durationSeconds,0),duration);
const activeDays=daily.filter(d=>d.count>0).length;
const startMonday=new Date(period.start+'T00:00:00Z');startMonday.setUTCDate(startMonday.getUTCDate()-((startMonday.getUTCDay()+6)%7));
const endSunday=new Date(period.end+'T00:00:00Z');endSunday.setUTCDate(endSunday.getUTCDate()+(7-endSunday.getUTCDay())%7);
const padded=[];for(let d=new Date(startMonday);d<=endSunday;d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10);padded.push(daily.find(x=>x.date===date)??{date,padding:true});}
const columns=padded.length/7;
const cells=padded.map(d=>d.padding?'<span class="day-cell padding" aria-hidden="true"></span>':'<button class="day-cell" type="button" data-date="'+d.date+'" tabindex="-1" aria-label="'+d.date+'，'+d.count+' 次运动"></button>').join('');
const months=[];padded.forEach((d,i)=>{if(d.date.endsWith('-01')&&d.date>=period.start&&d.date<=period.end)months.push({column:Math.floor(i/7)+1,label:Number(d.date.slice(5,7))+'月'});});
const monthLabels=months.map((m,i)=>'<span style="grid-column:'+m.column+'/'+(months[i+1]?.column??columns+1)+'">'+m.label+'</span>').join('');
const rows=activities.toSorted((a,b)=>b.date.localeCompare(a.date)).map(a=>'<tr data-date="'+a.date+'"><td><time datetime="'+a.date+'">'+pretty(a.date)+'</time></td><td><span class="sport-tag '+(a.sport==='徒步'?'hike-tag':'')+'">'+esc(a.sport)+'</span></td><td class="number">'+(a.distanceKm===null?'未记录':a.distanceKm.toFixed(2)+'<span class="unit"> 公里</span>')+'</td><td class="number duration-cell">'+a.duration+'</td><td class="number load-cell">'+(a.trainingLoad??'未记录')+'</td></tr>').join('');
const initialDate=daily.findLast(d=>d.count>0)?.date??period.end;
const favicon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#398afd"/><path d="M6 22V16M12 22V10M18 22V6M24 22V13" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const html=`<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101719">
<meta name="description" content="最近一年的真实运动记录：${activities.length} 次运动，${distance.toFixed(2)} 公里。查看距离、时长与训练负荷的全年活动热力图。">
<meta property="og:title" content="我的运动记录"><meta property="og:description" content="最近一年的运动累计与每日活动热力图。"><meta property="og:type" content="website">
<title>我的运动记录 · 最近一年</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}"><link rel="stylesheet" href="style.css"><script defer src="app.js"></script></head>
<body><a class="skip" href="#main">跳转到运动概览</a><div class="wrap">
<header><a class="brand" href="#main" aria-label="我的运动记录，回到概览"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>我的运动记录</a><nav aria-label="页面导航"><a href="#rhythm">全年活动</a><a href="#records">运动记录</a></nav></header>
<main id="main"><section class="hero" aria-labelledby="title"><div><p class="eyebrow">个人运动日志<span>最近一年</span></p><h1 id="title">我的运动记录</h1><p class="period"><time datetime="${period.start}">${pretty(period.start)}</time> — <time datetime="${period.end}">${pretty(period.end)}</time></p></div><div class="year-aside"><span class="year-number">365</span><span class="year-label">天的运动历程</span><div class="legend">${sports.map(s=>'<span class="legend-item">'+esc(s.sport)+' '+s.count+' 次</span>').join('')}</div></div></section>
<section class="metrics" aria-label="最近一年运动概览"><div class="metric"><div class="metric-label">累计距离</div><div class="metric-value primary">${distance.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}<small>公里</small></div><div class="metric-note">${missingDistance?'已记录距离 · '+missingDistance+' 次运动未提供距离':'骑行与徒步的总距离'}</div></div><div class="metric"><div class="metric-label">运动时长</div><div class="metric-value" aria-label="${Math.floor(duration/3600)} 小时 ${Math.floor(duration%3600/60)} 分 ${duration%60} 秒">${Math.floor(duration/3600)}<small>小时</small></div><div class="metric-note">精确时长 ${time(duration)}</div></div><div class="metric"><div class="metric-label">运动次数</div><div class="metric-value">${activities.length}<small>次</small></div><div class="metric-note">${activeDays} 天记录了运动</div></div></section>
<section class="chart-section" id="rhythm" aria-labelledby="rhythm-title"><div class="section-head"><h2 id="rhythm-title"><span class="section-number">01</span>全年活动</h2><div class="metric-switch" role="group" aria-label="热力图统计指标"><button type="button" data-metric="distanceKm" aria-pressed="true">距离</button><button type="button" data-metric="durationSeconds" aria-pressed="false">时长</button><button type="button" data-metric="trainingLoad" aria-pressed="false">负荷</button></div></div>
<div class="heatmap-card"><div class="heatmap-scroll" tabindex="0" aria-label="全年活动热力图，可横向滚动"><div class="heatmap" style="--columns:${columns}"><div class="day-grid" role="group" aria-label="全年每日活动，使用方向键选择日期">${cells}</div><div class="month-labels" aria-hidden="true">${monthLabels}</div></div></div>
<div class="heatmap-bottom"><p id="metric-explanation">颜色越亮，代表当天累计距离越多。</p><div class="heatmap-scale" aria-label="活动强度从少到多"><span>少</span><i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i><span>多</span></div></div><p class="mobile-hint">可横向滑动查看全年记录。</p>
<div class="day-inspector"><label for="selected-date">查看某一天</label><input id="selected-date" type="date" min="${period.start}" max="${period.end}" value="${initialDate}"><p id="day-description" aria-live="polite"></p></div>
<p class="chart-caption">每格代表一天，同一天的多次运动合并统计。灰色表示没有运动记录；斜线表示该指标未提供。负荷为 COROS 的活动训练负荷。${missingLoad?' '+missingLoad+' 次运动未提供负荷，统计时保留缺失标记。':''}</p><noscript><p>启用 JavaScript 后可查看热力图和切换指标；完整运动记录如下。</p></noscript></div></section>
<section class="records-section" id="records" aria-labelledby="records-title"><div class="section-head"><h2 id="records-title"><span class="section-number">02</span>一年内的运动记录</h2><p>共 ${activities.length} 条 · 最新记录在前</p></div><table class="records-table"><caption class="sr-only">一年内的全部运动记录。时长格式为小时:分钟:秒，或分钟:秒。负荷为 COROS 训练负荷。</caption><thead><tr><th scope="col">日期</th><th scope="col">运动</th><th scope="col">距离</th><th scope="col">时长</th><th scope="col">负荷</th></tr></thead><tbody>${rows}</tbody></table></section></main>
<footer><div><p class="footer-title">每一程，都是记录。</p><p>数据来自 COROS · 日期按北京时间展示</p></div><div class="footer-right"><p>同步于 <time>${syncedAt.replace(' +08:00','').replaceAll('-','.')}</time>（北京时间）</p><p class="footer-note">固定记录集 · 按需手动更新</p></div></footer></div>
<script type="application/json" id="daily-data">${JSON.stringify({period,daily,initialDate}).replaceAll('<','\\u003c')}</script></body></html>`;
await writeFile(new URL('../docs/index.html',import.meta.url),html);
console.log(JSON.stringify({records:activities.length,distanceKm:distance,durationSeconds:duration,activeDays,days:daily.length,missingDistance,missingLoad,privacyFieldsVerified:true}));

