import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCurveRecords, buildPersonalBests, fetchPersonalBests} from './update-personal-bests.mjs';

const now = new Date('2026-10-30T04:00:00Z');
const pace = curves => ({distances:[5000, 10000, 21097.5, 42195], curves});
const power = curves => ({secs:[300, 1200], curves});
const curve = (id, start, secs) => ({id, start_date_local:start, secs});
const paceCurves = pace([
  curve('i3', '2023-01-01T09:00:00', [1400, 2900, 6100, 13000]),
  curve('i1', '2022-01-01T08:00:00', [1500, 3000, 6200, 14000]),
  curve('i4', '2023-01-01T10:00:00', [1390, 2900, 6200]),
  curve('i2', '2022-01-02T08:00:00', [1500, 3100]),
  curve('i5', '2024-01-01T08:00:00', []),
]);
const powerCurves = power([
  {id:'i8', start_date_local:'2023-01-01T08:00:00', watts:[280, 230]},
  {id:'i7', start_date_local:'2022-01-01T08:00:00', watts:[270, 220]},
  {id:'i9', start_date_local:'2024-01-01T08:00:00', watts:[280, null]},
]);
const ride = (id, date, distanceKm, sport = 'Ride', startTime = '08:00:00') =>
  ({date, startTime, sport, distanceKm, activityUrl:'https://intervals.icu/activities/' + id, stravaUrl:'https://www.strava.com/activities/' + id.slice(1)});
const activities = [ride('i11', '2022-01-01', 100), ride('i12', '2023-01-01', 150, 'VirtualRide'), ride('i13', '2024-01-01', 150)];

test('七项从同一候选集生成，首次成绩、突破、同分、退步、短活动与乱序输入', () => {
  const data = buildPersonalBests({activities, paceCurves, powerCurves, now});
  assert.equal(data.records.length, 7);
  assert.deepEqual(data.history.filter(r => r.event === 'run5k').map(r => r.value), [1500, 1400, 1390]);
  assert.deepEqual(data.history.filter(r => r.event === 'run10k').map(r => r.value), [3000, 2900]);
  assert.deepEqual(data.history.filter(r => r.event === 'longestRide').map(r => r.value), [100, 150]);
  for (const record of data.records) {
    const {startTime, ...last} = data.history.filter(r => r.event === record.event).at(-1);
    assert.deepEqual(record, last);
  }
  assert.deepEqual(buildPersonalBests({activities:activities.toReversed(), paceCurves:pace(paceCurves.curves.toReversed()), powerCurves:power(powerCurves.curves.toReversed()), now}), data);
  const corrected = buildPersonalBests({activities, paceCurves:pace(paceCurves.curves.filter(r => r.id !== 'i4')), powerCurves, now});
  assert.equal(corrected.records.find(r => r.event === 'run5k').value, 1400);
});

test('按真实标识关联日期、开始时间与链接，无法关联时采用上游明确时间', () => {
  const linked = {date:'2023-02-03', startTime:'12:34:56', activityUrl:'https://intervals.icu/activities/i3', stravaUrl:'https://www.strava.com/activities/999'};
  const rows = activityCurveRecords(paceCurves, 'Run', [linked, {...linked, activityUrl:'https://intervals.icu/activities/i333', stravaUrl:'https://www.strava.com/activities/333'}]);
  assert.deepEqual(rows.find(r => r.activityUrl.endsWith('/i3')), {sport:'Run', event:'run5k', value:1400, ...linked});
  const unmatched = rows.find(r => r.activityUrl.endsWith('/i4'));
  assert.equal(unmatched.date, '2023-01-01');
  assert.equal(unmatched.startTime, '10:00:00');
  assert.equal(unmatched.stravaUrl, undefined);
  const stravaOnly = {sport:'VirtualRide', date:'2020-01-01', startTime:'12:00:00', distanceKm:200, stravaUrl:'https://www.strava.com/activities/901'};
  const data = buildPersonalBests({activities:[stravaOnly], paceCurves, powerCurves});
  assert.equal(data.records.find(r => r.event === 'longestRide').activityUrl, null);
  assert.equal(data.records.find(r => r.event === 'longestRide').stravaUrl, stravaOnly.stravaUrl);
});

test('同日活动按开始时间计算，缺少目标成绩不以均速或均功率推算', () => {
  const data = buildPersonalBests({activities:[ride('i1', '2024-01-01', 80, 'Ride', '10:00:00'), ride('i2', '2024-01-01', 70, 'Ride', '08:00:00')],
    paceCurves:pace([curve('i1', '2024-01-01T10:00:00', [1400]), curve('i2', '2024-01-01T08:00:00', [1500])]), powerCurves:power([])});
  assert.deepEqual(data.history.filter(r => r.event === 'longestRide').map(r => r.value), [70, 80]);
  assert.deepEqual(data.history.filter(r => r.event === 'run5k').map(r => r.value), [1500, 1400]);
  assert.deepEqual(data.records.map(r => r.event), ['run5k', 'longestRide']);
  assert.deepEqual(activityCurveRecords(pace([curve('i1', '2024-01-01T08:00:00', [null, 0])]), 'Run', []), []);
});

test('任意异常轴、数值、活动 ID、时间及重复响应使整次查询失败', () => {
  for (const payload of [{}, {...paceCurves, distances:[5000]}, {...paceCurves, curves:null},
    pace([null]), pace([curve('bad', '2024-01-01T08:00:00', [1500])]),
    pace([curve('i1', '2024-02-30T08:00:00', [1500])]), pace([curve('i1', '2024-01-01T25:00:00', [1500])]),
    pace([paceCurves.curves[0], paceCurves.curves[0]]),
    ...[-1, '1500', NaN, Infinity, {}].map(v => pace([curve('i1', '2024-01-01T08:00:00', [v])]))]) {
    assert.throws(() => buildPersonalBests({activities, paceCurves:payload, powerCurves}), /无效/);
  }
});

test('使用真实用户 ID 与运动大类批量查询全历史，网络及任意校验失败抛错', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('API_KEY:test').toString('base64'));
    assert.equal(options.redirect, 'error');
    return Response.json(url.endsWith('/athlete/0') ? {id:'i123', timezone:'Asia/Shanghai'} : url.includes('pace') ? paceCurves : powerCurves);
  };
  const data = await fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test'}, activities, now, fetchImpl});
  assert.equal(data.records.length, 7);
  assert.deepEqual(calls.slice(1).map(u => u.pathname), ['/api/v1/athlete/i123/activity-pace-curves', '/api/v1/athlete/i123/activity-power-curves']);
  for (const url of calls.slice(1)) {
    assert.equal(url.searchParams.get('oldest'), '1900-01-01');
    assert.equal(url.searchParams.get('newest'), '2026-10-30');
  }
  assert.equal(calls[1].searchParams.get('type'), 'Run');
  assert.equal(calls[2].searchParams.get('type'), 'Ride');
  for (const failing of [async () => {throw Error('offline');}, async () => new Response(null, {status:503}), async () => Response.json({id:'i123', timezone:'UTC'}), async url => url.endsWith('/athlete/0') ? Response.json({id:'i123', timezone:'Asia/Shanghai'}) : Response.json({})]) {
    await assert.rejects(fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test'}, activities, now, fetchImpl:failing}));
  }
});
