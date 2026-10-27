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
const interval = (extra = {}) => ({id:'i1', strava_id:'901', type:'Ride', start_date:'2026-10-23T16:30:00Z', moving_time:3601, distance:20070, total_elevation_gain:123.4, icu_training_load:40, ...extra});
const stub = (id = '901', extra = {}) => ({id, source:'STRAVA', start_date_local:'2026-10-24T00:30:00', _note:'STRAVA activities are not available via the API', ...extra});
const activity = (extra = {}) => normalizeActivities([interval(extra)], period)[0];
const merge = options => mergeActivities({previous:snapshot(), intervalsRecords:[interval()], corosRecords:[], strengthSets:[], window:syncWindow(null,now), now, ...options});
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

test('Intervals.icu 覆盖基础指标，新增完整活动，重复运行不重复', () => {
  const old = {...activity(), distanceKm:999, trainingLoad:30};
  const historical = activity({id:'i2',strava_id:undefined,start_date:'2021-01-01T01:00:00Z'});
  const records = [interval(),interval({id:'i3',strava_id:undefined})];
  const first = merge({previous:snapshot([old,historical]), intervalsRecords:records});
  assert.equal(first.data.activities.length,3);
  assert.deepEqual(first.data.activities.find(a=>a.activityUrl===old.activityUrl),activity());
  assert.deepEqual(first.data.activities.at(-1),historical);
  assert.equal(first.report.added,1); assert.equal(first.report.updated,1); assert.equal(first.report.retainedHistory,1);
  assert.deepEqual(merge({previous:first.data,intervalsRecords:records}).data.activities,first.data.activities);
  const corrected = merge({previous:first.data, intervalsRecords:[interval({distance:12345,moving_time:1800,total_elevation_gain:0})]});
  const row = corrected.data.activities.find(a=>a.stravaUrl);
  assert.equal(row.distanceKm,12.345); assert.equal(row.durationSeconds,1800); assert.equal(row.elevationGain,0);
});

test('精确关联历史并保留 Strava 链接，不按同日或相同指标猜测关联', () => {
  const old = activity();
  const {activityUrl,...stravaOnly} = old;
  const {stravaUrl,...intervalsOnly} = old;
  for (const previous of [snapshot([stravaOnly]),snapshot([intervalsOnly]),snapshot([stravaOnly,intervalsOnly])]) {
    const result = merge({previous});
    assert.equal(result.data.activities.length,1); assert.deepEqual(result.data.activities[0],old);
  }
  assert.equal(merge({previous:snapshot([old]),intervalsRecords:[interval({strava_id:undefined})]}).data.activities[0].stravaUrl,old.stravaUrl);
  const independent = merge({previous:snapshot([stravaOnly]),intervalsRecords:[interval({strava_id:undefined})]});
  assert.equal(independent.data.activities.length,2);
  assert.equal(independent.data.activities.filter(a=>a.stravaUrl).length,1);
});

test('同步合并按实际开始时间倒序，同日受限历史保留已知时间', () => {
  const old = activity({id:'902', strava_id:'902', start_date:'2026-10-24T08:00:00Z'});
  const result = merge({previous:snapshot([old]), intervalsRecords:[
    interval({start_date:'2026-10-24T01:00:00Z'}),
    stub('902'),
    interval({id:'i2', strava_id:'903', start_date:'2026-10-24T09:00:00Z'}),
  ]});
  assert.deepEqual(result.data.activities.map(a => a.startTime), ['17:00:00', '16:00:00', '09:00:00']);
});

test('关联冲突、多重关联、历史及本次重复 ID 均失败', () => {
  const old = activity();
  for (const options of [
    {previous:snapshot([old]),intervalsRecords:[interval({strava_id:'902'})]},
    {previous:snapshot([old]),intervalsRecords:[interval({id:'i2'})]},
    {intervalsRecords:[interval(),interval({id:'i2'})]},
    {intervalsRecords:[interval(),interval()]},
    {intervalsRecords:[stub('901',{strava_id:'902'})]},
    {previous:snapshot([old,old])},
    {previous:snapshot([old,{...old,activityUrl:'https://intervals.icu/activities/i2'}])},
  ]) assert.throws(()=>merge(options),/冲突|不唯一|重复/);
});

