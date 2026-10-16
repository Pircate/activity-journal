import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal, dayMetricState, describeDay, hasMissingMetric, dayStateLabels, dayStateNotes, renderHeatmapStates, statNotesHint, statNotesCounts, renderStatNotesBody} from '../docs/journal.mjs';

const snapshot = (activities, unavailableActivities = [], period = {start:'2021-01-01', end:'2026-10-16'}) =>
  ({period, syncedAt:'2026-10-16 12:00:00 +08:00', activities, unavailableActivities, gearLibrary:[]});
const activity = (date, overrides = {}) => ({date, sport:'骑行', distanceKm:10, duration:'1:00:00', trainingLoad:30, ...overrides});
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
  assert.equal(hasMissingMetric({date:'2026-10-10', sport:'力量训练', distanceKm:null, duration:'0:30:00', trainingLoad:20, sets:12, averageHeartRate:131}), false);
  assert.equal(hasMissingMetric({date:'2026-10-10', sport:'力量训练', distanceKm:null, duration:'0:30:00', trainingLoad:20, sets:null, averageHeartRate:131}), true);
  assert.equal(hasMissingMetric({date:'2026-10-10', sport:'力量训练', distanceKm:null, duration:'0:30:00', trainingLoad:20, sets:12, averageHeartRate:null}), true);
});

test('折叠统计说明给出三类计数、区分口径与历史缺失条数', () => {
  const data = syncedThrough14([activity('2026-10-14', {distanceKm:null, trainingLoad:null})], [{date:'2026-10-13'}, {date:'2026-10-12'}]);
  const journal = createJournal(data, '2026-10-16', 'recent');
  const counts = statNotesCounts(journal, '最近一年', data.unavailableActivities.length);
  assert.equal(counts.pendingDays, 1, '只有 2026-10-16 晚于已同步范围');
  assert.equal(counts.missingMetrics, 1);
  assert.equal(counts.unavailableCount, 2);
  assert.equal(counts.historyUnavailable, 2);
  const hint = statNotesHint(counts);
  for (const label of ['未同步 1 天', '指标缺失 1 次', '详情不可读取 2 条']) assert.match(hint, new RegExp(label));
  const body = renderStatNotesBody(counts);
  for (const label of ['未同步', '指标缺失', '详情不可读取', '每日标记', '统计口径']) assert.match(body, new RegExp(label));
  assert.match(body, /只列出详情可读取的 <strong>1<\/strong> 条活动/);
  assert.match(body, /不按 0 计入/);
  assert.match(body, /不当作没有运动/);
  assert.match(body, /力量训练以组数替代距离，距离为空不计入指标缺失/);
  assert.match(body, /2026 年|最近一年/);
  assert.doesNotMatch(body, /NaN|undefined/);
});

test('未同步计数为 0 时不显示 0 天，避免误导为没有记录', () => {
  const journal = createJournal(snapshot([activity('2026-10-15')]), '2026-10-16', 'recent');
  const body = renderStatNotesBody(statNotesCounts(journal, '最近一年', 0));
  assert.match(body, /当前范围不含未同步日期/);
  assert.doesNotMatch(body, /最近一年有 <strong>0<\/strong> 天未同步/);
});

test('筛选类型时统计说明保留排除的不可读取条数，空范围提示只统计可读指标', () => {
  const data = snapshot([activity('2026-10-15')], [{date:'2026-10-14'}]);
  const filtered = createJournal(data, '2026-10-16', 'recent', '跑步');
  const counts = statNotesCounts(filtered, '最近一年', data.unavailableActivities.length);
  assert.equal(counts.unavailableCount, 0);
  assert.equal(counts.unavailableExcluded, 1);
  const body = renderStatNotesBody(counts);
  assert.match(body, /另有 1 条详情不可读取的记录没有运动类型，未计入所选类型/);
  const emptyJournal = createJournal(snapshot([]), '2026-10-16', 'recent');
  assert.equal(statNotesHint(statNotesCounts(emptyJournal, '最近一年')), '当前范围没有缺失标记，只统计可读取指标');
});
