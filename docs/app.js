// 跟随 app.js 自身的 ?v= 版本号加载依赖，避免改动后浏览器仍用缓存的旧模块。
const version = new URL(import.meta.url).searchParams.get('v');
const {createJournal, createRecentSection, beijingDate, formatTime, formatDistance, validateData, syncTimestamp, renderGearLibrary, renderDayRecords, renderYearOptions, renderSportFilter, availableYears, dayMetricState, describeDay, dayStateLabels} = await import('./journal.mjs' + (version ? '?v=' + version : ''));
const {sportLabel} = await import('./activity-data.mjs' + (version ? '?v=' + version : ''));
const {initializeHistory} = await import('./history.mjs' + (version ? '?v=' + version : ''));
const {renderCalendar, moveCalendarDate} = await import('./calendar.mjs' + (version ? '?v=' + version : ''));
const {initializeTrends} = await import('./trends.mjs' + (version ? '?v=' + version : ''));
const {initializePersonalBests} = await import('./personal-bests.mjs' + (version ? '?v=' + version : ''));
const {initializeMilestones} = await import('./milestones.mjs' + (version ? '?v=' + version : ''));
const {initializeReports} = await import('./reports.mjs' + (version ? '?v=' + version : ''));
const refreshPersonalBests = initializePersonalBests(JSON.parse(document.getElementById('personal-bests-data').textContent));
let data = JSON.parse(document.getElementById('journal-data').textContent);
let daily, byDate, buttons, buttonByDate;
let renderedData, renderedDate, renderedGear;
const siteTitle = document.querySelector('meta[property="og:title"]').content;
const dateInput = document.getElementById('selected-date');
const description = document.getElementById('day-description');
const dayRecords = document.getElementById('day-records');
const yearSelect = document.getElementById('activity-year');
const updateHistory = initializeHistory(data);
const updateTrends = initializeTrends(data);
const updateMilestones = initializeMilestones(data);
const updateReports = initializeReports(data, document.getElementById('title').textContent);
// 先展开所属车辆，再由原生锚点定位；其余车辆保持各自的展开状态。
document.querySelector('.gear-library').addEventListener('click', event => {
  const link = event.target.closest('[data-gear-target]');
  if (!link) return;
  const part = document.getElementById(link.dataset.gearTarget);
  const bike = part?.closest('.gear-bike');
  if (!bike) return;
  bike.open = true;
  part.focus({preventScroll:true});
});
let selectedDate;
let metric = 'distanceKm';
let sport = '';
let recentRange = 'rolling';
const calendarGrid = document.getElementById('calendar-days');
const calendarPrevious = document.getElementById('calendar-previous');
const calendarNext = document.getElementById('calendar-next');
function selectDay(date, focus = false, view = 'year') {
  if (!byDate.has(date)) return;
  selectedDate = date;
  dateInput.value = date;
  for (const button of buttons) {
    const active = button.dataset.date === date;
    button.tabIndex = active ? 0 : -1;
    button.setAttribute('aria-current', String(active));
  }
  const day = byDate.get(date);
  description.textContent = describeDay(day);
  dayRecords.innerHTML = renderDayRecords(day.records);
  dayRecords.hidden = day.records.length === 0;
  const month = date.slice(0, 7);
  document.getElementById('calendar-month').textContent = date.slice(0, 4) + ' 年 ' + Number(date.slice(5, 7)) + ' 月';
  calendarPrevious.disabled = month === daily[0].date.slice(0, 7);
  calendarNext.disabled = month === daily.at(-1).date.slice(0, 7);
  calendarGrid.innerHTML = renderCalendar(daily, date, metric, beijingDate());
  if (focus) (view === 'month' ? calendarGrid.querySelector('[data-date="' + date + '"]') : buttonByDate.get(date))?.focus();
}
function render() {
  for (const day of daily) {
    const button = buttonByDate.get(day.date);
    const state = dayMetricState(day, metric);
    button.dataset.level = state.level;
    button.dataset.state = state.state;
    button.dataset.unavailable = String(state.unavailable);
    button.setAttribute('aria-label', state.label);
    button.title = describeDay(day);
  }
  for (const button of document.querySelectorAll('[data-metric]')) button.setAttribute('aria-pressed', String(button.dataset.metric === metric));
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
calendarGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (button) selectDay(button.dataset.date, true, 'month');
});
calendarGrid.addEventListener('keydown', event => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  const date = moveCalendarDate(button.dataset.date, event.key);
  if (date === undefined) return;
  event.preventDefault();
  selectDay([daily[0].date, date, daily.at(-1).date].sort()[1], true, 'month');
});
for (const [button, key] of [[calendarPrevious, 'PageUp'], [calendarNext, 'PageDown']]) {
  button.addEventListener('click', () => {
    if (!button.disabled) selectDay([daily[0].date, moveCalendarDate(selectedDate, key), daily.at(-1).date].sort()[1]);
  });
}
for (const button of document.querySelectorAll('[data-activity-view]')) button.addEventListener('click', () => {
  const view = button.dataset.activityView;
  document.querySelector('.heatmap-card').dataset.mobileView = view;
  for (const toggle of document.querySelectorAll('[data-activity-view]')) toggle.setAttribute('aria-pressed', String(toggle.dataset.activityView === view));
  if (view === 'year') buttonByDate.get(selectedDate)?.scrollIntoView({block:'nearest', inline:'nearest'});
});
document.getElementById('back-to-today').addEventListener('click', () => {
  const today = beijingDate();
  if (!byDate.has(today)) {
    yearSelect.value = 'recent';
    selectedDate = today;
    renderJournal();
  } else selectDay(today);
  if (matchMedia('(min-width: 601px)').matches || document.querySelector('.heatmap-card').dataset.mobileView === 'year') {
    buttonByDate.get(today)?.scrollIntoView({block:'nearest', inline:'nearest'});
  }
});
yearSelect.addEventListener('change', () => {
  selectedDate = undefined;
  renderJournal();
});
document.querySelector('.recent-summary').addEventListener('click', event => {
  const button = event.target.closest('[data-recent-range]');
  if (!button || button.dataset.recentRange === recentRange) return;
  recentRange = button.dataset.recentRange;
  updateRecentSection(createRecentSection(data, beijingDate(), recentRange), recentRange);
});
document.getElementById('sport-filter').addEventListener('click', event => {
  const chip = event.target.closest('[data-sport]');
  if (!chip) return;
  sport = sport === chip.dataset.sport ? '' : chip.dataset.sport;
  // 切换类型只影响年度范围；最近一周、历史查询和装备库各自独立。
  renderJournal();
});
function updateRecentSection(section, focusRange) {
  const summary = document.querySelector('.recent-summary');
  summary.innerHTML = section.summary;
  summary.setAttribute('aria-label', section.title + '运动摘要');
  document.getElementById('recent-records-title').textContent = section.title;
  document.getElementById('recent-records-status').textContent = section.status;
  document.querySelector('.records-grid').innerHTML = section.cards;
  if (focusRange) summary.querySelector('[data-recent-range="' + focusRange + '"]')?.focus({preventScroll:true});
}
function renderJournal() {
  const focusedCalendarDate = document.activeElement?.matches('.calendar-day[data-date]') ? document.activeElement.dataset.date : null;
  const focusedDate = document.activeElement?.matches('.day-cell[data-date]') ? document.activeElement.dataset.date : null;
  const focusedSport = document.activeElement?.closest?.('#sport-filter') ? document.activeElement.dataset.sport : undefined;
  const today = beijingDate();
  const range = availableYears(data, today).includes(yearSelect.value) ? yearSelect.value : 'recent';
  if (sport && !data.activities.some(activity => activity.sport === sport)) sport = '';
  yearSelect.innerHTML = renderYearOptions(data, today);
  yearSelect.value = range;
  const journal = createJournal(data, today, range, sport, recentRange);
  const snapshot = JSON.stringify(data);
  const updateRecent = snapshot !== renderedData || today !== renderedDate;
  if (updateRecent) updateTrends(data, today);
  if (updateRecent) updateMilestones(data);
  if (renderedData !== undefined && updateRecent) updateReports(data, today);
  if (updateRecent) updateRecentSection({
    summary:journal.recentSummary,
    title:journal.recentTitle,
    status:journal.recentStatus,
    cards:journal.cards,
  });
  const {period, distance, duration, activities, activeDays, missingDistance, unavailableCount} = journal;
  const pretty = date => date.replaceAll('-', '.');
  const rangeLabel = range === 'recent' ? '最近一年' : range + ' 年';
  document.querySelector('.overview-range').textContent = rangeLabel;
  document.querySelector('.year-number').textContent = journal.daily.length;
  document.querySelector('.metrics').setAttribute('aria-label', rangeLabel + '运动概览');
  document.title = siteTitle + ' · ' + rangeLabel;
  document.querySelector('.period').innerHTML = '<time datetime="' + period.start + '">' + pretty(period.start) + '</time> — <time datetime="' + period.end + '">' + pretty(period.end) + '</time>';
  document.getElementById('sport-filter').innerHTML = renderSportFilter(journal.sports, sport);
  document.getElementById('sport-filter-status').textContent = sport ? '已筛选：' + sportLabel(sport) + ' · ' + activities.length + ' 次' : '';
  const values = document.querySelectorAll('.metric-value');
  values[0].innerHTML = (distance === null ? '—' : formatDistance(distance)) + '<small>km</small>';
  values[1].innerHTML = formatTime(duration);
  values[1].setAttribute('aria-label', Math.floor(duration / 3600) + ' 小时 ' + Math.floor(duration % 3600 / 60) + ' 分 ' + duration % 60 + ' 秒');
  values[2].innerHTML = activities.length + '<small>次</small>';
  const notes = document.querySelectorAll('.metric-note');
  notes[0].textContent = missingDistance ? missingDistance + ' 次距离未提供' : '';
  notes[0].hidden = !missingDistance;
  notes[1].textContent = '时 : 分 : 秒';
  notes[2].textContent = activeDays + ' 个活跃日' + (unavailableCount ? ' · ' + unavailableCount + ' 条详情不可读取' : '');
  grid.innerHTML = journal.cells;
  document.querySelector('.heatmap').style.setProperty('--columns', journal.columns);
  document.querySelector('.month-labels').innerHTML = journal.monthLabels;
  // 装备独立于年度统计，内容未变化时保留节点、展开状态和焦点。
  const gear = renderGearLibrary(data.gearLibrary);
  if (gear !== renderedGear) {
    document.querySelector('.gear-library').innerHTML = gear;
    renderedGear = gear;
  }
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
  if (focusedCalendarDate) calendarGrid.querySelector('[data-date="' + focusedCalendarDate + '"]')?.focus({preventScroll:true});
  if (focusedSport !== undefined) [...document.querySelectorAll('#sport-filter [data-sport]')].find(chip => chip.dataset.sport === focusedSport)?.focus({preventScroll:true});
  if (renderedData !== undefined && snapshot !== renderedData) updateHistory(data);
  renderedData = snapshot;
  renderedDate = today;
}

const status = document.getElementById('sync-status');
let refreshing = false;
async function refreshActivities() {
  status.textContent = '正在读取最新数据…';
  try {
    const response = await fetch(new URL('activities.json', import.meta.url), {cache:'no-cache', signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('数据请求失败');
    const latest = await response.json();
    validateData(latest);
    if (syncTimestamp(latest.syncedAt) < syncTimestamp(data.syncedAt)) throw new Error('服务器数据尚未更新');
    data = latest;
    status.textContent = '';
  } catch {
    status.textContent = '暂时无法读取最新数据，当前显示最近成功同步的记录。';
  } finally {
    if (JSON.stringify(data) !== renderedData || beijingDate() !== renderedDate) renderJournal();
  }
}
async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    await Promise.all([refreshActivities(), refreshPersonalBests()]);
  } finally {
    refreshing = false;
  }
}
renderJournal();
refreshData();
window.addEventListener('pageshow', event => {if (event.persisted) refreshData();});
document.addEventListener('visibilitychange', () => {if (!document.hidden) refreshData();});
setInterval(() => {if (!document.hidden) refreshData();}, 5 * 60000);