test('COROS 组数精确关联，负荷和组数缺失保留历史，零值可以更新', () => {
  const record = interval({type:'WeightTraining',source:'COROS',external_id:'123',average_heartrate:130});
  const old = {...activity(record),sets:12,trainingLoad:10};
  const options = {previous:snapshot([old]),intervalsRecords:[record],corosRecords:[{labelId:'123',sets:0}]};
  const result = merge(options);
  assert.equal(result.data.activities[0].sets,0); assert.equal(result.data.activities[0].averageHeartRate,130);
  const missing = merge({...options,corosRecords:[{labelId:'456',sets:9}],intervalsRecords:[{...record,icu_training_load:null}]});
  assert.equal(missing.data.activities[0].sets,12); assert.equal(missing.data.activities[0].trainingLoad,10);
  const zero = merge({...options,intervalsRecords:[{...record,icu_training_load:0,average_heartrate:0}]});
  assert.equal(zero.data.activities[0].trainingLoad,0); assert.equal(zero.data.activities[0].averageHeartRate,null);
  const fresh = merge({intervalsRecords:[{...record,strava_id:undefined,distance:null,icu_training_load:null,average_heartrate:null}]});
  assert.equal(fresh.data.activities[0].trainingLoad,null); assert.equal(fresh.data.activities[0].sets,null);
  assert.equal(fresh.data.activities[0].averageHeartRate,null); assert.equal(fresh.data.activities[0].distanceKm,null);
  assert.equal(fresh.data.activities[0].stravaUrl,undefined);
});

test('全量和增量都保留未返回历史，不执行删除请求', () => {
  const old = activity();
  for (const full of [true,false]) {
    const result = merge({previous:snapshot([old]),intervalsRecords:[],window:{...syncWindow(null,now),full}});
    assert.deepEqual(result.data.activities,[old]); assert.equal(result.report.retainedHistory,1);
  }
});

test('已知受限记录保留详情与真实链接，新受限记录只生成日期提示', () => {
  const old = activity({id:'901'});
  const {activityUrl,...stravaOnly} = old;
  for (const previous of [snapshot([old]),snapshot([stravaOnly])]) {
    const result = merge({previous,intervalsRecords:[stub(),stub('902')]});
    assert.deepEqual(result.data.activities,[old]);
    assert.deepEqual(result.data.unavailableActivities,[{id:unavailableId('902'),date:'2026-10-24'}]);
    assert.equal(result.report.restrictedRetained,1); assert.equal(result.report.restrictedUnavailable,1);
    assert.deepEqual(merge({previous:result.data,intervalsRecords:[stub(),stub('902')]}).data,result.data);
  }
});

test('受限提示按身份保留，重复查询不增项，恢复可读仅移除对应记录', () => {
  const window = {...syncWindow(null,now),full:false,oldest:'2026-10-20'};
  const prior = [{id:unavailableId('903'),date:'2026-10-19'}, {id:unavailableId('901'),date:'2026-10-23'}];
  const previous = snapshot([], prior);
  const first = merge({previous,window,intervalsRecords:[stub(),stub('902')]});
  assert.equal(first.data.unavailableActivities.length, 3);
  assert.equal(first.data.unavailableActivities.filter(a => a.date === '2026-10-24').length, 2);
  assert.equal(first.data.unavailableActivities.find(a => a.id === unavailableId('901')).date, '2026-10-24');
  assert.deepEqual(merge({previous:first.data,window,intervalsRecords:[]}).data.unavailableActivities, first.data.unavailableActivities);
  const resolved = merge({previous:first.data,window,intervalsRecords:[interval({id:'i9'}),stub('902')]});
  assert.equal(resolved.data.activities.length,1);
  assert.deepEqual(resolved.data.unavailableActivities,[prior[0], {id:unavailableId('902'),date:'2026-10-24'}]);
  assert.deepEqual(merge({previous:resolved.data,window,intervalsRecords:[]}).data.unavailableActivities,resolved.data.unavailableActivities);
  assert.deepEqual(previous.unavailableActivities, prior, '不修改输入快照');
});

