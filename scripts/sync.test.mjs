import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {rename} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {syncWindow, validateCorosInput, mergeActivities, sync, recoverTransaction} from './sync.mjs';
import {createStravaClient, normalizeStrava} from './strava.mjs';
import {fetchIntervalsData} from './update-data.mjs';

const now = new Date('2026-10-24T10:00:00.000Z');
const raw = (id = 901, extra = {}) => ({id, sport_type:'Ride', start_date:'2026-10-23T16:30:00Z',
  moving_time:3601, distance:20070, total_elevation_gain:123.4, private:true, ...extra});
const snapshot = activities => ({period:{start:'2020-01-01',end:'2026-10-24'}, syncedAt:'2026-10-24 17:00:00 +08:00',
  activities, unavailableActivities:[], gearLibrary:[]});
const corosInput = {startDate:'1900-01-01',endDate:'2026-10-24',queriedAt:now.toISOString(),records:[]};
const pb = {source:'Intervals.icu',syncedAt:now.toISOString(),records:[]};
const interval = (extra = {}) => ({id:'i1', strava_id:'901',type:'Ride',icu_training_load:40,...extra});
const merge = options => mergeActivities({previous:snapshot([]),stravaRecords:[raw()],intervalsRecords:[],
  corosRecords:[],strengthSets:[],window:syncWindow(null,now),now,getActivity:async () => null,...options});
const response = (data, status = 200) => ({ok:status === 200,status,json:async () => data});
async function directory(t) {
  const parent = resolve('output/sync-tests');
  await mkdir(parent, {recursive:true});
  const path = await mkdtemp(join(parent,'journal-sync-'));
  t.after(() => rm(path,{recursive:true,force:true}));
  return path;
}

test('Strava 基础指标、北京时间跨天、力量训练与字段白名单', () => {
  const a = normalizeStrava(raw());
  assert.equal(a.date,'2026-10-24'); assert.equal(a.distanceKm,20.07);
  assert.equal(a.duration,'1:00:01'); assert.equal(a.elevationGain,123.4);
  assert.equal(a.trainingLoad,null); assert.equal(a.activityUrl,undefined);
  const strength = normalizeStrava(raw(902,{sport_type:'WeightTraining',average_heartrate:137,distance:0}));
  assert.equal(strength.distanceKm,null); assert.equal(strength.sets,null); assert.equal(strength.averageHeartRate,137);
  for (const change of [{id:0},{id:Number.MAX_SAFE_INTEGER+1},{moving_time:null},{distance:-1},{total_elevation_gain:Infinity},
    {start_date:'invalid'},{start_date:'2026-10-24T10:00:00'},{sport_type:null}]) assert.throws(() => normalizeStrava(raw(901,change)));
  assert.equal(normalizeStrava(raw(901,{total_elevation_gain:0})).elevationGain,0);
  assert.equal(normalizeStrava(raw(901,{total_elevation_gain:null})).elevationGain,undefined);
  assert.doesNotMatch(JSON.stringify(normalizeStrava(raw(901,{latlng:[1,2],name:'secret',external_id:'secret'}))),/secret|latlng/);
});

test('首次全量、成功游标回看七天、停机及每周核对', () => {
  assert.equal(syncWindow(null,now).full,true);
  const state = {cursor:'2026-10-22T10:00:00.000Z',lastSuccessfulSyncAt:'2026-10-22T10:01:00.000Z',lastFullReconcileAt:'2026-10-20T10:00:00.000Z'};
  const window = syncWindow(state,now);
  assert.equal(window.full,false);
  assert.equal(window.after,Date.parse('2026-10-15T10:00:00Z')/1000-1);
  assert.equal(window.before,now.getTime()/1000);
  assert.equal(syncWindow(state,new Date('2026-10-27T10:00:00Z')).full,true);
  assert.equal(syncWindow(state,new Date('2026-12-01T10:00:00Z')).full,true);
  for (const invalid of [{}, {...state,cursor:'bad'}, {...state,cursor:'2026-10-25T10:00:00.000Z'}]) assert.throws(() => syncWindow(invalid,now));
});

