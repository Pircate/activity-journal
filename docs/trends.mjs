const version = new URL(import.meta.url).searchParams.get('v');
const {escapeHtml, formatTime, beijingDate, renderDayRecords, renderYearOptions, availableYears, dayStateLabels, dayStateNotes} = await import('./journal.mjs' + (version ? '?v=' + version : ''));
const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const monthStart = date => date.slice(0, 7) + '-01';
const nextMonth = date => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10);
const weekStart = date => shift(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7));
const daysBetween = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
const pretty = date => date.replaceAll('-', '.');
const pageSize = 20;
const metrics = {
  distanceKm:{label:'距离', unit:'公里', format:value => value.toLocaleString('zh-CN', {maximumFractionDigits:2}), missing:'missingDistance'},
  durationSeconds:{label:'时长', unit:'', format:formatTime},
  count:{label:'次数', unit:'次', format:String},
  trainingLoad:{label:'负荷', unit:'', format:value => value.toLocaleString('zh-CN', {maximumFractionDigits:1}), missing:'missingLoad'},
};

export function createTrends(data, range = 'recent', mode = 'month', today = beijingDate(), sport = '') {
  const start = range === 'recent' ? shift(today, -364) : range + '-01-01';
  const end = range === 'recent' ? today : [range + '-12-31', today].sort()[0];
  const align = mode === 'week' ? weekStart : monthStart;
  // 受限记录没有类型信息，按运动类型筛选时整体排除。
  const activities = sport ? data.activities.filter(activity => activity.sport === sport) : data.activities;
  const unavailableActivities = sport ? [] : data.unavailableActivities;
  function summarize(first, last) {
    const records = activities.filter(a => a.date >= first && a.date <= last).slice().sort((a, b) => b.date.localeCompare(a.date));
    const missingDistance = records.filter(a => a.distanceKm === null).length;
    const missingLoad = records.filter(a => a.trainingLoad === null).length;
    return {start:first, end:last, records, count:records.length,
      distanceKm:records.length && missingDistance === records.length ? null : records.reduce((sum, a) => sum + Math.round((a.distanceKm ?? 0) * 100), 0) / 100,
      durationSeconds:records.reduce((sum, a) => sum + a.duration.split(':').reduce((value, part) => value * 60 + Number(part), 0), 0),
      trainingLoad:records.length && missingLoad === records.length ? null : records.reduce((sum, a) => sum + (a.trainingLoad ?? 0), 0),
      missingDistance, missingLoad,
      unavailable:unavailableActivities.filter(a => a.date >= first && a.date <= last).length,
      pending:first < data.period.start || last > data.period.end};
  }
  const periods = [];
  for (let first = align(start); first <= end;) {
    const next = mode === 'week' ? shift(first, 7) : nextMonth(first);
    const last = shift(next, -1);
    const cutoff = last > today ? today : last;
    const previousStart = mode === 'week' ? shift(first, -7) : monthStart(shift(first, -1));
    const previousEnd = shift(first, -1);
    const ongoing = last > today;
    const comparedEnd = ongoing ? [shift(previousStart, daysBetween(first, cutoff)), previousEnd].sort()[0] : previousEnd;
    periods.push({...summarize(first, cutoff), fullEnd:last, ongoing, previous:summarize(previousStart, comparedEnd)});
    first = next;
  }
  return periods;
}

export function compareTrend(current, previous, key) {
  const missing = metrics[key].missing;
  if (current.pending || previous.pending || current.unavailable || previous.unavailable ||
      missing && (current[missing] || previous[missing])) return '数据不完整，暂不比较';
  if (current[key] === previous[key]) return '持平';
  if (previous[key] === 0) return '上周期为 0';
  const change = (current[key] - previous[key]) / previous[key] * 100;
  return (change > 0 ? '增加 ' : '减少 ') + Math.abs(change).toFixed(1) + '%';
}

function valueText(period, key) {
  const spec = metrics[key];
  if (period[key] === null) return '未提供';
  // 周期内没有可读取活动时，明确写出是未同步还是详情不可读取，而不是笼统的“未提供”。
  if (!period.count && period.pending) return dayStateLabels.pending;
  if (!period.count && period.unavailable) return dayStateLabels.unavailable;
  return spec.format(period[key]) + (spec.unit ? ' ' + spec.unit : '');
}
const unknownTexts = new Set(['未提供', dayStateLabels.pending, dayStateLabels.unavailable]);
function notes(period) {
  const result = [];
  // 三类状态与热力图共用同一套措辞，避免同一现象在趋势里被说成另一种缺失。
  // 周期是所有日期，未同步说明用“部分日期”而不是单日口径。
  if (period.pending) result.push(dayStateLabels.pending + '：部分日期不在已同步日期范围内，或晚于北京时间今天');
  if (period.unavailable) result.push(dayStateLabels.unavailable + ' ' + period.unavailable + ' 条（' + dayStateNotes.unavailable + '），未计入统计');
  if (period.missingDistance) result.push(dayStateLabels.missing + '：' + period.missingDistance + ' 次未提供距离');
  if (period.missingLoad) result.push(dayStateLabels.missing + '：' + period.missingLoad + ' 次未提供负荷');
  return result.length ? result.join(' · ') + '；合计仅含可读取指标。' : '';
}

