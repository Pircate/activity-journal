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
const powerEvents = [{event:'cp5', seconds:300}, {event:'cp20', seconds:1200}];
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

export function buildPersonalBests({activities = [], paceCurves, powerCurves, now = new Date()} = {}) {
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

export async function fetchPersonalBests({config, fetchImpl = fetch, now = new Date(), activities = []} = {}) {
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
    get(`athlete/${athlete.id}/activity-power-curves?type=Ride&secs=300,1200` + range),
  ]);
  return buildPersonalBests({activities, paceCurves, powerCurves, now});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('用法：node scripts/update-personal-bests.mjs（获取全部历史个人最佳成绩与纪录历程）');
  const {activities} = JSON.parse(await readFile(new URL('../docs/activities.json', import.meta.url), 'utf8'));
  const data = await fetchPersonalBests({activities});
  const target = new URL('../docs/personal-bests.json', import.meta.url);
  const temporary = new URL('../docs/personal-bests.json.tmp', import.meta.url);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
  console.log(JSON.stringify({source:data.source, records:data.records.length, history:data.history.length}));
}
