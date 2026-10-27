import test from 'node:test';
import assert from 'node:assert/strict';
import {paceRecords, powerRecords, longestRide, buildPersonalBests, fetchPersonalBests} from '../scripts/update-personal-bests.mjs';

// 曲线按运动大类聚合：跑步曲线含越野跑与虚拟跑步，骑行曲线含虚拟骑行。
const paceCurves = {list:[{distance:[45.72, 1000, 5000, 10000, 21097.5, 42195], values:[5, 200, 1092, 2253, 5069, 10629],
  activity_id:['i1', 'i1', 'i17229425', 'i17229425', 'i17229384', 'i27581543']}]};
const powerCurves = {list:[{secs:[1, 60, 300, 1200, 3600], watts:[725, 406, 288, 233, 206],
  activity_id:['i9', 'i9', 'i146848137', 'i192532318', 'i9']}]};
const activities = [
  {date:'2025-05-11', sport:'Ride', distanceKm:154.86, activityUrl:'https://intervals.icu/activities/i77934321'},
  {date:'2026-01-01', sport:'VirtualRide', distanceKm:60.91, activityUrl:'https://intervals.icu/activities/i555'},
  {date:'2022-11-06', sport:'Run', distanceKm:10.01, activityUrl:'https://intervals.icu/activities/i17229425'},
  {date:'2022-10-27', sport:'Run', distanceKm:21.11, activityUrl:'https://intervals.icu/activities/i17229384'},
  {date:'2023-11-19', sport:'Run', distanceKm:42.52, activityUrl:'https://intervals.icu/activities/i27581543'},
  {date:'2026-05-10', sport:'Ride', distanceKm:40, activityUrl:'https://intervals.icu/activities/i146848137'},
  {date:'2026-10-02', sport:'Ride', distanceKm:30, activityUrl:'https://intervals.icu/activities/i192532318'},
];

test('跑步成绩按目标距离取首个不短于目标的点，保存数值秒', () => {
  assert.deepEqual(paceRecords(paceCurves).map(record => [record.event, record.value]), [
    ['run5k', 1092], ['run10k', 2253], ['halfMarathon', 5069], ['marathon', 10629]]);
});

test('曲线缺少目标距离时跳过该项而不是报错', () => {
  const short = {list:[{distance:[45.72, 1000], values:[5, 200], activity_id:['i1', 'i1']}]};
  assert.deepEqual(paceRecords(short), []);
  const shortPower = {list:[{secs:[1, 60], watts:[725, 406], activity_id:['i9', 'i9']}]};
  assert.deepEqual(powerRecords(shortPower), []);
  assert.equal(longestRide([{date:'2026-01-01', sport:'Run', distanceKm:10, activityUrl:'https://intervals.icu/activities/i1'}]), null);
});

test('骑行功率按秒数精确定位，保留原始最佳努力值的小幅回弹', () => {
  // watts 是各时长上的原始最佳努力值，允许多处微降，不能做单调性校验或插值。
  const bounce = {list:[{secs:[290, 300, 310, 1200], watts:[289, 288, 289, 233], activity_id:['i1', 'i2', 'i3', 'i4']}]};
  assert.deepEqual(powerRecords(bounce).map(record => [record.event, record.value]), [['cp5', 288], ['cp20', 233]]);
  assert.deepEqual(powerRecords(powerCurves).map(record => record.value), [288, 233]);
});

test('最远骑行包含虚拟骑行，并按活动快照给出日期与链接', () => {
  assert.deepEqual(longestRide(activities), {sport:'Ride', event:'longestRide', value:154.86, date:'2025-05-11', activityUrl:'https://intervals.icu/activities/i77934321'});
  // 仅虚拟骑行更远时也应入选。
  const virtualOnly = [...activities, {date:'2026-02-02', sport:'VirtualRide', distanceKm:200, activityUrl:'https://intervals.icu/activities/i777'}];
  assert.equal(longestRide(virtualOnly).value, 200);
  assert.equal(longestRide(virtualOnly).date, '2026-02-02');
});

