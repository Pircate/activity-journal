import {isRide} from '../docs/activity-data.mjs';
import {beijingDate, isDate} from '../docs/journal.mjs';
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readConfig} from './update-data.mjs';
import {validatePersonalBests, compareRecordHistory, improvesRecord, personalBestEvents} from '../docs/personal-bests.mjs';

const runEvents = [
  {event:'run5k', distance:5000}, {event:'run10k', distance:10000},
  {event:'halfMarathon', distance:21097.5}, {event:'marathon', distance:42195},
];
const powerEvents = [{event:'cp5', seconds:300}, {event:'cp10', seconds:600}, {event:'cp20', seconds:1200}];
const powerSeconds = new Map(powerEvents.map(({event, seconds}) => [event, seconds]));
const powerCache = new URL('../data/power-best-values.json', import.meta.url);
const activityUrl = id => typeof id === 'string' && /^(?:i)?\d+$/.test(id) ? 'https://intervals.icu/activities/' + id : null;
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);

// 批量曲线只返回所需距离／时长，短活动可能省略末尾值；缺失值不推算。
export function activityCurveRecords(payload, sport, activities) {
  const running = sport === 'Run';
  const axis = payload?.[running ? 'distances' : 'secs'];
  const definitions = running ? runEvents : powerEvents;
  if (!Array.isArray(axis) || axis.length !== definitions.length ||
      definitions.some((item, index) => axis[index] !== item[running ? 'distance' : 'seconds']) || !Array.isArray(payload?.curves)) {
    throw new Error('活动成绩曲线无效，未更新数据');
  }
  const byUrl = new Map();
  for (const activity of activities) {
    if (!activity.activityUrl) continue;
    if (byUrl.has(activity.activityUrl)) throw new Error('活动标识重复，未更新数据');
    byUrl.set(activity.activityUrl, activity);
  }
  const ids = new Set();
  return payload.curves.flatMap(curve => {
    const url = activityUrl(curve?.id);
    const values = curve?.[running ? 'secs' : 'watts'];
    if (!url || ids.has(curve.id) || !Array.isArray(values) || values.length > axis.length ||
        values.some(value => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error('活动成绩无效，未更新数据');
    ids.add(curve.id);
    const linked = byUrl.get(url);
    const local = curve.start_date_local;
    if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(local) ||
        !isDate(local.slice(0, 10)) || !validTime(local.slice(11, 19))) throw new Error('活动成绩时间无效，未更新数据');
    const date = linked?.date ?? local.slice(0, 10);
    // 只在同一天补用上游时间，避免将已修正日期与另一日的时间拼接。
    const startTime = linked ? linked.startTime ?? (date === local.slice(0, 10) ? local.slice(11, 19) : null) : local.slice(11, 19);
    return definitions.flatMap(({event}, index) => {
      const value = values[index];
      return value == null || value === 0 ? [] : [{sport, event, value, date, startTime, activityUrl:url,
        ...(linked?.stravaUrl ? {stravaUrl:linked.stravaUrl} : {})}];
    });
  });
}

// 曲线接口只给整数瓦（实测为向下取整），候选纪录改用原始功率流计算后四舍五入。
// 功率流只覆盖移动时间，采样之间的间隔按上一次功率延续。
export function powerStreamAverage(time, watts, seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0 || !Array.isArray(time) || !Array.isArray(watts) ||
      !time.length || time.length !== watts.length) return null;
  for (let index = 0; index < time.length; index++) {
    if (!Number.isInteger(time[index]) || time[index] < 0 || (index > 0 && time[index] <= time[index - 1]) ||
        !Number.isFinite(watts[index]) || watts[index] < 0) return null;
  }
  const values = [];
  for (let index = 0; index < watts.length; index++) {
    const step = index + 1 < time.length ? time[index + 1] - time[index] : 1;
    if (step > 86_400) return null;
    for (let second = 0; second < step; second++) values.push(watts[index]);
  }
  if (values.length < seconds) return null;
  let sum = 0, best = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
    if (index >= seconds) sum -= values[index - seconds];
    if (index >= seconds - 1) best = Math.max(best, sum / seconds);
  }
  return best;
}

export function validatePowerValues(payload) {
  const fail = () => { throw new Error('功率成绩缓存格式无效'); };
  if (!payload || payload.version !== 1 || !payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) fail();
  for (const [url, bests] of Object.entries(payload.values)) {
    if (!/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(url) || !bests || typeof bests !== 'object' || Array.isArray(bests)) fail();
    for (const [event, value] of Object.entries(bests)) if (!powerSeconds.has(event) || !Number.isInteger(value) || value <= 0) fail();
  }
  return payload.values;
}

export function serializePowerValues(values) {
  const sorted = {};
  for (const url of Object.keys(values).sort()) {
    const bests = {};
    for (const {event} of powerEvents) if (Number.isInteger(values[url]?.[event])) bests[event] = values[url][event];
    if (Object.keys(bests).length) sorted[url] = bests;
  }
  return JSON.stringify({version:1, values:sorted}, null, 2) + '\n';
}

