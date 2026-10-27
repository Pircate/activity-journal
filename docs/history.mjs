const version = new URL(import.meta.url).searchParams.get('v');
const {escapeHtml, isDate, renderDayRecords, dayStateLabels, compareActivityDates} = await import('./journal.mjs' + (version ? '?v=' + version : ''));

export const historyPageSize = 20;
const {sportLabel} = await import('./activity-data.mjs' + (version ? '?v=' + version : ''));

export function filterActivities(activities, {start = '', end = '', sport = '', minDistance = null, maxDistance = null, sort = 'date-desc'} = {}) {
  if (start && !isDate(start) || end && !isDate(end)) throw new Error('请输入有效日期。');
  if (start && end && start > end) throw new Error('开始日期不能晚于结束日期。');
  for (const value of [minDistance, maxDistance]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('距离必须是大于或等于 0 的数字。');
  }
  if (minDistance !== null && maxDistance !== null && minDistance > maxDistance) throw new Error('最短距离不能大于最长距离。');
  if (!['date-desc', 'date-asc', 'distance-desc', 'distance-asc', 'duration-desc', 'duration-asc'].includes(sort)) throw new Error('请选择有效的排序方式。');
  const records = activities.filter(activity => (!start || activity.date >= start) && (!end || activity.date <= end) &&
    (!sport || activity.sport === sport) &&
    (minDistance === null || activity.distanceKm !== null && activity.distanceKm >= minDistance) &&
    (maxDistance === null || activity.distanceKm !== null && activity.distanceKm <= maxDistance));
  const ascending = sort.endsWith('asc');
  return records.sort((a, b) => {
    if (sort.startsWith('date')) return ascending ? compareActivityDates(b, a) : compareActivityDates(a, b);
    if (sort.startsWith('distance') && (a.distanceKm === null || b.distanceKm === null)) {
      return Number(a.distanceKm === null) - Number(b.distanceKm === null) || compareActivityDates(a, b);
    }
    const difference = sort.startsWith('distance') ? a.distanceKm - b.distanceKm : a.durationSeconds - b.durationSeconds;
    return (ascending ? difference : -difference) || compareActivityDates(a, b);
  });
}

export function initializeHistory(initialData) {
  let data = initialData;
  let filters = {};
  let page = 1;
  const form = document.getElementById('history-filters');
  const fields = Object.fromEntries(['start', 'end', 'sport', 'min-distance', 'max-distance', 'sort']
    .map(name => [name, document.getElementById('history-' + name)]));
  const results = document.getElementById('history-results');
  const count = document.getElementById('history-count');
  const error = document.getElementById('history-error');
  const previous = document.getElementById('history-previous');
  const next = document.getElementById('history-next');
  let sportOptions;

  function render() {
    const records = filterActivities(data.activities, filters);
    const pages = Math.max(1, Math.ceil(records.length / historyPageSize));
    page = Math.min(page, pages);
    const start = (page - 1) * historyPageSize;
    results.innerHTML = records.length ? renderDayRecords(records.slice(start, start + historyPageSize), '历史运动记录') :
      '<p class="history-empty">' + (data.activities.length ? '没有符合条件的运动记录，请调整筛选条件或重置。' : '尚无可读取的历史运动记录。') + '</p>';
    count.textContent = records.length ? `共 ${records.length} 条　显示第 ${start + 1}–${Math.min(start + historyPageSize, records.length)} 条` : '共 0 条';
    document.getElementById('history-page').textContent = `第 ${page} / ${pages} 页`;
    previous.disabled = page === 1;
    next.disabled = page === pages;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const candidate = {start:fields.start.value, end:fields.end.value, sport:fields.sport.value,
      minDistance:fields['min-distance'].value === '' ? null : Number(fields['min-distance'].value),
      maxDistance:fields['max-distance'].value === '' ? null : Number(fields['max-distance'].value),
      sort:fields.sort.value || 'date-desc'};
    try {
      filterActivities(data.activities, candidate);
    } catch (failure) {
      error.textContent = failure.message + ' 当前列表仍为上次筛选结果。';
      error.hidden = false;
      return;
    }
    filters = candidate;
    page = 1;
    error.hidden = true;
    render();
  });
  document.getElementById('history-reset').addEventListener('click', () => {
    for (const [name, field] of Object.entries(fields)) field.value = name === 'sort' ? 'date-desc' : '';
    filters = {};
    page = 1;
    error.hidden = true;
    render();
  });
  previous.addEventListener('click', () => { if (!previous.disabled) { page--; render(); } });
  next.addEventListener('click', () => { if (!next.disabled) { page++; render(); } });

  function update(latest) {
    data = latest;
    const options = '<option value="">全部运动</option>' + [...new Set(data.activities.map(activity => activity.sport))]
      .sort((a, b) => sportLabel(a).localeCompare(sportLabel(b), 'zh-CN')).map(sport => `<option value="${escapeHtml(sport)}">${escapeHtml(sportLabel(sport))}</option>`).join('');
    if (options !== sportOptions) {
      const selected = fields.sport.value;
      fields.sport.innerHTML = options;
      // 保留正在填写的类型，即使本次同步已不再包含该类型。
      if (selected && !data.activities.some(activity => activity.sport === selected)) {
        fields.sport.innerHTML += `<option value="${escapeHtml(selected)}">${escapeHtml(sportLabel(selected))}</option>`;
      }
      fields.sport.value = selected;
      sportOptions = options;
    }
    document.getElementById('history-total').textContent = `${data.activities.length} 条活动`;
    const unavailable = data.unavailableActivities.length;
    const note = document.getElementById('history-note');
    // 与热力图、统计说明共用同一措辞，避免把“详情不可读取”写成另一种缺失。
    note.textContent = unavailable ? `全部历史另有 ${unavailable} 条${dayStateLabels.unavailable}的记录，未列入此列表。` : '';
    note.hidden = unavailable === 0;
    render();
  }
  update(data);
  return update;
}