export function renderTrendContent(periods, {mode = 'month', metric = 'distanceKm', selected = periods.at(-1)?.start, page = 1} = {}) {
  if (!periods.length) return '<p class="history-empty">此范围尚无可查看的周期。</p>';
  const active = periods.find(period => period.start === selected) ?? periods.at(-1);
  const maximum = Math.max(1, ...periods.map(period => period[metric] ?? 0));
  const bars = periods.map(period => {
    const label = mode === 'month' ? period.start.slice(0, 7).replace('-', '.') : period.start.slice(5).replace('-', '/');
    const value = valueText(period, metric);
    const incomplete = period.pending || period.unavailable || metrics[metric].missing && period[metrics[metric].missing];
    const description = `${pretty(period.start)} — ${pretty(period.end)}，${metrics[metric].label} ${value}${incomplete ? '，数据不完整' : ''}${period.ongoing ? '，周期进行中' : ''}`;
    return `<button type="button" class="trend-bar${incomplete ? ' incomplete' : ''}" data-period="${period.start}" aria-pressed="${period.start === active.start}" aria-label="${description}" title="${description}"><span class="trend-bar-value">${unknownTexts.has(value) ? '—' : metric === 'durationSeconds' ? (period[metric] / 3600).toFixed(1) : metrics[metric].format(period[metric])}</span><span class="trend-bar-track"><span style="height:${Math.max(2, (period[metric] ?? 0) / maximum * 100).toFixed(2)}%"></span></span><span class="trend-bar-label">${label}</span></button>`;
  }).join('');
  const pages = Math.max(1, Math.ceil(active.count / pageSize));
  const currentPage = Math.min(page, pages);
  const heading = mode === 'week' ? '本周' : '本月';
  const previousLabel = mode === 'week' ? '上周' : '上月';
  const comparedLabel = previousLabel + (active.ongoing ? '同期' : '');
  return `<p class="trend-guide">点击柱条查看活动 · ${mode === 'week' ? '周一至周日' : '自然月'}汇总 · ${metrics[metric].label}${metric === 'durationSeconds' ? '（柱图单位：小时）' : metrics[metric].unit ? '（' + metrics[metric].unit + '）' : ''} · 斜线表示数据不完整 · 横向滑动查看全部周期</p>
    <div class="trend-scroll" tabindex="0" role="region" aria-label="${mode === 'week' ? '每周' : '每月'}${metrics[metric].label}趋势，可横向滚动"><div class="trend-bars" style="--periods:${periods.length}">${bars}</div></div>
    <div class="trend-selection" aria-live="polite"><div class="trend-period"><h3>${pretty(active.start)} — ${pretty(active.end)}</h3><span>${active.ongoing ? heading + '进行中 · 与' + comparedLabel + '比较' : '与' + previousLabel + '比较'}</span></div>
    <p class="trend-previous">${comparedLabel}：${pretty(active.previous.start)} — ${pretty(active.previous.end)}</p>
    <dl class="trend-stats">${Object.entries(metrics).map(([key, spec]) => `<div><dt>${spec.label}</dt><dd><span>${valueText(active, key)}</span><p>${comparedLabel} ${valueText(active.previous, key)}</p><p class="trend-change">${compareTrend(active, active.previous, key)}</p></dd></div>`).join('')}</dl>
    ${notes(active) ? '<p class="trend-note">所选周期：' + notes(active) + '</p>' : ''}${notes(active.previous) ? '<p class="trend-note">比较周期：' + notes(active.previous) + '</p>' : ''}</div>
    <div class="trend-records">${renderDayRecords(active.records.slice((currentPage - 1) * pageSize, currentPage * pageSize), '所选周期运动记录') || '<p class="history-empty">' + (active.pending || active.unavailable ? '此周期暂无可读取的运动记录。' : '此周期没有运动记录。') + '</p>'}</div>
    ${pages > 1 ? `<nav class="trend-pagination" aria-label="周期活动分页"><button type="button" data-trend-direction="previous" data-trend-page="${currentPage - 1}"${currentPage === 1 ? ' disabled' : ''}>上一页</button><span>共 ${active.count} 条 · 第 ${currentPage} / ${pages} 页</span><button type="button" data-trend-direction="next" data-trend-page="${currentPage + 1}"${currentPage === pages ? ' disabled' : ''}>下一页</button></nav>` : ''}`;
}

