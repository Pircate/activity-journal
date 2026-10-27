import {isRide} from '../docs/activity-data.mjs';
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readConfig} from './update-data.mjs';
import {validatePersonalBests} from '../docs/personal-bests.mjs';

// 跑步按距离取最佳成绩，骑行按最远距离与 5／20 分钟最佳平均功率。
const runEvents = [
  {event:'run5k', metres:5000},
  {event:'run10k', metres:10000},
  {event:'halfMarathon', metres:21097.5},
  {event:'marathon', metres:42195},
];
const powerEvents = [
  {event:'cp5', seconds:300},
  {event:'cp20', seconds:1200},
];

const activityUrl = id => typeof id === 'string' && /^(?:i)?\d+$/.test(id) ? 'https://intervals.icu/activities/' + id : null;

// 曲线按运动大类聚合：type=Run 已含越野跑与虚拟跑步，type=Ride 已含虚拟骑行。
export function paceRecords(paceCurves) {
  const curve = paceCurves?.list?.[0];
  const {distance, values, activity_id: ids} = curve ?? {};
  if (!Array.isArray(distance) || !distance.length || !Array.isArray(values) || values.length !== distance.length ||
      !Array.isArray(ids) || ids.length !== distance.length) throw new Error('跑步配速曲线无效，未更新数据');
  const records = [];
  for (const {event, metres} of runEvents) {
    // 曲线起点约 45 米，目标距离超出曲线最大值时该项不可得，跳过而不是报错。
    const index = distance.findIndex(value => value >= metres);
    if (index < 0) continue;
    if (!Number.isFinite(values[index]) || values[index] <= 0) throw new Error('跑步配速曲线成绩无效，未更新数据');
    records.push({sport:'Run', event, value:values[index], date:null, activityUrl:activityUrl(ids[index])});
  }
  return records;
}

export function powerRecords(powerCurves) {
  const curve = powerCurves?.list?.[0];
  const {secs, watts, activity_id: ids} = curve ?? {};
  if (!Array.isArray(secs) || !secs.length || !Array.isArray(watts) || watts.length !== secs.length ||
      !Array.isArray(ids) || ids.length !== secs.length) throw new Error('骑行功率曲线无效，未更新数据');
  const records = [];
  for (const {event, seconds} of powerEvents) {
    // watts 是各时长上的原始最佳努力值，存在小幅回弹，只能用秒数精确定位。
    const index = secs.indexOf(seconds);
    if (index < 0) continue;
    if (!Number.isFinite(watts[index]) || watts[index] <= 0) throw new Error('骑行功率曲线成绩无效，未更新数据');
    records.push({sport:'Ride', event, value:watts[index], date:null, activityUrl:activityUrl(ids[index])});
  }
  return records;
}

export function longestRide(activities) {
  if (!Array.isArray(activities)) throw new Error('活动列表无效，未更新数据');
  let best = null;
  for (const activity of activities) {
    if (!activity || typeof activity.sport !== 'string' || !isRide(activity.sport)) continue;
    if (typeof activity.distanceKm !== 'number' || !Number.isFinite(activity.distanceKm)) continue;
    if (!best || activity.distanceKm > best.distanceKm) best = activity;
  }
  if (!best) return null;
  return {sport:'Ride', event:'longestRide', value:best.distanceKm, date:best.date ?? null, activityUrl:best.activityUrl ?? null,
    ...(best.stravaUrl ? {stravaUrl:best.stravaUrl} : {})};
}

export function buildPersonalBests({activities = [], paceCurves, powerCurves, now = new Date()} = {}) {
  const activityByUrl = new Map(activities.filter(activity => activity?.activityUrl).map(activity => [activity.activityUrl, activity]));
  // 按 Intervals.icu 活动链接精确关联；查不到时不猜测日期或 Strava 链接。
  const withActivity = records => records.map(record => {
    const activity = activityByUrl.get(record.activityUrl);
    return {...record, date:activity?.date ?? record.date, ...(activity?.stravaUrl ? {stravaUrl:activity.stravaUrl} : {})};
  });
  const ride = longestRide(activities);
  const records = withActivity([...paceRecords(paceCurves), ...(ride ? [ride] : []), ...powerRecords(powerCurves)]);
  if (!records.some(record => record.sport === 'Run') && !records.some(record => record.sport === 'Ride')) throw new Error('未取得任何个人最佳成绩，未更新数据');
  return {source:'Intervals.icu', syncedAt:now.toISOString(), records};
}

export async function fetchPersonalBests({config, fetchImpl = fetch, now = new Date(), activities} = {}) {
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
  // 任一曲线请求或解析失败都让整次同步失败，保留上一版成绩。
  const [paceCurves, powerCurves] = await Promise.all([
    get('athlete/0/pace-curves.json?type=Run&curves=all'),
    get('athlete/0/power-curves.json?type=Ride&curves=all'),
  ]);
  return buildPersonalBests({activities, paceCurves, powerCurves, now});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('用法：node scripts/update-personal-bests.mjs（获取 Intervals.icu 全部历史个人最佳成绩）');
  // 最远骑行和成绩日期都取自活动快照，必须在 update-data.mjs 之后运行。
  const {activities} = JSON.parse(await readFile(new URL('../docs/activities.json', import.meta.url), 'utf8'));
  const data = await fetchPersonalBests({activities});
  validatePersonalBests(data);
  const target = new URL('../docs/personal-bests.json', import.meta.url);
  const temporary = new URL('../docs/personal-bests.json.tmp', import.meta.url);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
  console.log(JSON.stringify({source:data.source, records:data.records.length, events:data.records.map(record => record.sport + ' ' + record.event)}));
}
