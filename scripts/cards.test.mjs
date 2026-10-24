import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal, renderDayRecords, sportMetric, formatPace, validateData} from '../docs/journal.mjs';
import {normalizeActivities} from './update-data.mjs';

const period = {start:'2021-01-01', end:'2026-10-16'};
const activity = (sport, distanceKm, duration, extra = {}) => ({date:'2026-10-15', sport, distanceKm, duration, trainingLoad:30, ...extra});
const snapshot = activities => ({period, syncedAt:'2026-10-16 12:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[]});
const cards = activities => createJournal(snapshot(activities), '2026-10-16').cards;

test('每种支持的运动使用独立图标，近期卡片与列表保持一致，未知类型安全显示', () => {
  const types = ['Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide', 'Handcycle', 'Velomobile',
    'Run', 'VirtualRun', 'TrailRun', 'Walk', 'Hike', 'Swim', 'WeightTraining', 'Workout', 'Yoga', 'Pilates', 'Rowing', 'VirtualRow',
    'Elliptical', 'StairStepper', 'RockClimbing', 'NordicSki', 'AlpineSki', 'BackcountrySki', 'Snowboard', 'Kayaking', 'Canoeing',
    'StandUpPaddling', 'Surfing', 'Soccer', 'Tennis', 'Badminton', 'Basketball', 'Golf'];
  const records = normalizeActivities(types.map((type, index) => ({id:'i' + index, type, start_date:'2026-10-15T00:00:00Z', moving_time:1800, distance:5000})), period);
  const shapes = new Set();
  for (const record of records) {
    const icon = cards([record]).match(/<svg class="record-icon[^>]*>(.*?)<\/svg>/);
    assert.ok(icon, record.sport + ' 卡片应显示图标');
    assert.ok(renderDayRecords([record]).includes(icon[0]), record.sport + ' 列表应复用同一图标');
    assert.match(icon[0], /viewBox="0 0 24 24"/);
    assert.match(icon[0], /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(icon[0], /#b6beca|undefined/ , record.sport + ' 不应使用通用图标');
    shapes.add(icon[1]);
  }
  assert.equal(shapes.size, types.length, '子类型也应有独立图形');
  for (const sport of ['其他运动（新类型）', 'constructor', '<img src=x onerror=alert(1)>']) {
    const html = cards([activity(sport, 5, '0:30:00')]);
    assert.match(html, /style="color:#b6beca"/);
    assert.doesNotMatch(html, /<img|undefined/);
  }
});

test('累计爬升从来源字段保留米值，卡片区分零和缺失并拒绝无效值', () => {
  const source = {id:'i1', type:'Ride', start_date:'2026-10-15T00:00:00Z', moving_time:3600, distance:30000, icu_training_load:30, strava_id:'123'};
  for (const value of [1234.56, 0, null, undefined]) {
    const records = normalizeActivities([{...source, total_elevation_gain:value}], period);
    const html = cards(records);
    if (value == null) {
      assert.equal(records[0].elevationGain, undefined);
      assert.match(html, /<span class="record-meta-label" title="累计爬升">.*?<span class="sr-only">累计爬升<\/span><\/span><span class="record-metric-missing">未提供<\/span>/);
    } else {
      assert.equal(records[0].elevationGain, value);
      const expected = value === 0 ? '0' : '1,234.6';
      assert.ok(html.includes(`<span class="sr-only">累计爬升</span></span>${expected}<small>m</small>`));
      assert.ok(html.includes(`，累计爬升 ${expected} m，在 Strava 查看`));
    }
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  }
  assert.match(cards([activity('骑行', 30, '1:00:00', {elevationGain:null})]), /累计爬升<\/span><\/span><span class="record-metric-missing">未提供/);
  for (const value of [-1, '100', NaN, Infinity]) {
    assert.throws(() => normalizeActivities([{...source, total_elevation_gain:value}], period), /累计爬升无效/);
    assert.throws(() => validateData(snapshot([activity('骑行', 30, '1:00:00', {elevationGain:value})])), /运动记录格式无效/);
  }
});

test('副指标按运动类型换算：跑步／步行看配速，游泳看每百米，其余看速度', () => {
  assert.deepEqual(sportMetric(activity('跑步', 10, '0:50:00')), {label:'平均配速', text:'5:00 /km', html:'5:00<small>/km</small>'});
  assert.deepEqual(sportMetric(activity('徒步', 4, '1:00:00')), {label:'平均配速', text:'15:00 /km', html:'15:00<small>/km</small>'});
  assert.deepEqual(sportMetric(activity('游泳', 2, '0:40:00')), {label:'每百米配速', text:'2:00 /100m', html:'2:00<small>/100m</small>'});
  assert.equal(sportMetric(activity('骑行', 30, '1:00:00')).text, '30.0 km/h');
  assert.equal(sportMetric(activity('虚拟骑行', 15, '0:30:00')).label, '平均速度');
  assert.equal(formatPace(59.6), '1:00', '四舍五入到整秒，不出现 60 秒');
  assert.equal(formatPace(3600), '60:00');
});

test('缺少距离或时长时不换算、不编造，显示未提供', () => {
  for (const record of [activity('体能训练', null, '0:20:00'), activity('跑步', 0, '0:20:00'), activity('骑行', 20, '0:00:00')]) {
    const metric = sportMetric(record);
    assert.equal(metric.text, '未提供');
    assert.equal(metric.html, '<span class="record-metric-missing">未提供</span>');
  }
  const html = cards([activity('体能训练', null, '0:20:00'), activity('骑行', 20, '0:00:00')]);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /data-label|record-metric-value/);
});

test('卡片层级展示运动类型、主指标标签与副指标标签', () => {
  const html = cards([activity('跑步', 10, '0:50:00', {stravaUrl:'https://www.strava.com/activities/123'})]);
  assert.match(html, /<p class="record-top"><span class="record-sport">.*?跑步<\/span><\/p>/);
  assert.match(html, /<span class="record-metric-label" title="距离"><svg class="metric-icon"[^>]*aria-hidden="true"[^>]*>.*?<\/svg><span class="sr-only">距离<\/span><\/span><span class="record-metric-value">10\.00<small>km<\/small>/);
  assert.match(html, /<span class="record-meta-label" title="平均配速"><svg .*?<span class="sr-only">平均配速<\/span><\/span>5:00<small>\/km<\/small>/);
  assert.match(html, /aria-label="2026-10-15 跑步，距离 10\.00 km，平均配速 5:00 \/km，时长 0:50:00，累计爬升 未提供，在 Strava 查看（新标签页）"/);
  const strength = cards([activity('力量训练', null, '0:30:00', {sets:12, averageHeartRate:131})]);
  assert.match(strength, /<span class="record-metric-label" title="组数"><svg .*?<span class="sr-only">组数<\/span><\/span><span class="record-metric-value">12<small>组<\/small>/);
  assert.match(strength, /<span class="record-meta-label" title="平均心率"><svg .*?<span class="sr-only">平均心率<\/span><\/span>131<small>bpm<\/small>/);
  assert.match(strength, /class="record-icon strength-icon"/);
});

test('明细表头按出现顺序合并，行为空时不影响混合表头', () => {
  const records = [activity('力量训练', null, '0:30:00', {sets:12, averageHeartRate:131}), activity('跑步', 10, '0:50:00'), activity('骑行', 30, '1:00:00')];
  const html = renderDayRecords(records, '当天运动记录');
  assert.match(html, /<th scope="col">距离 \/ 组数<\/th>/);
  assert.match(html, /<th scope="col">平均配速 \/ 平均速度 \/ 平均心率<\/th>/);
  assert.match(html, /data-label="平均配速">5:00<small>\/km<\/small>/);
  assert.match(html, /data-label="平均速度">30\.0<small>km\/h<\/small>/);
  assert.match(html, /data-label="平均心率">131<small>bpm<\/small>/);
  const running = renderDayRecords([activity('跑步', 10, '0:50:00'), activity('越野跑', 42.2, '4:00:00')], '历史运动记录');
  assert.match(running, /<th scope="col">平均配速<\/th>/);
  assert.doesNotMatch(running, /平均速度|组数/);
  const strengthOnly = renderDayRecords([activity('力量训练', null, '0:30:00', {sets:null, averageHeartRate:null})], '历史运动记录');
  assert.match(strengthOnly, /<th scope="col">组数<\/th>/);
  assert.match(strengthOnly, /<th scope="col">平均心率<\/th>/);
  assert.match(strengthOnly, /data-label="组数"><span class="record-metric-missing">未提供<\/span><\/td>/);
  assert.match(strengthOnly, /data-label="平均心率"><span class="record-metric-missing">未提供<\/span><\/td>/);
});

test('训练负荷说明简洁且不作为训练建议', () => {
  const html = renderDayRecords([activity('跑步', 10, '0:50:00')], '历史运动记录');
  assert.match(html, /训练负荷为 Intervals\.icu 的统计值，不含训练建议/);
});
