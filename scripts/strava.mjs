import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {beijingDate, formatTime, isDate} from '../docs/journal.mjs';
import {sports} from './update-data.mjs';

export function normalizeStrava(record) {
  if (!record || !/^[1-9]\d*$/.test(String(record.id)) ||
      typeof record.id === 'number' && !Number.isSafeInteger(record.id) ||
      typeof record.sport_type !== 'string' || !record.sport_type ||
      typeof record.start_date !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(record.start_date) ||
      !Number.isFinite(Date.parse(record.start_date)) || !isDate(record.start_date.slice(0,10)) || !Number.isInteger(record.moving_time) || record.moving_time < 0) {
    throw new Error('Strava 活动字段无效');
  }
  const number = (value, field) => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Strava ${field}无效`);
    return value;
  };
  const distance = number(record.distance, '距离');
  return {
    date:beijingDate(new Date(record.start_date)), sport:sports[record.sport_type] ?? `其他运动（${record.sport_type}）`,
    distanceKm:record.sport_type === 'WeightTraining' || distance === null ? null : Math.round(distance / 10) / 100,
    duration:formatTime(record.moving_time), trainingLoad:null,
    ...(record.total_elevation_gain != null ? {elevationGain:number(record.total_elevation_gain, '累计爬升')} : {}),
    stravaUrl:'https://www.strava.com/activities/' + record.id,
    ...(record.sport_type === 'WeightTraining' ? {sets:null, averageHeartRate:number(record.average_heartrate, '平均心率') || null} : {}),
  };
}

export async function createStravaClient({envPath = join(homedir(), '.open-fit/strava.env'), env = process.env, fetchImpl = fetch} = {}) {
  let file = '';
  try { file = await readFile(envPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Strava 凭据文件无法读取'); }
  const saved = parseEnv(file);
  const config = {...saved};
  for (const [key, value] of Object.entries(env)) if (key.startsWith('STRAVA_') && value) config[key] = value;
  let token = env.STRAVA_TOKEN || env.STRAVA_ACCESS_TOKEN || saved.STRAVA_TOKEN || saved.STRAVA_ACCESS_TOKEN;
  let readAllVerified = false;
  const checkScope = scope => {
    if (!scope) return;
    const scopes = Array.isArray(scope) ? scope : scope.split(/[,\s]+/);
    if (!scopes.includes('activity:read_all')) throw new Error('Strava 授权需要 activity:read_all，停止同步');
    readAllVerified = true;
  };
  checkScope(config.STRAVA_SCOPE || config.STRAVA_SCOPES);
  const refresh = async () => {
    if (![config.STRAVA_CLIENT_ID, config.STRAVA_CLIENT_SECRET, config.STRAVA_REFRESH_TOKEN].every(Boolean)) throw new Error('Strava 凭据缺失或已过期，需要重新授权');
    // 刷新会轮换 refresh token，必须先确认目标目录可写，避免请求成功后丢失凭据。
    const temporary = envPath + '.tmp';
    await writeFile(temporary, '', {mode:0o600});
    await unlink(temporary);
    const response = await fetchImpl('https://www.strava.com/oauth/token', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(60000),
      body:new URLSearchParams({client_id:config.STRAVA_CLIENT_ID, client_secret:config.STRAVA_CLIENT_SECRET,
        refresh_token:config.STRAVA_REFRESH_TOKEN, grant_type:'refresh_token'}),
    });
    if (!response.ok) throw new Error(`Strava 刷新授权失败（HTTP ${response.status}）`);
    const result = await response.json();
    if (!result.access_token || !result.refresh_token) throw new Error('Strava 刷新授权响应无效');
    token = result.access_token;
    config.STRAVA_TOKEN = config.STRAVA_ACCESS_TOKEN = token;
    config.STRAVA_REFRESH_TOKEN = result.refresh_token;
    // 先保存轮换后的凭据，即使权限不足也不能丢失新 refresh token。
    const values = {...saved, STRAVA_CLIENT_ID:config.STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET:config.STRAVA_CLIENT_SECRET,
      STRAVA_TOKEN:token, STRAVA_ACCESS_TOKEN:token, STRAVA_REFRESH_TOKEN:result.refresh_token};
    if (result.scope) values.STRAVA_SCOPE = Array.isArray(result.scope) ? result.scope.join(',') : result.scope;
    try {
      await writeFile(temporary, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join('\n') + '\n', {mode:0o600});
      await rename(temporary, envPath);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    checkScope(result.scope);
  };
  const get = async (path, {allowMissing = false} = {}) => {
    if (!token) await refresh();
    const request = () => fetchImpl('https://www.strava.com/api/v3/' + path, {
      headers:{Authorization:'Bearer ' + token, Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(60000),
    });
    let response = await request();
    if (response.status === 401) { await refresh(); response = await request(); }
    if (allowMissing && response.status === 404 && readAllVerified) return null;
    if (!response.ok) throw new Error(`Strava 请求失败（HTTP ${response.status}），未更新数据${response.status === 404 ? '，未确认完整读取权限，禁止据此删除活动' : ''}`);
    return response.json();
  };
  return {
    get,
    async activities({after, before}) {
      const records = [], ids = new Set();
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({before:String(before), page:String(page), per_page:'200'});
        if (after !== null) params.set('after', String(after));
        const rows = await get('athlete/activities?' + params);
        if (!Array.isArray(rows) || rows.length > 200) throw new Error('Strava 活动列表无效');
        if (!rows.length) break;
        for (const row of rows) {
          normalizeStrava(row);
          const id = String(row.id), start = Date.parse(row.start_date) / 1000;
          if (ids.has(id)) throw new Error('Strava 分页存在重复活动，请重试同步');
          if (after !== null && start <= after || start >= before) throw new Error('Strava 活动超出查询边界');
          ids.add(id); records.push(row);
          if (row.private === true) readAllVerified = true;
        }
        // 读到空页才确认结束，不因短页提前停止。
      }
      return records;
    },
  };
}