export async function readPowerValues() {
  try {
    return validatePowerValues(JSON.parse(await readFile(powerCache, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writePowerValues(values) {
  const temporary = new URL('../data/power-best-values.json.tmp', import.meta.url);
  try {
    await writeFile(temporary, serializePowerValues(values));
    await rename(temporary, powerCache);
  } finally {
    await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
}

export async function buildPersonalBests({activities = [], paceCurves, powerCurves, resolvePower, now = new Date()} = {}) {
  if (!Array.isArray(activities)) throw new Error('活动列表无效，未更新数据');
  const candidates = [
    ...activityCurveRecords(paceCurves, 'Run', activities),
    ...activityCurveRecords(powerCurves, 'Ride', activities),
    ...activities.filter(activity => isRide(activity.sport) && Number.isFinite(activity.distanceKm) && activity.distanceKm > 0)
      .map(activity => ({sport:'Ride', event:'longestRide', value:activity.distanceKm, date:activity.date,
        startTime:activity.startTime ?? null, activityUrl:activity.activityUrl ?? null,
        ...(activity.stravaUrl ? {stravaUrl:activity.stravaUrl} : {})})),
  ];
  const latest = new Map();
  const history = [];
  for (const record of candidates.sort(compareRecordHistory)) {
    const previous = latest.get(record.event);
    if (resolvePower && record.sport === 'Ride' && powerSeconds.has(record.event) && (!previous || record.value >= previous.value)) {
      const value = await resolvePower(record);
      if (value != null) record.value = value;
    }
    if (!previous || improvesRecord(record.event, record.value, previous.value)) {
      latest.set(record.event, record);
      history.push(record);
    }
  }
  const records = Object.values(personalBestEvents).flat().flatMap(event => {
    const record = latest.get(event);
    if (!record) return [];
    const {startTime, ...current} = record;
    return [current];
  });
  if (!records.length) throw new Error('未取得任何个人最佳成绩，未更新数据');
  const data = {source:'Intervals.icu', syncedAt:now.toISOString(), records, history};
  validatePersonalBests(data);
  return data;
}

export async function fetchPersonalBests({config, fetchImpl = fetch, now = new Date(), activities = [], powerValues, refresh = false} = {}) {
  config ??= await readConfig();
  if (typeof config?.INTERVALS_ICU_API_KEY !== 'string' || !config.INTERVALS_ICU_API_KEY.trim()) {
    throw new Error('请配置 ~/.config/interval-icu/config.json 中的 INTERVALS_ICU_API_KEY');
  }
  const authorization = 'Basic ' + Buffer.from('API_KEY:' + config.INTERVALS_ICU_API_KEY).toString('base64');
  const get = async path => {
    const response = await fetchImpl('https://intervals.icu/api/v1/' + path, {
      headers:{Authorization:authorization, Accept:'application/json'},
      signal:AbortSignal.timeout(60_000), redirect:'error',
    });
    if (!response.ok) throw new Error(`Intervals.icu 请求失败（HTTP ${response.status}），未更新数据`);
    return response.json();
  };
  // 批量曲线端点要求真实 athlete ID，不能使用 0；本地时间必须明确属于北京时间。
  const athlete = await get('athlete/0');
  if (!/^i?[1-9]\d*$/.test(String(athlete?.id)) || athlete.timezone !== 'Asia/Shanghai') {
    throw new Error('Intervals.icu 用户标识或北京时间设置无效，未更新数据');
  }
  const range = '&oldest=1900-01-01&newest=' + beijingDate(now);
  const [paceCurves, powerCurves] = await Promise.all([
    get(`athlete/${athlete.id}/activity-pace-curves?type=Run&distances=5000,10000,21097.5,42195` + range),
    get(`athlete/${athlete.id}/activity-power-curves?type=Ride&secs=300,600,1200` + range),
  ]);
  powerValues ??= await readPowerValues();
  const streams = new Map();
  const loadStreams = url => {
    if (!streams.has(url)) streams.set(url, (async () => {
      const id = url.match(/^https:\/\/intervals\.icu\/activities\/(.+)$/)?.[1];
      if (!id) return null;
      const payload = await get(`activity/${id}/streams?types=time,watts`);
      const list = Array.isArray(payload) ? payload : Object.entries(payload ?? {}).map(([type, data]) => ({type, data}));
      const byType = new Map(list.filter(stream => stream && typeof stream.type === 'string').map(stream => [stream.type, stream.data]));
      return {time:byType.get('time'), watts:byType.get('watts')};
    })().catch(() => null));
    return streams.get(url);
  };
  const resolvePower = async record => {
    const cached = powerValues[record.activityUrl]?.[record.event];
    if (!refresh && Number.isInteger(cached)) return cached;
    const payload = await loadStreams(record.activityUrl);
    if (!payload) return null;
    const average = powerStreamAverage(payload.time, payload.watts, powerSeconds.get(record.event));
    // 原始流与曲线整数不一致时保留曲线值，避免算法差异造成错误纪录。
    if (average === null || Math.floor(average) !== record.value) return null;
    const value = Math.round(average);
    powerValues[record.activityUrl] = {...powerValues[record.activityUrl], [record.event]:value};
    return value;
  };
  return buildPersonalBests({activities, paceCurves, powerCurves, resolvePower, now});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('用法：node scripts/update-personal-bests.mjs（获取全部历史个人最佳成绩与纪录历程）');
  const {activities} = JSON.parse(await readFile(new URL('../docs/activities.json', import.meta.url), 'utf8'));
  const powerValues = await readPowerValues();
  const data = await fetchPersonalBests({activities, powerValues, refresh:process.env.SYNC_FULL === 'true'});
  const target = new URL('../docs/personal-bests.json', import.meta.url);
  const temporary = new URL('../docs/personal-bests.json.tmp', import.meta.url);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
  await writePowerValues(powerValues);
  console.log(JSON.stringify({source:data.source, records:data.records.length, history:data.history.length}));
}
