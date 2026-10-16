import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal, renderSportFilter} from '../docs/journal.mjs';
import {createTrends} from '../docs/trends.mjs';

const activity = (date, sport, distanceKm = 10, trainingLoad = 30) => ({date, sport, distanceKm, duration:'1:00:00', trainingLoad});
const snapshot = activities => ({period:{start:'2021-01-01', end:'2026-10-16'}, syncedAt:'2026-10-16 12:00:00 +08:00',
  activities, unavailableActivities:[{date:'2026-10-12'}], gearLibrary:[]});
const records = [
  activity('2026-10-12', '骑行', 20), activity('2026-10-12', '跑步', 5), activity('2026-10-11', '跑步', 8),
  activity('2026-10-09', '骑行', 30), activity('2026-10-09', '跑步', 3), activity('2025-09-01', '跑步', 1),
];

test('运动类型分布始终展示该范围完整计数，并保留已选类型', () => {
  const journal = createJournal(snapshot(records), '2026-10-16', '2026');
  assert.deepEqual(journal.sports, [{sport:'骑行', count:2}, {sport:'跑步', count:3}]);
  const html = renderSportFilter(journal.sports, '骑行');
  assert.match(html, /data-sport="" aria-pressed="false" aria-label="全部运动，该范围 5 次"/);
  assert.match(html, /data-sport="骑行" aria-pressed="true"[^>]*>骑行 <strong>2<\/strong> 次/);
  assert.match(html, /data-sport="跑步" aria-pressed="false"[^>]*>跑步 <strong>3<\/strong> 次/);
  const isolated = renderSportFilter(journal.sports, '游泳');
  assert.match(isolated, /data-sport="游泳" aria-pressed="true"[^>]*>游泳 <strong>0<\/strong> 次/);
  assert.match(isolated, /全部运动 <strong>5<\/strong> 次/, '不含范围外的类型计数');
});

test('年度类型筛选只统计所选类型，且不改变类型分布', () => {
  const data = snapshot(records);
  const all = createJournal(data, '2026-10-16', '2026');
  assert.equal(all.activities.length, 5);
  assert.equal(all.distance, 66);
  assert.deepEqual(all.sports, [{sport:'骑行', count:2}, {sport:'跑步', count:3}]);
  assert.equal(all.unavailableCount, 1);
  assert.equal(all.unavailableExcluded, 0);
  const running = createJournal(data, '2026-10-16', '2026', '跑步');
  assert.equal(running.activities.length, 3);
  assert.equal(running.distance, 16);
  assert.equal(running.activeDays, 3);
  assert.deepEqual(running.sports, all.sports, '筛选后仍保留完整分布');
  assert.equal(running.unavailableCount, 0);
  assert.equal(running.unavailableExcluded, 1, '受限记录没有类型信息，筛选时排除');
  assert.equal(running.recent.length, 3, '最近七天不受年度类型筛选影响');
  assert.deepEqual(running.recent, all.recent, '最近七天保留全部类型');
  const empty = createJournal(data, '2026-10-16', '2026', '游泳');
  assert.equal(empty.activities.length, 0);
  assert.equal(empty.distance, 0);
  assert.equal(empty.initialDate, '2026-10-16');
});

test('运动趋势跟随年度类型筛选，受限记录不再阻止比较', () => {
  const data = snapshot(records);
  const all = createTrends(data, '2026', 'month', '2026-10-16');
  const october = all.find(period => period.start === '2026-10-01');
  assert.equal(october.count, 5);
  assert.equal(october.unavailable, 1);
  const running = createTrends(data, '2026', 'month', '2026-10-16', '跑步');
  const runningOctober = running.find(period => period.start === '2026-10-01');
  assert.equal(runningOctober.count, 3);
  assert.equal(runningOctober.distanceKm, 16);
  assert.equal(runningOctober.unavailable, 0);
  assert.equal(running.length, all.length, '周期数量不因类型筛选改变');
  assert.equal(running[0].count, 0);
});
