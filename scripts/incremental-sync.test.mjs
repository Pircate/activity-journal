import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAllActivities} from './fetch-site-data.mjs';
import {normalizeActivities, readConfig} from './update-data.mjs';

const now = new Date('2026-10-27T01:00:00Z');
const since = '2026-10-25T16:30:00Z'; // Beijing October 26, refresh from October 24.
const record = (id, date, extra = {}) => ({id, type:'Ride', start_date:date + 'T00:00:00Z', moving_time:3600, distance:20000, ...extra});
const baseline = (rows, unavailableActivities = []) => ({period:{start:'2020-01-01', end:'2026-10-26'}, syncedAt:'2026-10-26 00:30:00 +08:00',
  activities:normalizeActivities(rows, {start:'2020-01-01', end:'2026-10-26'}), unavailableActivities, gearLibrary:[]});
const stub = (id, date) => ({id, source:'STRAVA', start_date_local:date + 'T12:00:00', _note:'STRAVA activities are not available via the API'});

function api(rows, details = {}, failGear = false) {
  const calls = [];
  return {calls, fetchImpl:async input => {
    const url = new URL(input);
    calls.push(url);
    let data;
    if (url.pathname === '/api/v1/athlete/0') data = {id:'i123'};
    else if (url.pathname.endsWith('/activities')) data = rows;
    else if (url.pathname.endsWith('/gear')) {
      if (failGear) return {ok:false, status:503};
      data = [];
    } else {
      data = details[url.pathname.split('/').at(-1)];
      if (!data) return {ok:false, status:404};
    }
    return {ok:true, json:async () => data};
  }};
}
const sync = options => fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'}, now, ...options});

test('incremental updates preserve older history, unseen activities and timezone padding rows', async () => {
  const old = record('i1', '2020-01-01');
  const padding = record('i2', '2026-10-23');
  const updated = record('i3', '2026-10-24', {distance:30000});
  const deleted = record('i4', '2026-10-25');
  const fresh = record('i5', '2026-10-27');
  const baseData = baseline([old, padding, {...updated, distance:10000}, deleted], [{date:'2020-01-02'}, {date:'2026-10-24'}]);
  const client = api([padding, updated, fresh]);
  const data = await sync({...client, baseData, since});
  assert.equal(client.calls.find(url => url.pathname.endsWith('/activities')).searchParams.get('oldest'), '2026-10-22');
  assert.deepEqual(data.activities.map(a => a.activityUrl.split('/').at(-1)), ['i5', 'i4', 'i3', 'i2', 'i1']);
  assert.equal(data.activities[2].distanceKm, 30);
  assert.deepEqual(data.unavailableActivities, [{date:'2020-01-02'}]);
  assert.equal(baseData.activities.length, 4, 'input snapshot must not be mutated');
});

test('first run without cursor or baseline and explicit full mode query all history', async () => {
  for (const options of [{}, {since}, {baseData:baseline([])}, {baseData:baseline([]), since, full:true}]) {
    const client = api([]);
    await sync({...client, ...options});
    assert.equal(client.calls.find(url => url.pathname.endsWith('/activities')).searchParams.get('oldest'), '1900-01-01');
  }
});

test('old upload expands the range using its exact platform association', async () => {
  const old = record('i7', '2021-02-02', {strava_id:'901'});
  const client = api([old], {901:old});
  const data = await sync({...client, baseData:baseline([]), since, eventActivityIds:['901']});
  assert.equal(client.calls.find(url => url.pathname.includes('/activity/')).pathname, '/api/v1/activity/901');
  assert.equal(client.calls.find(url => url.pathname.endsWith('/activities')).searchParams.get('oldest'), '2021-01-31');
  assert.equal(data.activities[0].date, '2021-02-02');
});

test('known different platform IDs are resolved by real links, not by date', async () => {
  const old = record('i7', '2021-02-02', {strava_id:'901'});
  const client = api([old], {i7:old});
  const data = await sync({...client, baseData:baseline([old]), since, eventActivityIds:['901']});
  assert.equal(client.calls.find(url => url.pathname.includes('/activity/')).pathname, '/api/v1/activity/i7');
  assert.equal(data.activities.length, 1);
});

test('unknown event date falls back to full query and a restricted stub may publish', async () => {
  const client = api([stub('901', '2021-02-02')]);
  const data = await sync({...client, baseData:baseline([]), since, eventActivityIds:['901']});
  assert.equal(client.calls.find(url => url.pathname.endsWith('/activities')).searchParams.get('oldest'), '1900-01-01');
  assert.deepEqual(data.unavailableActivities, [{date:'2021-02-02'}]);
});

test('missing event, malformed response, future date, HTTP and gear failures reject without changing baseline', async () => {
  const baseData = baseline([record('i1', '2020-01-01')]);
  const before = JSON.stringify(baseData);
  await assert.rejects(sync({...api([]), baseData, since, eventActivityIds:['901']}), /尚未收录/);
  await assert.rejects(sync({...api([record('i1', '2026-10-27', {moving_time:null})]), baseData, since}), /活动不完整/);
  await assert.rejects(sync({...api([record('901', '2026-10-28')]), baseData, since, eventActivityIds:['901']}), /可发布日期/);
  await assert.rejects(sync({...api([], {}, true), baseData, since}), /HTTP 503/);
  await assert.rejects(sync({fetchImpl:async () => ({ok:false, status:401}), baseData, since}), /HTTP 401/);
  assert.equal(JSON.stringify(baseData), before);
});

test('a run reuses only the published baseline; repetition produces no duplicates', async () => {
  const row = record('i3', '2026-10-27', {strava_id:'901'});
  const baseData = baseline([record('i1', '2020-01-01')]);
  const options = {...api([row], {901:row}), baseData, since, eventActivityIds:['901']};
  const first = await sync(options);
  assert.deepEqual(await sync({...options, baseData:first}), first);
});

test('invalid cursors and event identifiers cannot silently trigger an incomplete query', async () => {
  for (const bad of ['invalid', '2026-10-28T00:00:00Z', '2026-10-25T16:00:00']) await assert.rejects(sync({since:bad}), /增量起点/);
  await assert.rejects(sync({eventActivityIds:['../settings']}), /事件活动 ID/);
});

test('environment configuration is supported without reading the local credential file', async () => {
  const previous = process.env.INTERVALS_ICU_API_KEY;
  process.env.INTERVALS_ICU_API_KEY = 'test-env-key';
  try { assert.deepEqual(await readConfig(), {INTERVALS_ICU_API_KEY:'test-env-key'}); }
  finally {
    if (previous === undefined) delete process.env.INTERVALS_ICU_API_KEY;
    else process.env.INTERVALS_ICU_API_KEY = previous;
  }
});
