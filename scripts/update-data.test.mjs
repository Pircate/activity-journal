import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchAllActivities, normalizeActivities, readConfig} from './update-data.mjs';
import {createJournal, validateData, renderDayRecords, availableYears, renderYearOptions} from '../docs/journal.mjs';
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
  assert.match(cards, /<table class="activity-table" role="table">/);
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

test('使用账号 ID 查询全部历史，包含时区边界且只输出公开字段', async () => {
  const calls = [];
  const data = await fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test-key'}, now:new Date('2026-10-15T04:00:00Z'),
    fetchImpl:async (url, options) => {
      calls.push({url:new URL(url), options});
      return {ok:true, json:async () => calls.length === 1 ? {id:'i123'} : calls.length === 2 ? [record] : []};
    }});
  assert.deepEqual(data.period, {start:'2025-01-01', end:period.end});
  assert.equal(calls[0].options.headers.Authorization, 'Basic ' + Buffer.from('API_KEY:test-key').toString('base64'));
  assert.equal(calls[1].url.pathname, '/api/v1/athlete/i123/activities');
  assert.equal(calls[2].url.pathname, '/api/v1/athlete/i123/gear');
  assert.equal(calls[1].url.searchParams.get('oldest'), '1900-01-01');
  assert.equal(calls[1].url.searchParams.get('newest'), '2026-10-16T23:59:59');
  assert.equal(data.activities.length, 1);
  assert.deepEqual(data.gearLibrary, []);
  assert.equal(JSON.stringify(data).includes('i123'), false);
  assert.equal(JSON.stringify(data).includes('test-key'), false);
});

test('授权缺失、HTTP 失败、列表截断均拒绝更新', async () => {
  for (const config of [{}, {INTERVALS_ICU_API_KEY:''}, {INTERVALS_ICU_API_KEY:'  '}, {INTERVALS_ICU_API_KEY:123}]) {
    await assert.rejects(fetchAllActivities({config}), /请配置/);
  }
  await assert.rejects(fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'}, fetchImpl:async () => ({ok:false, status:401})}), /HTTP 401/);
  let count = 0;
  await assert.rejects(fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'}, fetchImpl:async () => ({ok:true,
    json:async () => ++count === 1 ? {id:'i123'} : Array(10000).fill(record)})}), /查询上限/);
});

test('受限 Strava 记录在日期上标注缺失，并排除在距离、时长、次数之外', async () => {
  let count = 0;
  const restricted = {id:'s1', source:'STRAVA', start_date_local:'2026-10-15T20:00:00', _note:'STRAVA activities are not available via the API'};
  const data = await fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'}, now:new Date('2026-10-15T04:00:00Z'),
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

test('历史活动与受限日期全部保留，边界后的活动裁剪，年份倒序且涵盖空年', async () => {
  const history = {...record, id:'i2', start_date:'2022-12-31T16:00:00Z'};
  const restricted = {id:'s1', source:'STRAVA', start_date_local:'2021-05-01T12:00:00', _note:'STRAVA activities are not available via the API'};
  const data = await fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'}, now:new Date('2026-10-15T04:00:00Z'),
    fetchImpl:async url => ({ok:true, json:async () => url.endsWith('/athlete/0') ? {id:'test'} : url.endsWith('/gear') ? []
      : [record, history, restricted, {...record, id:'i3', start_date:'2026-10-15T16:00:00Z'}]})});
  assert.deepEqual(data.period, {start:'2021-01-01', end:period.end});
  assert.equal(data.activities.length, 2);
  assert.equal(data.activities.at(-1).date, '2023-01-01');
  assert.deepEqual(data.unavailableActivities, [{date:'2021-05-01'}]);
  assert.deepEqual(availableYears(data), ['2026','2025','2024','2023','2022','2021']);
  assert.match(renderYearOptions(data), /value="recent">最近一年/);
  assert.equal(createJournal(data).activities.length, 1);
  assert.equal(createJournal(data, period.end, '2021').unavailableCount, 1);
  assert.equal(createJournal(data, period.end, '2022').activities.length, 0);
  assert.equal(createJournal(data, period.end, '2023').distance, 20.07);
  assert.throws(() => createJournal(data, period.end, '2020'), /所选年份/);
});

