import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCurveRecords, buildPersonalBests, fetchPersonalBests, powerStreamAverage} from './update-personal-bests.mjs';

const now = new Date('2026-10-30T04:00:00Z');
const pace = curves => ({distances:[5000, 10000, 21097.5, 42195], curves});
const power = curves => ({secs:[300, 600, 1200], curves});
const curve = (id, start, secs) => ({id, start_date_local:start, secs});
const paceCurves = pace([
  curve('i3', '2023-01-01T09:00:00', [1400, 2900, 6100, 13000]),
  curve('i1', '2022-01-01T08:00:00', [1500, 3000, 6200, 14000]),
  curve('i4', '2023-01-01T10:00:00', [1390, 2900, 6200]),
  curve('i2', '2022-01-02T08:00:00', [1500, 3100]),
  curve('i5', '2024-01-01T08:00:00', []),
]);
const powerCurves = power([
  {id:'i8', start_date_local:'2023-01-01T08:00:00', watts:[280, 260, 230]},
  {id:'i7', start_date_local:'2022-01-01T08:00:00', watts:[270, 250, 220]},
  {id:'i9', start_date_local:'2024-01-01T08:00:00', watts:[280, 250, null]},
]);
const ride = (id, date, distanceKm, sport = 'Ride', startTime = '08:00:00') =>
  ({date, startTime, sport, distanceKm, activityUrl:'https://intervals.icu/activities/' + id, stravaUrl:'https://www.strava.com/activities/' + id.slice(1)});
const activities = [ride('i11', '2022-01-01', 100), ride('i12', '2023-01-01', 150, 'VirtualRide'), ride('i13', '2024-01-01', 150)];

test('八项从同一候选集生成，首次成绩、突破、同分、退步、短活动与乱序输入', async () => {
  const data = await buildPersonalBests({activities, paceCurves, powerCurves, now});
  assert.equal(data.records.length, 8);
  assert.deepEqual(data.history.filter(r => r.event === 'run5k').map(r => r.value), [1500, 1400, 1390]);
  assert.deepEqual(data.history.filter(r => r.event === 'run10k').map(r => r.value), [3000, 2900]);
  assert.deepEqual(data.history.filter(r => r.event === 'longestRide').map(r => r.value), [100, 150]);
  assert.deepEqual(data.history.filter(r => r.event === 'cp5').map(r => r.value), [270, 280]);
  assert.deepEqual(data.history.filter(r => r.event === 'cp10').map(r => r.value), [250, 260]);
  assert.deepEqual(data.history.filter(r => r.event === 'cp20').map(r => r.value), [220, 230]);
  for (const record of data.records) {
    const {startTime, ...last} = data.history.filter(r => r.event === record.event).at(-1);
    assert.deepEqual(record, last);
  }
  assert.deepEqual(await buildPersonalBests({activities:activities.toReversed(), paceCurves:pace(paceCurves.curves.toReversed()), powerCurves:power(powerCurves.curves.toReversed()), now}), data);
  const corrected = await buildPersonalBests({activities, paceCurves:pace(paceCurves.curves.filter(r => r.id !== 'i4')), powerCurves, now});
  assert.equal(corrected.records.find(r => r.event === 'run5k').value, 1400);
});

test('按真实标识关联日期、开始时间与链接，无法关联时采用上游明确时间', async () => {
  const linked = {date:'2023-02-03', startTime:'12:34:56', activityUrl:'https://intervals.icu/activities/i3', stravaUrl:'https://www.strava.com/activities/999'};
  const rows = activityCurveRecords(paceCurves, 'Run', [linked, {...linked, activityUrl:'https://intervals.icu/activities/i333', stravaUrl:'https://www.strava.com/activities/333'}]);
  assert.deepEqual(rows.find(r => r.activityUrl.endsWith('/i3')), {sport:'Run', event:'run5k', value:1400, ...linked});
  const unmatched = rows.find(r => r.activityUrl.endsWith('/i4'));
  assert.equal(unmatched.date, '2023-01-01');
  assert.equal(unmatched.startTime, '10:00:00');
  assert.equal(unmatched.stravaUrl, undefined);
  const stravaOnly = {sport:'VirtualRide', date:'2020-01-01', startTime:'12:00:00', distanceKm:200, stravaUrl:'https://www.strava.com/activities/901'};
  const data = await buildPersonalBests({activities:[stravaOnly], paceCurves, powerCurves});
  assert.equal(data.records.find(r => r.event === 'longestRide').activityUrl, null);
  assert.equal(data.records.find(r => r.event === 'longestRide').stravaUrl, stravaOnly.stravaUrl);
});

test('同日活动按开始时间计算，缺少目标成绩不以均速或均功率推算', async () => {
  const data = await buildPersonalBests({activities:[ride('i1', '2024-01-01', 80, 'Ride', '10:00:00'), ride('i2', '2024-01-01', 70, 'Ride', '08:00:00')],
    paceCurves:pace([curve('i1', '2024-01-01T10:00:00', [1400]), curve('i2', '2024-01-01T08:00:00', [1500])]), powerCurves:power([])});
  assert.deepEqual(data.history.filter(r => r.event === 'longestRide').map(r => r.value), [70, 80]);
  assert.deepEqual(data.history.filter(r => r.event === 'run5k').map(r => r.value), [1500, 1400]);
  assert.deepEqual(data.records.map(r => r.event), ['run5k', 'longestRide']);
  assert.deepEqual(activityCurveRecords(pace([curve('i1', '2024-01-01T08:00:00', [null, 0])]), 'Run', []), []);
});

