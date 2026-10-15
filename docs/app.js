// 跟随 app.js 自身的 ?v= 版本号加载依赖，避免改动后浏览器仍用缓存的旧模块。
const version = new URL(import.meta.url).searchParams.get('v');
const {createJournal, beijingDate, formatTime, escapeHtml, validateData, syncTimestamp} = await import('./journal.mjs' + (version ? '?v=' + version : ''));
let data = JSON.parse(document.getElementById('journal-data').textContent);
let daily, byDate, buttons, buttonByDate;
const dateInput = document.getElementById('selected-date');
const description = document.getElementById('day-description');
const explanation = document.getElementById('metric-explanation');
const metrics = {
  distanceKm: { label: '距离', thresholds: [10, 30, 60], format: value => value.toFixed(2) + ' 公里', missing: 'missingDistance' },
  durationSeconds: { label: '时长', thresholds: [1800, 3600, 7200], format: formatTime },
  trainingLoad: { label: '负荷', thresholds: [50, 150, 300], format: value => String(value), missing: 'missingLoad' }
};
let selectedDate;
let metric = 'distanceKm';
function display(day, key) {
  if (day.count === 0) return key === 'durationSeconds' ? '0:00:00' : metrics[key].format(0);
  const missing = metrics[key].missing && day[metrics[key].missing];
  if (day[key] === null || missing === day.count) return '未提供';
  return metrics[key].format(day[key]) + (missing ? '（' + missing + ' 次未提供）' : '');
}
function sentence(day) {
  if (day.pending) return day.date + ' · 尚未同步该日期的运动记录';
  return day.date + ' · ' + day.count + ' 次运动 · ' + display(day, 'distanceKm') + ' · ' + display(day, 'durationSeconds') + ' · 负荷 ' + display(day, 'trainingLoad') + (day.unavailable ? ' · 另有 ' + day.unavailable + ' 次运动详情无法读取（日期为平台当地日期），未计入统计' : '');
}
function selectDay(date, focus = false) {
  if (!byDate.has(date)) return;
  selectedDate = date;
  dateInput.value = date;
  for (const button of buttons) {
    const active = button.dataset.date === date;
    button.tabIndex = active ? 0 : -1;
    button.setAttribute('aria-current', String(active));
  }
  description.textContent = sentence(byDate.get(date));
  if (focus) buttonByDate.get(date).focus();
}
function render() {
  const spec = metrics[metric];
  for (const day of daily) {
    const button = buttonByDate.get(day.date);
    const value = day[metric];
    const missing = spec.missing && day[spec.missing];
    const entirelyMissing = day.count > 0 && (value === null || missing === day.count);
    button.dataset.level = day.pending || entirelyMissing || day.unavailable && day.count === 0 ? 'missing' : day.count === 0 || value === 0 ? '0' : String(1 + spec.thresholds.filter(threshold => value >= threshold).length);
    button.dataset.missing = String(Boolean(day.unavailable || missing && !entirelyMissing));
    button.setAttribute('aria-label', day.unavailable ? sentence(day) : day.pending ? day.date + '，尚未同步' : day.date + '，' + day.count + ' 次运动，' + spec.label + ' ' + display(day, metric));
    button.title = sentence(day);
  }
  for (const button of document.querySelectorAll('[data-metric]')) button.setAttribute('aria-pressed', String(button.dataset.metric === metric));
  const ranges = {
    distanceKm: '10 / 30 / 60 公里',
    durationSeconds: '30 / 60 / 120 分钟',
    trainingLoad: '50 / 150 / 300'
  };
  explanation.textContent = '颜色越亮，累计' + spec.label + '越多 · 分级界限 ' + ranges[metric];
  selectDay(selectedDate);
}
for (const button of document.querySelectorAll('[data-metric]')) button.addEventListener('click', () => {
  metric = button.dataset.metric;
  render();
});
const grid = document.querySelector('.day-grid');
grid.addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (button) selectDay(button.dataset.date);
});
grid.addEventListener('keydown', event => {
    const button = event.target.closest('[data-date]');
    if (!button) return;
    const index = daily.findIndex(day => day.date === button.dataset.date);
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? daily.length - 1 : step === undefined ? undefined : index + step;
    if (target === undefined) return;
    event.preventDefault();
    selectDay(daily[Math.max(0, Math.min(daily.length - 1, target))].date, true);
});
dateInput.addEventListener('change', () => {
  if (dateInput.validity.valid && byDate.has(dateInput.value)) selectDay(dateInput.value);
  else dateInput.value = selectedDate;
});
function renderJournal() {
  const focusedDate = document.activeElement?.matches('.day-cell[data-date]') ? document.activeElement.dataset.date : null;
  const journal = createJournal(data, beijingDate());
  const {period, distance, duration, activities, recent, activeDays, missingDistance, missingLoad, unavailableCount} = journal;
  const pretty = date => date.replaceAll('-', '.');
  document.querySelector('.period').innerHTML = '<time datetime="' + period.start + '">' + pretty(period.start) + '</time> — <time datetime="' + period.end + '">' + pretty(period.end) + '</time>';
  document.querySelector('.legend').innerHTML = journal.sports.map(s => '<span class="legend-item">' + escapeHtml(s.sport) + ' ' + s.count + ' 次</span>').join('');
  const values = document.querySelectorAll('.metric-value');
  values[0].innerHTML = distance.toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2}) + '<small>公里</small>';
  values[1].innerHTML = Math.floor(duration / 3600) + '<small>小时</small>';
  values[1].setAttribute('aria-label', Math.floor(duration / 3600) + ' 小时 ' + Math.floor(duration % 3600 / 60) + ' 分 ' + duration % 60 + ' 秒');
  values[2].innerHTML = activities.length + '<small>次</small>';
  const notes = document.querySelectorAll('.metric-note');
  notes[0].textContent = missingDistance ? '已记录距离 · ' + missingDistance + ' 次运动未提供距离' : '可读取运动的总距离';
  notes[1].textContent = '精确时长 ' + formatTime(duration);
  notes[2].textContent = activeDays + ' 天记录了运动' + (unavailableCount ? ' · 另有 ' + unavailableCount + ' 次详情无法读取' : '');
  grid.innerHTML = journal.cells;
  document.querySelector('.heatmap').style.setProperty('--columns', journal.columns);
  document.querySelector('.month-labels').innerHTML = journal.monthLabels;
  document.querySelector('.records-grid').innerHTML = journal.cards;
  document.querySelector('.records-section .section-head p').textContent = recent.length ? '共 ' + recent.length + ' 条 · 最新记录在前' : '最近一周还没有运动记录';
  document.querySelector('.chart-caption').textContent = '每格代表一天，同一天的多次运动合并统计。灰色表示没有运动记录；斜线表示该指标未提供或该日期尚未同步。负荷为 Intervals.icu 的活动训练负荷。' + (missingLoad ? ' ' + missingLoad + ' 次运动未提供负荷，统计时保留缺失标记。' : '') + (unavailableCount ? ' 另有 ' + unavailableCount + ' 次 Strava 运动详情无法读取，未计入距离、时长和次数；对应日期按平台当地日期标注缺失。' : '');
  dateInput.min = period.start;
  dateInput.max = period.end;
  daily = journal.daily;
  byDate = new Map(daily.map(day => [day.date, day]));
  buttons = [...grid.querySelectorAll('[data-date]')];
  buttonByDate = new Map(buttons.map(button => [button.dataset.date, button]));
  if (!byDate.has(selectedDate)) selectedDate = journal.initialDate;
  const syncTime = document.getElementById('sync-time');
  syncTime.textContent = data.syncedAt.replace(' +08:00', '').replaceAll('-', '.');
  syncTime.dateTime = data.syncedAt.replace(' ', 'T').replace(' +08:00', '+08:00');
  render();
  if (focusedDate) buttonByDate.get(focusedDate)?.focus({preventScroll:true});
}

