import {sportLabel} from '../docs/activity-data.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReport, reportSummary, renderReportPanel, initializeReports, drawReport} from '../docs/reports.mjs';

const activity = (date, values = {}) => ({date, sport:'Run', distanceKm:5.25, durationSeconds:1800, trainingLoad:20, activityUrl:'https://intervals.icu/activities/i1', ...values});
const fixture = (activities = [], values = {}) => ({period:{start:'2023-01-01', end:'2026-10-16'}, syncedAt:'2026-10-16 16:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:{active:[],retired:[]}, ...values});
const today = '2026-10-16';

test('自然月包含首尾与同日多次活动，闰月不跨到相邻月份', () => {
  const data = fixture([activity('2024-01-31'), activity('2024-02-01'), activity('2024-02-29'), activity('2024-02-29'), activity('2024-03-01')]);
  const report = createReport(data, 'month', '2024-02', today);
  assert.equal(report.start, '2024-02-01');
  assert.equal(report.end, '2024-02-29');
  assert.equal(report.count, 3);
  assert.equal(report.activeDays, 2);
  assert.equal(report.distanceKm, 15.75);
  assert.equal(report.durationSeconds, 5400);
  assert.equal(report.buckets.length, 29);
  assert.equal(report.buckets.at(-1).count, 2);
  assert.equal(report.sports[0].sport, 'Run');
  assert.equal(report.sports[0].count, 3);
  assert.equal(report.sports[0].distanceKm, 15.75);
  assert.equal(report.sports[0].durationSeconds, 5400);
  assert.equal(report.sports[0].trainingLoad, 60);
  assert.equal(report.trainingLoad, 60);
});

test('年报按自然年汇总，本月本年只统计北京时间今天及以前', () => {
  const data = fixture([activity('2025-12-31'), activity('2026-01-01'), activity(today), activity('2026-10-17')]);
  const annual = createReport(data, 'year', '2026', today);
  assert.equal(annual.count, 2);
  assert.equal(annual.ongoing, true);
  assert.equal(annual.end, today);
  assert.equal(annual.pendingDays, 0, '尚未发生的日期不累计为已过周期未同步天数');
  assert.equal(annual.buckets.length, 10);
  assert.equal(annual.buckets.at(-1).label, '10');
  const month = createReport(data, 'month', '2026-10', today);
  assert.equal(month.count, 1);
  assert.equal(month.buckets.length, 16, '今天之后不保留柱子及占位');
  assert.equal(month.buckets.at(-1).label, '16');
  assert.equal(month.buckets.at(-1).incomplete, false);
  assert.match(reportSummary(month), /周期进行中/);
  assert.equal(createReport(data, 'year', '2025', today).ongoing, false);
});

test('已同步无活动为零；未同步或仅不可读取时不伪造零运动', () => {
  const data = fixture();
  assert.equal(createReport(data, 'month', '2024-02', today).count, 0);
  const pending = createReport(fixture([], {period:{start:'2023-01-01', end:'2024-02-01'}}), 'month', '2024-02', today);
  assert.equal(pending.pendingDays, 28);
  assert.equal(pending.distanceKm, null);
  assert.equal(pending.count, null);
  assert.match(pending.notes.join(' '), /未同步 28 天/);
  const unavailable = createReport(fixture([], {unavailableActivities:[{date:'2024-02-10'}]}), 'month', '2024-02', today);
  assert.equal(unavailable.count, null);
  assert.equal(unavailable.unavailable, 1);
  assert.match(reportSummary(unavailable), /详情不可读取 1 条/);
});

test('部分距离缺失仅合计可读值，力量训练距离不误报应有指标缺失', () => {
  const data = fixture([activity('2024-02-01', {distanceKm:null}), activity('2024-02-02'), activity('2024-02-03', {sport:'WeightTraining', distanceKm:null, sets:12, averageHeartRate:100})], {unavailableActivities:[{date:'2024-02-15'}]});
  const report = createReport(data, 'month', '2024-02', today);
  assert.equal(report.count, 3);
  assert.equal(report.distanceKm, 5.25);
  assert.equal(report.missingMetrics, 1);
  assert.equal(report.missingDistance, 1);
  assert.equal(report.unavailable, 1);
  assert.equal(createReport(fixture([activity('2024-02-01', {distanceKm:null})]), 'month', '2024-02', today).distanceKm, null);
  assert.equal(createReport(fixture([activity('2024-02-01', {distanceKm:0})]), 'month', '2024-02', today).distanceKm, 0);
});

test('总负荷与各运动距离、时长、次数、负荷一致，未知负荷不伪装为零', () => {
  const data = fixture([
    activity('2024-02-01', {trainingLoad:null}),
    activity('2024-02-02', {sport:'Ride', distanceKm:30, trainingLoad:0}),
    activity('2024-02-03', {sport:'Ride', distanceKm:50, trainingLoad:70}),
    activity('2024-02-03', {sport:'WeightTraining', distanceKm:null, sets:3, averageHeartRate:110, trainingLoad:10}),
  ]);
  const report = createReport(data, 'month', '2024-02', today);
  assert.equal(report.trainingLoad, 80);
  assert.equal(report.missingLoad, 1);
  const running = report.sports.find(item => item.sport === 'Run');
  assert.equal(running.trainingLoad, null);
  const riding = report.sports.find(item => item.sport === 'Ride');
  assert.equal(riding.distanceKm, 80);
  assert.equal(riding.count, 2);
  assert.equal(riding.durationSeconds, 3600);
  assert.equal(riding.trainingLoad, 70);
  for (const key of ['count', 'durationSeconds', 'trainingLoad']) assert.equal(report.sports.reduce((sum, item) => sum + (item[key] ?? 0), 0), report[key]);
  assert.match(report.notes.join(' '), /负荷未提供 1 次/);
  assert.equal(createReport(fixture([activity('2024-02-01', {trainingLoad:null})]), 'month', '2024-02', today).trainingLoad, null);
  assert.equal(report.buckets[0].missingLoad, 1);
  assert.equal(report.buckets[1].trainingLoad, 0);
  assert.match(reportSummary(report), /总负荷 80 TL/);
  assert.match(reportSummary(report), /骑行 2 次 \/ 80\.00 km \/ 1 小时 0 分钟 \/ 70 TL/);
});

test('图片支持四项图表指标，完整显示所有运动统计，图片高度容纳明细', () => {
  const data = fixture(['Run','Ride','Walk','Swim','Hike','Workout','TrailRun'].map(sport => activity(today, {sport})));
  const report = createReport(data, 'month', '2026-10', today);
  for (const metric of ['distanceKm', 'durationSeconds', 'count', 'trainingLoad']) {
    const texts = [];
    const canvas = {getContext:() => ({font:'', fillRect() {}, strokeRect() {}, measureText:value => ({width:String(value).length * 8}), fillText(value, x, y) {texts.push({value, y});}})};
    drawReport(canvas, report, '测试', metric);
    for (const sport of report.sports) assert.ok(texts.some(text => text.value === sportLabel(sport.sport)), '所有运动类型都有明细');
    assert.ok(texts.some(text => text.value === '负荷'));
    for (const legacy of ['距离 / km', '负荷 / TL']) assert.equal(texts.some(text => text.value === legacy), false, '表头不再携带单位');
    assert.ok(texts.every(text => text.y < canvas.height));
    assert.ok(canvas.height > 1440, '明细较多时自动增加图片高度');
    assert.equal(texts.some(text => text.value === '未开始'), false);
  }
});

test('时长精确到分钟并以小字号单位呈现，距离与负荷带单位且标题不含单位', () => {
  const report = createReport(fixture([activity('2024-02-01', {durationSeconds:9000})]), 'month', '2024-02', today);
  const calls = [];
  const canvas = {getContext:() => ({
    font:'',
    fillRect() {},
    measureText:value => ({width:String(value).length * 8}),
    fillText(value, x, y) {calls.push({value, size:Number(this.font.match(/(\d+)px/)[1]), color:this.fillStyle, x, y});},
  })};
  drawReport(canvas, report, '测试');
  const row = calls.filter(call => call.y === 704).sort((a, b) => a.x - b.x);
  assert.deepEqual(row.map(call => call.value), ['2', 'h', '30', 'min', '1', '次', '20', 'TL']);
  for (const value of ['2', '30', '1', '20']) assert.equal(row.find(call => call.value === value).size, 43);
  for (const unit of ['h', 'min', '次', 'TL']) assert.ok(row.find(call => call.value === unit).size < 43, '单位使用小字号');
  const distance = calls.filter(call => call.y === 522).sort((a, b) => a.x - b.x);
  assert.deepEqual(distance.map(call => call.value), ['5.25', 'km']);
  assert.ok(distance[1].size < distance[0].size);
  for (const [unit, value] of [['h', '2'], ['min', '30'], ['次', '1'], ['TL', '20']]) assert.notEqual(calls.find(call => call.value === unit).color, calls.find(call => call.value === value).color, '单位颜色与数字区分');
  assert.equal(calls.find(call => call.value === 'km').color, calls.find(call => call.value === '5.25').color, '橙色主视觉单位沿用墨色');
  assert.ok(calls.find(call => call.value === 'km').size < calls.find(call => call.value === '5.25').size, '主视觉单位仅以字号区分');
  assert.ok(calls.some(call => call.value === '日均距离' && call.y === 888 && call.size === 22), '月报图表标签改为日均且不再包含单位');
  const subtitle = calls.filter(call => call.y === 932).sort((a, b) => a.x - b.x);
  assert.deepEqual(subtitle.map(call => call.value), ['0.18', 'km']);
  assert.equal(subtitle[0].size, 34, '日均值作为图表头部的数值');
  assert.ok(subtitle[1].size < subtitle[0].size);
  assert.notEqual(subtitle[1].color, subtitle[0].color);
  assert.ok(subtitle[1].x - (subtitle[0].x + 4 * 8) >= 4, '数字与单位之间留有间距');
  assert.ok(row.find(call => call.value === 'h').x - (row[0].x + 8) >= 4, '时长数值与单位不贴在一起');
  const annualCalls = [];
  const annualCanvas = {getContext:() => ({font:'', fillRect() {}, measureText:value => ({width:String(value).length * 8}), fillText(value) {annualCalls.push(value);}})};
  drawReport(annualCanvas, createReport(fixture([activity('2024-02-01')]), 'year', '2024', today), '测试');
  assert.ok(annualCalls.includes('月均距离'), '年报图表标签改为月均');
  assert.ok(annualCalls.includes('0.44'), '年报图表显示每月均值');
  assert.equal(annualCalls.includes('每月距离'), false);
  const headers = calls.filter(call => call.y === 1410).map(call => call.value);
  assert.deepEqual(headers, ['运动 / 次数', '距离', '时长', '负荷']);
  const shortCalls = [];
  const shortCanvas = {getContext:() => ({font:'', fillRect() {}, measureText:value => ({width:String(value).length * 8}), fillText(value, x, y) {shortCalls.push({value, y});}})};
  drawReport(shortCanvas, createReport(fixture([activity('2024-02-01')]), 'month', '2024-02', today), '测试');
  assert.deepEqual(shortCalls.filter(call => call.y === 704).map(call => call.value).slice(0, 2), ['30', 'min'], '不足一小时时只显示分钟');
});

test('年报右上以已覆盖月份数和小字单位替代孤立的年字，月报仍显示月份数字', () => {
  const calls = [];
  const canvas = {getContext:() => ({font:'', measureText:value => ({width:String(value).length * 8}), fillRect() {}, fillText(value, x, y) {calls.push({value, x, y});}})};
  drawReport(canvas, createReport(fixture([activity('2026-02-01')]), 'year', '2026', today), '测试');
  const annualTop = calls.filter(call => call.y === 252);
  assert.deepEqual(annualTop.map(call => call.value), ['10', '个月'], '年份进行中按已覆盖月份绘制');
  assert.equal(calls.some(call => call.value === '年'), false, '不再绘制孤立的年字');
  calls.length = 0;
  drawReport(canvas, createReport(fixture([activity('2026-10-16')]), 'month', '2026-10', today), '测试');
  assert.deepEqual(calls.filter(call => call.y === 252).map(call => call.value), ['10'], '月报右上仍是月份数字');
});

test('分享图精简说明并移除空心框，仍绘制已记录值且保留文字摘要', () => {
  const report = createReport(fixture([
    activity('2024-02-01'),
    activity('2024-02-02', {distanceKm:null, trainingLoad:null}),
  ], {period:{start:'2023-01-01', end:'2024-02-03'}}), 'month', '2024-02', today);
  const texts = [];
  const bars = [];
  const canvas = {getContext:() => ({
    font:'',
    measureText:value => ({width:String(value).length * 8}),
    fillRect(x, y, width, height) {if (width < 20) bars.push({height});},
    fillText(value) {texts.push(value);},
    strokeRect() {assert.fail('分享图不再绘制空心框');},
  })};
  drawReport(canvas, report, '测试');
  assert.equal(bars.length, 1);
  assert.ok(bars[0].height > 0);
  assert.equal(canvas.height, 1920, '常规报表采用手机竖屏 9:16 比例');
  assert.doesNotMatch(texts.join(' '), /空心框|未同步|仅统计|数据来自|同步于|数据不完整|截至今日/);
  assert.match(reportSummary(report), /未同步|距离未提供/, '详细数据说明仍保留在无障碍摘要中');
});

test('拒绝无效／未来周期，不修改快照，界面包含独立周期与下载入口', () => {
  const data = fixture([activity(today)]);
  const before = structuredClone(data);
  for (const [mode, selection] of [['month','2026-13'], ['month','2026-11'], ['year','2027'], ['year','recent'], ['month','2020-01'], ['week','2026']]) assert.throws(() => createReport(data, mode, selection, today));
  createReport(data, 'month', '2026-10', today);
  assert.deepEqual(data, before);
  const html = renderReportPanel(data, today);
  assert.match(html, /id="report-month"[^>]*max="2026-10"/);
  assert.match(html, /id="report-download"/);
  assert.match(html, /id="report-year" disabled/);
  assert.match(html, /图片宽 1080 像素/);
  assert.match(html, /id="report-metric"/);
  const staleHtml = renderReportPanel(fixture([], {period:{start:'2023-01-01', end:'2025-12-20'}}), today);
  assert.match(staleHtml, /id="report-month"[^>]*value="2025-12"/, '快照跨年未同步时默认仍选择可生成月份');
});

test('仅手机端显示保存到相册，桌面端显示下载 PNG 图片', async t => {
  const previousDocument = globalThis.document;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    globalThis.document = previousDocument;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  });
  const ctx = {font:'', measureText:value => ({width:String(value).length * 8}), fillRect() {}, fillText() {}, strokeRect() {}};
  function setup(userAgent, {platform = '', maxTouchPoints = 0, share = true} = {}) {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {value:'', hidden:false, disabled:false, textContent:'', events:{}, addEventListener(event, callback) {this.events[event] = callback;}, removeAttribute(name) {delete this[name];}});
      return elements.get(id);
    };
    globalThis.document = {getElementById:element, fonts:{ready:Promise.resolve()}, createElement:() => ({getContext:() => ctx, toBlob:callback => callback(new Blob(['png'], {type:'image/png'}))})};
    Object.defineProperty(globalThis, 'navigator', {value:{userAgent, platform, maxTouchPoints, canShare:share ? () => true : undefined, share:share ? async () => {} : undefined}, configurable:true, writable:true});
    element('report-mode').value = 'month';
    element('report-month').value = '2024-02';
    initializeReports(fixture([activity('2024-02-01')]), '测试');
    return {element, generate: () => element('report-form').events.submit({preventDefault() {}})};
  }
  const desktop = setup('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', {platform:'MacIntel'});
  await desktop.generate();
  assert.equal(desktop.element('report-save').hidden, true, '桌面端即使支持分享也不显示保存到相册');
  assert.equal(desktop.element('report-download').hidden, false, '桌面端显示下载 PNG 图片');
  assert.doesNotMatch(desktop.element('report-image-info').textContent, /长按/);
  const phone = setup('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', {platform:'iPhone'});
  await phone.generate();
  assert.equal(phone.element('report-save').hidden, false, '手机端显示保存到相册');
  assert.equal(phone.element('report-download').hidden, true, '手机端隐藏下载入口');
  assert.match(phone.element('report-image-info').textContent, /长按/);
  const ipad = setup('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', {platform:'MacIntel', maxTouchPoints:5});
  await ipad.generate();
  assert.equal(ipad.element('report-save').hidden, false, 'iPad 桌面模式按移动端处理');
  const unsupported = setup('Mozilla/5.0 (Linux; Android 14; Pixel 8)', {platform:'Linux armv8l', share:false});
  await unsupported.generate();
  assert.equal(unsupported.element('report-save').hidden, true, '不支持分享文件时不显示保存到相册');
  assert.equal(unsupported.element('report-download').hidden, false, '不支持分享文件时回退到下载');
});

