import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeActivities, unavailableId} from './activity-sync.mjs';
import {normalizeStravaActivity} from './strava-data.mjs';
const now=new Date('2026-10-27T10:00:00Z');
const record=extra=>({id:'901',sport_type:'Ride',start_date:'2026-10-24T00:00:00Z',distance:12345,moving_time:3600,...extra});
const old=extra=>({...normalizeStravaActivity(record()),activityUrl:'https://intervals.icu/activities/i1',...extra});
const snapshot=activities=>({period:{start:'2020-01-01',end:'2026-10-27'},syncedAt:'2026-10-27 12:00:00 +08:00',activities,unavailableActivities:[],gearLibrary:[]});
const merge=options=>mergeActivities({previous:snapshot([]),stravaRecords:[record()],intervalsRecords:[{id:'i1',strava_id:'901',icu_training_load:40}],window:{oldest:'1900-01-01',end:'2026-10-27',before:now.getTime()/1000},now,...options});
test('主数据来自 Strava，负荷和组数各自精确关联，零值覆盖历史',()=>{
  const stravaRecords=[record({sport_type:'WeightTraining',average_heartrate:140,calories:123.45})];
  const intervalsRecords=[{id:'i1',strava_id:'901',type:'WeightTraining',source:'COROS',external_id:'123',icu_training_load:0,distance:9999,moving_time:999}];
  const previous=snapshot([old({sport:'WeightTraining',sets:12,averageHeartRate:130,trainingLoad:40})]);
  const result=merge({previous,stravaRecords,intervalsRecords,corosRecords:[{labelId:'123',sets:0}]});
  assert.equal(result.data.activities[0].sets,0);assert.equal(result.data.activities[0].trainingLoad,0);
  assert.equal(result.data.activities[0].averageHeartRate,140);assert.equal(result.data.activities[0].durationSeconds,3600);
  assert.equal(result.data.activities[0].calories,123.45);
  assert.deepEqual(merge({previous:result.data,stravaRecords,intervalsRecords,corosRecords:[{labelId:'123',sets:0}]}).data,result.data);
});
test('单边历史可以精确合并，恢复受限活动按摘要身份移除提示',()=>{
  const a=old();const {activityUrl,...stravaOnly}=a;const {stravaUrl,...intervalOnly}=a;
  const previous={...snapshot([stravaOnly,intervalOnly]),unavailableActivities:[{id:unavailableId('901'),date:'2026-10-24'},{id:unavailableId('902'),date:'2026-10-24'}]};
  const result=merge({previous});
  assert.equal(result.data.activities.length,1);assert.equal(result.data.unavailableActivities.length,1);
  assert.equal(result.data.unavailableActivities[0].id,unavailableId('902'));
});
test('跨平台冲突和重复 ID 失败，不猜测或任意覆盖',()=>{
  for(const options of [
    {previous:snapshot([old()]),intervalsRecords:[{id:'i1',strava_id:'902'}]},
    {previous:snapshot([old()]),intervalsRecords:[{id:'i2',strava_id:'901'}]},
    {intervalsRecords:[{id:'i1',strava_id:'901'},{id:'i2',strava_id:'901'}]},
    {intervalsRecords:[{id:'901',source:'STRAVA',strava_id:'902'}]},
    {stravaRecords:[record(),record()]}, {previous:snapshot([old(),old()])},
  ]) assert.throws(()=>merge(options),/冲突|重复/);
});
test('开始时间倒序，未来活动排除，缺失负荷保留历史且不保留旧基础字段',()=>{
  const result=merge({previous:snapshot([old({trainingLoad:30,distanceKm:999})]),intervalsRecords:[{id:'i1',strava_id:'901'}],stravaRecords:[record({distance:null}),record({id:'902',start_date:'2026-10-24T09:00:00Z'}),record({id:'903',start_date:now.toISOString()})]});
  assert.deepEqual(result.data.activities.map(a=>a.startTime),['17:00:00','08:00:00']);
  assert.equal(result.data.activities[1].distanceKm,null);assert.equal(result.data.activities[1].trainingLoad,30);
});
