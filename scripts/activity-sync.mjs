import {createHash} from 'node:crypto';
import {beijingDate, compareActivityDates, shiftDate, validateData} from '../docs/journal.mjs';
import {summarizeActivities} from '../docs/activity-data.mjs';
import {normalizeStravaActivity, stravaId} from './strava-data.mjs';
import {matchCorosStrengthSets} from './update-data.mjs';

export const unavailableId = id => createHash('sha256').update('strava:' + id).digest('hex');

export function activityAssociations(previous, records, strengthSets = []) {
  const byStrava = new Map(), byIntervals = new Map(), loads = new Map(), sets = new Map();
  const link = (stravaUrl, activityUrl) => {
    if (!stravaUrl || !activityUrl) return;
    if (byStrava.has(stravaUrl) && byStrava.get(stravaUrl) !== activityUrl ||
        byIntervals.has(activityUrl) && byIntervals.get(activityUrl) !== stravaUrl) throw new Error('跨平台活动关联冲突');
    byStrava.set(stravaUrl, activityUrl);
    byIntervals.set(activityUrl, stravaUrl);
  };
  for (const row of previous.activities) link(row.stravaUrl, row.activityUrl);
  for (const row of strengthSets) {
    if (!row || Object.keys(row).sort().join(',') !== 'activityUrl,sets' ||
        !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(row.activityUrl) || sets.has(row.activityUrl) ||
        !Number.isInteger(row.sets) || row.sets < 0) throw new Error('历史组数来源无效');
    sets.set(row.activityUrl, row.sets);
  }
  const seen = new Set();
  for (const record of records) {
    const id = String(record?.id ?? '');
    if (!/^(?:i)?\d+$/.test(id) || seen.has(id)) throw new Error('Intervals.icu 活动标识无效或重复');
    seen.add(id);
    const activityUrl = 'https://intervals.icu/activities/' + id;
    const sourceId = record.source === 'STRAVA' && /^[1-9]\d*$/.test(id) ? id : null;
    if (record.strava_id != null && (typeof record.strava_id !== 'string' || stravaId(record.strava_id) !== record.strava_id)) throw new Error('Intervals.icu Strava 关联无效');
    if (sourceId && record.strava_id != null && sourceId !== record.strava_id) throw new Error('跨平台活动关联冲突');
    const linked = record.strava_id ?? sourceId;
    if (linked) link('https://www.strava.com/activities/' + linked, activityUrl);
    const load = record.icu_training_load;
    if (load != null && (typeof load !== 'number' || !Number.isFinite(load) || load < 0)) throw new Error('Intervals.icu 训练负荷无效');
    loads.set(activityUrl, load ?? null);
  }
  return {byStrava, loads, sets};
}

export function mergeActivities({previous, stravaRecords, intervalsRecords, corosRecords = [], strengthSets = [], window, now}) {
  validateData(previous);
  if (!Array.isArray(stravaRecords) || !Array.isArray(intervalsRecords)) throw new Error('活动列表无效');
  const matchedSets = matchCorosStrengthSets(intervalsRecords, corosRecords);
  const associations = activityAssociations(previous, intervalsRecords, strengthSets);
  const {byStrava, loads, sets} = associations;
  for (const row of matchedSets) sets.set(row.activityUrl, row.sets);
  const rows = new Map(), intervalRows = new Map();
  for (const row of previous.activities) {
    const key = row.stravaUrl ?? row.activityUrl;
    if (!key || rows.has(key) || row.activityUrl && intervalRows.has(row.activityUrl)) throw new Error('历史活动标识缺失或重复');
    const copy = {...row};
    if (row.sport === 'WeightTraining') copy.calories ??= null;
    rows.set(key, copy);
    if (row.activityUrl) intervalRows.set(row.activityUrl, {key, row:copy});
  }
  const unavailable = new Map(previous.unavailableActivities.map(row => [row.id, {...row}]));
  const seen = new Set(), touched = new Set();
  let added = 0, updated = 0;
  for (const record of stravaRecords) {
    const id = stravaId(record?.id);
    if (seen.has(id)) throw new Error('Strava 活动标识重复');
    seen.add(id);
    const next = normalizeStravaActivity(record);
    if (next.date < window.oldest || next.date > window.end || Date.parse(record.start_date) >= window.before * 1000) continue;
    const activityUrl = byStrava.get(next.stravaUrl);
    const related = rows.get(next.stravaUrl), known = intervalRows.get(activityUrl)?.row;
    const old = related ?? known;
    if (activityUrl) next.activityUrl = activityUrl;
    next.trainingLoad = loads.get(activityUrl) ?? related?.trainingLoad ?? known?.trainingLoad ?? null;
    if (next.sport === 'WeightTraining') next.sets = sets.get(activityUrl) ?? related?.sets ?? known?.sets ?? null;
    if (old) updated++; else added++;
    for (const row of [related, known]) if (row) { const key = row.stravaUrl ?? row.activityUrl; rows.delete(key); touched.add(key); }
    rows.set(next.stravaUrl, next);
    unavailable.delete(unavailableId(id));
  }
  // 未读取到的历史只刷新 Intervals 专属指标，不用它覆盖 Strava 主字段。
  for (const row of rows.values()) {
    row.trainingLoad = loads.get(row.activityUrl) ?? row.trainingLoad;
    if (row.sport === 'WeightTraining' && sets.has(row.activityUrl)) row.sets = sets.get(row.activityUrl);
  }
  const activities = [...rows.values()].sort((a,b) => compareActivityDates(a,b) || (a.stravaUrl ?? a.activityUrl).localeCompare(b.stravaUrl ?? b.activityUrl));
  const unavailableActivities = [...unavailable.values()].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const end = beijingDate(now);
  const earliest = [...activities, ...unavailableActivities].reduce((date,a) => a.date < date ? a.date : date, shiftDate(end, -364));
  const data = {sourcePolicyVersion:2, period:{start:earliest.slice(0,4) + '-01-01', end},
    syncedAt:new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).format(now) + ' +08:00',
    activities, unavailableActivities, gearLibrary:previous.gearLibrary};
  validateData(data);
  const retained = previous.activities.filter(row => row.date >= window.oldest && !touched.has(row.stravaUrl ?? row.activityUrl));
  return {data, strengthSets:[...sets].map(([activityUrl,sets]) => ({activityUrl,sets})), report:{
    sourcePolicyVersion:2, mode:window.oldest === '1900-01-01' ? 'full' : 'incremental',
    stravaFetched:stravaRecords.length, intervalsFetched:intervalsRecords.length, added, updated,
    retainedHistory:previous.activities.length - touched.size, corosMatched:matchedSets.length, corosUnmatched:corosRecords.length - matchedSets.length,
    uncorrected:retained.map(row => ({date:row.date, activityUrl:row.activityUrl ?? null, stravaUrl:row.stravaUrl ?? null,
      reason:row.stravaUrl ? 'Strava 未返回或无法读取' : '缺少 Strava 关联'})),
    unavailable:unavailableActivities,
    before:summarizeActivities(previous.activities), after:summarizeActivities(activities),
  }};
}
