import {createHash} from 'node:crypto';
import {readFile, writeFile, rename, unlink, mkdir, open} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {beijingDate, compareActivityDates, shiftDate, validateData, isDate} from '../docs/journal.mjs';
import {validatePersonalBests} from '../docs/personal-bests.mjs';
import {fetchIntervalsData, normalizeActivities, matchCorosStrengthSets} from './update-data.mjs';
import {fetchPersonalBests} from './update-personal-bests.mjs';
import {buildHtml} from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const week = 7 * 86400000;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
// 受限记录用不可逆摘要关联，不发布原始平台标识。
export const unavailableId = stravaId => createHash('sha256').update('strava:' + stravaId).digest('hex');
const keyFor = a => a.stravaUrl || a.activityUrl;
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

export function mergeActivities({previous, intervalsRecords, corosRecords, strengthSets, window, now}) {
  validateData(previous);
  if (!Array.isArray(intervalsRecords)) throw new Error('Intervals.icu 活动列表无效');
  const byStrava = new Map(), byIntervals = new Map(), activities = new Set();
  for (const a of previous.activities) {
    if (!keyFor(a) || a.stravaUrl && byStrava.has(a.stravaUrl) || a.activityUrl && byIntervals.has(a.activityUrl)) throw new Error('历史活动标识缺失或重复');
    const row = {...a};
    activities.add(row);
    if (a.stravaUrl) byStrava.set(a.stravaUrl, row);
    if (a.activityUrl) byIntervals.set(a.activityUrl, row);
  }
  const sets = new Map();
  for (const row of strengthSets) {
    if (!row || Object.keys(row).sort().join(',') !== 'activityUrl,sets' ||
        !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(row.activityUrl) || sets.has(row.activityUrl) ||
        !Number.isInteger(row.sets) || row.sets < 0) throw new Error('历史组数来源无效');
    sets.set(row.activityUrl, row.sets);
  }
  const matchedSets = matchCorosStrengthSets(intervalsRecords, corosRecords);
  for (const row of matchedSets) sets.set(row.activityUrl, row.sets);
  const seen = new Set(), linked = new Set(), touched = new Set();
  const unavailable = new Map(previous.unavailableActivities.map(a => [a.id, {...a}]));
  let updated = 0, added = 0, restrictedRetained = 0, restrictedUnavailable = 0;
  for (const record of intervalsRecords) {
    if (!record || !/^(?:i)?\d+$/.test(String(record.id)) || seen.has(String(record.id))) throw new Error('Intervals.icu 活动标识无效或重复');
    seen.add(String(record.id));
    const activityUrl = 'https://intervals.icu/activities/' + record.id;
    if (record.strava_id != null && (typeof record.strava_id !== 'string' || !/^[1-9]\d*$/.test(record.strava_id))) throw new Error('Intervals.icu Strava 关联无效');
    const sourceId = record.source === 'STRAVA' && /^[1-9]\d*$/.test(String(record.id)) ? String(record.id) : null;
    if (sourceId && record.strava_id != null && sourceId !== record.strava_id) throw new Error('跨平台活动关联冲突');
    const id = record.strava_id ?? sourceId;
    const known = byIntervals.get(activityUrl);
    const stravaUrl = id === null ? known?.stravaUrl : 'https://www.strava.com/activities/' + id;
    const related = stravaUrl ? byStrava.get(stravaUrl) : undefined;
    if (known?.stravaUrl && known.stravaUrl !== stravaUrl || related?.activityUrl && related.activityUrl !== activityUrl) throw new Error('跨平台活动关联冲突');
    if (stravaUrl && linked.has(stravaUrl)) throw new Error('跨平台活动关联不唯一');
    if (stravaUrl) linked.add(stravaUrl);
    const old = known || related;
    let next;
    const restricted = sourceId && record._note === 'STRAVA activities are not available via the API' &&
      ['type','start_date','moving_time','distance','total_elevation_gain','icu_training_load','average_heartrate','external_id'].every(field => record[field] === undefined);
    if (restricted) {
      const local = record.start_date_local;
      if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(local) || !isDate(local.slice(0,10))) throw new Error('受限活动当地日期无效');
      const date = local.slice(0,10);
      if (date < window.oldest || date > window.end) continue;
      if (!old) { unavailable.set(unavailableId(sourceId), {id:unavailableId(sourceId), date}); restrictedUnavailable++; continue; }
      next = {...related, ...known, activityUrl, stravaUrl};
      restrictedRetained++;
    } else {
      [next] = normalizeActivities([{...record, ...(id === null ? {} : {strava_id:id})}], {start:'1900-01-01', end:window.end});
      const timestamp = /(?:Z|[+-]\d\d:?\d\d)$/.test(record.start_date) ? record.start_date : record.start_date + 'Z';
      if (!next || next.date < window.oldest || Date.parse(timestamp) >= window.before * 1000) continue;
      if (stravaUrl) next.stravaUrl = stravaUrl;
      if (old) updated++; else added++;
    }
    if (id !== null) unavailable.delete(unavailableId(id));
    next.trainingLoad ??= known?.trainingLoad ?? related?.trainingLoad ?? null;
    if (next.sport === 'WeightTraining') next.sets ??= known?.sets ?? related?.sets ?? null;
    for (const row of [known, related]) if (row) { activities.delete(row); touched.add(row); }
    activities.add(next);
    byIntervals.set(activityUrl, next);
    if (stravaUrl) byStrava.set(stravaUrl, next);
  }
  for (const a of activities) if (a.sport === 'WeightTraining' && sets.has(a.activityUrl)) a.sets = sets.get(a.activityUrl);
  const unavailableActivities = [...unavailable.values()].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const end = beijingDate(now), rows = [...activities].sort((a,b) => compareActivityDates(a, b) || keyFor(a).localeCompare(keyFor(b)));
  const earliest = [...rows, ...unavailableActivities].reduce((date, a) => a.date < date ? a.date : date, shiftDate(end, -364));
  const data = {period:{start:earliest.slice(0,4) + '-01-01', end}, syncedAt:'',
    activities:rows, unavailableActivities, gearLibrary:previous.gearLibrary};
  data.syncedAt = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now) + ' +08:00';
  validateData(data);
  return {data, strengthSets:[...sets].map(([activityUrl, sets]) => ({activityUrl, sets})), report:{intervalsFetched:intervalsRecords.length,
    added, updated, retainedHistory:previous.activities.length - touched.size, restrictedRetained, restrictedUnavailable,
    corosMatched:matchedSets.length, corosUnmatched:corosRecords.length - matchedSets.length}};
}

