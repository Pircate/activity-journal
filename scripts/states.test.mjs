import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal, dayMetricState, describeDay, hasMissingMetric, dayStateLabels, dayStateNotes, renderHeatmapStates} from '../docs/journal.mjs';

const snapshot = (activities, unavailableActivities = [], period = {start:'2021-01-01', end:'2026-10-16'}) =>
  ({period, syncedAt:'2026-10-16 12:00:00 +08:00', activities, unavailableActivities, gearLibrary:{active:[],retired:[]}});
const activity = (date, overrides = {}) => ({date, sport:'Ride', distanceKm:10, durationSeconds:3600, trainingLoad:30, ...overrides});
// 未同步需要“日期晚于已同步范围”，因此把已同步末日期设为 10 月 15 日。
const syncedThrough14 = (activities, unavailableActivities = []) => snapshot(activities, unavailableActivities, {start:'2021-01-01', end:'2026-10-15'});

test('三种缺失状态各有独立措辞，互不混用', () => {
  assert.deepEqual(dayStateLabels, {pending:'未同步', missing:'指标缺失', unavailable:'详情不可读取'});
  assert.notEqual(dayStateLabels.pending, dayStateLabels.missing);
  assert.notEqual(dayStateLabels.missing, dayStateLabels.unavailable);
  assert.match(dayStateNotes.pending, /已同步日期范围/);
  assert.match(dayStateNotes.missing, /指标没有提供/);
  assert.match(dayStateNotes.unavailable, /只返回当地日期/);
});

test('未同步、指标缺失、详情不可读取分别落在不同 state，纹理图例与之一致', () => {
  const journal = createJournal(syncedThrough14([activity('2026-10-13'), activity('2026-10-14', {distanceKm:null, trainingLoad:null})], [{date:'2026-10-12'}]), '2026-10-16', '2026');
  const state = date => dayMetricState(journal.daily.find(day => day.date === date), 'distanceKm');
  assert.equal(state('2026-10-11').state, 'none', '普通无活动不是缺失');
  assert.equal(state('2026-10-12').state, 'unavailable');
  assert.equal(state('2026-10-13').state, 'value');
  assert.equal(state('2026-10-14').state, 'missing');
  assert.equal(state('2026-10-15').state, 'none', '已同步范围内没有记录不算未同步');
  assert.equal(state('2026-10-16').state, 'pending');
  assert.equal(state('2026-10-16').level, 'missing');
  assert.equal(state('2026-10-12').missing, false, '详情不可读取不算指标缺失');
  assert.equal(state('2026-10-16').unavailable, false, '未同步不算详情不可读取');
  const legend = renderHeatmapStates();
  for (const label of ['无运动记录', '未同步', '指标缺失', '详情不可读取']) assert.match(legend, new RegExp(label));
  assert.equal((legend.match(/data-state="/g) ?? []).length, 4);
});

test('同一天既有可读取活动又有受限记录时保留活动分级并标明不可读取', () => {
  const journal = createJournal(snapshot([activity('2026-10-15', {distanceKm:30})], [{date:'2026-10-15'}]), '2026-10-16', '2026');
  const day = journal.daily.find(item => item.date === '2026-10-15');
  const state = dayMetricState(day, 'distanceKm');
  assert.equal(state.state, 'value');
  assert.equal(state.level, '3');
  assert.equal(state.unavailable, true, '受限记录用独立属性标记，不伪装成指标缺失');
  assert.match(describeDay(day), /另有 1 条详情不可读取/);
});

test('指标缺失按运动应有指标判断，组数替代距离的力量训练不因距离为空而算缺失', () => {
  assert.equal(hasMissingMetric(activity('2026-10-10')), false);
  assert.equal(hasMissingMetric(activity('2026-10-10', {distanceKm:null})), true);
  assert.equal(hasMissingMetric(activity('2026-10-10', {trainingLoad:null})), true);
  assert.equal(hasMissingMetric({date:'2026-10-10', sport:'WeightTraining', distanceKm:null, durationSeconds:1800, trainingLoad:20, sets:12, averageHeartRate:131}), false);
  assert.equal(hasMissingMetric({date:'2026-10-10', sport:'WeightTraining', distanceKm:null, durationSeconds:1800, trainingLoad:20, sets:null, averageHeartRate:131}), true);
  assert.equal(hasMissingMetric({date:'2026-10-10', sport:'WeightTraining', distanceKm:null, durationSeconds:1800, trainingLoad:20, sets:12, averageHeartRate:null}), true);
});
