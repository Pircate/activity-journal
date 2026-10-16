import test from 'node:test';
import assert from 'node:assert/strict';
import {filterActivities, initializeHistory} from '../docs/history.mjs';
import {renderDayRecords} from '../docs/journal.mjs';

const activity = (date, distanceKm, sport = '骑行', duration = '1:00:00') => ({date, distanceKm, sport, duration, trainingLoad:30});
const records = [activity('2026-10-10', 0), activity('2026-10-11', null, '力量训练'),
  activity('2026-10-12', 20), activity('2026-10-12', 30), activity('2026-10-13', 40, '跑步', '0:45:00')];

test('组合筛选使用含边界的日期和距离，保留同日多次活动且不修改源数据', () => {
  const before = structuredClone(records);
  assert.deepEqual(filterActivities(records, {start:'2026-10-12', end:'2026-10-12', sport:'骑行', minDistance:20, maxDistance:30}), records.slice(2, 4));
  assert.equal(filterActivities(records, {minDistance:0, maxDistance:0})[0], records[0]);
  assert.equal(filterActivities(records).length, 5, '不筛距离时保留未提供距离的活动');
  assert.equal(filterActivities(records, {minDistance:0}).length, 4, '距离未知不视为零');
  assert.deepEqual(filterActivities(records, {sport:'游泳'}), []);
  assert.deepEqual(records, before);
});

test('排序按日期、距离和实际秒数，未知距离始终排在末尾', () => {
  assert.deepEqual(filterActivities(records).map(a => a.date), ['2026-10-13', '2026-10-12', '2026-10-12', '2026-10-11', '2026-10-10']);
  assert.equal(filterActivities(records, {sort:'date-asc'})[0], records[0]);
  assert.deepEqual(filterActivities(records, {sort:'distance-asc'}).map(a => a.distanceKm), [0, 20, 30, 40, null]);
  assert.deepEqual(filterActivities(records, {sort:'distance-desc'}).map(a => a.distanceKm), [40, 30, 20, 0, null]);
  const times = [activity('2026-10-10', 10, '骑行', '10:00:00'), activity('2026-10-11', 10, '骑行', '2:00:00'), activity('2026-10-12', 10, '骑行', '0:59:59')];
  assert.deepEqual(filterActivities(times, {sort:'duration-desc'}).map(a => a.duration), ['10:00:00', '2:00:00', '0:59:59']);
  assert.deepEqual(filterActivities(times, {sort:'duration-asc'}).map(a => a.duration), ['0:59:59', '2:00:00', '10:00:00']);
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
  get('history-sport').value = '游泳';
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
