import {readFile, writeFile, rename, unlink, mkdir, open} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {beijingDate, compareActivityDates, shiftDate, validateData, isDate} from '../docs/journal.mjs';
import {validatePersonalBests} from '../docs/personal-bests.mjs';
import {matchCorosStrengthSets} from './update-data.mjs';
import {fetchPersonalBests} from './update-personal-bests.mjs';
import {buildHtml} from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const week = 7 * 86400000;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export {unavailableId, mergeActivities} from './activity-sync.mjs';
const json = data => JSON.stringify(data, null, 2) + '\n';

export function syncWindow(state, now = new Date()) {
  if (state !== null && (!state || Object.keys(state).sort().join(',') !== 'cursor,lastFullReconcileAt,lastSuccessfulSyncAt' ||
      ![state.cursor, state.lastSuccessfulSyncAt, state.lastFullReconcileAt].every(iso) ||
      Date.parse(state.cursor) > Date.parse(state.lastSuccessfulSyncAt) || Date.parse(state.lastFullReconcileAt) > Date.parse(state.cursor) ||
      Date.parse(state.lastSuccessfulSyncAt) > now.getTime())) throw new Error('同步状态无效，禁止跳过历史数据');
  const full = state === null || now.getTime() - Date.parse(state.lastFullReconcileAt) >= week;
  const after = full ? null : Math.floor((Date.parse(state.cursor) - week) / 1000) - 1;
  const before = Math.floor(now.getTime() / 1000);
  return {full, after, before, oldest:full ? '1900-01-01' : shiftDate(beijingDate(new Date((after + 1) * 1000)), -1), end:beijingDate(now)};
}

export function validateCorosInput(input, window, now) {
  if (!input || !Array.isArray(input.records) || !iso(input.queriedAt) ||
      now.getTime() - Date.parse(input.queriedAt) < 0 || now.getTime() - Date.parse(input.queriedAt) > 86400000 ||
      !isDate(input.startDate) || !isDate(input.endDate) || input.startDate > input.endDate ||
      input.startDate > window.oldest || input.endDate < window.end) throw new Error('COROS 组数输入缺失、过期或查询范围不足，请先按 --plan 查询');
  // 即使当前没有关联活动，也验证全部输入，不把查询失败误当成空列表。
  matchCorosStrengthSets([], input.records);
}

// 同一任务只允许一个写入者；进程中断留下的日志在下次运行先恢复。
export async function recoverTransaction(directory) {
  const path = resolve(directory, 'output/sync/rollback.json');
  let entries;
  try { entries = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const {name, previous} of entries) {
    if (!['docs/activities.json','docs/personal-bests.json','docs/index.html','data/profile.json','data/strength-sets.json','data/sync-state.json'].includes(name)) throw new Error('恢复日志路径无效');
    const target = resolve(directory, name);
    if (previous === null) await unlink(target).catch(error => {if (error.code !== 'ENOENT') throw error;});
    else { await writeFile(target + '.tmp', previous); await rename(target + '.tmp', target); }
  }
  await unlink(path);
}

export async function commitFiles(directory, files, renameImpl = rename) {
  const journal = resolve(directory, 'output/sync/rollback.json');
  await mkdir(dirname(journal), {recursive:true});
  const entries = [];
  for (const [name, content] of files) {
    let previous = null;
    try { previous = await readFile(resolve(directory, name), 'utf8'); } catch (error) {if (error.code !== 'ENOENT') throw error;}
    entries.push({name, previous});
    await writeFile(resolve(directory, name) + '.tmp', content);
  }
  await writeFile(journal + '.tmp', json(entries));
  await rename(journal + '.tmp', journal);
  try {
    for (const [name] of files) await renameImpl(resolve(directory, name) + '.tmp', resolve(directory, name));
    await unlink(journal);
  } catch (error) { await recoverTransaction(directory); throw error; }
  finally { for (const [name] of files) await unlink(resolve(directory, name) + '.tmp').catch(error => {if (error.code !== 'ENOENT') throw error;}); }
}

