import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {beijingDate, validateData, shiftDate, formatTime, replacementTargets, isDate} from '../docs/journal.mjs';

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
    if (!record || !/^(?:i)?\d+$/.test(String(record.id)) || ids.has(String(record.id)) || !record.type || !record.start_date ||
        !Number.isInteger(record.moving_time) || record.moving_time < 0) {
      throw new Error('活动不完整或 ID 重复（可能是 API 不提供的 Strava 记录），未更新数据');
    }
    ids.add(String(record.id));
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
      activityUrl:'https://intervals.icu/activities/' + record.id,
    };
  }).filter(a => a.date >= period.start && a.date <= period.end)
    .sort((a,b) => b.date.localeCompare(a.date));
}

export function normalizeGear(records) {
  if (!Array.isArray(records)) throw new Error('Intervals.icu 返回的装备列表无效');
  const byId = new Map();
  const distanceKm = value => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('装备里程无效');
    return value / 1000;
  };
  for (const gear of records) {
    if (!gear || typeof gear.id !== 'string' || !gear.id || byId.has(gear.id) ||
        typeof gear.name !== 'string' || !gear.name.trim() || typeof gear.type !== 'string' || !gear.type ||
        gear.component != null && typeof gear.component !== 'boolean' ||
        gear.component_ids != null && (!Array.isArray(gear.component_ids) || gear.component_ids.some(id => typeof id !== 'string' || !id)) ||
        gear.retired != null && typeof gear.retired !== 'string' || gear.reminders != null && !Array.isArray(gear.reminders)) throw new Error('装备信息无效或 ID 重复');
    byId.set(gear.id, gear);
  }
  const replacementFor = gear => {
    if (!Object.hasOwn(replacementTargets, gear.type)) return null;
    const reminders = (gear.reminders ?? []).filter(reminder => reminder?.name === '更换');
    if (reminders.length !== 1) return {status:reminders.length ? 'duplicate-reminder' : 'missing-reminder', date:null, distanceKm:null};
    const reminder = reminders[0];
    let date = null;
    if (reminder.last_reset != null) {
      // 提醒的时间必须带时区，避免运行机器的时区影响最近更换日期。
      if (typeof reminder.last_reset !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(reminder.last_reset) ||
          !Number.isFinite(Date.parse(reminder.last_reset)) || !isDate(reminder.last_reset.slice(0,10))) throw new Error('更换提醒重置时间无效');
      date = beijingDate(new Date(reminder.last_reset));
    }
    // 平台不允许回填 last_reset。历史补录绑定初始提醒和计数基准，后续重置后自动失效。
    const prefix = '运动装备库更换记录：';
    const historical = (gear.notes ?? '').split('\n').filter(line => line.startsWith(prefix));
    if (historical.length > 1) throw new Error('配件历史更换记录重复');
    if (historical.length) {
      let entry;
      try { entry = JSON.parse(historical[0].slice(prefix.length)); }
      catch { throw new Error('配件历史更换记录无效'); }
      if (!entry || entry.date !== null && !isDate(entry.date) || !Number.isInteger(entry.reminderId) || typeof entry.resetAt !== 'string' ||
          !Number.isFinite(Date.parse(entry.resetAt)) || !Array.isArray(entry.baseline) || entry.baseline.length !== 3 ||
          entry.baseline.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw new Error('配件历史更换记录无效');
      const baseline = [reminder.starting_distance ?? 0, reminder.starting_time ?? 0, reminder.starting_activities ?? 0];
      if (entry.reminderId === reminder.id && Date.parse(entry.resetAt) === Date.parse(reminder.last_reset) &&
          entry.baseline.every((n,i) => n === baseline[i])) date = entry.date;
    }
    return {status:'available', date, distanceKm:distanceKm(reminder.distance_used)};
  };
  return records.filter(gear => gear.type === 'Bike' && !gear.component && !gear.retired).map(bike => {
    const components = [];
    const visited = new Set();
    const visit = (id, ancestors) => {
      if (ancestors.has(id)) throw new Error('装备配件关联存在循环');
      if (visited.has(id)) return;
      const part = byId.get(id);
      if (!part) throw new Error('装备关联的配件缺失');
      if (part.retired) return;
      visited.add(id);
      if (id !== bike.id) components.push({name:part.name, type:part.type, distanceKm:distanceKm(part.distance), replacement:replacementFor(part)});
      const path = new Set([...ancestors,id]);
      for (const childId of part.component_ids ?? []) visit(childId,path);
    };
    visit(bike.id,new Set());
    return {name:bike.name, type:'Bike', distanceKm:distanceKm(bike.distance), components};
  });
}

export async function readConfig(configPath = join(homedir(), '.config/interval-icu/config.json')) {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    throw new Error('请配置 ~/.config/interval-icu/config.json，确保文件可读取且为有效 JSON');
  }
  return config;
}

export async function fetchYear({config, fetchImpl = fetch, now = new Date()} = {}) {
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
  const gearLibrary = normalizeGear(await get(`athlete/${encodeURIComponent(athlete.id)}/gear`));
  const syncedAt = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).format(now) + ' +08:00';
  const unavailable = records.filter(a => a.source === 'STRAVA' && !a.type && !a.start_date && a._note === 'STRAVA activities are not available via the API');
  const unavailableActivities = unavailable.map(a => ({date:a.start_date_local?.slice(0,10)}))
    .filter(a => a.date >= period.start && a.date <= period.end);
  // 空壳只保留平台提供的当地日期，公开注明详情缺失，不混入可读取活动的总量。
  for (const a of unavailable) {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(a.start_date_local ?? '')) throw new Error('无法读取的活动缺少有效日期');
  }
  const data = {period, syncedAt, activities:normalizeActivities(records.filter(a => !unavailable.includes(a)), period), unavailableActivities, gearLibrary};
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
  console.log(JSON.stringify({period:data.period, records:data.activities.length, unavailable:data.unavailableActivities.length, bikes:data.gearLibrary.length, source:'Intervals.icu'}));
}
