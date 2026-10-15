import {writeFile, rename, unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {beijingDate, validateData, shiftDate, formatTime} from '../docs/journal.mjs';

const sports = {
  Ride:'骑行', VirtualRide:'虚拟骑行', EBikeRide:'电助力骑行', EMountainBikeRide:'电助力山地骑行',
  MountainBikeRide:'山地骑行', GravelRide:'砾石骑行', Handcycle:'手摇自行车', Velomobile:'卧式骑行',
  Run:'跑步', VirtualRun:'虚拟跑步', TrailRun:'越野跑', Walk:'步行', Hike:'徒步', Swim:'游泳',
  WeightTraining:'力量训练', Workout:'体能训练', Yoga:'瑜伽', Pilates:'普拉提', Rowing:'划船',
  VirtualRow:'虚拟划船', Elliptical:'椭圆机', StairStepper:'踏步机', RockClimbing:'攀岩',
  NordicSki:'越野滑雪', AlpineSki:'高山滑雪', BackcountrySki:'野外滑雪', Snowboard:'单板滑雪',
  Kayaking:'皮划艇', Canoeing:'划独木舟', StandUpPaddling:'桨板', Surfing:'冲浪',
  Soccer:'足球', Tennis:'网球', Badminton:'羽毛球', Basketball:'篮球', Golf:'高尔夫',
};

export function normalizeActivities(records, period) {
  if (!Array.isArray(records)) throw new Error('Intervals.icu 返回的活动列表无效');
  const ids = new Set();
  return records.map(record => {
    // Strava 空壳与缺失时长不能视为零运动；整次同步失败，保留已发布的数据。
    if (!record || !record.id || ids.has(record.id) || !record.type || !record.start_date ||
        !Number.isInteger(record.moving_time) || record.moving_time < 0) {
      throw new Error('活动不完整或 ID 重复（可能是 API 不提供的 Strava 记录），未更新数据');
    }
    ids.add(record.id);
    const timestamp = /(?:Z|[+-]\d\d:?\d\d)$/.test(record.start_date) ? record.start_date : record.start_date + 'Z';
    const instant = new Date(timestamp);
    if (!Number.isFinite(instant.getTime())) throw new Error('活动开始时间无效');
    const number = (value, field) => {
      if (value == null) return null;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('活动的' + field + '无效');
      return value;
    };
    const distance = number(record.distance, '距离');
    return {
      date:beijingDate(instant),
      sport:sports[record.type] ?? `其他运动（${record.type}）`,
      distanceKm:distance === null ? null : Math.round(distance / 10) / 100,
      duration:formatTime(record.moving_time),
      trainingLoad:number(record.icu_training_load, '训练负荷'),
    };
  }).filter(a => a.date >= period.start && a.date <= period.end)
    .sort((a,b) => b.date.localeCompare(a.date));
}

export async function fetchYear({env = process.env, fetchImpl = fetch, now = new Date()} = {}) {
  const authorization = env.INTERVALS_ICU_TOKEN ? `Bearer ${env.INTERVALS_ICU_TOKEN}`
    : env.INTERVALS_ICU_API_KEY ? 'Basic ' + Buffer.from('API_KEY:' + env.INTERVALS_ICU_API_KEY).toString('base64') : null;
  if (!authorization) throw new Error('请配置 INTERVALS_ICU_API_KEY 或 INTERVALS_ICU_TOKEN 后重新运行');
  const get = async path => {
    const response = await fetchImpl('https://intervals.icu/api/v1/' + path, {
      headers:{Authorization:authorization, Accept:'application/json'},
      signal:AbortSignal.timeout(60_000), redirect:'error',
    });
    if (!response.ok) throw new Error(`Intervals.icu 请求失败（HTTP ${response.status}），未更新数据`);
    return response.json();
  };
  const athlete = await get('athlete/0');
  if (!athlete || typeof athlete.id !== 'string' && typeof athlete.id !== 'number') throw new Error('Intervals.icu 账号信息无效');
  const end = beijingDate(now);
  const period = {start:shiftDate(end, -364), end};
  // API 按活动当地日期查询；两端多取一天，再按 UTC 开始时间转换为北京时间裁剪。
  const params = new URLSearchParams({oldest:shiftDate(period.start, -1), newest:shiftDate(end, 1) + 'T23:59:59',
    limit:'10000', fields:'id,type,start_date,moving_time,distance,icu_training_load,source,start_date_local'});
  const records = await get(`athlete/${encodeURIComponent(athlete.id)}/activities?${params}`);
  if (!Array.isArray(records) || records.length >= 10000) throw new Error('活动列表无效或达到查询上限，无法确认完整性，未更新数据');
  if (records.some(a => !a?.id) || new Set(records.map(a => a.id)).size !== records.length) throw new Error('活动 ID 缺失或重复，未更新数据');
  const syncedAt = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).format(new Date()) + ' +08:00';
  const unavailable = records.filter(a => a.source === 'STRAVA' && !a.type && !a.start_date && a._note === 'STRAVA activities are not available via the API');
  const unavailableActivities = unavailable.map(a => ({date:a.start_date_local?.slice(0,10)}))
    .filter(a => a.date >= period.start && a.date <= period.end);
  // 空壳只保留平台提供的当地日期，公开注明详情缺失，不混入可读取活动的总量。
  for (const a of unavailable) {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(a.start_date_local ?? '')) throw new Error('无法读取的活动缺少有效日期');
  }
  const data = {period, syncedAt, activities:normalizeActivities(records.filter(a => !unavailable.includes(a)), period), unavailableActivities};
  validateData(data);
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('用法：node scripts/update-data.mjs（直接获取 Intervals.icu 最近一年数据）');
  const data = await fetchYear();
  const target = new URL('../docs/activities.json', import.meta.url);
  const temporary = new URL('../docs/activities.json.tmp', import.meta.url);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
  console.log(JSON.stringify({period:data.period, records:data.activities.length, unavailable:data.unavailableActivities.length, source:'Intervals.icu'}));
}
