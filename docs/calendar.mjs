const version = new URL(import.meta.url).searchParams.get('v');
const {escapeHtml, beijingDate, dayMetricState, dayStateShort, describeDay} = await import('./journal.mjs' + (version ? '?v=' + version : ''));
const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const weekday = date => (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;

export function moveCalendarDate(date, key) {
  const offsets = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7, Home:-weekday(date), End:6 - weekday(date)};
  if (Object.hasOwn(offsets, key)) return shift(date, offsets[key]);
  if (key !== 'PageUp' && key !== 'PageDown') return undefined;
  const target = new Date(date + 'T00:00:00Z');
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + (key === 'PageUp' ? -1 : 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export function renderCalendar(daily, selectedDate, metric = 'distanceKm', today = beijingDate()) {
  const month = selectedDate.slice(0, 7);
  const start = month + '-01';
  const next = moveCalendarDate(start, 'PageDown');
  const days = new Map(daily.map(day => [day.date, day]));
  const cells = Array.from({length:weekday(start)}, () => '<span class="calendar-padding" aria-hidden="true"></span>');
  // 只为当月日期生成按钮；范围外日期不可选，也不当作零活动。
  for (let date = start; date < next; date = shift(date, 1)) {
    const day = days.get(date);
    const number = Number(date.slice(8));
    if (!day) {
      cells.push(`<span class="calendar-outside" aria-label="${date}，不在查看范围内">${number}</span>`);
      continue;
    }
    const state = dayMetricState(day, metric);
    const isToday = date === today;
    const label = state.label + (isToday ? '，今天' : '');
    // 三类缺失在月历里各有措辞和纹理：未同步、指标缺失、详情不可读取。
    const summary = state.state === 'pending' ? dayStateShort.pending : state.state === 'unavailable' ? dayStateShort.unavailable : state.state === 'missing' ? dayStateShort.missing : day.count + ' 次';
    cells.push(`<button type="button" class="calendar-day" data-date="${date}" data-level="${state.level}" data-state="${state.state}" data-unavailable="${state.unavailable}" aria-pressed="${date === selectedDate}"${isToday ? ' aria-current="date"' : ''} tabindex="${date === selectedDate ? '0' : '-1'}" aria-label="${escapeHtml(label)}" title="${escapeHtml(describeDay(day))}"><span class="calendar-number" aria-hidden="true">${number}${isToday ? '<small class="calendar-today">今</small>' : ''}</span><span class="calendar-count" aria-hidden="true">${summary}</span></button>`);
  }
  return cells.join('');
}
