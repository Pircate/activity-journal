export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatTime = seconds => Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
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
  const rows = activities.map(a => '<tr data-date="' + a.date + '"><td><time datetime="' + a.date + '">' + a.date.replaceAll('-','.') + '</time></td><td><span class="sport-tag ' + (a.sport === '徒步' ? 'hike-tag' : '') + '">' + escapeHtml(a.sport) + '</span></td><td class="number">' + (a.distanceKm === null ? '未记录' : a.distanceKm.toFixed(2) + '<span class="unit"> 公里</span>') + '</td><td class="number duration-cell">' + escapeHtml(a.duration) + '</td><td class="number load-cell">' + (a.trainingLoad ?? '未记录') + '</td></tr>').join('');
  const initialDate = daily.findLast(d => d.count > 0)?.date ?? period.end;
  return {activities, period, syncedAt:data.syncedAt, daily, distance, duration, activeDays, missingDistance, missingLoad, sports, columns, cells, monthLabels, rows, initialDate};
}
