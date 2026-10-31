import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeActivities, readConfig} from './update-data.mjs';
import {createJournal, validateData, renderDayRecords, availableYears, renderYearOptions, recentDateRange} from '../docs/journal.mjs';
const period = {start:'2025-10-16', end:'2026-10-15'};
const record = {id:'i1', type:'Ride', start_date:'2026-10-14T16:30:00', moving_time:3601, distance:20070, icu_training_load:0};


test('北京时间边界、米到公里、零负荷、缺失值及同日多次活动', () => {
  const activities = normalizeActivities([record, {...record, id:'i2', distance:null, icu_training_load:null},
    {...record, id:'i3', start_date:'2025-10-15T15:59:59Z'},
    {...record, id:'i4', start_date:'2026-10-15T16:00:00Z'}], period);
  assert.deepEqual(activities, [
    {date:'2026-10-15', startTime:'00:30:00', sport:'Ride', distanceKm:20.07, durationSeconds:3601, trainingLoad:0, activityUrl:'https://intervals.icu/activities/i1'},
    {date:'2026-10-15', startTime:'00:30:00', sport:'Ride', distanceKm:null, durationSeconds:3601, trainingLoad:null, activityUrl:'https://intervals.icu/activities/i2'},
  ]);
});

test('Strava 链接精确区分同日运动，无关联时不跳转并拒绝非平台链接', () => {
  const activities = normalizeActivities([{...record, strava_id:'901'}, {...record, id:123, strava_id:'902'}], period);
  const data = {period, syncedAt:'2026-10-15 12:00:00 +08:00', activities, unavailableActivities:[], gearLibrary:[]};
  validateData(data);
  const cards = createJournal(data).cards;
  for (const id of ['901', '902']) assert.ok(cards.includes(`href="https://www.strava.com/activities/${id}" target="_blank" rel="noopener noreferrer"`));
  assert.match(cards, /新标签页/);
  for (const activityUrl of ['javascript:alert(1)', 'https://evil.test/activities/i1', 'https://intervals.icu/activities/i1/../../settings', 'https://intervals.icu/activities/i1?x=1', null]) {
    assert.throws(() => validateData({...data, activities:[{...activities[0], activityUrl}]}), /运动记录格式无效/);
  }
  const {stravaUrl, ...unlinked} = activities[0];
  validateData({...data, activities:[unlinked]});
  assert.doesNotMatch(createJournal({...data, activities:[unlinked]}).cards, /record-link/);
  for (const stravaUrl of ['javascript:alert(1)', 'https://evil.test/activities/1', 'https://www.strava.com/activities/1?x=1', 'https://www.strava.com/activities/i1', 'https://www.strava.com/activities/0', null]) {
    assert.throws(() => validateData({...data, activities:[{...activities[0], stravaUrl}]}), /运动记录格式无效/);
  }
  for (const strava_id of ['i1', '', '1/../../settings', 123, 0]) assert.throws(() => normalizeActivities([{...record, strava_id}], period), /Strava 活动标识无效/);
  assert.doesNotMatch(cards, /href="https:\/\/intervals\.icu/);
  for (const id of ['../settings', {}, 'i1" onclick="alert(1)', null]) assert.throws(() => normalizeActivities([{...record, id}], period));
});

test('全年日期保留当天全部记录及各自链接，空日期和不可读取记录不生成卡片', () => {
  const activities = normalizeActivities([
    {...record, start_date:'2026-06-01T02:00:00Z', strava_id:'901'},
    {...record, id:'i2', start_date:'2026-06-01T10:00:00Z', strava_id:'902', distance:null, icu_training_load:null},
    {...record, id:'i3'},
  ], period);
  const data = {period, syncedAt:'2026-10-15 12:00:00 +08:00', activities, unavailableActivities:[{date:'2026-06-02'}], gearLibrary:[]};
  const journal = createJournal(data);
  const day = journal.daily.find(day => day.date === '2026-06-01');
  assert.equal(day.count, 2);
  assert.deepEqual(day.records, activities.filter(activity => activity.date === day.date));
  assert.equal(journal.recent.length, 1);
  const cards = renderDayRecords(day.records);
  for (const id of ['901', '902']) assert.ok(cards.includes(`href="https://www.strava.com/activities/${id}"`));
  assert.doesNotMatch(cards, /activities\/i3/);
  assert.match(cards, /未提供/);
  assert.match(cards, /<table class="activity-table" role="table">/);
  assert.equal((cards.match(/<tr class="activity-row/g) ?? []).length, 2);
  assert.equal(renderDayRecords([]), '');
  const {stravaUrl, ...legacy} = day.records[0];
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

test('首屏摘要固定最近七天，保留多次活动及缺失距离，不显示部分日期未同步提示', () => {
  const activity = {date:'2026-10-09', sport:'Ride', distanceKm:0.1, durationSeconds:1801, trainingLoad:0};
  const data = {period:{start:'2024-01-01', end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00', gearLibrary:[],
    activities:[activity, {...activity, distanceKm:0.2}, {...activity, date:'2026-10-15', distanceKm:null}, {...activity, date:'2026-10-08', distanceKm:999}, {...activity, date:'2026-10-16', distanceKm:999}],
    unavailableActivities:[{date:'2026-10-15'}, {date:'2026-10-08'}]};
  const summary = createJournal(data).recentSummary;
  assert.match(summary, /2026\.10\.09/);
  assert.match(summary, /2026\.10\.15/);
  assert.match(summary, /<dd>3<small>次/);
  assert.match(summary, /<dd>0\.30<small>km/);
  assert.match(summary, /1:30:03/);
  assert.match(summary, /1 次运动指标缺失（距离未提供）/);
  assert.match(summary, /另有 1 条详情不可读取/);
  assert.equal(createJournal(data, data.period.end, '2024').recentSummary, summary);
  const rolled = createJournal(data, '2026-10-16').recentSummary;
  assert.match(rolled, /<dd>2<small>次/);
  assert.doesNotMatch(rolled, /部分日期未同步|当前为已同步记录/);
  const missing = createJournal({...data, activities:[{...activity, distanceKm:null}], unavailableActivities:[]}).recentSummary;
  assert.match(missing, /<dd>—<small>km/);
  const empty = createJournal({...data, activities:[], unavailableActivities:[]}).recentSummary;
  assert.match(empty, /<dd>0<small>次/);
  assert.match(empty, /<dd>0\.00<small>km/);
  assert.match(empty, /0:00:00/);
});

test('七天累计负荷合计所有运动、排除范围外记录，并区分零、部分缺失和全部缺失', () => {
  const activity = {date:'2026-10-15', sport:'Ride', distanceKm:10, durationSeconds:1800, trainingLoad:25.25};
  const data = {period:{start:'2024-01-01', end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00', gearLibrary:[], unavailableActivities:[],
    activities:[activity, {...activity, sport:'Run', trainingLoad:10.15}, {...activity, date:'2026-10-08', trainingLoad:999}, {...activity, date:'2026-10-16', trainingLoad:999}]};
  const summary = createJournal(data).recentSummary;
  assert.match(summary, /<dt>累计负荷<\/dt><dd>35\.4<\/dd>/);
  assert.equal(createJournal(data, data.period.end, '2024', 'Run').recentSummary, summary);
  const render = loads => createJournal({...data, activities:loads.map(trainingLoad => ({...activity, trainingLoad}))}).recentSummary;
  assert.match(render([0]), /<dt>累计负荷<\/dt><dd>0<\/dd>/);
  assert.match(render([25.25, null]), /<dt>累计负荷<\/dt><dd>25\.3<\/dd>/);
  assert.match(render([25.25, null]), /1 次运动指标缺失（负荷未提供，累计负荷仅含已提供值）/);
  assert.match(render([null]), /<dt>累计负荷<\/dt><dd>—<\/dd>/);
  assert.match(render([null]), /1 次运动指标缺失（负荷未提供）/);
  assert.match(render([]), /<dt>累计负荷<\/dt><dd>0<\/dd>/);
});

test('近期摘要支持最近七天和本周切换，并累计爬升、区分缺失值', () => {
  const activity = (date, elevationGain) => ({date, sport:'Ride', distanceKm:10, durationSeconds:1800, trainingLoad:20, elevationGain});
  const data = {period:{start:'2024-01-01', end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00', gearLibrary:[], unavailableActivities:[],
    activities:[activity('2026-10-08', 100), activity('2026-10-09', 10), activity('2026-10-10', 20),
      activity('2026-10-11', 30), activity('2026-10-11', null), activity('2026-10-12', 40), activity('2026-10-15', 50)]};
  const rolling = createJournal(data, '2026-10-15', 'recent', '', 'rolling');
  assert.match(rolling.recentSummary, /2026\.10\.09/);
  assert.match(rolling.recentSummary, /2026\.10\.15/);
  assert.match(rolling.recentSummary, /<span class="summary-title">最近 7 天<\/span>/);
  assert.match(rolling.recentSummary, /data-recent-range="rolling" aria-pressed="true">最近 7 天<\/button>/);
  assert.match(rolling.recentSummary, /<dt>累计爬升<\/dt><dd>150<small>m<\/small><\/dd>/);
  assert.match(rolling.recentSummary, /1 次运动指标缺失（爬升未提供，累计爬升仅含已提供值）/);
  assert.equal(rolling.recentTitle, '最近一周');
  assert.equal((rolling.cards.match(/record-card/g) ?? []).length, 6);

  const week = createJournal(data, '2026-10-15', 'recent', '', 'week');
  assert.match(week.recentSummary, /2026\.10\.12/);
  assert.match(week.recentSummary, /2026\.10\.18/);
  assert.match(week.recentSummary, /<span class="summary-title">本周<\/span>/);
  assert.match(week.recentSummary, /data-recent-range="week" aria-pressed="true">本周<\/button>/);
  assert.match(week.recentSummary, /<dt>累计爬升<\/dt><dd>90<small>m<\/small><\/dd>/);
  assert.doesNotMatch(week.recentSummary, /累计爬升仅含已提供值/);
  assert.equal(week.recentTitle, '本周');
  assert.equal(week.recentStatus, '2 次运动');
  assert.equal((week.cards.match(/record-card/g) ?? []).length, 2);

  const zero = createJournal({...data, activities:[activity('2026-10-15', 0)]}, '2026-10-15').recentSummary;
  assert.match(zero, /<dt>累计爬升<\/dt><dd>0<small>m<\/small><\/dd>/);
  const missing = createJournal({...data, activities:[activity('2026-10-15', null)]}, '2026-10-15').recentSummary;
  assert.match(missing, /<dt>累计爬升<\/dt><dd>—<small>m<\/small><\/dd>/);
  assert.match(missing, /1 次运动指标缺失（爬升未提供）/);
  const empty = createJournal({...data, activities:[]}, '2026-10-15').recentSummary;
  assert.match(empty, /<dt>累计爬升<\/dt><dd>0<small>m<\/small><\/dd>/);
});

test('本周完整包含周一至周日，跨月跨年也显示截止日期', () => {
  assert.deepEqual(recentDateRange('2026-10-26', 'week'), {start:'2026-10-26', end:'2026-11-01', mode:'week'});
  assert.deepEqual(recentDateRange('2026-10-31', 'week'), {start:'2026-10-26', end:'2026-11-01', mode:'week'});
  assert.deepEqual(recentDateRange('2026-11-01', 'week'), {start:'2026-10-26', end:'2026-11-01', mode:'week'});
  assert.deepEqual(recentDateRange('2026-12-31', 'week'), {start:'2026-12-28', end:'2027-01-03', mode:'week'});
});