test('仅识别明确的 Strava 空壳，其他缺字段、错误结构及无效数值失败', () => {
  for (const records of [null,{},[null],[stub('i1')],[stub('0')],[stub('901',{_note:'其他错误'})], [stub('901',{source:'COROS'})],[stub('901',{moving_time:null})],[stub('901',{start_date_local:'2026-02-30T10:00:00'})], [stub('901',{start_date_local:'2026-10-24T25:00:00'})],[interval({moving_time:null})], [interval({distance:-1})],[interval({icu_training_load:'12'})],[interval({strava_id:901})]]) {
    assert.throws(()=>merge({intervalsRecords:records}));
  }
  assert.throws(()=>merge({intervalsRecords:[stub('901',{distance:-1})]}));
});

test('北京时间日期及任务开始时间上界，未来记录不提前加入', () => {
  const result = merge({intervalsRecords:[interval(),interval({id:'i2',strava_id:undefined,start_date:now.toISOString()}), stub('902',{start_date_local:'2026-10-25T00:00:00'})]});
  assert.equal(result.data.activities.length,1); assert.equal(result.data.activities[0].date,'2026-10-24');
  assert.deepEqual(result.data.unavailableActivities,[]);
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
  return path;
}
const syncOptions=directory=>({directory,now,corosInput, fetchIntervals:async()=>({records:[interval()],gearLibrary:[]}),fetchBests:async()=>pb,render:async()=>'new html',finishTime:()=>now});

test('整个同步成功后才推进游标，下一次执行为增量', async t => {
  const path=await workspace(t), options=syncOptions(path);
  const first=await sync(options); assert.equal(first.mode,'full');
  const state=JSON.parse(await readFile(join(path,'data/sync-state.json'),'utf8'));
  assert.equal(state.cursor,now.toISOString()); assert.equal(state.lastFullReconcileAt,now.toISOString());
  const second=await sync({...options,now:new Date(now.getTime()+60000),finishTime:()=>new Date(now.getTime()+120000)});
  assert.equal(second.mode,'incremental'); assert.equal(second.records,1);
});

test('完整入口不读取 Strava 凭据或资料，网络仅访问 Intervals.icu', async t => {
  const path=await workspace(t), calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const parsed=new URL(url); calls.push(parsed);
    assert.equal(parsed.hostname,'intervals.icu');
    if(parsed.pathname.endsWith('/athlete/0')) return response({id:'i123'});
    if(parsed.pathname.endsWith('/gear')) return response([]);
    if(parsed.pathname.endsWith('/activities')) return response([interval()]);
    if(parsed.pathname.endsWith('/pace-curves.json')) return response({list:[{distance:[5000],values:[1500],activity_id:['i1']}]});
    if(parsed.pathname.endsWith('/power-curves.json')) return response({list:[{secs:[300,1200],watts:[200,160],activity_id:['i1','i1']}]});
    throw new Error('非预期请求');
  });
  const {fetchIntervals,fetchBests,...options}=syncOptions(path);
  const result=await sync({...options, fetchIntervals:args=>fetchIntervalsData({...args,config:{INTERVALS_ICU_API_KEY:'test'}}), fetchBests:args=>fetchPersonalBests({...args,config:{INTERVALS_ICU_API_KEY:'test'}})});
  assert.equal(result.records,1); assert.equal(calls.length,5);
});

test('COROS、活动、装备、成绩、构建失败及替换中断均保留旧文件和游标', async t => {
  const path=await workspace(t),options=syncOptions(path), files=['docs/activities.json','docs/personal-bests.json','docs/index.html','data/strength-sets.json'];
  const before=await Promise.all(files.map(f=>readFile(join(path,f),'utf8')));
  for(const change of [
    {corosInput:{...corosInput,records:null}},
    {fetchIntervals:async()=>{throw Error('活动或装备失败');}},
    {fetchIntervals:async()=>({records:[interval({moving_time:null})],gearLibrary:[]})},
    {fetchIntervals:async()=>({records:[],gearLibrary:[{}]})},
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

test('全量发现更早历史时要求扩大 COROS 范围，不推进游标', async t => {
  const path=await workspace(t);
  await assert.rejects(sync({...syncOptions(path),corosInput:{...corosInput,startDate:'2020-01-01'}, fetchIntervals:async()=>({records:[interval({start_date:'2019-01-01T00:00:00Z'})],gearLibrary:[]})}),/Intervals.icu 发现更早历史/);
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
