import {readFile, writeFile, rename, unlink, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {dirname} from 'node:path';
import {beijingDate, shiftDate, validateData} from '../docs/journal.mjs';
import {fetchIntervalsData, readConfig} from './update-data.mjs';
import {mergeActivities, activityAssociations} from './activity-sync.mjs';
import {createStravaClient, normalizeStravaActivity, stravaId} from './strava-data.mjs';
import {workerRequest} from './site-sync.mjs';

export async function fetchAllActivities({config, fetchImpl = fetch, now = new Date(), baseData, since,
  eventActivityIds = [], full = false, strengthSets = [], corosRecords = [], stravaClient, onReport = () => {}} = {}) {
  if (!Number.isFinite(now.getTime())) throw new Error('同步时间无效');
  if (since != null && (typeof since !== 'string' || !/Z$/.test(since) || !Number.isFinite(Date.parse(since)) || Date.parse(since) > now.getTime())) throw new Error('增量起点无效');
  if (!Array.isArray(eventActivityIds)) throw new Error('事件活动 ID 无效');
  let ids;
  try { ids = [...new Set(eventActivityIds.map(stravaId))]; } catch { throw new Error('事件活动 ID 无效'); }
  const end = beijingDate(now);
  const previous = baseData ?? {period:{start:'1900-01-01', end}, syncedAt:end + ' 00:00:00 +08:00', activities:[], unavailableActivities:[], gearLibrary:[]};
  validateData(previous);
  config ??= await readConfig();
  const client = stravaClient ?? createStravaClient({accessToken:config.STRAVA_ACCESS_TOKEN, fetchImpl});
  await client.verifyAthlete(config.STRAVA_ATHLETE_ID ?? '78720097');
  const isFull = full || previous.sourcePolicyVersion !== 2 || !since || !baseData;
  let start = isFull ? '1900-01-01' : shiftDate(beijingDate(new Date(since)), -2);
  const before = Math.floor(now.getTime() / 1000);
  const details = new Map();
  for (const id of ids) {
    const record = await client.activity(id);
    if (!record) throw new Error('Strava 尚无法读取事件活动，稍后重试，未更新数据');
    if (stravaId(record.id) !== id) throw new Error('Strava 事件活动关联冲突');
    const normalized = normalizeStravaActivity(record);
    if (normalized.date > end || Date.parse(record.start_date) >= before * 1000) throw new Error('事件活动尚未进入可发布日期范围');
    if (normalized.date < start) start = normalized.date;
    details.set(id, record);
  }
  const after = start === '1900-01-01' ? null : Math.floor(Date.parse(start + 'T00:00:00+08:00') / 1000) - 1;
  const stravaRecords = await client.activities({after, before});
  const records = new Map();
  for (const row of stravaRecords) {
    const id = stravaId(row.id);
    if (records.has(id)) throw new Error('Strava 活动标识重复');
    records.set(id, row);
  }
  for (const [id, record] of details) records.set(id, record);
  const intervals = await fetchIntervalsData({config, fetchImpl, now, oldest:start === '1900-01-01' ? start : shiftDate(start, -2)});
  const {byStrava, sets} = activityAssociations(previous, intervals.records, strengthSets);
  const oldByStrava = new Map(previous.activities.map(row => [row.stravaUrl, row]));
  for (const [id, record] of records) {
    if (record.sport_type !== 'WeightTraining') continue;
    const url = 'https://www.strava.com/activities/' + id;
    const knownSets = sets.get(byStrava.get(url)) ?? oldByStrava.get(url)?.sets;
    if (knownSets != null || details.has(id)) continue;
    const detail = await client.activity(id);
    if (detail) {
      if (stravaId(detail.id) !== id) throw new Error('Strava 活动详情关联冲突');
      records.set(id, detail);
    }
  }
  const merged = mergeActivities({previous, stravaRecords:[...records.values()], intervalsRecords:intervals.records,
    corosRecords, strengthSets, window:{oldest:start, end, before}, now});
  merged.data.gearLibrary = intervals.gearLibrary;
  validateData(merged.data);
  await onReport(merged.report);
  return merged.data;
}

export async function stravaAccessToken(env = process.env) {
  // 正式网站更新仅向当前租约申请令牌，不读取本机凭据或旧的 GitHub 令牌。
  if (env.GITHUB_ACTIONS === 'true') {
    const token = await workerRequest('/sync/strava-token', {
      runId:env.GITHUB_RUN_ID + ':' + env.GITHUB_RUN_ATTEMPT,
      clientId:env.STRAVA_CLIENT_ID,
      clientSecret:env.STRAVA_CLIENT_SECRET,
      refreshToken:env.STRAVA_REFRESH_TOKEN,
    }, {env});
    if (typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('Strava 令牌响应无效');
    return token.accessToken;
  }
  if (!env.STRAVA_ACCESS_TOKEN) throw new Error('本地同步请通过环境变量提供有效的 STRAVA_ACCESS_TOKEN');
  return env.STRAVA_ACCESS_TOKEN;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options:{full:{type:'boolean'}, since:{type:'string'}, baseline:{type:'string'}, events:{type:'string'}, report:{type:'string'}}});
    const baseData = JSON.parse(await readFile(values.baseline ?? new URL('../docs/activities.json', import.meta.url), 'utf8'));
    const strengthSets = JSON.parse(await readFile(new URL('../data/strength-sets.json', import.meta.url), 'utf8'));
    const eventActivityIds = values.events ? JSON.parse(await readFile(values.events, 'utf8')) : [];
    const config = {...await readConfig(), STRAVA_ACCESS_TOKEN:await stravaAccessToken()};
    const data = await fetchAllActivities({config, baseData, strengthSets, eventActivityIds, since:values.since, full:values.full,
      onReport:async report => {
        const path = values.report ?? 'output/sync/history-correction.json';
        await mkdir(dirname(path), {recursive:true});
        await writeFile(path, JSON.stringify(report, null, 2) + '\n');
      }});
    const target = new URL('../docs/activities.json', import.meta.url);
    const temporary = new URL('../docs/activities.json.tmp', import.meta.url);
    try { await writeFile(temporary, JSON.stringify(data, null, 2) + '\n'); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;}); }
    console.log(JSON.stringify({records:data.activities.length, syncedAt:data.syncedAt, sourcePolicyVersion:data.sourcePolicyVersion}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
