import {setTimeout as delay} from 'node:timers/promises';
import {beijingDate, beijingTime} from '../docs/journal.mjs';

export const stravaId = value => {
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id) || typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Strava 活动标识无效');
  return id;
};

export function normalizeStravaProfile(athlete) {
  const id = stravaId(athlete?.id);
  const fields = ['firstname', 'lastname', 'state', 'city'];
  if (fields.some(key => athlete[key] != null && typeof athlete[key] !== 'string')) throw new Error('Strava 个人资料格式无效');
  const name = [athlete.firstname, athlete.lastname].map(value => value?.trim()).filter(Boolean).join(' ');
  if (!name) throw new Error('Strava 姓名未提供');
  const location = [...new Set([athlete.state, athlete.city].map(value => value?.trim()).filter(Boolean))].join('，');
  return {name, location, stravaUrl:'https://www.strava.com/athletes/' + id};
}

export function normalizeStravaActivity(record) {
  const id = stravaId(record?.id);
  const sport = record.sport_type;
  if (typeof sport !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(sport) ||
      typeof record.start_date !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(record.start_date) || !Number.isFinite(Date.parse(record.start_date)) ||
      !Number.isSafeInteger(record.moving_time) || record.moving_time < 0) throw new Error('Strava 活动不完整');
  const number = (value, name) => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Strava ' + name + '无效');
    return value;
  };
  const instant = new Date(record.start_date);
  const distance = number(record.distance, '距离');
  return {date:beijingDate(instant), startTime:beijingTime(instant), sport,
    distanceKm:distance === null ? null : distance / 1000, durationSeconds:record.moving_time,
    elevationGain:number(record.total_elevation_gain, '爬升'), trainingLoad:null,
    stravaUrl:'https://www.strava.com/activities/' + id,
    ...(sport === 'WeightTraining' ? {sets:null, averageHeartRate:number(record.average_heartrate, '平均心率') || null,
      calories:number(record.calories, '卡路里')} : {})};
}

// 所有调用共享限额；不把 API 错误响应（可能包含敏感信息）输出到日志。
export function createStravaClient({accessToken, fetchImpl = fetch, clock = Date.now, sleep = delay, maxWaitMs = 16 * 60_000} = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw new Error('请配置 Strava 访问令牌');
  let resumeAt = 0;
  const deadline = clock() + maxWaitMs;
  const wait = async () => {
    if (resumeAt > deadline) throw new Error('Strava 限流等待超时，保留原发布数据');
    while (resumeAt > clock()) await sleep(Math.min(60_000, resumeAt - clock()));
  };
  const quota = headers => {
    for (const prefix of ['X-RateLimit', 'X-ReadRateLimit']) {
      const limits = headers.get(prefix + '-Limit')?.split(',').map(Number);
      const used = headers.get(prefix + '-Usage')?.split(',').map(Number);
      if (limits?.length !== 2 || used?.length !== 2 || [...limits, ...used].some(n => !Number.isFinite(n))) continue;
      if (used[0] >= limits[0]) resumeAt = Math.max(resumeAt, (Math.floor(clock() / 900_000) + 1) * 900_000 + 1000);
      if (used[1] >= limits[1]) resumeAt = Math.max(resumeAt, (Math.floor(clock() / 86400_000) + 1) * 86400_000 + 1000);
    }
  };
  const get = async (path, {allowNotFound = false} = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait();
      let response;
      try {
        response = await fetchImpl('https://www.strava.com/api/v3' + path, {
          headers:{Authorization:'Bearer ' + accessToken, Accept:'application/json'},
          signal:AbortSignal.timeout(60_000), redirect:'error',
        });
      } catch { throw new Error('Strava 网络请求失败，未更新数据'); }
      quota(response.headers);
      if (response.status === 429) {
        const retry = Number(response.headers.get('Retry-After'));
        resumeAt = Math.max(resumeAt, clock() + (retry > 0 ? retry * 1000 : 60_000));
        continue;
      }
      if (response.status === 404 && allowNotFound) return null;
      if (!response.ok) throw new Error('Strava 请求失败（HTTP ' + response.status + '），未更新数据');
      try { return await response.json(); } catch { throw new Error('Strava 响应无效'); }
    }
    throw new Error('Strava 限流重试失败，未更新数据');
  };
  return {get,
    async verifyAthlete(expectedId = '78720097') {
      const athlete = await get('/athlete');
      if (stravaId(athlete?.id) !== expectedId) throw new Error('Strava 授权账号不匹配');
      return normalizeStravaProfile(athlete);
    },
    async activities({after, before}) {
      const rows = [], ids = new Set();
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({before:String(before), per_page:'200', page:String(page)});
        if (after != null) params.set('after', String(after));
        const records = await get('/athlete/activities?' + params);
        if (!Array.isArray(records)) throw new Error('Strava 活动列表无效');
        for (const record of records) {
          const id = stravaId(record?.id);
          if (ids.has(id)) throw new Error('Strava 分页活动重复，无法确认完整性');
          ids.add(id);
          rows.push(record);
        }
        if (!records.length) return rows;
      }
    },
    activity:id => get('/activities/' + stravaId(id), {allowNotFound:true}),
  };
}
