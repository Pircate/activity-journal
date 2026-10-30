import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeActivities} from '../docs/activity-data.mjs';
import {createJournal, validateData, renderDayRecords} from '../docs/journal.mjs';
import {createTrends, compareTrend} from '../docs/trends.mjs';
import {createReport} from '../docs/reports.mjs';
import {createMilestones} from '../docs/milestones.mjs';
import {normalizeActivities} from './update-data.mjs';
import {buildPersonalBests} from './update-personal-bests.mjs';
import {validatePersonalBests, renderPersonalBests} from '../docs/personal-bests.mjs';
import {unavailableId} from './sync.mjs';

const period = {start:'2026-01-01', end:'2026-10-27'};
const snapshot = activities => ({period, syncedAt:'2026-10-27 12:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[]});
const raw = {id:'i1', type:'Ride', start_date:'2026-10-01T00:00:00Z', moving_time:300, distance:1004, icu_training_load:0};

test('力量训练距离不适用，其他运动的缺失和零值在所有统计中保持一致', () => {
  const strength = {date:'2026-10-01', sport:'WeightTraining', distanceKm:null, durationSeconds:300, trainingLoad:0, sets:10, averageHeartRate:120};
  const ride = {...normalizeActivities([raw], period)[0], distanceKm:null};
  for (const records of [[strength], [strength, ride], [strength, {...ride, distanceKm:0}]]) {
    const data = snapshot(records);
    const summary = summarizeActivities(records);
    const journal = createJournal(data);
    const day = journal.daily.find(day => day.date === strength.date);
    const trend = createTrends(data, '2026', 'month', period.end).at(-1);
    const report = createReport(data, 'month', '2026-10', period.end);
    for (const actual of [day, trend, report]) {
      for (const key of ['distanceKm', 'durationSeconds', 'trainingLoad', 'missingDistance', 'missingLoad']) assert.equal(actual[key], summary[key]);
    }
    assert.equal(summary.missingDistance, records.includes(ride) ? 1 : 0);
    assert.equal(summary.trainingLoad, 0);
  }
  const data = snapshot([strength]);
  assert.doesNotMatch(createJournal(data, '2026-10-01').recentSummary, /距离未提供/);
  const trend = createTrends(data, '2026', 'month', period.end).at(-1);
  assert.notEqual(compareTrend(trend, trend.previous, 'distanceKm'), '数据不完整，暂不比较');
});

test('入库与跨视图汇总保留亚十米精度，格式化不改变原始数值或目标达成时间', () => {
  const records = normalizeActivities([raw, {...raw, id:'i2'}], period);
  assert.equal(records[0].distanceKm, 1.004);
  assert.equal(records[0].durationSeconds, 300);
  const data = snapshot(records);
  assert.equal(createJournal(data).distance, 2.008);
  assert.equal(createTrends(data, '2026', 'month', period.end).at(-1).distanceKm, 2.008);
  assert.equal(createReport(data, 'month', '2026-10', period.end).distanceKm, 2.008);
  assert.equal(createMilestones(data).tracks.find(track => track.key === 'distance').total, 2.008);
  assert.match(renderDayRecords(records), /1\.00<small>km/);
  assert.equal(records[0].distanceKm, 1.004);
  const progress = createMilestones(snapshot([{...records[0], distanceKm:4999.996}])).tracks.find(track => track.key === 'distance');
  assert.equal(progress.milestones[0].reached, false, '显示舍入不得提前达成里程碑');
});

test('新模型拒绝旧时长和中文运动代码，保留超过一天的时长与未知平台类型', () => {
  const activity = normalizeActivities([{...raw, moving_time:90061, type:'NewSport'}], period)[0];
  validateData(snapshot([activity]));
  assert.match(renderDayRecords([activity]), /25:01:01/);
  assert.match(renderDayRecords([activity]), /其他运动（NewSport）/);
  for (const change of [{durationSeconds:'300'}, {durationSeconds:-1}, {durationSeconds:0.5}, {duration:'0:05:00'}, {sport:'骑行'}]) {
    assert.throws(() => validateData(snapshot([{...activity, ...change}])));
  }
});

test('不可读记录必须有唯一稳定标识，不能用同日或重复日期替代身份', () => {
  const data = snapshot([]);
  const unavailable = {id:unavailableId('901'), date:'2026-10-01'};
  validateData({...data, unavailableActivities:[unavailable, {...unavailable, id:unavailableId('902')}]});
  for (const entries of [[{date:unavailable.date}], [unavailable, unavailable], [{...unavailable, id:'901'}]]) {
    assert.throws(() => validateData({...data, unavailableActivities:entries}));
  }
});

test('PB 数值保留曲线精度，单位和展示格式由项目决定', () => {
  const bests = buildPersonalBests({activities:[], now:new Date('2026-10-27T04:00:00Z'),
    paceCurves:{distances:[5000,10000,21097.5,42195],curves:[{id:'i1', start_date_local:'2026-01-01T08:00:00',secs:[1092.25]}]},
    powerCurves:{secs:[300,1200],curves:[{id:'i2', start_date_local:'2026-01-01T08:00:00',watts:[288.125]}]},
  });
  validatePersonalBests(bests);
  assert.deepEqual(bests.records.map(record => record.value), [1092.25, 288.125]);
  assert.match(renderPersonalBests(bests), /0:18:12/);
  assert.match(renderPersonalBests(bests), /288 <small class="pb-unit">W/);
  for (const value of ['banana', '288 W', null, NaN, Infinity, -1, 0]) {
    assert.throws(() => validatePersonalBests({...bests, records:[{...bests.records[0], value}]}));
  }
});
