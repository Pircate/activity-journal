import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeActivities, matchCorosStrengthSets, fetchAllActivities} from './update-data.mjs';
import {createJournal, renderDayRecords, validateData} from '../docs/journal.mjs';

const period = {start:'2026-01-01', end:'2026-10-15'};
const raw = {id:'i1', type:'WeightTraining', start_date:'2026-10-15T04:00:00Z', moving_time:699, distance:null, icu_training_load:6, average_heartrate:137};
const snapshot = activities => ({period, syncedAt:'2026-10-15 12:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[]});

test('力量训练提取平均心率，缺失组数保留未知；其他运动不公开心率', () => {
  const records = normalizeActivities([raw, {...raw, id:'i2', type:'Ride', distance:20000}], period);
  assert.equal(records[0].sets, null);
  assert.equal(records[0].averageHeartRate, 137);
  assert.equal(Object.hasOwn(records[1], 'averageHeartRate'), false);
  assert.equal(Object.hasOwn(records[1], 'sets'), false);
  validateData(snapshot(records));
  for (const average_heartrate of [null, undefined, 0]) {
    assert.equal(normalizeActivities([{...raw, average_heartrate}], period)[0].averageHeartRate, null);
  }
  for (const average_heartrate of [-1, '137', Infinity]) {
    assert.throws(() => normalizeActivities([{...raw, average_heartrate}], period), /平均心率无效/);
  }
});

test('COROS 组数只通过原始活动标识精确关联，不按日期猜测', () => {
  const coros = [{labelId:'123', sets:12}, {labelId:'456', sets:0}];
  const rawRecords = [{...raw, source:'COROS', external_id:'123'},
    {...raw, id:'i2', source:'COROS', external_id:'456'},
    {...raw, id:'i3', source:'COROS', external_id:'789'},
    {...raw, id:'i4', source:'UPLOAD', external_id:'123'},
    {...raw, id:'i5', type:'Ride', source:'COROS', external_id:'123'}];
  const supplement = matchCorosStrengthSets(rawRecords, coros);
  assert.deepEqual(supplement, [{activityUrl:'https://intervals.icu/activities/i1', sets:12}, {activityUrl:'https://intervals.icu/activities/i2', sets:0}]);
  const activities = normalizeActivities(rawRecords, period, supplement);
  assert.deepEqual(activities.slice(0,4).map(a => a.sets), [12, 0, null, null]);
  assert.equal(JSON.stringify(supplement).includes('external_id'), false);
  assert.throws(() => matchCorosStrengthSets([rawRecords[0], {...rawRecords[0], id:'i6'}], coros), /不唯一/);
  for (const records of [[coros[0], coros[0]], [{labelId:'123', sets:-1}], [{labelId:'123', sets:1.5}]]) {
    assert.throws(() => matchCorosStrengthSets(rawRecords, records));
  }
  for (const rows of [[supplement[0], supplement[0]], [{activityUrl:'https://other.test/i1', sets:12}], [{...supplement[0], labelId:'123'}]]) {
    assert.throws(() => normalizeActivities(rawRecords, period, rows));
  }
});

test('同步接收已核对的 COROS 组数，只向列表 API 请求平均心率', async () => {
  let calls = 0;
  const data = await fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'}, now:new Date('2026-10-15T04:00:00Z'),
    strengthSets:[{activityUrl:'https://intervals.icu/activities/i1', sets:12}],
    fetchImpl:async url => {
      calls++;
      if (calls === 2) assert.ok(new URL(url).searchParams.get('fields').split(',').includes('average_heartrate'));
      return {ok:true, json:async () => calls === 1 ? {id:'i123'} : calls === 2 ? [raw] : []};
    }});
  assert.equal(data.activities[0].sets, 12);
  assert.equal(data.activities[0].averageHeartRate, 137);
  validateData(data);
});

test('力量训练指标验证拒绝非法数值和额外字段', () => {
  const activity = {...normalizeActivities([raw], period)[0], sets:12};
  validateData(snapshot([activity]));
  for (const change of [{sets:-1}, {sets:1.5}, {sets:'12'}, {sets:undefined}, {averageHeartRate:0},
    {averageHeartRate:-1}, {averageHeartRate:'137'}, {averageHeartRate:undefined}, {heartrate:[137]}]) {
    assert.throws(() => validateData(snapshot([{...activity, ...change}])), /运动记录格式无效/);
  }
});

test('力量训练列表使用组数、平均心率和杠铃图标；混合列表标明两种指标', () => {
  const strength = {...normalizeActivities([raw], period)[0], sets:12};
  const html = renderDayRecords([strength], '历史运动记录');
  assert.match(html, /<th scope="col">组数<\/th>/);
  assert.match(html, /<th scope="col">平均心率<\/th>/);
  assert.match(html, /data-label="组数">12<small>组<\/small>/);
  assert.match(html, /data-label="平均心率">137<small>bpm<\/small>/);
  assert.match(html, /class="record-icon strength-icon"/);
  assert.doesNotMatch(html, /km\/h|data-label="距离"/);
  const unknown = renderDayRecords([{...strength, sets:null, averageHeartRate:null}]);
  assert.match(unknown, /data-label="组数"><span class="record-metric-missing">未提供<\/span>/);
  assert.match(unknown, /data-label="平均心率"><span class="record-metric-missing">未提供<\/span>/);
  const ride = normalizeActivities([{...raw, id:'i2', type:'Ride', distance:20000}], period)[0];
  const mixed = renderDayRecords([strength, ride]);
  assert.match(mixed, /距离 \/ 组数/);
  assert.match(mixed, /平均速度 \/ 平均心率/);
  assert.match(mixed, /data-label="距离">20\.00<small>km/);
  assert.match(mixed, /data-label="平均速度">103\.0<small>km\/h/);
});

test('近期力量训练卡片显示组数与心率，未知值不当作零', () => {
  const strength = {...normalizeActivities([raw], period)[0], sets:12};
  const cards = createJournal(snapshot([strength])).cards;
  assert.match(cards, /12<small>组<\/small>/);
  assert.match(cards, /137<small>bpm<\/small>/);
  assert.match(cards, /class="sr-only">平均心率<\/span><\/span>137/);
  assert.doesNotMatch(cards, /km\/h|未记录距离/);
  const unknown = createJournal(snapshot([{...strength, sets:null, averageHeartRate:null}])).cards;
  assert.match(unknown, /class="sr-only">组数<\/span><\/span><span class="record-metric-value"><span class="record-metric-missing">未提供/);
  assert.match(unknown, /class="sr-only">平均心率<\/span><\/span><span class="record-metric-missing">未提供/);
});