test('COROS 查询范围、时效和空列表校验', () => {
  validateCorosInput(corosInput,syncWindow(null,now),now);
  for (const change of [{startDate:'2020-01-01'},{endDate:'2026-10-23'}, {queriedAt:'2026-10-22T10:00:00.000Z'},
    {records:[{labelId:'123',sets:-1}]},{records:[{labelId:'123',sets:1},{labelId:'123',sets:2}]}]) {
    assert.throws(() => validateCorosInput({...corosInput,...change},syncWindow(null,now),now));
  }
});

test('Strava 分页固定上下界，短页继续读取，拒绝重复、截断和越界', async t => {
  const envPath=join(await directory(t),'strava.env'), calls=[];
  let pages=[[raw()],[raw(902)],[]];
  const client=await createStravaClient({envPath,env:{STRAVA_TOKEN:'test'},fetchImpl:async url => {calls.push(new URL(url));return response(pages.shift());}});
  const window=syncWindow(null,now);
  assert.equal((await client.activities(window)).length,2); assert.equal(calls.length,3);
  assert.ok(calls.every(u => u.searchParams.get('before')===String(window.before)));
  assert.ok(calls.every(u => !u.searchParams.has('after')));
  pages=[[raw()],[raw()]]; await assert.rejects(client.activities(window),/重复/);
  pages=[[raw(901,{start_date:now.toISOString()})]]; await assert.rejects(client.activities(window),/边界/);
  pages=[{}]; await assert.rejects(client.activities(window),/列表无效/);
});

test('401 只刷新重试一次，持久化新 token，不泄漏凭据', async t => {
  const envPath=join(await directory(t),'strava.env');
  await writeFile(envPath,'STRAVA_TOKEN=old\nSTRAVA_REFRESH_TOKEN=refresh\nSTRAVA_CLIENT_ID=1\nSTRAVA_CLIENT_SECRET=private\n');
  let count=0;
  const client=await createStravaClient({envPath,env:{},fetchImpl:async (url,options) => {
    count++;
    if (url.endsWith('/oauth/token')) return response({access_token:'new',refresh_token:'new-refresh',scope:'activity:read_all'});
    return options.headers.Authorization==='Bearer new' ? response({id:1}) : response(null,401);
  }});
  assert.deepEqual(await client.get('athlete'),{id:1}); assert.equal(count,3);
  const saved=parseEnv(await readFile(envPath,'utf8')); assert.equal(saved.STRAVA_REFRESH_TOKEN,'new-refresh');
  assert.equal(saved.STRAVA_TOKEN,'new'); assert.equal(saved.STRAVA_CLIENT_SECRET,'private');
});

test('权限不足、限流和未知权限的 404 不允许删除', async t => {
  const envPath=join(await directory(t),'strava.env');
  await assert.rejects(createStravaClient({envPath,env:{STRAVA_SCOPE:'activity:read'}}),/activity:read_all/);
  for (const status of [403,429,500,404]) {
    const client=await createStravaClient({envPath,env:{STRAVA_TOKEN:'test'},fetchImpl:async () => response(null,status)});
    await assert.rejects(client.get('activities/901',{allowMissing:true}),new RegExp('HTTP '+status));
  }
  const client=await createStravaClient({envPath,env:{STRAVA_TOKEN:'test',STRAVA_SCOPE:'activity:read_all'},fetchImpl:async () => response(null,404)});
  assert.equal(await client.get('activities/901',{allowMissing:true}),null);
});

test('Strava 主指标优先，保留负荷、组数及历史独有记录，重跑不重复', async () => {
  const old={...normalizeStrava(raw()),distanceKm:999,trainingLoad:30,activityUrl:'https://intervals.icu/activities/i1'};
  const unlinked={date:'2021-01-01',sport:'跑步',distanceKm:5,duration:'0:30:00',trainingLoad:20,activityUrl:'https://intervals.icu/activities/i2'};
  const first=await merge({previous:snapshot([old,unlinked]),intervalsRecords:[interval({distance:999999})]});
  const a=first.data.activities.find(a=>a.stravaUrl);
  assert.equal(a.distanceKm,20.07); assert.equal(a.trainingLoad,40); assert.equal(a.elevationGain,123.4);
  assert.deepEqual(first.data.activities.at(-1),unlinked);
  const repeated=await merge({previous:first.data,intervalsRecords:[]});
  assert.deepEqual(repeated.data.activities,first.data.activities);
  const corrected=await merge({previous:first.data,stravaRecords:[raw(901,{distance:12345,moving_time:1800})]});
  assert.equal(corrected.data.activities[0].distanceKm,12.35); assert.equal(corrected.data.activities[0].duration,'0:30:00');
});

