import test from 'node:test';
import assert from 'node:assert/strict';
import {createStravaClient, normalizeStravaActivity, normalizeStravaProfile} from './strava-data.mjs';

test('用户资料仅保留展示字段，支持单名、空位置和重复地区', () => {
  const athlete = {id:78720097, firstname:' 波咖茶 ', lastname:'', state:' 安徽 ', city:'合肥', weight:60, email:'private@example.test'};
  assert.deepEqual(normalizeStravaProfile(athlete), {name:'波咖茶', location:'安徽，合肥', stravaUrl:'https://www.strava.com/athletes/78720097'});
  assert.equal(normalizeStravaProfile({...athlete, firstname:'Alex', lastname:'Chen'}).name, 'Alex Chen');
  assert.equal(normalizeStravaProfile({...athlete, firstname:null, lastname:'Chen'}).name, 'Chen');
  assert.equal(normalizeStravaProfile({...athlete, state:null, city:undefined}).location, '');
  assert.equal(normalizeStravaProfile({...athlete, state:'合肥'}).location, '合肥');
  for (const extra of [{id:null}, {firstname:' ', lastname:null}, {city:123}, {lastname:[]}]) {
    assert.throws(() => normalizeStravaProfile({...athlete, ...extra}));
  }
});

test('账号校验复用 /athlete 响应返回资料，不额外请求', async () => {
  const calls = [];
  const client = createStravaClient({accessToken:'secret', fetchImpl:async url => {
    calls.push(url);
    return Response.json({id:78720097, firstname:'接口姓名', city:'接口城市'});
  }});
  assert.deepEqual(await client.verifyAthlete(), {name:'接口姓名', location:'接口城市', stravaUrl:'https://www.strava.com/athletes/78720097'});
  assert.deepEqual(calls, ['https://www.strava.com/api/v3/athlete']);
  await assert.rejects(createStravaClient({accessToken:'secret', fetchImpl:async () => Response.json({id:78720097})}).verifyAthlete(), /姓名/);
});

const row = extra => ({id:901,sport_type:'Ride',start_date:'2026-10-23T16:30:00Z',distance:12345.67,moving_time:3601,elapsed_time:7200,total_elevation_gain:0,...extra});
test('Strava 原始精度、运动时间、北京时间和力量指标', () => {
  const a = normalizeStravaActivity(row());
  assert.equal(a.distanceKm,12.34567);
  assert.equal(a.durationSeconds,3601);
  assert.equal(a.date,'2026-10-24');
  assert.equal(a.startTime,'00:30:00');
  assert.equal(a.elevationGain,0);
  const strength = normalizeStravaActivity(row({sport_type:'WeightTraining',distance:null,calories:123.45,average_heartrate:130}));
  assert.equal(strength.calories,123.45); assert.equal(strength.averageHeartRate,130);
  for (const extra of [{distance:-1},{moving_time:null},{moving_time:1.5},{sport_type:undefined},{start_date:'2026-10-23T16:30:00'}, {id:Number.MAX_SAFE_INTEGER+1}, {sport_type:'WeightTraining',calories:-1}]) {
    assert.throws(() => normalizeStravaActivity(row(extra)));
  }
});
test('Strava 分页一直读取到空页，短页不代表历史结束', async () => {
  const calls=[];
  const client=createStravaClient({accessToken:'secret',fetchImpl:async (url,options) => {
    const u=new URL(url); calls.push(u);
    assert.equal(options.headers.Authorization,'Bearer secret');
    return Response.json(u.searchParams.get('page')==='1'?[row()]:u.searchParams.get('page')==='2'?[row({id:902})]:[]);
  }});
  assert.equal((await client.activities({after:10,before:20})).length,2);
  assert.deepEqual(calls.map(u=>u.searchParams.get('page')),['1','2','3']);
  assert.ok(calls.every(u=>u.searchParams.get('before')==='20' && u.searchParams.get('after')==='10'));
});
test('分页重复、账号错误、权限和网络错误不被当成空列表', async () => {
  const make=fetchImpl=>createStravaClient({accessToken:'secret',fetchImpl});
  await assert.rejects(make(async()=>Response.json([row()])).activities({before:20}),/重复/);
  await assert.rejects(make(async()=>Response.json({id:2})).verifyAthlete('1'),/账号/);
  for (const status of [401,403,500]) await assert.rejects(make(async()=>new Response(null,{status})).activities({before:20}),new RegExp(String(status)));
  await assert.rejects(make(async()=>{throw Error('Bearer secret');}).activity('1'),error=>!error.message.includes('secret'));
  assert.equal(await make(async()=>new Response(null,{status:404})).activity('1'),null);
});
test('按实际读限额等待，分段等待不超过一分钟，日限额超时停止', async () => {
  let current=Date.parse('2026-10-28T00:00:00Z'),calls=0;
  const waits=[];
  const client=createStravaClient({accessToken:'secret',clock:()=>current,sleep:async ms=>{waits.push(ms);current+=ms;},fetchImpl:async()=>{
    calls++;
    return calls===1?Response.json([row()],{headers:{'X-ReadRateLimit-Limit':'100,1000','X-ReadRateLimit-Usage':'100,100'}}):Response.json([]);
  }});
  assert.equal((await client.activities({before:20})).length,1);
  assert.ok(waits.length>=15); assert.ok(waits.every(ms=>ms<=60000));
  const daily=createStravaClient({accessToken:'secret',clock:()=>current,fetchImpl:async()=>Response.json([row()],{headers:{'X-ReadRateLimit-Limit':'100,1000','X-ReadRateLimit-Usage':'1,1000'}})});
  await assert.rejects(daily.activities({before:20}),/限流等待超时/);
});
