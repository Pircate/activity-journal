import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access, rename} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {unavailableId, syncWindow, validateCorosInput, mergeActivities, sync, recoverTransaction} from './sync.mjs';
import {fetchIntervalsData, normalizeActivities} from './update-data.mjs';
import {fetchPersonalBests} from './update-personal-bests.mjs';

const now = new Date('2026-10-24T10:00:00.000Z');
const period = {start:'2020-01-01', end:'2026-10-24'};
const snapshot = (activities = [], unavailableActivities = []) => ({period, syncedAt:'2026-10-24 17:00:00 +08:00', activities, unavailableActivities, gearLibrary:[]});
const corosInput = {startDate:'1900-01-01',endDate:'2026-10-24',queriedAt:now.toISOString(),records:[]};
const pb = {source:'Intervals.icu',syncedAt:now.toISOString(),records:[]};
const profile = {name:'接口姓名',location:'接口位置',stravaUrl:'https://www.strava.com/athletes/78720097'};
const interval = (extra = {}) => ({id:'i1', strava_id:'901', type:'Ride', start_date:'2026-10-23T16:30:00Z', moving_time:3601, distance:20070, total_elevation_gain:123.4, icu_training_load:40, ...extra});
const stub = (id = '901', extra = {}) => ({id, source:'STRAVA', start_date_local:'2026-10-24T00:30:00', _note:'STRAVA activities are not available via the API', ...extra});
const activity = (extra = {}) => normalizeActivities([interval(extra)], period)[0];
const strava = (extra = {}) => ({id:'901',sport_type:'Ride',start_date:'2026-10-23T16:30:00Z',moving_time:3601,distance:20070,total_elevation_gain:123.4,...extra});
const merge = options => mergeActivities({previous:snapshot(), stravaRecords:[strava()], intervalsRecords:[interval()], corosRecords:[], strengthSets:[], window:syncWindow(null,now), now, ...options});
const response = (data, status = 200) => ({ok:status === 200,status,json:async () => data});
async function directory(t) {
  const parent = resolve('output/sync-tests');
  await mkdir(parent, {recursive:true});
  const path = await mkdtemp(join(parent,'journal-sync-'));
  t.after(() => rm(path,{recursive:true,force:true}));
  return path;
}

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
  for (const change of [{startDate:'2020-01-01'},{endDate:'2026-10-23'}, {queriedAt:'2026-10-22T10:00:00.000Z'}, {queriedAt:'2026-10-25T10:00:00.000Z'}, {records:[{labelId:'123',sets:-1}]}, {records:[{labelId:'123',sets:1},{labelId:'123',sets:2}]}]) {
    assert.throws(() => validateCorosInput({...corosInput,...change},syncWindow(null,now),now));
  }
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
  await writeFile(join(path,'docs/activities.json'),JSON.stringify(snapshot()));
  await writeFile(join(path,'docs/personal-bests.json'),JSON.stringify(pb));
  await writeFile(join(path,'docs/index.html'),'previous html');
  await writeFile(join(path,'data/strength-sets.json'),'[]');
  await writeFile(join(path,'data/profile.json'),JSON.stringify({...profile,name:'旧姓名'}));
  return path;
}
const syncOptions=directory=>({directory,now,corosInput, fetchActivities:async options=>{const merged=merge({...options,previous:options.baseData,window:syncWindow(null,options.now)});options.onReport(merged.report);options.onProfile(profile);return merged.data;},fetchBests:async()=>pb,render:async options=>{assert.deepEqual(options.profile,profile);return 'new html';},finishTime:()=>now});

test('整个同步成功后才推进游标，下一次执行为增量', async t => {
  const path=await workspace(t), options=syncOptions(path);
  const first=await sync(options); assert.equal(first.mode,'full');
  assert.deepEqual(JSON.parse(await readFile(join(path,'data/profile.json'),'utf8')),profile);
  const state=JSON.parse(await readFile(join(path,'data/sync-state.json'),'utf8'));
  assert.equal(state.cursor,now.toISOString()); assert.equal(state.lastFullReconcileAt,now.toISOString());
  const second=await sync({...options,now:new Date(now.getTime()+60000),finishTime:()=>new Date(now.getTime()+120000)});
  assert.equal(second.mode,'incremental'); assert.equal(second.records,1);
});

test('COROS、活动、装备、成绩、构建失败及替换中断均保留旧文件和游标', async t => {
  const path=await workspace(t),options=syncOptions(path), files=['docs/activities.json','docs/personal-bests.json','docs/index.html','data/profile.json','data/strength-sets.json'];
  const before=await Promise.all(files.map(f=>readFile(join(path,f),'utf8')));
  for(const change of [
    {corosInput:{...corosInput,records:null}},
    {fetchActivities:async()=>{throw Error('活动或装备失败');}},
    {fetchActivities:async()=>({activities:[{}]})},
    {fetchActivities:async()=>({...snapshot(),gearLibrary:[{}]})},
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
  await assert.rejects(sync({...options,fetchActivities:async()=>{throw Error('失败');}}));
  assert.equal(await readFile(join(path,'data/sync-state.json'),'utf8'),state);
});

test('全量发现更早历史时要求扩大 COROS 范围，不推进游标', async t => {
  const path=await workspace(t);
  await assert.rejects(sync({...syncOptions(path),corosInput:{...corosInput,startDate:'2020-01-01'}, fetchActivities:async()=>({...snapshot([{...activity(),date:'2019-01-01'}]),sourcePolicyVersion:2,period:{start:'2019-01-01',end:period.end}})}),/Strava 发现更早历史/);
  await assert.rejects(access(join(path,'data/sync-state.json')),{code:'ENOENT'});
});

test('恢复中断事务并阻止同时写入', async t => {
  const path=await workspace(t);
  await mkdir(join(path,'output/sync'),{recursive:true});
  await writeFile(join(path,'output/sync/rollback.json'),JSON.stringify([{name:'docs/index.html',previous:'restored'}]));
  await recoverTransaction(path); assert.equal(await readFile(join(path,'docs/index.html'),'utf8'),'restored');
  await writeFile(join(path,'output/sync.lock'),String(process.pid));
  await assert.rejects(sync(syncOptions(path)),/同步进程/);
});
