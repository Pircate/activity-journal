import test from 'node:test';
import assert from 'node:assert/strict';
import {filterActivities, initializeHistory} from '../docs/history.mjs';
import {createJournal, renderDayRecords, validateData} from '../docs/journal.mjs';
import {normalizeActivities} from './update-data.mjs';
import {createTrends} from '../docs/trends.mjs';

const activity = (date, distanceKm, sport = 'Ride', duration = 3600) => ({date, distanceKm, sport, durationSeconds:duration, trainingLoad:30});
const records = [activity('2026-10-10', 0), activity('2026-10-11', null, 'WeightTraining'),
  activity('2026-10-12', 20), activity('2026-10-12', 30), activity('2026-10-13', 40, 'Run', 2700)];

test('开始时间按北京时间保留，近期、历史、日历与趋势详情同日最新在前', () => {
  const period = {start:'2026-01-01', end:'2026-10-13'};
  const times = ['2026-10-12T01:00:00Z', '2026-10-12T10:00:00Z', '2026-10-11T16:00:00Z', '2026-10-12T16:00:00Z'];
  const normalized = normalizeActivities(times.map((start_date, i) => ({id:'i' + i, strava_id:String(i + 1), type:'Ride', start_date, moving_time:3600, distance:10000})), period);
  const descending = ['i3', 'i1', 'i0', 'i2'];
  const ids = rows => rows.map(a => a.activityUrl.split('/').at(-1));
  assert.deepEqual(ids(normalized), descending);
  assert.deepEqual(normalized.map(a => a.startTime), ['00:00:00', '18:00:00', '09:00:00', '00:00:00']);
  const activities = normalized.slice().reverse();
  const data = {period, syncedAt:'2026-10-13 12:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[]};
  validateData(data);
  assert.deepEqual(ids(filterActivities(activities)), descending);
  assert.deepEqual(ids(filterActivities(activities, {sort:'date-asc'})), descending.slice().reverse());
  for (const sort of ['distance-asc', 'distance-desc', 'duration-asc', 'duration-desc']) {
    assert.deepEqual(ids(filterActivities(activities, {sort})), descending, '主排序相同则按开始时间倒序');
  }
  const journal = createJournal(data);
  assert.deepEqual(ids(journal.recent), descending);
  assert.deepEqual(ids(journal.daily.find(day => day.date === '2026-10-12').records), ['i1', 'i0', 'i2']);
  assert.deepEqual([...journal.cards.matchAll(/href="https:\/\/www.strava.com\/activities\/(\d+)"/g)].map(match => match[1]), ['4', '2', '1', '3']);
  assert.deepEqual(ids(createTrends(data, 'recent', 'month', period.end).at(-1).records), descending);
  for (const startTime of ['24:00:00', '9:00:00', '12:60:00', null, 900]) {
    assert.throws(() => validateData({...data, activities:[{...activities[0], startTime}]}), /运动记录格式无效/);
  }
  assert.deepEqual(ids(activities), descending.slice().reverse(), '排序不修改原始数据');
});

test('组合筛选使用含边界的日期和距离，保留同日多次活动且不修改源数据', () => {
  const before = structuredClone(records);
  assert.deepEqual(filterActivities(records, {start:'2026-10-12', end:'2026-10-12', sport:'Ride', minDistance:20, maxDistance:30}), records.slice(2, 4));
  assert.equal(filterActivities(records, {minDistance:0, maxDistance:0})[0], records[0]);
  assert.equal(filterActivities(records).length, 5, '不筛距离时保留未提供距离的活动');
  assert.equal(filterActivities(records, {minDistance:0}).length, 4, '距离未知不视为零');
  assert.deepEqual(filterActivities(records, {sport:'Swim'}), []);
  assert.deepEqual(records, before);
});

test('排序按日期、距离和实际秒数，未知距离始终排在末尾', () => {
  assert.deepEqual(filterActivities(records).map(a => a.date), ['2026-10-13', '2026-10-12', '2026-10-12', '2026-10-11', '2026-10-10']);
  assert.equal(filterActivities(records, {sort:'date-asc'})[0], records[0]);
  assert.deepEqual(filterActivities(records, {sort:'distance-asc'}).map(a => a.distanceKm), [0, 20, 30, 40, null]);
  assert.deepEqual(filterActivities(records, {sort:'distance-desc'}).map(a => a.distanceKm), [40, 30, 20, 0, null]);
  const times = [activity('2026-10-10', 10, 'Ride', 36000), activity('2026-10-11', 10, 'Ride', 7200), activity('2026-10-12', 10, 'Ride', 3599)];
  assert.deepEqual(filterActivities(times, {sort:'duration-desc'}).map(a => a.durationSeconds), [36000, 7200, 3599]);
  assert.deepEqual(filterActivities(times, {sort:'duration-asc'}).map(a => a.durationSeconds), [3599, 7200, 36000]);
  assert.deepEqual(filterActivities(records, {sort:'distance-asc'}).slice(2, 4), [records[3], records[4]]);
});

test('非法范围明确报错，未知类型与空数据返回空结果', () => {
  for (const filters of [{start:'2026-02-30'}, {start:'2026-10-12', end:'2026-10-01'}, {minDistance:-1},
    {maxDistance:Infinity}, {minDistance:NaN}, {minDistance:30, maxDistance:20}, {sort:'unknown'}]) {
    assert.throws(() => filterActivities(records, filters));
  }
  assert.deepEqual(filterActivities([]), []);
  assert.deepEqual(filterActivities(records, {start:'2027-01-01'}), []);
  const html = renderDayRecords([activity('2026-10-10', null, '<img src=x>')], '历史运动记录');
  assert.match(html, /aria-label="历史运动记录"/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('历史列表分页、组合筛选、校验、重置与新快照更新', t => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {value:'', innerHTML:'', textContent:'', hidden:false, disabled:false,
      events:new Map(), addEventListener(name, callback) { this.events.set(name, callback); }});
    return elements.get(id);
  };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:get}});
  t.after(() => originalDocument ? Object.defineProperty(globalThis, 'document', originalDocument) : delete globalThis.document);
  const data = {activities:Array.from({length:45}, (_, index) => ({...activity('2026-10-12', index), stravaUrl:'https://www.strava.com/activities/' + (1000 + index)})), unavailableActivities:[{date:'2026-10-12'}]};
  const update = initializeHistory(data);
  const click = id => get(id).events.get('click')();
  const apply = () => get('history-filters').events.get('submit')({preventDefault() {}});
  assert.equal(get('history-count').textContent, '共 45 条 · 显示第 1–20 条');
  assert.equal((get('history-results').innerHTML.match(/class="activity-row/g) ?? []).length, 20);
  assert.equal(get('history-previous').disabled, true);
  click('history-next');
  assert.equal(get('history-count').textContent, '共 45 条 · 显示第 21–40 条');
  click('history-next');
  assert.equal(get('history-count').textContent, '共 45 条 · 显示第 41–45 条');
  assert.equal(get('history-next').disabled, true);
  click('history-previous');
  assert.equal(get('history-page').textContent, '第 2 / 3 页');
  get('history-min-distance').value = '40';
  get('history-sort').value = 'distance-desc';
  apply();
  assert.equal(get('history-count').textContent, '共 5 条 · 显示第 1–5 条');
  assert.ok(get('history-results').innerHTML.indexOf('/1044"') < get('history-results').innerHTML.indexOf('/1040"'));
  assert.equal(get('history-page').textContent, '第 1 / 1 页');
  get('history-max-distance').value = '10';
  apply();
  assert.equal(get('history-error').hidden, false);
  assert.match(get('history-error').textContent, /最短距离不能大于最长距离/);
  assert.equal(get('history-count').textContent, '共 5 条 · 显示第 1–5 条', '无效筛选保留上次结果');
  get('history-max-distance').value = '';
  update({...data, activities:[...data.activities, activity('2026-10-13', 50)]});
  assert.equal(get('history-count').textContent, '共 6 条 · 显示第 1–6 条');
  assert.equal(get('history-min-distance').value, '40');
  click('history-reset');
  assert.equal(get('history-error').hidden, true);
  assert.equal(get('history-sort').value, 'date-desc');
  assert.equal(get('history-min-distance').value, '');
  assert.equal(get('history-count').textContent, '共 46 条 · 显示第 1–20 条');
  get('history-sport').value = 'Swim';
  apply();
  assert.equal(get('history-count').textContent, '共 0 条');
  assert.match(get('history-results').innerHTML, /没有符合条件/);
  assert.equal(get('history-previous').disabled, true);
  assert.equal(get('history-next').disabled, true);
  assert.match(get('history-note').textContent, /另有 1 条/);
  update({activities:[], unavailableActivities:[]});
  assert.equal(get('history-page').textContent, '第 1 / 1 页');
  assert.match(get('history-results').innerHTML, /尚无可读取/);
  assert.equal(get('history-note').hidden, true);
});
