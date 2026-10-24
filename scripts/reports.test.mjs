import test from 'node:test';
import assert from 'node:assert/strict';
import {createReport, reportSummary, renderReportPanel, initializeReports, drawReport} from '../docs/reports.mjs';

const activity = (date, values = {}) => ({date, sport:'跑步', distanceKm:5.25, duration:'0:30:00', trainingLoad:20, activityUrl:'https://intervals.icu/activities/i1', ...values});
const fixture = (activities = [], values = {}) => ({period:{start:'2023-01-01', end:'2026-10-16'}, syncedAt:'2026-10-16 16:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[], ...values});
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
  assert.equal(report.sports[0].sport, '跑步');
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
  const data = fixture([activity('2024-02-01', {distanceKm:null}), activity('2024-02-02'), activity('2024-02-03', {sport:'力量训练', distanceKm:null, sets:12, averageHeartRate:100})], {unavailableActivities:[{date:'2024-02-15'}]});
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
    activity('2024-02-02', {sport:'骑行', distanceKm:30, trainingLoad:0}),
    activity('2024-02-03', {sport:'骑行', distanceKm:50, trainingLoad:70}),
    activity('2024-02-03', {sport:'力量训练', distanceKm:null, sets:3, averageHeartRate:110, trainingLoad:10}),
  ]);
  const report = createReport(data, 'month', '2024-02', today);
  assert.equal(report.trainingLoad, 80);
  assert.equal(report.missingLoad, 1);
  const running = report.sports.find(item => item.sport === '跑步');
  assert.equal(running.trainingLoad, null);
  const riding = report.sports.find(item => item.sport === '骑行');
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
  assert.match(reportSummary(report), /骑行 2 次 \/ 80\.00 km \/ 1:00:00 \/ 70 TL/);
});

test('图片支持四项图表指标，完整显示所有运动统计，图片高度容纳明细', () => {
  const data = fixture(['跑步','骑行','步行','游泳','徒步','体能训练','越野跑'].map(sport => activity(today, {sport})));
  const report = createReport(data, 'month', '2026-10', today);
  for (const metric of ['distanceKm', 'durationSeconds', 'count', 'trainingLoad']) {
    const texts = [];
    const canvas = {getContext:() => ({fillRect() {}, strokeRect() {}, fillText(value, x, y) {texts.push({value, y});}})};
    drawReport(canvas, report, '测试', metric);
    for (const sport of report.sports) assert.ok(texts.some(text => text.value === sport.sport), '所有运动类型都有明细');
    assert.ok(texts.some(text => text.value === '负荷 / TL'));
    assert.ok(texts.every(text => text.y < canvas.height));
    assert.ok(canvas.height > 1440, '明细较多时自动增加图片高度');
    assert.equal(texts.some(text => text.value === '未开始'), false);
  }
});

test('分享图精简说明并移除空心框，仍绘制已记录值且保留文字摘要', () => {
  const report = createReport(fixture([
    activity('2024-02-01'),
    activity('2024-02-02', {distanceKm:null, trainingLoad:null}),
  ], {period:{start:'2023-01-01', end:'2024-02-03'}}), 'month', '2024-02', today);
  const texts = [];
  const bars = [];
  const canvas = {getContext:() => ({
    fillRect(x, y, width, height) {if (width < 20) bars.push({height});},
    fillText(value) {texts.push(value);},
    strokeRect() {assert.fail('分享图不再绘制空心框');},
  })};
  drawReport(canvas, report, '测试');
  assert.equal(bars.length, 1);
  assert.ok(bars[0].height > 0);
  assert.ok(canvas.height < 1440, '移除说明后收紧图片高度');
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
  const ctx = {fillRect() {}, fillText() {}, strokeRect() {}};
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