function renderSportOptions(data) {
  const sports = [...new Set(data.activities.map(activity => activity.sport))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return '<option value="">全部运动</option>' + sports.map(sport => `<option value="${escapeHtml(sport)}">${escapeHtml(sport)}</option>`).join('');
}

export function renderTrendPanel(data, today = beijingDate()) {
  return `<section class="trend-section" id="trends" aria-labelledby="trend-title"><div class="section-head"><h2 id="trend-title"><span class="section-number">03</span>运动趋势</h2><div class="trend-controls"><div class="year-filter"><label for="trend-year">查看范围</label><select id="trend-year">${renderYearOptions(data, today)}</select></div><div class="year-filter"><label for="trend-sport">运动类型</label><select id="trend-sport">${renderSportOptions(data)}</select></div></div></div><div class="trend-panel"><div class="trend-controls"><div class="metric-switch" role="group" aria-label="趋势汇总周期"><button type="button" data-trend-mode="week" aria-pressed="false">每周</button><button type="button" data-trend-mode="month" aria-pressed="true">每月</button></div><label class="sr-only" for="trend-metric">趋势统计指标</label><select id="trend-metric">${Object.entries(metrics).map(([key, spec]) => `<option value="${key}">${spec.label}</option>`).join('')}</select></div><p class="trend-intro">本栏目独立筛选，不受全年活动的范围和类型筛选影响。边界周／月包含完整自然周期的记录；本周／本月截至北京时间今天，与上周期相同天数比较（不超过上周期末）。按运动类型筛选时，详情不可读取的记录没有类型信息，未计入统计。训练负荷为 Intervals.icu 的活动统计值，不构成训练建议。</p><div id="trend-content">${renderTrendContent(createTrends(data, 'recent', 'month', today))}</div></div></section>`;
}

export function initializeTrends(initialData) {
  let data = initialData;
  let range = 'recent';
  let today = beijingDate();
  let mode = 'month';
  let metric = 'distanceKm';
  let sport = '';
  let selected;
  let page = 1;
  const root = document.getElementById('trend-content');
  const panel = document.querySelector('.trend-panel');
  const yearSelect = document.getElementById('trend-year');
  const sportSelect = document.getElementById('trend-sport');
  function render() {
    const periods = createTrends(data, range, mode, today, sport);
    const changedSelection = !periods.some(period => period.start === selected);
    if (changedSelection) {
      selected = periods.at(-1)?.start;
      page = 1;
    }
    page = Math.min(page, Math.max(1, Math.ceil((periods.find(period => period.start === selected)?.count ?? 0) / pageSize)));
    const focused = document.activeElement;
    const focusedPeriod = focused?.dataset?.period;
    const focusedDirection = focused?.dataset?.trendDirection;
    const scroll = root.querySelector('.trend-scroll');
    const left = scroll?.scrollLeft;
    root.innerHTML = renderTrendContent(periods, {mode, metric, selected, page});
    const nextScroll = root.querySelector('.trend-scroll');
    if (nextScroll) nextScroll.scrollLeft = changedSelection ? nextScroll.scrollWidth : left ?? nextScroll.scrollWidth;
    if (focusedPeriod) root.querySelector(`[data-period="${focusedPeriod}"]`)?.focus({preventScroll:true});
    if (focusedDirection) (root.querySelector(`[data-trend-direction="${focusedDirection}"]:not(:disabled)`) ?? root.querySelector('.trend-pagination button:not(:disabled)'))?.focus({preventScroll:true});
  }
  panel.addEventListener('click', event => {
    const period = event.target.closest('[data-period]');
    const toggle = event.target.closest('[data-trend-mode]');
    const paging = event.target.closest('[data-trend-page]');
    if (period) { selected = period.dataset.period; page = 1; }
    else if (toggle) {
      const date = createTrends(data, range, mode, today).find(period => period.start === selected)?.end ?? today;
      mode = toggle.dataset.trendMode;
      selected = (mode === 'week' ? weekStart : monthStart)(date);
      page = 1;
      for (const button of panel.querySelectorAll('[data-trend-mode]')) button.setAttribute('aria-pressed', String(button.dataset.trendMode === mode));
    } else if (paging && !paging.disabled) page = Number(paging.dataset.trendPage);
    else return;
    render();
    // 柱条和分页重绘后恢复键盘焦点。
    if (period) root.querySelector(`[data-period="${selected}"]`)?.focus({preventScroll:true});
    if (toggle) root.querySelector(`[data-period="${selected}"]`)?.scrollIntoView({block:'nearest', inline:'nearest'});
    if (paging) root.querySelector('.trend-records')?.scrollIntoView({block:'nearest'});
  });
  document.getElementById('trend-metric').addEventListener('change', event => { metric = event.target.value; render(); });
  yearSelect.addEventListener('change', () => { range = yearSelect.value; page = 1; render(); });
  sportSelect.addEventListener('change', () => { sport = sportSelect.value; page = 1; render(); });
  return (latest, nextToday) => {
    data = latest;
    today = nextToday;
    if (!availableYears(data, today).includes(range)) range = 'recent';
    if (sport && !data.activities.some(activity => activity.sport === sport)) sport = '';
    yearSelect.innerHTML = renderYearOptions(data, today);
    yearSelect.value = range;
    sportSelect.innerHTML = renderSportOptions(data);
    sportSelect.value = sport;
    render();
  };
}
