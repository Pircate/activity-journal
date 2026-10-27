import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {beijingDate, shiftDate, validateData, isDate} from '../docs/journal.mjs';
import {fetchIntervalsData, readConfig} from './update-data.mjs';
import {mergeActivities} from './sync.mjs';

// The cloud runner reuses the current merger: preserve history and known
// metrics, including restricted Strava history and saved COROS strength sets.
export async function fetchAllActivities({config, fetchImpl = fetch, now = new Date(), baseData, since, eventActivityIds = [], full = false, strengthSets = []} = {}) {
  if (!Number.isFinite(now.getTime())) throw new Error('同步时间无效');
  if (since != null && (typeof since !== 'string' || !/Z$/.test(since) || !Number.isFinite(Date.parse(since)) || Date.parse(since) > now.getTime())) throw new Error('增量起点无效');
  if (!Array.isArray(eventActivityIds) || eventActivityIds.some(id => !/^[1-9]\d*$/.test(String(id)))) throw new Error('事件活动 ID 无效');
  const end = beijingDate(now);
  const previous = baseData ?? {period:{start:'1900-01-01', end}, syncedAt:end + ' 00:00:00 +08:00', activities:[], unavailableActivities:[], gearLibrary:[]};
  validateData(previous);
  config ??= await readConfig();
  if (typeof config.INTERVALS_ICU_API_KEY !== 'string' || !config.INTERVALS_ICU_API_KEY.trim()) throw new Error('请配置 INTERVALS_ICU_API_KEY');
  let start = !full && since && baseData ? shiftDate(beijingDate(new Date(since)), -2) : '1900-01-01';
  const ids = [...new Set(eventActivityIds.map(String))];
  const urlFor = id => 'https://www.strava.com/activities/' + id;
  const links = new Map(previous.activities.filter(a => a.stravaUrl && a.activityUrl).map(a => [a.stravaUrl, a.activityUrl.split('/').at(-1)]));
  const dateFor = record => {
    if (!record?.start_date) return record?.start_date_local?.slice(0,10);
    const timestamp = /(?:Z|[+-]\d\d:?\d\d)$/.test(record.start_date) ? record.start_date : record.start_date + 'Z';
    const instant = new Date(timestamp);
    return Number.isFinite(instant.getTime()) ? beijingDate(instant) : null;
  };
  for (const id of ids) {
    if (start === '1900-01-01') break;
    const expected = links.get(urlFor(id)) ?? id;
    const response = await fetchImpl('https://intervals.icu/api/v1/activity/' + encodeURIComponent(expected), {
      headers:{Authorization:'Basic ' + Buffer.from('API_KEY:' + config.INTERVALS_ICU_API_KEY).toString('base64'), Accept:'application/json'},
      redirect:'error', signal:AbortSignal.timeout(60_000),
    });
    if (!response.ok && response.status !== 404) throw new Error('Intervals.icu 请求失败（HTTP ' + response.status + '）');
    const detail = response.ok ? await response.json() : null;
    const matches = detail && (String(detail.id) === expected || String(detail.strava_id) === id);
    const date = matches && isDate(dateFor(detail)) ? dateFor(detail) : previous.activities.find(a => a.stravaUrl === urlFor(id))?.date;
    if (!date) start = '1900-01-01';
    else if (date < start) start = date;
  }
  const intervals = await fetchIntervalsData({config, fetchImpl, now, oldest:start === '1900-01-01' ? start : shiftDate(start, -2)});
  for (const id of ids) {
    const record = intervals.records.find(a => String(a.strava_id) === id || String(a.id) === id || String(a.id) === links.get(urlFor(id)));
    if (!record) throw new Error('Intervals.icu 尚未收录事件活动，稍后重试，未更新数据');
    const date = dateFor(record);
    if (!isDate(date) || date < start || date > end) throw new Error('事件活动尚未进入可发布日期范围，未更新数据');
    if (record.start_date) {
      const timestamp = /(?:Z|[+-]\d\d:?\d\d)$/.test(record.start_date) ? record.start_date : record.start_date + 'Z';
      if (Date.parse(timestamp) >= Math.floor(now.getTime()/1000)*1000) throw new Error('事件活动尚未进入可发布日期范围，未更新数据');
    }
  }
  const merged = mergeActivities({previous, intervalsRecords:intervals.records, corosRecords:[], strengthSets,
    window:{oldest:start, end, before:Math.floor(now.getTime()/1000)}, now});
  merged.data.gearLibrary = intervals.gearLibrary;
  validateData(merged.data);
  return merged.data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{full:{type:'boolean'}, since:{type:'string'}, baseline:{type:'string'}, events:{type:'string'}}});
  const baseData = JSON.parse(await readFile(values.baseline ?? new URL('../docs/activities.json', import.meta.url), 'utf8'));
  const strengthSets = JSON.parse(await readFile(new URL('../data/strength-sets.json', import.meta.url), 'utf8'));
  const eventActivityIds = values.events ? JSON.parse(await readFile(values.events, 'utf8')) : [];
  const data = await fetchAllActivities({baseData, strengthSets, eventActivityIds, since:values.since, full:values.full});
  const target = new URL('../docs/activities.json', import.meta.url);
  const temporary = new URL('../docs/activities.json.tmp', import.meta.url);
  try { await writeFile(temporary, JSON.stringify(data, null, 2) + '\n'); await rename(temporary, target); }
  finally { await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;}); }
  console.log(JSON.stringify({records:data.activities.length, syncedAt:data.syncedAt}));
}
