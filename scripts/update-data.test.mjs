import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchYear, normalizeActivities, readConfig} from './update-data.mjs';
import {createJournal, validateData, renderDayRecords} from '../docs/journal.mjs';
const period = {start:'2025-10-16', end:'2026-10-15'};
const record = {id:'i1', type:'Ride', start_date:'2026-10-14T16:30:00', moving_time:3601, distance:20070, icu_training_load:0};

test('北京时间边界、米到公里、零负荷、缺失值及同日多次活动', () => {
  const activities = normalizeActivities([record, {...record, id:'i2', distance:null, icu_training_load:null},
    {...record, id:'i3', start_date:'2025-10-15T15:59:59Z'},
    {...record, id:'i4', start_date:'2026-10-15T16:00:00Z'}], period);
  assert.deepEqual(activities, [
    {date:'2026-10-15', sport:'骑行', distanceKm:20.07, duration:'1:00:01', trainingLoad:0, activityUrl:'https://intervals.icu/activities/i1'},
    {date:'2026-10-15', sport:'骑行', distanceKm:null, duration:'1:00:01', trainingLoad:null, activityUrl:'https://intervals.icu/activities/i2'},
  ]);
});

test('活动链接精确区分同日运动，兼容旧快照并拒绝非平台链接', () => {
  const activities = normalizeActivities([record, {...record, id:123}], period);
  const data = {period, syncedAt:'2026-10-15 12:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[]};
  validateData(data);
  const cards = createJournal(data).cards;
  for (const id of ['i1', '123']) assert.ok(cards.includes(`href="https://intervals.icu/activities/${id}" target="_blank" rel="noopener noreferrer"`));
  assert.match(cards, /新标签页/);
  for (const activityUrl of ['javascript:alert(1)', 'https://evil.test/activities/i1', 'https://intervals.icu/activities/i1/../../settings', 'https://intervals.icu/activities/i1?x=1', null]) {
    assert.throws(() => validateData({...data, activities:[{...activities[0], activityUrl}]}), /运动记录格式无效/);
  }
  const {activityUrl, ...legacy} = activities[0];
  validateData({...data, activities:[legacy]});
  assert.doesNotMatch(createJournal({...data, activities:[legacy]}).cards, /record-link/);
  for (const id of ['../settings', {}, 'i1" onclick="alert(1)', null]) assert.throws(() => normalizeActivities([{...record, id}], period));
});

test('全年日期保留当天全部记录及各自链接，空日期和不可读取记录不生成卡片', () => {
  const activities = normalizeActivities([
    {...record, start_date:'2026-06-01T02:00:00Z'},
    {...record, id:'i2', start_date:'2026-06-01T10:00:00Z', distance:null, icu_training_load:null},
    {...record, id:'i3'},
  ], period);
  const data = {period, syncedAt:'2026-10-15 12:00:00 +08:00', activities, unavailableActivities:[{date:'2026-06-02'}], gearLibrary:[]};
  const journal = createJournal(data);
  const day = journal.daily.find(day => day.date === '2026-06-01');
  assert.equal(day.count, 2);
  assert.deepEqual(day.records, activities.filter(activity => activity.date === day.date));
  assert.equal(journal.recent.length, 1);
  const cards = renderDayRecords(day.records);
  for (const id of ['i1', 'i2']) assert.ok(cards.includes(`href="https://intervals.icu/activities/${id}"`));
  assert.doesNotMatch(cards, /activities\/i3/);
  assert.match(cards, /未提供/);
  assert.match(cards, /<table class="activity-table">/);
  assert.equal((cards.match(/<tr class="activity-row/g) ?? []).length, 2);
  assert.equal(renderDayRecords([]), '');
  const {activityUrl, ...legacy} = day.records[0];
  assert.doesNotMatch(renderDayRecords([legacy]), /activity-link/);
  assert.match(renderDayRecords([{...legacy, sport:'<script>骑行</script>'}]), /&lt;script&gt;/);
  for (const date of ['2026-06-02', '2026-06-03']) assert.deepEqual(journal.daily.find(day => day.date === date).records, []);
  const pending = createJournal(data, '2026-10-16').daily.at(-1);
  assert.equal(pending.pending, true);
  assert.deepEqual(pending.records, []);
});

test('拒绝 Strava 空壳、重复 ID、缺失时长与无效数值', () => {
  for (const records of [[{id:'strava'}], [record, record], [{...record, moving_time:null}],
    [{...record, distance:-1}], [{...record, icu_training_load:'12'}]]) {
    assert.throws(() => normalizeActivities(records, period));
  }
});

test('使用账号 ID 查询完整一年，包含时区边界且只输出公开字段', async () => {
  const calls = [];
  const data = await fetchYear({config:{INTERVALS_ICU_API_KEY:'test-key'}, now:new Date('2026-10-15T04:00:00Z'),
    fetchImpl:async (url, options) => {
      calls.push({url:new URL(url), options});
      return {ok:true, json:async () => calls.length === 1 ? {id:'i123'} : calls.length === 2 ? [record] : []};
    }});
  assert.deepEqual(data.period, period);
  assert.equal(calls[0].options.headers.Authorization, 'Basic ' + Buffer.from('API_KEY:test-key').toString('base64'));
  assert.equal(calls[1].url.pathname, '/api/v1/athlete/i123/activities');
  assert.equal(calls[2].url.pathname, '/api/v1/athlete/i123/gear');
  assert.equal(calls[1].url.searchParams.get('oldest'), '2025-10-15');
  assert.equal(calls[1].url.searchParams.get('newest'), '2026-10-16T23:59:59');
  assert.equal(data.activities.length, 1);
  assert.deepEqual(data.gearLibrary, []);
  assert.equal(JSON.stringify(data).includes('i123'), false);
  assert.equal(JSON.stringify(data).includes('test-key'), false);
});

test('授权缺失、HTTP 失败、列表截断均拒绝更新', async () => {
  for (const config of [{}, {INTERVALS_ICU_API_KEY:''}, {INTERVALS_ICU_API_KEY:'  '}, {INTERVALS_ICU_API_KEY:123}]) {
    await assert.rejects(fetchYear({config}), /请配置/);
  }
  await assert.rejects(fetchYear({config:{INTERVALS_ICU_API_KEY:'test'}, fetchImpl:async () => ({ok:false, status:401})}), /HTTP 401/);
  let count = 0;
  await assert.rejects(fetchYear({config:{INTERVALS_ICU_API_KEY:'test'}, fetchImpl:async () => ({ok:true,
    json:async () => ++count === 1 ? {id:'i123'} : Array(10000).fill(record)})}), /查询上限/);
});

test('受限 Strava 记录在日期上标注缺失，并排除在距离、时长、次数之外', async () => {
  let count = 0;
  const restricted = {id:'s1', source:'STRAVA', start_date_local:'2026-10-15T20:00:00', _note:'STRAVA activities are not available via the API'};
  const data = await fetchYear({config:{INTERVALS_ICU_API_KEY:'test'}, now:new Date('2026-10-15T04:00:00Z'),
    fetchImpl:async () => ({ok:true, json:async () => ++count === 1 ? {id:'i123'} : count === 2 ? [record, restricted] : []})});
  validateData(data);
  assert.deepEqual(data.unavailableActivities, [{date:'2026-10-15'}]);
  const journal = createJournal(data);
  assert.equal(journal.unavailableCount, 1);
  assert.equal(journal.activities.length, 1);
  assert.equal(journal.distance, 20.07);
  assert.equal(journal.duration, 3601);
  assert.equal(journal.daily.at(-1).unavailable, 1);
  assert.equal(journal.daily.at(-1).count, 1);
  const withoutDetails = createJournal({...data, activities:[]});
  assert.equal(withoutDetails.daily.at(-1).unavailable, 1);
  assert.equal(withoutDetails.activities.length, 0);
});

test('读取本地配置，文件缺失或 JSON 错误时拒绝继续且不泄漏内容', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'interval-icu-config-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const path = join(directory, 'config.json');
  await assert.rejects(readConfig(path), /请配置/);
  await writeFile(path, '{"INTERVALS_ICU_API_KEY":"private-test-value"');
  await assert.rejects(readConfig(path), error => /有效 JSON/.test(error.message) && !error.message.includes('private-test-value'));
  await writeFile(path, JSON.stringify({INTERVALS_ICU_API_KEY:'test-key'}));
  assert.deepEqual(await readConfig(path), {INTERVALS_ICU_API_KEY:'test-key'});
});
