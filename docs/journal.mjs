export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatTime = seconds => Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
const sportIcon = sport => {
  const paths = sport === '徒步'
    ? '<circle cx="17" cy="4" r="2" fill="currentColor" stroke="none"/><path d="m14 9-3 7-5 4m8-11 5 5 5 1m-10-6 4 10-1 9m-4-10-3 10m14-14 2 14M9 8l-2 7 4 1"/>'
    : sport.includes('骑行')
      ? '<circle cx="7" cy="23" r="6"/><circle cx="25" cy="23" r="6"/><circle cx="22" cy="5" r="2" fill="currentColor" stroke="none"/><path d="m16 8-5 6 7 4-2 7m0-17 6 6h5m-6 0 4 9M7 23l5-9"/>'
      : '<path d="M2 17h6l4-11 7 21 4-10h7"/>';
  return '<svg class="record-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
};

function recordCard(activity) {
  const {date, sport, distanceKm, duration, trainingLoad} = activity;
  const seconds = duration.split(':').reduce((value, part) => value * 60 + Number(part), 0);
  const speed = distanceKm !== null && seconds > 0 ? (distanceKm * 3600 / seconds).toFixed(1) : null;
  const weekday = new Intl.DateTimeFormat('zh-CN', {timeZone:'UTC', weekday:'long'}).format(new Date(date + 'T00:00:00Z'));
  const distance = distanceKm === null ? '<span class="record-distance-missing">未记录距离</span>' : distanceKm.toFixed(2) + '<small>km</small>';
  return `<article class="record-card${sport === '徒步' ? ' hike' : ''}">
    <div class="record-body">
      <h3 class="record-distance">${sportIcon(sport)}<span><span class="sr-only">距离 </span>${distance}</span></h3>
      <div class="record-meta"><span><span class="sr-only">运动时长 </span>${escapeHtml(duration)}</span>${speed === null ? '' : '<span><span class="sr-only">平均速度 </span>' + speed + '<small>km/h</small></span>'}</div>
      <p class="record-details"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日</time><span>${weekday}</span><span class="record-sport">${escapeHtml(sport)}</span></p>
    </div>
    <div class="record-load"><span class="record-load-value${trainingLoad === null ? ' missing' : ''}">${trainingLoad ?? '未记录'}</span><span class="record-load-label">训练负荷</span></div>
  </article>`;
}
export const beijingDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
export const syncTimestamp = value => Date.parse(value.replace(' ', 'T').replace(' +08:00', '+08:00'));
export function validateData(data) {
  const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!data || Object.keys(data).sort().join(',') !== 'activities,period,syncedAt' || !isDate(data.period?.start) || !isDate(data.period?.end) || Object.keys(data.period).sort().join(',') !== 'end,start' || data.period.start > data.period.end || !Array.isArray(data.activities) || typeof data.syncedAt !== 'string' || !/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d \+08:00$/.test(data.syncedAt) || !Number.isFinite(syncTimestamp(data.syncedAt))) throw new Error('运动数据格式无效');
  for (const a of data.activities) {
    if (!a || Object.keys(a).sort().join(',') !== 'date,distanceKm,duration,sport,trainingLoad' || !isDate(a.date) || a.date < data.period.start || a.date > data.period.end || typeof a.sport !== 'string' || !a.sport || typeof a.duration !== 'string' || !/^\d+(?::[0-5]\d){1,2}$/.test(a.duration) || ![a.distanceKm,a.trainingLoad].every(v => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new Error('运动记录格式无效');
  }
}
export function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function createJournal(data, endDate = data.period.end) {
  const period = {start:shiftDate(endDate, -364), end:endDate};
  const activities = data.activities.filter(a => a.date >= period.start && a.date <= period.end).slice().sort((a,b) => b.date.localeCompare(a.date));
  const recent = activities.filter(a => a.date >= shiftDate(period.end, -6));
  const daily = [];
  for (let date = period.start; date <= period.end; date = shiftDate(date, 1)) {
    const records = activities.filter(a => a.date === date);
    daily.push({date, count:records.length, pending:date > data.period.end,
      distanceKm:records.reduce((s,a) => s + Math.round((a.distanceKm ?? 0) * 100), 0) / 100,
      durationSeconds:records.reduce((s,a) => s + a.duration.split(':').reduce((v,n) => v * 60 + Number(n), 0), 0),
      trainingLoad:records.length && records.every(a => a.trainingLoad === null) ? null : records.reduce((s,a) => s + (a.trainingLoad ?? 0), 0),
      missingDistance:records.filter(a => a.distanceKm === null).length,
      missingLoad:records.filter(a => a.trainingLoad === null).length});
  }
  const distance = daily.reduce((s,d) => s + Math.round(d.distanceKm * 100), 0) / 100;
  const duration = daily.reduce((s,d) => s + d.durationSeconds, 0);
  const activeDays = daily.filter(d => d.count > 0).length;
  const missingDistance = activities.filter(a => a.distanceKm === null).length;
  const missingLoad = activities.filter(a => a.trainingLoad === null).length;
  const sports = [...new Set(activities.map(a => a.sport))].map(sport => ({sport, count:activities.filter(a => a.sport === sport).length}));
  const first = new Date(period.start + 'T00:00:00Z');
  const last = new Date(period.end + 'T00:00:00Z');
  const start = shiftDate(period.start, -((first.getUTCDay() + 6) % 7));
  const end = shiftDate(period.end, (7 - last.getUTCDay()) % 7);
  const byDate = new Map(daily.map(d => [d.date, d]));
  const padded = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) padded.push(byDate.get(date) ?? {date, padding:true});
  const columns = padded.length / 7;
  const cells = padded.map(d => d.padding ? '<span class="day-cell padding" aria-hidden="true"></span>' : '<button class="day-cell" type="button" data-date="' + d.date + '" tabindex="-1" aria-label="' + d.date + '，' + (d.pending ? '尚未同步' : d.count + ' 次运动') + '"></button>').join('');
  const months = [];
  padded.forEach((d,i) => {if(d.date.endsWith('-01') && d.date >= period.start && d.date <= period.end) months.push({column:Math.floor(i/7)+1, label:Number(d.date.slice(5,7))+'月'});});
  const monthLabels = months.map((m,i) => '<span style="grid-column:' + m.column + '/' + (months[i+1]?.column ?? columns+1) + '">' + m.label + '</span>').join('');
  const cards = recent.length ? recent.map(recordCard).join('') : '<p class="records-empty">最近一周还没有运动记录。</p>';
  const initialDate = daily.findLast(d => d.count > 0)?.date ?? period.end;
  return {activities, recent, period, syncedAt:data.syncedAt, daily, distance, duration, activeDays, missingDistance, missingLoad, sports, columns, cells, monthLabels, cards, initialDate};
}
