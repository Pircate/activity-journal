import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {beijingDate, beijingTime, compareActivityDates, shiftDate, replacementTargets, isDate} from '../docs/journal.mjs';

// COROS 原始标识只用于内存中的精确关联，补充文件仅保留网站已有链接和组数。
export function matchCorosStrengthSets(records, corosRecords) {
  const sets = new Map();
  for (const row of corosRecords) {
    if (!row || typeof row.labelId !== 'string' || !/^\d+$/.test(row.labelId) || sets.has(row.labelId) || !Number.isInteger(row.sets) || row.sets < 0) throw new Error('COROS 组数记录无效或重复');
    sets.set(row.labelId, row.sets);
  }
  const matched = new Set();
  return records.filter(record => record.type === 'WeightTraining' && record.source === 'COROS' && sets.has(record.external_id)).map(record => {
    if (matched.has(record.external_id) || !/^(?:i)?\d+$/.test(String(record.id))) throw new Error('力量训练来源关联不唯一或活动标识无效');
    matched.add(record.external_id);
    return {activityUrl:'https://intervals.icu/activities/' + record.id, sets:sets.get(record.external_id)};
  });
}

export function normalizeActivities(records, period, strengthSets = []) {
  if (!Array.isArray(records)) throw new Error('Intervals.icu 返回的活动列表无效');
  if (!Array.isArray(strengthSets)) throw new Error('力量训练组数补充数据无效');
  const setsByActivity = new Map();
  for (const row of strengthSets) {
    if (!row || Object.keys(row).sort().join(',') !== 'activityUrl,sets' || typeof row.activityUrl !== 'string' || !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(row.activityUrl) ||
        setsByActivity.has(row.activityUrl) || !Number.isInteger(row.sets) || row.sets < 0) throw new Error('力量训练组数补充数据无效或重复');
    setsByActivity.set(row.activityUrl, row.sets);
  }
  const ids = new Set();
  return records.map(record => {
    // Strava 空壳与缺失时长不能视为零运动；整次同步失败，保留已发布的数据。
    if (!record || !/^(?:i)?\d+$/.test(String(record.id)) || ids.has(String(record.id)) || typeof record.type !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(record.type) || !record.start_date ||
        !Number.isSafeInteger(record.moving_time) || record.moving_time < 0) {
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
    if (record.strava_id != null && (typeof record.strava_id !== 'string' || !/^[1-9]\d*$/.test(record.strava_id))) throw new Error('Strava 活动标识无效');
    return {
      date:beijingDate(instant),
      startTime:beijingTime(instant),
      sport:record.type,
      distanceKm:distance === null ? null : distance / 1000,
      durationSeconds:record.moving_time,
      trainingLoad:number(record.icu_training_load, '训练负荷'),
      ...(record.total_elevation_gain != null ? {elevationGain:number(record.total_elevation_gain, '累计爬升')} : {}),
      activityUrl:'https://intervals.icu/activities/' + record.id,
      ...(record.strava_id ? {stravaUrl:'https://www.strava.com/activities/' + record.strava_id} : {}),
      ...(record.type === 'WeightTraining' ? {sets:setsByActivity.get('https://intervals.icu/activities/' + record.id) ?? null, averageHeartRate:number(record.average_heartrate, '平均心率') || null} : {}),
    };
  }).filter(a => a.date >= period.start && a.date <= period.end)
    .sort(compareActivityDates);
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
  const owners = new Map();
  const bikes = records.filter(gear => gear.type === 'Bike' && !gear.component);
  const active = bikes.filter(bike => !bike.retired).map(bike => {
    const components = [];
    const visited = new Set();
    const visit = (id, ancestors) => {
      if (ancestors.has(id)) throw new Error('装备配件关联存在循环');
      if (visited.has(id)) return;
      const part = byId.get(id);
      if (!part) throw new Error('装备关联的配件缺失');
      if (part.retired) return;
      visited.add(id);
      if (id !== bike.id) {
        const component = {name:part.name, type:part.type, distanceKm:distanceKm(part.distance), replacement:replacementFor(part)};
        components.push(component);
        if (!owners.has(id)) owners.set(id, []);
        owners.get(id).push({bike:bike.name, component});
      }
      const path = new Set([...ancestors,id]);
      for (const childId of part.component_ids ?? []) visit(childId,path);
    };
    visit(bike.id,new Set());
    return {name:bike.name, type:'Bike', distanceKm:distanceKm(bike.distance), components};
  });
  let sharedGroup = 0;
  for (const entries of owners.values()) {
    if (entries.length > 1) {
      sharedGroup++;
      for (const entry of entries) {
        entry.component.sharedBy = entries.map(owner => owner.bike);
        // 仅为本份快照生成共享分组号，原始平台配件标识不公开。
        entry.component.sharedGroup = sharedGroup;
      }
    }
  }
  const retired = bikes.filter(bike => bike.retired).map(bike => {
    if (!isDate(bike.retired)) throw new Error('退役装备日期无效');
    return {name:bike.name, type:'Bike', distanceKm:distanceKm(bike.distance), retiredAt:bike.retired};
  }).sort((a, b) => b.retiredAt.localeCompare(a.retiredAt) || a.name.localeCompare(b.name, 'zh-CN'));
  return {active, retired};
}

export async function readConfig(configPath = join(homedir(), '.config/interval-icu/config.json')) {
  if (process.env.INTERVALS_ICU_API_KEY && configPath === join(homedir(), '.config/interval-icu/config.json')) return {INTERVALS_ICU_API_KEY:process.env.INTERVALS_ICU_API_KEY};
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    throw new Error('请配置 ~/.config/interval-icu/config.json，确保文件可读取且为有效 JSON');
  }
  return config;
}

export async function fetchIntervalsData({config, fetchImpl = fetch, now = new Date(), oldest = '1900-01-01'} = {}) {
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
  // 从历史起点获取全部记录；达到条数上限时二分当地日期范围，不使用可能截断的结果。
  const fetchRange = async (oldest, newest) => {
    const params = new URLSearchParams({oldest, newest:newest + 'T23:59:59',
      limit:'10000', fields:'id,type,start_date,moving_time,distance,total_elevation_gain,icu_training_load,average_heartrate,source,external_id,start_date_local,strava_id'});
    const records = await get(`athlete/${encodeURIComponent(athlete.id)}/activities?${params}`);
    if (!Array.isArray(records)) throw new Error('活动列表无效，未更新数据');
    if (records.length < 10000) return records;
    if (oldest === newest) throw new Error('单日活动达到查询上限，无法确认完整性，未更新数据');
    const days = Math.round((Date.parse(newest) - Date.parse(oldest)) / 86400000);
    const middle = shiftDate(oldest, Math.floor(days / 2));
    return [...await fetchRange(oldest, middle), ...await fetchRange(shiftDate(middle, 1), newest)];
  };
  // 当地日期上界多取一天，再转换北京时间裁剪。
  if (!isDate(oldest) || oldest > end) throw new Error('Intervals.icu 查询起点无效');
  const records = await fetchRange(oldest, shiftDate(end, 1));
  if (records.some(a => !a?.id) || new Set(records.map(a => String(a.id))).size !== records.length) throw new Error('活动 ID 缺失或重复，未更新数据');
  const gearLibrary = normalizeGear(await get(`athlete/${encodeURIComponent(athlete.id)}/gear`));
  return {records, gearLibrary};
}