test('任意异常轴、数值、活动 ID、时间及重复响应使整次查询失败', async () => {
  for (const payload of [{}, {...paceCurves, distances:[5000]}, {...paceCurves, curves:null},
    pace([null]), pace([curve('bad', '2024-01-01T08:00:00', [1500])]),
    pace([curve('i1', '2024-02-30T08:00:00', [1500])]), pace([curve('i1', '2024-01-01T25:00:00', [1500])]),
    pace([paceCurves.curves[0], paceCurves.curves[0]]),
    ...[-1, '1500', NaN, Infinity, {}].map(v => pace([curve('i1', '2024-01-01T08:00:00', [v])]))]) {
    await assert.rejects(() => buildPersonalBests({activities, paceCurves:payload, powerCurves}), /无效/);
  }
});

test('原始功率流按移动时间计算最大平均功率，采样间隔延续上一次功率', () => {
  const time = Array.from({length:700}, (_, index) => index);
  assert.ok(Math.abs(powerStreamAverage(time, Array(700).fill(248.8), 600) - 248.8) < 1e-9);
  const gap = [...Array.from({length:300}, (_, index) => index), ...Array.from({length:300}, (_, index) => 900 + index)];
  assert.equal(powerStreamAverage(gap, Array(600).fill(300), 600), 300);
  const warmup = [...Array(600).fill(200), ...Array(600).fill(300)];
  assert.equal(powerStreamAverage(Array.from({length:1200}, (_, index) => index), warmup, 600), 300);
  assert.equal(powerStreamAverage(time, Array(700).fill(100), 1200), null);
  assert.equal(powerStreamAverage([0, 0], [100, 100], 1), null);
});

test('功率并列时用原始流四舍五入决定新纪录', async () => {
  const curves = power([
    {id:'i1', start_date_local:'2024-01-01T08:00:00', watts:[270, 248, 210]},
    {id:'i2', start_date_local:'2024-02-01T08:00:00', watts:[280, 248, 230]},
  ]);
  const resolved = {'https://intervals.icu/activities/i1':{cp10:248}, 'https://intervals.icu/activities/i2':{cp10:249}};
  const data = await buildPersonalBests({activities:[ride('i1', '2024-01-01', 100), ride('i2', '2024-02-01', 110)],
    paceCurves:pace([]), powerCurves:curves, now,
    resolvePower:async record => resolved[record.activityUrl]?.[record.event] ?? null});
  assert.deepEqual(data.history.filter(r => r.event === 'cp10').map(r => r.value), [248, 249]);
  assert.equal(data.records.find(r => r.event === 'cp10').date, '2024-02-01');
});

test('使用真实用户 ID 与运动大类批量查询全历史，网络及任意校验失败抛错', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('API_KEY:test').toString('base64'));
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/athlete/0')) return Response.json({id:'i123', timezone:'Asia/Shanghai'});
    if (url.includes('/streams')) return Response.json([]);
    return Response.json(url.includes('pace') ? paceCurves : powerCurves);
  };
  const data = await fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test'}, activities, now, fetchImpl, powerValues:{}});
  assert.equal(data.records.length, 8);
  const curves = calls.filter(url => url.pathname.includes('activity-pace-curves') || url.pathname.includes('activity-power-curves'));
  assert.deepEqual(curves.map(u => u.pathname), ['/api/v1/athlete/i123/activity-pace-curves', '/api/v1/athlete/i123/activity-power-curves']);
  for (const url of curves) {
    assert.equal(url.searchParams.get('oldest'), '1900-01-01');
    assert.equal(url.searchParams.get('newest'), '2026-10-30');
  }
  assert.equal(curves[0].searchParams.get('type'), 'Run');
  assert.equal(curves[1].searchParams.get('type'), 'Ride');
  assert.equal(curves[1].searchParams.get('secs'), '300,600,1200');
  assert.ok(calls.some(url => url.pathname === '/api/v1/activity/i7/streams'));
  for (const failing of [async () => {throw Error('offline');}, async () => new Response(null, {status:503}), async () => Response.json({id:'i123', timezone:'UTC'}), async url => url.endsWith('/athlete/0') ? Response.json({id:'i123', timezone:'Asia/Shanghai'}) : Response.json({})]) {
    await assert.rejects(fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test'}, activities, now, fetchImpl:failing, powerValues:{}}));
  }
});

test('候选功率纪录读取原始流并写入缓存', async () => {
  const curves = power([{id:'i1', start_date_local:'2024-01-01T08:00:00', watts:[270, 248, 220]}]);
  const time = Array.from({length:700}, (_, index) => index);
  const fetchImpl = async url => {
    if (url.endsWith('/athlete/0')) return Response.json({id:'i123', timezone:'Asia/Shanghai'});
    if (url.includes('activity-pace-curves')) return Response.json(pace([]));
    if (url.includes('activity-power-curves')) return Response.json(curves);
    if (url.includes('/streams')) return Response.json([{type:'time', data:time}, {type:'watts', data:Array(700).fill(248.8)}]);
    throw new Error('unexpected ' + url);
  };
  const powerValues = {};
  const data = await fetchPersonalBests({config:{INTERVALS_ICU_API_KEY:'test'}, activities:[ride('i1', '2024-01-01', 100)], now, fetchImpl, powerValues});
  assert.equal(data.records.find(r => r.event === 'cp10').value, 249);
  assert.deepEqual(powerValues['https://intervals.icu/activities/i1'], {cp10:249});
});
