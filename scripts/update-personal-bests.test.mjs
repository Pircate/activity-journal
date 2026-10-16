import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRunTime, paceRecords, powerRecords, longestRide, buildPersonalBests, fetchPersonalBests} from '../scripts/update-personal-bests.mjs';

// 曲线按运动大类聚合：跑步曲线含越野跑与虚拟跑步，骑行曲线含虚拟骑行。
const paceCurves = {list:[{distance:[45.72, 1000, 5000, 10000, 21097.5, 42195], values:[5, 200, 1092, 2253, 5069, 10629],
  activity_id:['i1', 'i1', 'i17229425', 'i17229425', 'i17229384', 'i27581543']}]};
const powerCurves = {list:[{secs:[1, 60, 300, 1200, 3600], watts:[725, 406, 288, 233, 206],
  activity_id:['i9', 'i9', 'i146848137', 'i192532318', 'i9']}]};
const activities = [
  {date:'2025-05-11', sport:'骑行', distanceKm:154.86, activityUrl:'https://intervals.icu/activities/i77934321'},
  {date:'2026-01-01', sport:'虚拟骑行', distanceKm:60.91, activityUrl:'https://intervals.icu/activities/i555'},
  {date:'2022-11-06', sport:'跑步', distanceKm:10.01, activityUrl:'https://intervals.icu/activities/i17229425'},
  {date:'2022-10-27', sport:'跑步', distanceKm:21.11, activityUrl:'https://intervals.icu/activities/i17229384'},
  {date:'2023-11-19', sport:'跑步', distanceKm:42.52, activityUrl:'https://intervals.icu/activities/i27581543'},
  {date:'2026-05-10', sport:'骑行', distanceKm:40, activityUrl:'https://intervals.icu/activities/i146848137'},
  {date:'2026-10-02', sport:'骑行', distanceKm:30, activityUrl:'https://intervals.icu/activities/i192532318'},
];

test('跑步成绩按目标距离取首个不短于目标的点，不足一小时省略小时位', () => {
  assert.equal(formatRunTime(1092), '18:12');
  assert.equal(formatRunTime(2253), '37:33');
  assert.equal(formatRunTime(5069), '1:24:29');
  assert.equal(formatRunTime(10629), '2:57:09');
  assert.deepEqual(paceRecords(paceCurves).map(record => [record.event, record.result]), [
    ['5 公里', '18:12'], ['10 公里', '37:33'], ['半程马拉松', '1:24:29'], ['全程马拉松', '2:57:09']]);
});

test('曲线缺少目标距离时跳过该项而不是报错', () => {
  const short = {list:[{distance:[45.72, 1000], values:[5, 200], activity_id:['i1', 'i1']}]};
  assert.deepEqual(paceRecords(short), []);
  const shortPower = {list:[{secs:[1, 60], watts:[725, 406], activity_id:['i9', 'i9']}]};
  assert.deepEqual(powerRecords(shortPower), []);
  assert.equal(longestRide([{date:'2026-01-01', sport:'跑步', distanceKm:10, activityUrl:'https://intervals.icu/activities/i1'}]), null);
});

test('骑行功率按秒数精确定位，保留原始最佳努力值的小幅回弹', () => {
  // watts 是各时长上的原始最佳努力值，允许多处微降，不能做单调性校验或插值。
  const bounce = {list:[{secs:[290, 300, 310, 1200], watts:[289, 288, 289, 233], activity_id:['i1', 'i2', 'i3', 'i4']}]};
  assert.deepEqual(powerRecords(bounce).map(record => [record.event, record.result]), [['CP5', '288 W'], ['CP20', '233 W']]);
  assert.deepEqual(powerRecords(powerCurves).map(record => record.result), ['288 W', '233 W']);
});

test('最远骑行包含虚拟骑行，并按活动快照给出日期与链接', () => {
  assert.deepEqual(longestRide(activities), {sport:'骑行', event:'最远距离', result:'154.86 km', date:'2025-05-11', activityUrl:'https://intervals.icu/activities/i77934321'});
  // 仅虚拟骑行更远时也应入选。
  const virtualOnly = [...activities, {date:'2026-02-02', sport:'虚拟骑行', distanceKm:200, activityUrl:'https://intervals.icu/activities/i777'}];
  assert.equal(longestRide(virtualOnly).result, '200.00 km');
  assert.equal(longestRide(virtualOnly).date, '2026-02-02');
});

test('组装成绩固定顺序，并用活动快照补全日期', () => {
  const data = buildPersonalBests({activities, paceCurves, powerCurves, now:new Date('2026-10-16T04:00:00Z')});
  assert.equal(data.source, 'Intervals.icu');
  assert.equal(data.syncedAt, '2026-10-16T04:00:00.000Z');
  assert.deepEqual(data.records.map(record => record.sport + ' ' + record.event), ['跑步 5 公里', '跑步 10 公里', '跑步 半程马拉松', '跑步 全程马拉松', '骑行 最远距离', '骑行 CP5', '骑行 CP20']);
  assert.equal(data.records[0].date, '2022-11-06');
  assert.equal(data.records[4].date, '2025-05-11');
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