const status = document.getElementById('sync-status');
let refreshing = false;
async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  status.textContent = '正在读取最新数据…';
  try {
    const response = await fetch(new URL('activities.json', import.meta.url), {cache:'no-store', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('数据请求失败');
    const latest = await response.json();
    validateData(latest);
    if (syncTimestamp(latest.syncedAt) < syncTimestamp(data.syncedAt)) throw new Error('服务器数据尚未更新');
    data = latest;
    renderJournal();
    const age = Date.now() - syncTimestamp(data.syncedAt);
    const upToDate = data.period.end >= beijingDate() && age <= 26 * 3600000;
    status.textContent = upToDate ? '已读取最新已同步数据' : '显示最近成功同步的数据，每天 22:00 随运动同步任务更新。';
  } catch {
    status.textContent = '暂时无法读取最新数据，当前显示最近成功同步的记录。';
  } finally {
    refreshing = false;
  }
}
renderJournal();
refreshData();
window.addEventListener('pageshow', event => {if (event.persisted) refreshData();});
document.addEventListener('visibilitychange', () => {if (!document.hidden) refreshData();});
setInterval(() => {if (!document.hidden) refreshData();}, 5 * 60000);
if (matchMedia('(max-width: 600px)').matches) {
  const scroller = document.querySelector('.heatmap-scroll');
  scroller.scrollLeft = scroller.scrollWidth;
}

