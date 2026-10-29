import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAllActivities} from './fetch-site-data.mjs';
import {normalizeStravaActivity} from './strava-data.mjs';
import {readConfig} from './update-data.mjs';

const now=new Date('2026-10-27T01:00:00Z'),since='2026-10-25T16:30:00Z';
const profile={name:'接口姓名', location:'接口位置', stravaUrl:'https://www.strava.com/athletes/78720097'};
const record=(id,date,extra={})=>({id,sport_type:'Ride',start_date:date+'T00:00:00Z',moving_time:3600,distance:20000,...extra});
const baseline=(rows=[],extra={})=>({sourcePolicyVersion:2,period:{start:'2020-01-01',end:'2026-10-26'},syncedAt:'2026-10-26 00:30:00 +08:00',
  activities:rows.map(normalizeStravaActivity),unavailableActivities:[],gearLibrary:[],...extra});
function api(rows=[],intervals=[],details={}) {
  const calls=[];
  const stravaClient={verifyAthlete:async id=>{assert.equal(id,'78720097');return profile;},activities:async window=>{calls.push(window);return rows;},activity:async id=>{calls.push(id);return details[id]??null;}};
  const fetchImpl=async input=>{
    const url=new URL(input);calls.push(url);
    return Response.json(url.pathname.endsWith('/athlete/0')?{id:'i123'}:url.pathname.endsWith('/gear')?[]:intervals);
  };
  return {calls,stravaClient,fetchImpl};
}
const sync=options=>fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'},now,...options});

test('同步成功时交付接口资料，失败时不更新资料',async()=>{
  const profiles=[];
  const options={...api(),baseData:baseline(),since,onProfile:value=>profiles.push(value)};
  await sync(options);
  assert.deepEqual(profiles,[profile]);
  await assert.rejects(sync({...options,fetchImpl:async()=>new Response(null,{status:503})}),/HTTP 503/);
  assert.deepEqual(profiles,[profile]);
});

test('增量由 Strava 覆盖主数据，Intervals 仅补负荷，未返回历史保留',async()=>{
  const baseData=baseline([record('1','2020-01-01'),record('2','2026-10-24'),record('3','2026-10-25')]);
  baseData.activities[1].activityUrl='https://intervals.icu/activities/i2';
  const client=api([record('2','2026-10-24',{distance:12345.67,moving_time:4000}),record('4','2026-10-27')],
    [{id:'i2',strava_id:'2',distance:999999,moving_time:999999,type:'Run',icu_training_load:42}]);
  const data=await sync({...client,baseData,since});
  assert.deepEqual(data.activities.map(a=>a.stravaUrl.split('/').at(-1)),['4','3','2','1']);
  assert.equal(data.activities[2].distanceKm,12.34567);assert.equal(data.activities[2].durationSeconds,4000);
  assert.equal(data.activities[2].sport,'Ride');assert.equal(data.activities[2].trainingLoad,42);
  assert.equal(client.calls.find(x=>x instanceof URL&&x.pathname.endsWith('/activities')).searchParams.get('oldest'),'2026-10-22');
  assert.equal(baseData.activities[1].distanceKm,20);
});
test('旧快照无规则版本强制全量，第二次按同一规则增量且不恢复旧距离',async()=>{
  const old=baseline([record('1','2020-01-01')]);delete old.sourcePolicyVersion;
  let report;
  const client=api([record('1','2020-01-01',{distance:12345})],[{id:'i1',strava_id:'1',distance:999999}]);
  const first=await sync({...client,baseData:old,since,onReport:value=>{report=value;}});
  assert.equal(client.calls.find(x=>!(x instanceof URL)).after,null);assert.equal(report.mode,'full');
  assert.equal(first.activities[0].distanceKm,12.345);
  const secondClient=api([],[{id:'i1',strava_id:'1',distance:999999}]);
  const second=await sync({...secondClient,baseData:first,since});
  assert.notEqual(secondClient.calls.find(x=>!(x instanceof URL)).after,null);
  assert.equal(second.activities[0].distanceKm,12.345);
});
test('新活动无需 Intervals 收录，旧日期事件直接查询 Strava 扩大窗口',async()=>{
  const event=record('9','2021-02-02');
  const client=api([],[],{'9':event});
  const data=await sync({...client,baseData:baseline(),since,eventActivityIds:['9']});
  assert.equal(client.calls[0],'9');assert.equal(data.activities[0].date,'2021-02-02');
  assert.equal(data.activities[0].trainingLoad,null);
  assert.equal(client.calls.find(x=>x instanceof URL&&x.pathname.endsWith('/activities')).searchParams.get('oldest'),'2021-01-31');
});
test('仅缺组数的力量训练读取详情卡路里，已存零组数不触发详情',async()=>{
  const rows=[record('1','2026-10-25',{sport_type:'WeightTraining'}),record('2','2026-10-25',{sport_type:'WeightTraining'})];
  const baseData=baseline(rows);baseData.activities[1].sets=0;
  const client=api(rows,[],{'1':{...rows[0],calories:123.4,average_heartrate:130}});
  const data=await sync({...client,baseData,since});
  assert.deepEqual(client.calls.filter(x=>typeof x==='string'),['1']);
  assert.equal(data.activities.find(a=>a.stravaUrl.endsWith('/1')).calories,123.4);
  assert.equal(data.activities.find(a=>a.stravaUrl.endsWith('/2')).sets,0);
});
test('无法读取历史列入报告，未关联不猜测，同日记录不合并',async()=>{
  const baseData=baseline([record('1','2020-01-01'),record('2','2020-01-01')]);
  delete baseData.activities[1].stravaUrl;baseData.activities[1].activityUrl='https://intervals.icu/activities/i2';
  let report;
  const data=await sync({...api([record('3','2020-01-01')]),baseData,since,full:true,onReport:r=>{report=r;}});
  assert.equal(data.activities.length,3);assert.equal(report.uncorrected.length,2);
  assert.match(report.uncorrected[1].reason,/缺少 Strava/);
  assert.equal(report.before.count,2);assert.equal(report.after.count,3);
});
test('事件缺失、未来日期、重复和鉴权或装备失败保持输入不变',async()=>{
  const baseData=baseline([record('1','2020-01-01')]),before=JSON.stringify(baseData);
  await assert.rejects(sync({...api(),baseData,since,eventActivityIds:['9']}),/尚无法读取/);
  await assert.rejects(sync({...api([],[],{'9':record('9','2026-10-28')}),baseData,since,eventActivityIds:['9']}),/可发布日期/);
  await assert.rejects(sync({...api([record('1','2026-10-25'),record('1','2026-10-25')]),baseData,since}),/重复/);
  await assert.rejects(sync({...api(),baseData,since,fetchImpl:async()=>new Response(null,{status:503})}),/HTTP 503/);
  for(const since of ['bad','2026-10-28T00:00:00Z']) await assert.rejects(sync({baseData,since}),/增量起点/);
  assert.equal(JSON.stringify(baseData),before);
});
test('环境配置无需本机凭据文件',async()=>{
  const previous=process.env.INTERVALS_ICU_API_KEY;process.env.INTERVALS_ICU_API_KEY='test-env';
  try{assert.deepEqual(await readConfig(),{INTERVALS_ICU_API_KEY:'test-env'});}finally{if(previous===undefined)delete process.env.INTERVALS_ICU_API_KEY;else process.env.INTERVALS_ICU_API_KEY=previous;}
});