async function readState(directory) {
  try { return JSON.parse(await readFile(resolve(directory, 'data/sync-state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('同步状态无法读取'); }
}

export async function sync({directory = root, now = new Date(), corosInput, fetchActivities,
  fetchBests = fetchPersonalBests, render = buildHtml, finishTime = () => new Date(), renameImpl} = {}) {
  const lockPath = resolve(directory, 'output/sync.lock');
  await mkdir(dirname(lockPath), {recursive:true});
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('同步锁无效；确认没有同步进程后删除 output/sync.lock 并重试');
    try { process.kill(pid, 0); }
    catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
      await unlink(lockPath);
      lock = await open(lockPath, 'wx');
    }
    if (!lock) throw new Error('已有同步进程，拒绝并发写入');
  }
  try {
    await lock.writeFile(String(process.pid));
    await recoverTransaction(directory);
    const state = await readState(directory);
    let window = syncWindow(state, now);
    const previous = JSON.parse(await readFile(resolve(directory, 'docs/activities.json'), 'utf8'));
    const strengthSets = JSON.parse(await readFile(resolve(directory, 'data/strength-sets.json'), 'utf8'));
    validateData(previous);
    if (previous.sourcePolicyVersion !== 2) window = syncWindow(null, now);
    // COROS 从已保存历史的起点查询，避免向平台发送 1900 年的无效时间范围。
    validateCorosInput(corosInput, {...window, oldest:window.full ? previous.period.start : window.oldest}, now);
    // 本地入口与云端入口共用 Strava 主数据管线。
    if (!fetchActivities) {
      const {fetchAllActivities, stravaAccessToken} = await import('./fetch-site-data.mjs');
      const {readConfig} = await import('./update-data.mjs');
      const config = {...await readConfig(), STRAVA_ACCESS_TOKEN:await stravaAccessToken()};
      fetchActivities = options => fetchAllActivities({...options, config});
    }
    let report, profile;
    const data = await fetchActivities({baseData:previous, since:state?.cursor, now, strengthSets,
      corosRecords:corosInput.records, full:window.full,
      onReport:value => { report = value; }, onProfile:value => { profile = value; }});
    validateData(data);
    if (window.full && data.period.start < corosInput.startDate) throw new Error(`Strava 发现更早历史，请从 ${data.period.start} 重新完整查询 COROS`);
    const personalBests = await fetchBests({activities:data.activities, now});
    validatePersonalBests(personalBests);
    const html = await render({data, personalBests, profile});
    const nextState = {cursor:new Date(window.before * 1000).toISOString(), lastSuccessfulSyncAt:finishTime().toISOString(),
      lastFullReconcileAt:window.full ? new Date(window.before * 1000).toISOString() : state.lastFullReconcileAt};
    syncWindow(nextState, new Date(nextState.lastSuccessfulSyncAt));
    await commitFiles(directory, [['docs/activities.json',json(data)], ['docs/personal-bests.json',json(personalBests)], ['data/profile.json',json(profile)],
      ['docs/index.html',html], ['data/strength-sets.json',json(data.activities.filter(a => a.sport === 'WeightTraining' && a.activityUrl && a.sets !== null).map(a => ({activityUrl:a.activityUrl,sets:a.sets})))], ['data/sync-state.json',json(nextState)]], renameImpl);
    return {...report, mode:window.full ? 'full' : 'incremental', records:data.activities.length,
      syncedAt:data.syncedAt, period:data.period, cursor:nextState.cursor};
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--plan') {
      let window = syncWindow(await readState(root));
      const previous = JSON.parse(await readFile(resolve(root, 'docs/activities.json'), 'utf8'));
      if (previous.sourcePolicyVersion !== 2) window = syncWindow(null, new Date());
      console.log(json({...window, corosOldest:window.full ? previous.period.start : window.oldest,
        corosInput:{startDate:window.full ? previous.period.start : window.oldest, endDate:window.end,
        queriedAt:'填写本次 COROS 查询完成的 UTC ISO 时间', records:[{labelId:'填写真实标识',sets:0}]}}));
    } else {
      if (process.argv.length !== 4 || process.argv[2] !== '--coros-input') throw new Error('用法：node scripts/sync.mjs --plan；node scripts/sync.mjs --coros-input output/sync/coros-strength.json');
      const corosInput = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'));
      console.log(json(await sync({corosInput})));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