test('COROS 只按精确标识关联，缺失保留历史，更新值包括零', async () => {
  const previous=snapshot([{...normalizeStrava(raw(901,{sport_type:'WeightTraining'})),sets:12,
    trainingLoad:10,activityUrl:'https://intervals.icu/activities/i1'}]);
  const options={previous,stravaRecords:[raw(901,{sport_type:'WeightTraining',average_heartrate:130})],
    intervalsRecords:[interval({type:'WeightTraining',source:'COROS',external_id:'123'})],corosRecords:[{labelId:'123',sets:0}]};
  const result=await merge(options);
  assert.equal(result.data.activities[0].sets,0); assert.equal(result.data.activities[0].averageHeartRate,130);
  const missing=await merge({...options,corosRecords:[{labelId:'456',sets:9}],intervalsRecords:[interval({icu_training_load:null})]});
  assert.equal(missing.data.activities[0].sets,12); assert.equal(missing.data.activities[0].trainingLoad,10);
});

test('跨平台精确关联合并历史独有活动，冲突或多重关联失败', async () => {
  const old={...normalizeStrava(raw()),activityUrl:'https://intervals.icu/activities/i1',trainingLoad:12};
  const {stravaUrl,...unlinked}=old;
  const result=await merge({previous:snapshot([unlinked]),intervalsRecords:[interval()]});
  assert.equal(result.data.activities.length,1); assert.equal(result.data.activities[0].trainingLoad,40);
  await assert.rejects(merge({previous:snapshot([old]),intervalsRecords:[interval({strava_id:'902'})]}),/冲突/);
  await assert.rejects(merge({intervalsRecords:[interval(),interval({id:'i2'})]}),/不唯一/);
  await assert.rejects(merge({previous:snapshot([old,old])}),/重复/);
});

test('全量发现补传、修改与删除；日常不因列表未返回而删除', async () => {
  const old=normalizeStrava(raw()), older=normalizeStrava(raw(902,{start_date:'2021-01-01T01:00:00Z'}));
  const result=await merge({previous:snapshot([old]),stravaRecords:[raw(902,{start_date:'2021-01-01T01:00:00Z'})]});
  assert.deepEqual(result.report.deleted,[old.stravaUrl]); assert.equal(result.data.activities.length,1);
  assert.equal(result.data.activities[0].date,older.date);
  const found=await merge({previous:snapshot([old]),stravaRecords:[],getActivity:async ()=>raw(901,{distance:50000})});
  assert.equal(found.data.activities[0].distanceKm,50);
  const daily=await merge({previous:snapshot([old]),stravaRecords:[],window:{...syncWindow(null,now),full:false},getActivity:async ()=>{throw Error('不应查询');}});
  assert.equal(daily.data.activities.length,1);
  await assert.rejects(merge({previous:snapshot([old]),stravaRecords:[],getActivity:async ()=>{throw Error('HTTP 429');}}),/429/);
});

test('Intervals.icu 查询窗口、字段、装备及满页拆分', async () => {
  const calls=[];
  const data=await fetchIntervalsData({config:{INTERVALS_ICU_API_KEY:'test'},now,oldest:'2026-10-17',fetchImpl:async url=>{
    calls.push(new URL(url)); return response(url.endsWith('/athlete/0')?{id:'i123'}:url.endsWith('/gear')?[]:[interval()]);
  }});
  assert.equal(data.records.length,1); assert.deepEqual(data.gearLibrary,[]);
  assert.equal(calls[1].searchParams.get('oldest'),'2026-10-17'); assert.match(calls[1].searchParams.get('fields'),/external_id/);
  let ranges=0;
  const split=await fetchIntervalsData({config:{INTERVALS_ICU_API_KEY:'test'},now,oldest:'2026-10-17',fetchImpl:async url=>{
    if(url.endsWith('/athlete/0'))return response({id:'i123'});
    if(url.endsWith('/gear'))return response([]);
    ranges++;return response(ranges===1?Array(10000).fill(interval()):[interval({id:'i'+ranges})]);
  }});
  assert.equal(ranges,3);assert.equal(split.records.length,2);
  for(const status of [401,429,503]) await assert.rejects(fetchIntervalsData({config:{INTERVALS_ICU_API_KEY:'test'},now,fetchImpl:async()=>response(null,status)}),new RegExp('HTTP '+status));
  await assert.rejects(fetchIntervalsData({config:{},now}),/请配置/);
});