// 同一任务只允许一个写入者；进程中断留下的日志在下次运行先恢复。
export async function recoverTransaction(directory) {
  const path = resolve(directory, 'output/sync/rollback.json');
  let entries;
  try { entries = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const {name, previous} of entries) {
    if (!['docs/activities.json','docs/personal-bests.json','docs/index.html','data/strength-sets.json','data/sync-state.json'].includes(name)) throw new Error('恢复日志路径无效');
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

export async function sync({directory = root, now = new Date(), corosInput, fetchIntervals = fetchIntervalsData,
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
    const state = await readState(directory), window = syncWindow(state, now);
    const previous = JSON.parse(await readFile(resolve(directory, 'docs/activities.json'), 'utf8'));
    const strengthSets = JSON.parse(await readFile(resolve(directory, 'data/strength-sets.json'), 'utf8'));
    validateData(previous);
    // COROS 从已保存历史的起点查询，避免向平台发送 1900 年的无效时间范围。
    validateCorosInput(corosInput, {...window, oldest:window.full ? previous.period.start : window.oldest}, now);
    const intervals = await fetchIntervals({now, oldest:window.oldest});
    const merged = mergeActivities({previous, intervalsRecords:intervals.records,
      corosRecords:corosInput.records, strengthSets, window, now});
    const firstDate = [...merged.data.activities, ...merged.data.unavailableActivities].reduce((date, row) => row.date < date ? row.date : date, previous.period.start);
    if (window.full && firstDate < corosInput.startDate) throw new Error(`Intervals.icu 发现更早历史，请从 ${firstDate.slice(0,4)}-01-01 重新完整查询 COROS`);
    merged.data.gearLibrary = intervals.gearLibrary;
    validateData(merged.data);
    const personalBests = await fetchBests({activities:merged.data.activities, now});
    validatePersonalBests(personalBests);
    const html = await render({data:merged.data, personalBests});
    const nextState = {cursor:new Date(window.before * 1000).toISOString(), lastSuccessfulSyncAt:finishTime().toISOString(),
      lastFullReconcileAt:window.full ? new Date(window.before * 1000).toISOString() : state.lastFullReconcileAt};
    syncWindow(nextState, new Date(nextState.lastSuccessfulSyncAt));
    await commitFiles(directory, [['docs/activities.json',json(merged.data)], ['docs/personal-bests.json',json(personalBests)],
      ['docs/index.html',html], ['data/strength-sets.json',json(merged.strengthSets)], ['data/sync-state.json',json(nextState)]], renameImpl);
    return {...merged.report, mode:window.full ? 'full' : 'incremental', records:merged.data.activities.length,
      syncedAt:merged.data.syncedAt, period:merged.data.period, cursor:nextState.cursor};
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--plan') {
      const window = syncWindow(await readState(root));
      const previous = JSON.parse(await readFile(resolve(root, 'docs/activities.json'), 'utf8'));
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