test('自然年覆盖闰日与年界，未来和未同步日期标记未知，最近一周保持当前记录', () => {
  const historyPeriod = {start:'2024-01-01', end:period.end};
  const activities = normalizeActivities([record,
    {...record, id:'i2', start_date:'2024-02-28T16:00:00Z'},
    {...record, id:'i3', start_date:'2024-12-31T15:59:59Z'},
    {...record, id:'i4', start_date:'2024-12-31T16:00:00Z'}], historyPeriod);
  const data = {period:historyPeriod, activities, syncedAt:'2026-10-15 12:00:00 +08:00', unavailableActivities:[], gearLibrary:[]};
  const leap = createJournal(data, period.end, '2024');
  assert.deepEqual(leap.period, {start:'2024-01-01', end:'2024-12-31'});
  assert.equal(leap.daily.length, 366);
  assert.equal(leap.activities.length, 2);
  assert.equal(leap.daily.find(d => d.date === '2024-02-29').count, 1);
  assert.equal(leap.daily.at(-1).count, 1);
  assert.equal(leap.daily.some(d => d.pending), false);
  assert.deepEqual(leap.recent.map(a => a.date), ['2026-10-15']);
  const current = createJournal(data, period.end, '2026');
  assert.equal(current.daily.length, 365);
  assert.equal(current.daily.find(d => d.date === period.end).pending, false);
  assert.equal(current.daily.find(d => d.date === '2026-10-16').pending, true);
  assert.equal(current.daily.at(-1).pending, true);
  const stale = createJournal(data, '2026-10-16');
  assert.equal(stale.daily.at(-1).pending, true);
  assert.equal(createJournal({...data, period}, period.end, '2025').daily[0].pending, true);
});

test('首屏摘要固定最近七天，保留多次活动、缺失距离及未同步提示', () => {
  const activity = {date:'2026-10-09', sport:'骑行', distanceKm:0.1, duration:'0:30:01', trainingLoad:0};
  const data = {period:{start:'2024-01-01', end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00', gearLibrary:[],
    activities:[activity, {...activity, distanceKm:0.2}, {...activity, date:'2026-10-15', distanceKm:null}, {...activity, date:'2026-10-08', distanceKm:999}, {...activity, date:'2026-10-16', distanceKm:999}],
    unavailableActivities:[{date:'2026-10-15'}, {date:'2026-10-08'}]};
  const summary = createJournal(data).recentSummary;
  assert.match(summary, /2026\.10\.09/);
  assert.match(summary, /2026\.10\.15/);
  assert.match(summary, /<dd>3<small>次/);
  assert.match(summary, /<dd>0\.30<small>公里/);
  assert.match(summary, /1:30:03/);
  assert.match(summary, /1 次运动指标缺失（距离未提供）/);
  assert.match(summary, /另有 1 条详情不可读取/);
  assert.equal(createJournal(data, data.period.end, '2024').recentSummary, summary);
  const rolled = createJournal(data, '2026-10-16').recentSummary;
  assert.match(rolled, /<dd>2<small>次/);
  assert.match(rolled, /部分日期未同步/);
  const missing = createJournal({...data, activities:[{...activity, distanceKm:null}], unavailableActivities:[]}).recentSummary;
  assert.match(missing, /<dd>—<small>公里/);
  const empty = createJournal({...data, activities:[], unavailableActivities:[]}).recentSummary;
  assert.match(empty, /<dd>0<small>次/);
  assert.match(empty, /<dd>0\.00<small>公里/);
  assert.match(empty, /0:00:00/);
});

test('达到上限后拆分为互不重叠的日期范围，分段失败则拒绝整个快照', async () => {
  const ranges = [];
  let fail = false;
  const fetchImpl = async url => {
    if (url.endsWith('/athlete/0')) return {ok:true, json:async () => ({id:'test'})};
    if (url.endsWith('/gear')) return {ok:true, json:async () => []};
    const params = new URL(url).searchParams;
    ranges.push([params.get('oldest'), params.get('newest').slice(0,10)]);
    if (ranges.length === 1) return {ok:true, json:async () => Array(10000).fill(record)};
    if (fail) return {ok:false, status:503};
    return {ok:true, json:async () => ranges.length === 2 ? [{...record, start_date:'1950-01-01T00:00:00Z'}] : [{...record, id:'i2'}]};
  };
  const options = {config:{INTERVALS_ICU_API_KEY:'test'}, now:new Date('2026-10-15T04:00:00Z'), fetchImpl};
  const data = await fetchAllActivities(options);
  assert.equal(data.activities.length, 2);
  assert.equal(data.period.start, '1950-01-01');
  assert.equal(ranges.length, 3);
  assert.equal(ranges[1][0], ranges[0][0]);
  assert.equal(Date.parse(ranges[2][0]) - Date.parse(ranges[1][1]), 86400000);
  assert.equal(ranges[2][1], ranges[0][1]);
  ranges.length = 0;
  fail = true;
  await assert.rejects(fetchAllActivities(options), /HTTP 503/);
});