async function workspace(t) {
  const path=await directory(t);
  await mkdir(join(path,'docs')); await mkdir(join(path,'data'));
  await writeFile(join(path,'docs/activities.json'),JSON.stringify(snapshot([])));
  await writeFile(join(path,'docs/personal-bests.json'),JSON.stringify(pb));
  await writeFile(join(path,'docs/index.html'),'previous html');
  await writeFile(join(path,'data/strength-sets.json'),'[]');
  await writeFile(join(path,'data/profile.json'),JSON.stringify({stravaUrl:'https://www.strava.com/athletes/1'}));
  return path;
}
const syncOptions=directory=>({directory,now,corosInput,client:{get:async()=>({id:1}),activities:async()=>[raw()]},
  fetchIntervals:async()=>({records:[],gearLibrary:[]}),fetchBests:async()=>pb,render:async()=>'new html',finishTime:()=>now});

test('整个同步成功后才推进游标，下一次执行为增量', async t => {
  const path=await workspace(t), options=syncOptions(path);
  const first=await sync(options); assert.equal(first.mode,'full');
  const state=JSON.parse(await readFile(join(path,'data/sync-state.json'),'utf8'));
  assert.equal(state.cursor,now.toISOString()); assert.equal(state.lastFullReconcileAt,now.toISOString());
  const second=await sync({...options,now:new Date(now.getTime()+60000),finishTime:()=>new Date(now.getTime()+120000)});
  assert.equal(second.mode,'incremental'); assert.equal(second.records,1);
});

test('Strava、装备、成绩、构建失败及替换中断均保留旧文件和游标', async t => {
  const path=await workspace(t),options=syncOptions(path), files=['docs/activities.json','docs/personal-bests.json','docs/index.html','data/strength-sets.json'];
  const before=await Promise.all(files.map(f=>readFile(join(path,f),'utf8')));
  for(const change of [
    {client:{get:async()=>({id:1}),activities:async()=>{throw Error('Strava 失败');}}},
    {fetchIntervals:async()=>{throw Error('装备失败');}},
    {fetchBests:async()=>{throw Error('成绩失败');}},
    {render:async()=>{throw Error('构建失败');}},
    {renameImpl:async (from,to)=>{if(to.endsWith('index.html'))throw Error('替换中断');await rename(from,to);}},
  ]) {
    await assert.rejects(sync({...options,...change}));
    assert.deepEqual(await Promise.all(files.map(f=>readFile(join(path,f),'utf8'))),before);
    await assert.rejects(access(join(path,'data/sync-state.json')),{code:'ENOENT'});
    await assert.rejects(access(join(path,'output/sync.lock')),{code:'ENOENT'});
  }
  await sync(options);
  const state=await readFile(join(path,'data/sync-state.json'),'utf8');
  await assert.rejects(sync({...options,fetchIntervals:async()=>{throw Error('失败');}}));
  assert.equal(await readFile(join(path,'data/sync-state.json'),'utf8'),state);
});

test('恢复中断事务并阻止同时写入', async t => {
  const path=await workspace(t);
  await mkdir(join(path,'output/sync'),{recursive:true});
  await writeFile(join(path,'output/sync/rollback.json'),JSON.stringify([{name:'docs/index.html',previous:'restored'}]));
  await recoverTransaction(path); assert.equal(await readFile(join(path,'docs/index.html'),'utf8'),'restored');
  await writeFile(join(path,'output/sync.lock'),String(process.pid));
  await assert.rejects(sync(syncOptions(path)),/同步进程/);
});