test('Strava 独有的最远骑行保留日期和真实链接，不生成 Intervals.icu 链接', () => {
  const ride = {date:'2021-05-12', sport:'Ride', distanceKm:200, stravaUrl:'https://www.strava.com/activities/901'};
  const data = buildPersonalBests({activities:[...activities, ride], paceCurves, powerCurves});
  assert.deepEqual(data.records.find(record => record.event === 'longestRide'), {
    sport:'Ride', event:'longestRide', value:200, date:ride.date, activityUrl:null, stravaUrl:ride.stravaUrl,
  });
});

test('组装成绩固定顺序，并用活动快照精确关联日期及 Strava 链接', () => {
  const linkedActivities = activities.map((activity, index) => ({...activity, stravaUrl:'https://www.strava.com/activities/' + (9000 + index)}));
  const data = buildPersonalBests({activities:linkedActivities, paceCurves, powerCurves, now:new Date('2026-10-16T04:00:00Z')});
  assert.equal(data.source, 'Intervals.icu');
  assert.equal(data.syncedAt, '2026-10-16T04:00:00.000Z');
  assert.deepEqual(data.records.map(record => record.sport + ' ' + record.event), ['Run run5k', 'Run run10k', 'Run halfMarathon', 'Run marathon', 'Ride longestRide', 'Ride cp5', 'Ride cp20']);
  assert.equal(data.records[0].date, '2022-11-06');
  assert.equal(data.records[4].date, '2025-05-11');
  assert.deepEqual(data.records.map(record => record.stravaUrl), [9002, 9002, 9003, 9004, 9000, 9005, 9006].map(id => 'https://www.strava.com/activities/' + id));
  const unlinked = buildPersonalBests({activities, paceCurves, powerCurves});
  assert.ok(unlinked.records.every(record => !Object.hasOwn(record, 'stravaUrl')));
  // 曲线覆盖范围早于本地快照，查不到记录时日期留空。
  assert.equal(buildPersonalBests({activities:[], paceCurves, powerCurves, now:new Date('2026-10-16T04:00:00Z')}).records[0].date, null);
});

test('拒绝结构异常或数值无效的曲线，整次同步失败', () => {
  for (const curves of [{list:[]}, {list:[{distance:[1], values:[1,2], activity_id:['i1']}]}, {list:[{distance:[6000], values:[0], activity_id:['i1']}]},
    {list:[{distance:[1], values:[1], activity_id:[]}]}, {}]) {
    assert.throws(() => paceRecords(curves), /曲线无效|成绩无效/);
  }
  for (const curves of [{list:[{secs:[300], watts:[288, 233], activity_id:['i1']}]}, {list:[{secs:[300], watts:[null], activity_id:['i1']}]},
    {list:[{secs:[300], watts:[0], activity_id:['i1']}]}, {}]) {
    assert.throws(() => powerRecords(curves), /曲线无效|成绩无效/);
  }
});

test('使用 API Key 并发查询两个曲线端点，失败时抛错保留旧快照', async () => {
  const calls = [];
  const data = await fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test-key'}, now:new Date('2026-10-16T04:00:00Z'), activities,
    fetchImpl:async (url, options) => {
      calls.push({url:new URL(url), options});
      return {ok:true, json:async () => url.includes('pace-curves') ? paceCurves : powerCurves};
    }});
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.url.pathname).sort(), ['/api/v1/athlete/0/pace-curves.json', '/api/v1/athlete/0/power-curves.json']);
  assert.ok(calls.every(call => /^Basic /.test(call.options.headers.Authorization)));
  assert.equal(calls.find(call => call.url.pathname.endsWith('pace-curves.json')).url.searchParams.get('curves'), 'all');
  assert.equal(calls.find(call => call.url.pathname.endsWith('power-curves.json')).url.searchParams.get('type'), 'Ride');
  assert.equal(data.records.length, 7);

  await assert.rejects(() => fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test-key'}, activities,
    fetchImpl:async url => url.includes('pace-curves') ? {ok:true, json:async () => paceCurves} : {ok:false, status:503}}), /HTTP 503/);
  await assert.rejects(() => fetchPersonalBests({config:{}, activities, fetchImpl:async () => ({ok:true, json:async () => paceCurves})}), /INTERVALS_ICU_API_KEY/);
});