test('图片生成失败可重试；更改周期和刷新使旧预览失效，异步生成不覆盖新选择', async t => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {value:'', hidden:false, disabled:false, textContent:'', events:{}, addEventListener(event, callback) {this.events[event] = callback;}, removeAttribute(name) {delete this[name];}});
    return elements.get(id);
  }
  let resolveFonts;
  const fonts = new Promise(resolve => {resolveFonts = resolve;});
  const previousDocument = globalThis.document;
  const previousRevoke = URL.revokeObjectURL;
  const revoked = [];
  let fail = true;
  const ctx = {font:'', measureText:value => ({width:String(value).length * 8}), fillRect() {}, fillText() {}, strokeRect() {}};
  globalThis.document = {getElementById:element, fonts:{ready:fonts}, createElement:() => ({getContext:() => ctx, toBlob:callback => callback(fail ? null : new Blob(['png'], {type:'image/png'}))})};
  URL.revokeObjectURL = url => {revoked.push(url); previousRevoke(url);};
  t.after(() => {globalThis.document = previousDocument; URL.revokeObjectURL = previousRevoke;});
  element('report-mode').value = 'month';
  element('report-month').value = '2024-02';
  element('report-year').value = '2024';
  const update = initializeReports(fixture(), '测试');
  const submit = () => element('report-form').events.submit({preventDefault() {}});
  const generating = submit();
  element('report-mode').value = 'year';
  element('report-form').events.change();
  resolveFonts();
  await generating;
  assert.equal(element('report-result').hidden, true);
  assert.equal(element('report-month').disabled, true);
  assert.equal(element('report-year').disabled, false);
  await submit();
  assert.match(element('report-status').textContent, /图片生成失败/);
  assert.equal(element('report-generate').disabled, false);
  fail = false;
  await submit();
  assert.equal(element('report-result').hidden, false);
  assert.equal(element('report-download').download, '运动年报-2024.png');
  assert.match(element('report-image').alt, /2024 年运动年报/);
  update(fixture(), today);
  assert.equal(element('report-year').value, '2024');
  assert.equal(element('report-month').value, '2024-02');
  assert.equal(element('report-result').hidden, true);
  assert.equal(element('report-download').href, undefined);
  assert.equal(revoked.length, 1);
});
