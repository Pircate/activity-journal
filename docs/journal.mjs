export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 只统一展示，不改变快照精度；距离固定两位、速度固定一位、负荷最多一位。
export const formatDistance = new Intl.NumberFormat('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2}).format;
export const formatSpeed = new Intl.NumberFormat('zh-CN', {minimumFractionDigits:1, maximumFractionDigits:1}).format;
export const formatLoad = new Intl.NumberFormat('zh-CN', {maximumFractionDigits:1}).format;
export const formatTime = seconds => Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
export const durationSeconds = duration => duration.split(':').reduce((value, part) => value * 60 + Number(part), 0);
export const formatPace = secondsPerUnit => {
  const total = Math.round(secondsPerUnit);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
};
const missingMetric = {text:'未提供', html:'<span class="record-metric-missing">未提供</span>'};
const measuredMetric = (text, html) => ({text, html});
// 运动专属副指标：跑步／步行／徒步看每公里配速，游泳看每百米配速，其余有距离的运动看速度。
// 全部由 Intervals.icu 的距离与运动时长换算，缺少任一数值时按要求显示“未提供”，不推算缺失指标。
const paceSports = new Set(['跑步', '越野跑', '虚拟跑步', '步行', '徒步']);
export function sportMetric({sport, distanceKm, duration}) {
  const seconds = durationSeconds(duration);
  const measurable = distanceKm !== null && distanceKm > 0 && seconds > 0;
  if (paceSports.has(sport)) return {label:'平均配速', ...measurable ? measuredMetric(formatPace(seconds / distanceKm) + ' /km', formatPace(seconds / distanceKm) + '<small>/km</small>') : missingMetric};
  if (sport === '游泳') return {label:'每百米配速', ...measurable ? measuredMetric(formatPace(seconds / (distanceKm * 10)) + ' /100m', formatPace(seconds / (distanceKm * 10)) + '<small>/100m</small>') : missingMetric};
  return {label:'平均速度', ...measurable ? measuredMetric(formatSpeed(distanceKm * 3600 / seconds) + ' km/h', formatSpeed(distanceKm * 3600 / seconds) + '<small>km/h</small>') : missingMetric};
}
const primaryOrder = ['距离', '组数'];
const secondaryOrder = ['平均配速', '每百米配速', '平均速度', '平均心率'];
const orderedLabels = (order, labels) => order.filter(label => labels.includes(label)).join(' / ');
export const dayMetrics = {
  distanceKm:{label:'距离', thresholds:[10, 30, 60], format:value => formatDistance(value) + ' km', missing:'missingDistance'},
  durationSeconds:{label:'时长', thresholds:[1800, 3600, 7200], format:formatTime},
  trainingLoad:{label:'负荷', thresholds:[50, 150, 300], format:formatLoad, missing:'missingLoad'},
};
export function formatDayMetric(day, key) {
  const spec = dayMetrics[key];
  if (day.count === 0) return spec.format(0);
  const missing = spec.missing && day[spec.missing];
  if (day[key] === null || missing === day.count) return '未提供';
  return spec.format(day[key]) + (missing ? '（' + missing + ' 次未提供）' : '');
}
// 三种非正常状态必须彼此区分，措辞与热力图纹理共用同一份定义：
// 未同步（日期不在已同步范围）、指标缺失（活动已读取但指标为空）、详情不可读取（平台只返回当地日期）。
export const dayStateLabels = {pending:'未同步', missing:'指标缺失', unavailable:'详情不可读取'};
// 月历格子宽度有限，只在这里使用短措辞；完整口径始终以 dayStateLabels 为准。
export const dayStateShort = {pending:'未同步', missing:'指标缺失', unavailable:'不可读'};
export const dayStateNotes = {
  pending:'该日期不在已同步日期范围内，或晚于北京时间今天',
  missing:'活动已经读取，但该指标没有提供',
  unavailable:'平台只返回当地日期，没有距离、时长和运动类型',
};
export function describeDay(day) {
  if (day.pending) return day.date + ' · ' + dayStateLabels.pending + '：' + dayStateNotes.pending;
  // 只有受限记录、没有可读取活动时，先说明状态，避免读成“这天没有运动”。
  if (day.count === 0 && day.unavailable) return day.date + ' · ' + dayStateLabels.unavailable + ' ' + day.unavailable + ' 条：' + dayStateNotes.unavailable + '，未计入统计';
  const summary = day.date + ' · ' + day.count + ' 次运动 · ' + formatDayMetric(day, 'distanceKm') + ' · ' + formatDayMetric(day, 'durationSeconds') + ' · 负荷 ' + formatDayMetric(day, 'trainingLoad');
  return day.unavailable ? summary + ' · 另有 ' + day.unavailable + ' 条' + dayStateLabels.unavailable + '（' + dayStateNotes.unavailable + '），未计入统计' : summary;
}
export function dayMetricState(day, key) {
  const spec = dayMetrics[key];
  const value = day[key];
  const missing = spec.missing && day[spec.missing];
  const hasUnavailable = Boolean(day.unavailable);
  // state 驱动纹理：pending／missing／unavailable 各自独立；partial 在分级颜色上叠加白色斜纹，unavailable 另加虚线边框。
  if (day.pending) return {level:'missing', state:'pending', missing:false, unavailable:false, label:day.date + '，' + dayStateLabels.pending + '：' + dayStateNotes.pending};
  if (day.count === 0 && hasUnavailable) return {level:'missing', state:'unavailable', missing:false, unavailable:true, label:day.date + '，' + dayStateLabels.unavailable + ' ' + day.unavailable + ' 条：' + dayStateNotes.unavailable};
  if (day.count === 0) return {level:'0', state:'none', missing:false, unavailable:false, label:day.date + '，没有运动记录'};
  if (value === null || missing === day.count) return {level:'missing', state:'missing', missing:false, unavailable:hasUnavailable, label:day.date + '，' + day.count + ' 次运动，' + spec.label + '：' + dayStateLabels.missing + '（' + dayStateNotes.missing + '）'};
  const level = value === 0 ? '0' : String(1 + spec.thresholds.filter(threshold => value >= threshold).length);
  const text = day.date + '，' + day.count + ' 次运动，' + spec.label + ' ' + formatDayMetric(day, key);
  return {level, state:missing ? 'partial' : 'value', missing:Boolean(missing), unavailable:hasUnavailable, label:missing ? text + '（部分' + dayStateLabels.missing + '）' : text};
}

// 热力图图例沿用统一的状态措辞。
export function renderHeatmapStates() {
  return '<ul class="heatmap-states"><li><i class="state-swatch" data-state="none" aria-hidden="true"></i>无运动记录</li>' +
    '<li><i class="state-swatch" data-state="pending" aria-hidden="true"></i>' + dayStateLabels.pending + '</li>' +
    '<li><i class="state-swatch" data-state="missing" aria-hidden="true"></i>' + dayStateLabels.missing + '</li>' +
    '<li><i class="state-swatch" data-state="unavailable" aria-hidden="true"></i>' + dayStateLabels.unavailable + '</li></ul>';
}
// 运动图标共用 24px 网格；跑步参考实心人物，其余沿用线性轮廓，子类型独立区分。
const bicycle = '<circle cx="5.5" cy="16.5" r="4"/><circle cx="18.5" cy="16.5" r="4"/><path d="m5.5 16.5 4-8 5 8h-9m4-8h6.5m3 8-3-11H13M8 5.5h3"/>';
const runner = '<g fill="currentColor" stroke="none"><circle cx="17.4" cy="3.1" r="1.9"/><path d="m11.8 6.2 3.2 1.5-4.5 5.6-2.9-2.1Z"/></g><path d="m14.1 7.5-5.8-1.7-2.6 3.6m8.4-1.2 3.7 3.7 3.3-.3"/><path d="m10 12.1 5.1 4.6-7.4 2.7m1.4-6.9-3 4.9-4.3 4.1" stroke-width="2.1"/>';
const rower = '<circle cx="13" cy="5" r="2"/><path d="m10 9-2 5h7l3 4M10 9l5 3 4-3M3 18h18l-3 3H6ZM4 5l16 16"/>';
const sportIcons = {
  '骑行':['#32d05b', bicycle],
  '虚拟骑行':['#32d05b', '<circle cx="6" cy="17" r="4"/><circle cx="15" cy="17" r="2"/><rect x="17" y="1" width="6" height="4" rx="1"/><path d="m6 17 6-6 3 6H6m6-10v4m-3-4h6m2 6 3-8M2 23h19"/>'],
  '电助力骑行':['#32d05b', bicycle + '<path d="m13 1-2 3h3l-2 3"/>'],
  '山地骑行':['#32d05b', bicycle + '<path d="m2 7 3-5 3 5"/>'],
  '电助力山地骑行':['#32d05b', bicycle + '<path d="m1 7 3-5 3 5m7-6-2 3h3l-2 3"/>'],
  '砾石骑行':['#32d05b', bicycle + '<path d="M3 23h1m4-1h1m4 1h1m5-1h1"/>'],
  '手摇自行车':['#32d05b', '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="3"/><circle cx="11" cy="4" r="2"/><path d="M10 8v6h6l3 3M10 9l5 1 1-3M5 17l5-3m0 3h3"/>'],
  '卧式骑行':['#32d05b', '<circle cx="5" cy="18" r="4"/><circle cx="19" cy="18" r="4"/><circle cx="7" cy="5" r="2"/><path d="m6 9 4 5h5l3-5h3M3 10l4 7h8l4 1m-6-4 3-4"/>'],
  '跑步':['#ffc52f', runner],
  '虚拟跑步':['#ff9d66', '<rect x="2" y="2" width="20" height="13" rx="2"/><circle cx="14" cy="5.5" r="1"/><path d="m8 8 2 1 2-2 3 3h3m-6-3-2 4 3 2m-3-2-3 2m2 6h6m-3-4v4M5 22h14"/>'],
  '越野跑':['#ffc52f', '<g fill="currentColor" stroke="none"><circle cx="14.6" cy="2.8" r="1.9"/><path d="m10.3 5.5 3.5 2.1-4 5-3-1.9ZM8 22l3.3-4.4 2.9 2.6 2.8-3.4 5 5.2Z"/></g><path d="m12.1 6.7-4.6-.4-1.8 3.8m6.9-2.8 4.3 2.8 3.2-4"/><path d="m9.2 11.6 5 3.4-6.8 1.2m.8-4-3.6 5.3-2.8 3.9" stroke-width="2.1"/>'],
  '步行':['#f2d839', '<circle cx="13" cy="4" r="2"/><path d="m5 12 4-4h4l3 5h4M12 8l-2 7 5 7m-5-7-4 7"/>'],
  '徒步':['#f2d839', '<circle cx="13" cy="3" r="2"/><path d="m11 7-2 7-4 7m6-14 4 5h4m-10 2 5 3 1 5m4-13v13M7 7l-2 6 4 1"/>'],
  '游泳':['#64c9f5', '<circle cx="17" cy="6" r="2"/><path d="m3 12 5-5 5 5 4 1M8 7l3-4h3M2 17q2.5-2 5 0t5 0 5 0 5 0M2 21q2.5-2 5 0t5 0 5 0 5 0"/>'],
  '力量训练':['#d778ff', '<path d="M8 12h8M3 9v6m4-9v12m10-12v12m4-9v6M3 12H1m22 0h-2"/>'],
  '体能训练':['#d778ff', '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>'],
  '瑜伽':['#d778ff', '<circle cx="12" cy="4" r="2"/><path d="M12 8v7M7 9l-3 5H1m11-6 5 1 3 5h3M12 15l-6 3-3 3h18l-3-3Z"/>'],
  '普拉提':['#d778ff', '<circle cx="5" cy="13" r="2"/><path d="M8 15h6l5-10 3 1M14 15l5 3h3M2 22h20"/>'],
  '划船':['#64c9f5', rower],
  '虚拟划船':['#64c9f5', '<rect x="2" y="2" width="20" height="13" rx="2"/><path d="m7 5 10 8M6 11h12l-2 2H8Zm3 8h6m-3-4v4M5 22h14"/>'],
  '椭圆机':['#d778ff', '<circle cx="13" cy="3" r="2"/><path d="m11 7-2 6 5 3-2 5m-1-14 4 4h4M9 13l-4 7M5 8l2 13m12-13-2 13"/><ellipse cx="12" cy="21" rx="9" ry="1.5"/>'],
  '踏步机':['#d778ff', '<path d="M2 21h6v-6h7V9h7M6 3v6l4 3v6m-4-9 8-2 2-5"/>'],
  '攀岩':['#f2d839', '<circle cx="12" cy="5" r="2"/><path d="m5 2 2 7 5 1 5-5 2 1M12 10l-2 6-6 2m6-2 6 2 1 4M22 2v20M2 7h2m15 6h3M2 22h3"/>'],
  '越野滑雪':['#9abaff', '<circle cx="13" cy="3" r="2"/><path d="m10 7-2 6 7 3 2 5M10 7l5 4h4M8 13l-4 7M2 23h18l2-2M4 8v13m15-13 3 11"/>'],
  '高山滑雪':['#9abaff', '<circle cx="15" cy="3" r="2"/><path d="m12 7-5 5 7 2-4 6m2-13 3 5h5M4 6l16 13M2 18l15 5 4-1"/>'],
  '野外滑雪':['#9abaff', '<path d="m1 10 4-7 4 7m8 2 4-5 2 4M3 17l14 5 5-1m-11-8 4 1-3 5m1-14-3 4 3 4 5 2"/><circle cx="15" cy="3" r="1.5"/>'],
  '单板滑雪':['#9abaff', '<circle cx="14" cy="4" r="2"/><path d="m5 8 5 2 3-3 4 5h4M13 7l-3 8 5 3-2 3m-3-6-5 4M2 19q8 5 18 3l2-2"/>'],
  '皮划艇':['#64c9f5', '<ellipse cx="12" cy="16" rx="10" ry="4"/><circle cx="12" cy="5" r="2"/><path d="M12 9v7M5 5l14 14M3 3l3 1-2 2Zm15 14 3 1-2 3Z"/>'],
  '划独木舟':['#64c9f5', '<circle cx="10" cy="5" r="2"/><path d="M10 9v6l5 2M10 10l7 2M3 16l3 5h12l4-5ZM18 8l-2 14m-1-3 3 1"/>'],
  '桨板':['#64c9f5', '<circle cx="11" cy="3" r="2"/><path d="M11 7v7l-3 7m3-7 3 7M11 9l7 2m1-5-2 15M2 22h20"/>'],
  '冲浪':['#64c9f5', '<circle cx="14" cy="3" r="2"/><path d="m5 8 5 1 3-2 4 4h4M13 7l-3 8 5 2 1 3m-6-5-5 4M2 20q9 4 20-1M2 15q2-3 5-2"/>'],
  '足球':['#72dfbc', '<circle cx="12" cy="12" r="10"/><path d="m12 7 5 4-2 6H9l-2-6Zm0 0V2m5 9 4-2m-6 8 3 3M9 17l-3 3m1-9L3 9"/>'],
  '网球':['#72dfbc', '<ellipse cx="14" cy="8" rx="6" ry="7" transform="rotate(35 14 8)"/><path d="m9 13-7 8 2 2 7-8m1-11 6 6m-8-3 6 6m-1-10-5 8m8-6-5 8"/>'],
  '羽毛球':['#72dfbc', '<path d="m3 3 10 2 8 8-9 6L5 12ZM3 3l9 16M8 4l8 12M5 12l14-1M9 17l4 4a3 3 0 0 0 4-4l-2-2"/>'],
  '篮球':['#ff9d66', '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2v20M5 5q12 7 14 14M19 5Q7 12 5 19"/>'],
  '高尔夫':['#72dfbc', '<path d="M6 19V2l12 4-12 4"/><ellipse cx="10" cy="20" rx="8" ry="2"/><circle cx="20" cy="16" r="2"/>'],
};
const sportIcon = sport => {
  const [color, paths] = Object.hasOwn(sportIcons, sport) ? sportIcons[sport] : ['#b6beca', '<circle cx="12" cy="12" r="9"/><path d="M3 12h5l2-4 4 8 2-4h5"/>'];
  return `<svg class="record-icon${sport === '力量训练' ? ' strength-icon' : ''}" data-sport="${escapeHtml(sport)}" style="color:${color}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
};

// 每条运动统一的指标层级：主指标（距离／组数）、副指标（配速、速度或平均心率）。
function activityMetrics(activity) {
  if (activity.sport === '力量训练') return {
    primaryLabel:'组数',
    primary:activity.sets === null ? missingMetric : measuredMetric(activity.sets + ' 组', escapeHtml(activity.sets) + '<small>组</small>'),
    secondaryLabel:'平均心率',
    secondary:activity.averageHeartRate === null ? missingMetric : measuredMetric(activity.averageHeartRate + ' bpm', escapeHtml(activity.averageHeartRate) + '<small>bpm</small>'),
  };
  const metric = sportMetric(activity);
  return {primaryLabel:'距离', primary:activity.distanceKm === null ? missingMetric : measuredMetric(formatDistance(activity.distanceKm) + ' km', formatDistance(activity.distanceKm) + '<small>km</small>'), secondaryLabel:metric.label, secondary:metric};
}

// 同一套 24px 线性图标；保留文字供读屏使用，视觉上只显示图形。
const metricPaths = {
  '距离':'<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  '时长':'<circle cx="12" cy="14" r="8"/><path d="M12 10v4l3 2M9 2h6M12 2v4m6 2 2-2"/>',
  '平均速度':'<path d="M4.2 19a9 9 0 1 1 15.6 0M12 5v2M5.6 8.6 7 10m11.4-1.4L17 10M3 14h2m14 0h2M12 15l4-4"/><circle cx="12" cy="15" r="1.5"/>',
  '平均配速':'<path d="M4 18a8 8 0 1 1 16 0M12 7v2M6.3 10.3l1.4 1.4M12 16l4-4M9 21h6"/>',
  '每百米配速':'<path d="M4 15a8 8 0 1 1 16 0M12 5v2m0 7 4-4M2 19q2.5-2 5 0t5 0 5 0 5 0"/>',
  '累计爬升':'<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
  '组数':'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  '平均心率':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M3 12h4l2-4 4 8 2-4h6"/>',
};
const metricLabel = (label, className) => `<span class="${className}" title="${label}"><svg class="metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${metricPaths[label]}</svg><span class="sr-only">${label}</span></span>`;

function recordCard(activity) {
  const {date, sport, duration, trainingLoad, stravaUrl} = activity;
  const {primaryLabel, primary, secondaryLabel, secondary} = activityMetrics(activity);
  const weekday = new Intl.DateTimeFormat('zh-CN', {timeZone:'UTC', weekday:'long'}).format(new Date(date + 'T00:00:00Z'));
  const heading = `${metricLabel(primaryLabel, 'record-metric-label')}<span class="record-metric-value">${primary.html}</span>`;
  const elevation = activity.elevationGain == null ? missingMetric : measuredMetric(formatLoad(activity.elevationGain) + ' m', formatLoad(activity.elevationGain) + '<small>m</small>');
  return `<article class="record-card${sport === '徒步' ? ' hike' : ''}" title="${escapeHtml(primaryLabel + ' ' + primary.text + ' · 时长 ' + duration + ' · ' + secondaryLabel + ' ' + secondary.text + ' · 累计爬升 ' + elevation.text)}">
    <div class="record-body">
      <p class="record-top"><span class="record-sport">${sportIcon(sport)}${escapeHtml(sport)}</span></p>
      <h3 class="record-distance">${stravaUrl ? `<a class="record-link" href="${escapeHtml(stravaUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(date + ' ' + sport + '，' + primaryLabel + ' ' + primary.text + '，' + secondaryLabel + ' ' + secondary.text + '，时长 ' + duration + '，累计爬升 ' + elevation.text)}，在 Strava 查看（新标签页）">${heading}</a>` : heading}</h3>
      <div class="record-meta"><span>${metricLabel('时长', 'record-meta-label')}${escapeHtml(duration)}</span><span>${metricLabel(secondaryLabel, 'record-meta-label')}${secondary.html}</span><span>${metricLabel('累计爬升', 'record-meta-label')}${elevation.html}</span></div>
      <p class="record-details"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日</time><span>${weekday}</span>${stravaUrl ? '<span class="record-open" aria-hidden="true">Strava ↗</span>' : ''}</p>
    </div>
    <div class="record-load"><span class="record-load-value${trainingLoad === null ? ' missing' : ''}">${trainingLoad === null ? '未提供' : formatLoad(trainingLoad)}</span><span class="record-load-label">训练负荷</span></div>
  </article>`;
}
export function renderDayRecords(records, title = '当天运动记录') {
  if (!records.length) return '';
  const metricsByRecord = records.map(activity => ({activity, metric:activityMetrics(activity)}));
  const rows = metricsByRecord.map(({activity, metric:{primaryLabel, primary, secondaryLabel, secondary}}) => {
    const {date, sport, duration, trainingLoad, stravaUrl} = activity;
    const name = sportIcon(sport) + '<span>' + escapeHtml(sport) + '</span>';
    const aria = date + ' ' + sport + ' ' + duration + '，' + primaryLabel + ' ' + primary.text + '，' + secondaryLabel + ' ' + secondary.text;
    return `<tr class="activity-row${sport === '徒步' ? ' hike' : ''}" role="row">
      <td role="cell"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日<small>${date.slice(0, 4)}</small></time></td>
      <td role="cell">${stravaUrl ? `<a class="activity-link activity-name" href="${escapeHtml(stravaUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(aria)}，在 Strava 查看（新标签页）">${name}<span class="activity-open" aria-hidden="true">↗</span></a>` : `<span class="activity-name">${name}</span>`}</td>
      <td role="cell" data-label="${primaryLabel}">${primary.html}</td>
      <td role="cell" data-label="运动时间">${escapeHtml(duration)}</td><td role="cell" data-label="${secondaryLabel}">${secondary.html}</td><td role="cell" data-label="训练负荷">${trainingLoad === null ? '未提供' : formatLoad(trainingLoad)}</td>
    </tr>`;
  }).join('');
  const labels = metricsByRecord.map(({metric}) => metric);
  return `<div class="day-records-heading"><span>${escapeHtml(title)}</span><span>${records.length} 条活动</span></div>
    <div class="activity-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(title)}"><table class="activity-table" role="table"><caption class="sr-only">${escapeHtml(title)}，点击运动可在新标签页打开 Strava 详情。训练负荷为 Intervals.icu 的统计值，不含训练建议。</caption><thead role="rowgroup"><tr role="row"><th scope="col">日期</th><th scope="col">运动</th><th scope="col">${orderedLabels(primaryOrder, labels.map(metric => metric.primaryLabel))}</th><th scope="col">运动时间</th><th scope="col">${orderedLabels(secondaryOrder, labels.map(metric => metric.secondaryLabel))}</th><th scope="col">训练负荷</th></tr></thead><tbody role="rowgroup">${rows}</tbody></table></div>`;
}
export const beijingDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
export const beijingTime = date => new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).format(date);
export const compareActivityDates = (a, b) => b.date.localeCompare(a.date) || (b.startTime ?? '').localeCompare(a.startTime ?? '');
export const syncTimestamp = value => Date.parse(value.replace(' ', 'T').replace(' +08:00', '+08:00'));
export const replacementTargets = {Chain:5000, Cassette:10000, Tyre:5000, Chainrings:30000};
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const isDistance = value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validateGearLibrary(library) {
  // null 只表示尚未完成首次装备同步；成功查询的空列表用 [] 表示。
  if (library === null) return;
  if (!Array.isArray(library)) throw new Error('装备库格式无效');
  const groups = new Map();
  for (const [bikeIndex, bike] of library.entries()) {
    if (!bike || Object.keys(bike).sort().join(',') !== 'components,distanceKm,name,type' || bike.type !== 'Bike' ||
        typeof bike.name !== 'string' || !bike.name.trim() || !isDistance(bike.distanceKm) || !Array.isArray(bike.components)) throw new Error('自行车信息无效');
    for (const part of bike.components) {
      if (!part || Object.keys(part).filter(key => !['sharedBy','sharedGroup'].includes(key)).sort().join(',') !== 'distanceKm,name,replacement,type' ||
          typeof part.name !== 'string' || !part.name.trim() || typeof part.type !== 'string' || !part.type || !isDistance(part.distanceKm)) throw new Error('配件信息无效');
      if (Object.hasOwn(part, 'sharedBy') && (!Array.isArray(part.sharedBy) || part.sharedBy.length < 2 ||
          !part.sharedBy.includes(bike.name) || part.sharedBy.some(name => typeof name !== 'string' || !name.trim() || !library.some(owner => owner.name === name)))) throw new Error('配件共享关系无效');
      if (Object.hasOwn(part, 'sharedBy') !== Object.hasOwn(part, 'sharedGroup') || Object.hasOwn(part, 'sharedGroup') &&
          (!Number.isSafeInteger(part.sharedGroup) || part.sharedGroup < 1)) throw new Error('配件共享分组无效');
      if (part.sharedGroup) {
        if (!groups.has(part.sharedGroup)) groups.set(part.sharedGroup, []);
        groups.get(part.sharedGroup).push({bikeIndex, name:bike.name, part});
      }
      const replacement = part.replacement;
      if (!Object.hasOwn(replacementTargets, part.type)) {
        if (replacement !== null) throw new Error('普通配件不应包含更换提醒');
        continue;
      }
      if (!replacement || Object.keys(replacement).sort().join(',') !== 'date,distanceKm,status' ||
          !['available','missing-reminder','duplicate-reminder'].includes(replacement.status) ||
          replacement.date !== null && !isDate(replacement.date) || !isDistance(replacement.distanceKm) ||
          replacement.status !== 'available' && (replacement.date !== null || replacement.distanceKm !== null)) throw new Error('配件更换记录无效');
    }
  }
  for (const entries of groups.values()) {
    const owners = JSON.stringify(entries.map(entry => entry.name).sort());
    const values = part => JSON.stringify([part.name, part.type, part.distanceKm, part.replacement?.status, part.replacement?.date, part.replacement?.distanceKm]);
    if (entries.length < 2 || new Set(entries.map(entry => entry.bikeIndex)).size !== entries.length ||
        entries.some(entry => JSON.stringify([...entry.part.sharedBy].sort()) !== owners || values(entry.part) !== values(entries[0].part))) {
      throw new Error('共享配件的归属或使用信息不一致');
    }
  }
}

const gearTypes = {
  Bike:'自行车', Chain:'链条', Cassette:'飞轮', Tyre:'外胎', Wheel:'车轮', Wheelset:'轮组', Tube:'内胎',
  Frame:'车架', Fork:'前叉', Handlebar:'车把', Headset:'碗组', Saddle:'坐垫', Seatpost:'座管', Stem:'把立',
  Crankset:'曲柄组', Chainrings:'牙盘', Drivetrain:'传动系统', Derailleur:'变速器', BottomBracket:'中轴',
  Pedals:'脚踏', Lever:'手变', Cable:'线管', Brake:'刹车', BrakePads:'刹车片', Rotor:'碟片',
  Hub:'花鼓', Axel:'车轴', Shock:'避震器', Trainer:'骑行台', PowerMeter:'功率计', Computer:'码表',
  Light:'车灯', Battery:'电池', Cleats:'锁片', CyclingShoes:'锁鞋', Shoes:'鞋', Accessories:'附件',
  Apparel:'服装', Equipment:'装备',
};
const gearType = part => part.type === 'Tyre'
  ? part.name.startsWith('前胎') ? '前胎' : part.name.startsWith('后胎') ? '后胎' : '外胎'
  : Object.hasOwn(gearTypes, part.type) ? gearTypes[part.type] : part.type;
const gearDistance = value => value === null ? '未提供' : formatDistance(value) + ' km';
const componentState = part => !part.replacement ? 'untracked' : part.replacement.distanceKm === null ? 'unknown'
  : part.replacement.distanceKm >= replacementTargets[part.type] ? 'due'
  : part.replacement.distanceKm >= replacementTargets[part.type] * .8 ? 'soon' : part.replacement.date === null ? 'unknown' : 'normal';
const componentPriority = part => ({due:0, soon:1, unknown:2, normal:3, untracked:4})[componentState(part)];

function gearAlerts(components) {
  return [['due', '已达建议更换里程'], ['soon', '接近建议更换里程'], ['unknown', '信息待完善']].map(([state, label]) => {
    const count = components.filter(part => componentState(part) === state).length;
    return count ? `<span class="gear-alert" data-state="${state}">${count} 项${label}</span>` : '';
  }).join('');
}

function componentCard(part, bikeName, id) {
  const type = gearType(part);
  const positionNote = part.type === 'Tyre' && type === '外胎' ? '<p class="gear-note">未标记前后位置</p>' : '';
  const heading = `<div class="gear-part-heading"><span class="gear-type">${escapeHtml(type)}</span><h4>${escapeHtml(part.name)}</h4></div>${part.sharedBy ? '<p class="gear-shared">共享配件 · ' + part.sharedBy.map(escapeHtml).join(' / ') + '</p>' : ''}`;
  const total = `<p class="gear-note">累计里程 ${gearDistance(part.distanceKm)}</p>`;
  if (part.replacement === null) return `<article class="gear-part" id="${id}" tabindex="-1">${heading}${total}</article>`;
  const {status, date, distanceKm} = part.replacement;
  const target = replacementTargets[part.type];
  const warning = status === 'missing-reminder' ? '未设置更换提醒' : status === 'duplicate-reminder' ? '“更换”提醒重名，请保留一个' : null;
  const state = componentState(part);
  const label = warning ?? (distanceKm === null ? '更换后里程未提供' : state === 'due' ? '已达建议更换里程' : state === 'soon' ? '接近建议更换里程' : date === null ? '最近更换日期未记录' : '使用中');
  const remaining = distanceKm === null ? '建议更换里程 ' + formatDistance(target) + ' km'
    : distanceKm > target ? '已超出建议里程 ' + gearDistance(distanceKm - target) : '距建议里程 ' + gearDistance(target - distanceKm);
  const progress = distanceKm === null ? '' : `<div class="gear-progress" role="progressbar" aria-label="${escapeHtml(bikeName + ' · ' + type + ' · ' + part.name + '更换里程')}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(distanceKm,target)}" aria-valuetext="已使用 ${gearDistance(distanceKm)}，建议更换里程 ${formatDistance(target)} km，${remaining}"><span style="width:${Math.min(distanceKm / target * 100,100)}%"></span></div>`;
  return `<article class="gear-part gear-part-tracked" id="${id}" tabindex="-1" data-state="${state}">${heading}
    <p class="gear-replaced">最近更换 ${date === null ? '<span>未记录</span>' : '<time datetime="' + date + '">' + date.replaceAll('-','.') + '</time>'}</p>
    <p class="gear-used"><strong>${gearDistance(distanceKm)}</strong><span> / ${formatDistance(target)} km</span></p>
    ${progress}<div class="gear-progress-caption"><span>${remaining}</span>${distanceKm === null ? '' : '<span>' + Math.floor(distanceKm / target * 100) + '%</span>'}</div>
    <p class="gear-state">${label}</p>${positionNote}${total}</article>`;
}

export function summarizeGear(library) {
  validateGearLibrary(library);
  if (library === null) return null;
  const parts = [];
  const shared = new Map();
  library.forEach((bike, bikeIndex) => bike.components.forEach((part, partIndex) => {
    if (part.replacement === null) return;
    let entry = part.sharedGroup ? shared.get(part.sharedGroup) : null;
    if (!entry) {
      entry = {part, state:componentState(part), owners:[]};
      parts.push(entry);
      if (part.sharedGroup) shared.set(part.sharedGroup, entry);
    }
    entry.owners.push({name:bike.name, target:`gear-part-${bikeIndex}-${partIndex}`});
  }));
  parts.sort((a, b) => componentPriority(a.part) - componentPriority(b.part));
  return {parts, shared:shared.size, counts:Object.fromEntries(['due','soon','unknown','normal'].map(state => [state, parts.filter(entry => entry.state === state).length]))};
}

function renderGearMaintenance({parts, shared, counts}) {
  const attention = parts.filter(entry => entry.state !== 'normal');
  const labels = {due:'已达建议里程', soon:'接近建议里程', unknown:'信息待完善'};
  return `<section class="gear-maintenance" aria-labelledby="gear-maintenance-title"><div class="gear-maintenance-heading"><h3 id="gear-maintenance-title">维护摘要</h3><p>${parts.length} 件重点配件${shared ? ' · ' + shared + ' 件共享配件各计一次' : ''}</p></div>
    <dl class="maintenance-counts">${Object.entries(labels).map(([state, label]) => `<div data-state="${state}"><dt>${label}</dt><dd>${counts[state]}<small>件</small></dd></div>`).join('')}</dl>
    ${attention.length ? `<ul class="maintenance-list">${attention.map(({part, state, owners}) => {
      const distance = part.replacement.distanceKm;
      const target = replacementTargets[part.type];
      const usage = distance === null ? '更换后里程未提供' : `已使用 ${gearDistance(distance)} / ${formatDistance(target)} km · ${distance > target ? '已超出 ' + gearDistance(distance - target) : '距建议里程 ' + gearDistance(target - distance)}`;
      const issues = [];
      if (part.replacement.status === 'missing-reminder') issues.push('未设置更换提醒');
      if (part.replacement.status === 'duplicate-reminder') issues.push('“更换”提醒重名');
      if (part.replacement.date === null) issues.push('最近更换日期未记录');
      return `<li data-state="${state}"><div class="maintenance-item-heading"><h4>${escapeHtml(part.name)}</h4><span>${labels[state]}${owners.length > 1 ? ' · 共享' : ''}</span></div><p class="maintenance-usage">${escapeHtml(usage)}</p>${issues.length ? '<p class="maintenance-issue">' + issues.join(' · ') + '</p>' : ''}<div class="maintenance-links">${owners.map(owner => `<a href="#${owner.target}" data-gear-target="${owner.target}" aria-label="查看${escapeHtml(owner.name + '的' + part.name)}">查看 ${escapeHtml(owner.name)} <span aria-hidden="true">→</span></a>`).join('')}</div></li>`;
    }).join('')}</ul>` : '<p class="maintenance-empty">' + (parts.length ? '更换信息完整，暂无接近或已达建议里程的配件。' : '尚未关联链条、飞轮、外胎或牙盘。') + '</p>'}</section>`;
}

export function renderGearLibrary(library) {
  const maintenance = summarizeGear(library);
  if (library === null) return '<p class="gear-empty">装备尚未同步。完成 Intervals.icu 装备同步后，将在这里显示自行车和配件使用情况。</p>';
  if (!library.length) return '<p class="gear-empty">还没有在用的自行车。在 Intervals.icu 添加自行车并关联配件后，会随每日同步显示。</p>';
  return renderGearMaintenance(maintenance) + library.map((bike, bikeIndex) => `<details class="gear-bike"><summary class="gear-bike-heading"><div><span class="gear-type">自行车 · ${bike.components.length} 件配件</span><h3>${escapeHtml(bike.name)}</h3><span class="gear-alerts">${gearAlerts(bike.components)}</span></div><p><span>累计使用</span><strong>${gearDistance(bike.distanceKm)}</strong></p><svg class="gear-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    ${bike.components.length ? '<div class="gear-parts">' + bike.components.map((part, index) => ({part, index})).sort((a,b) => componentPriority(a.part) - componentPriority(b.part)).map(({part, index}) => componentCard(part,bike.name,`gear-part-${bikeIndex}-${index}`)).join('') + '</div>' : '<p class="gear-note">尚未关联在用配件。</p>'}</details>`).join('');
}

export function validateData(data) {
  if (!data || Object.keys(data).sort().join(',') !== 'activities,gearLibrary,period,syncedAt,unavailableActivities' || !isDate(data.period?.start) || !isDate(data.period?.end) || Object.keys(data.period).sort().join(',') !== 'end,start' || data.period.start > data.period.end || !Array.isArray(data.activities) || typeof data.syncedAt !== 'string' || !/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d \+08:00$/.test(data.syncedAt) || !Number.isFinite(syncTimestamp(data.syncedAt))) throw new Error('运动数据格式无效');
  validateGearLibrary(data.gearLibrary);
  if (!Array.isArray(data.unavailableActivities) || data.unavailableActivities.some(a => !a || Object.keys(a).join(',') !== 'date' || !isDate(a.date) || a.date < data.period.start || a.date > data.period.end)) throw new Error('无法读取的活动日期无效');
  for (const a of data.activities) {
    const keys = a?.sport === '力量训练' ? 'averageHeartRate,date,distanceKm,duration,sets,sport,trainingLoad' : 'date,distanceKm,duration,sport,trainingLoad';
    if (!a || Object.keys(a).filter(key => !['activityUrl', 'stravaUrl', 'elevationGain', 'startTime'].includes(key)).sort().join(',') !== keys || Object.hasOwn(a, 'startTime') && (typeof a.startTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(a.startTime)) || Object.hasOwn(a, 'elevationGain') && a.elevationGain !== null && (typeof a.elevationGain !== 'number' || !Number.isFinite(a.elevationGain) || a.elevationGain < 0) || Object.hasOwn(a, 'activityUrl') && (typeof a.activityUrl !== 'string' || !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(a.activityUrl)) || Object.hasOwn(a, 'stravaUrl') && (typeof a.stravaUrl !== 'string' || !/^https:\/\/www\.strava\.com\/activities\/[1-9]\d*$/.test(a.stravaUrl)) || !isDate(a.date) || a.date < data.period.start || a.date > data.period.end || typeof a.sport !== 'string' || !a.sport || typeof a.duration !== 'string' || !/^\d+(?::[0-5]\d){1,2}$/.test(a.duration) || ![a.distanceKm,a.trainingLoad].every(v => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0) ||
        a.sport === '力量训练' && (a.sets !== null && (!Number.isInteger(a.sets) || a.sets < 0) || a.averageHeartRate !== null && (typeof a.averageHeartRate !== 'number' || !Number.isFinite(a.averageHeartRate) || a.averageHeartRate <= 0))) throw new Error('运动记录格式无效');
  }
}
export function shiftDate(date, days) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function availableYears(data, endDate = data.period.end) {
  const last = Number((data.period.end < endDate ? data.period.end : endDate).slice(0,4));
  const first = Number(data.period.start.slice(0,4));
  return Array.from({length:Math.max(0, last - first + 1)}, (_, i) => String(last - i));
}

export function renderYearOptions(data, endDate = data.period.end) {
  return '<option value="recent">最近一年</option>' + availableYears(data, endDate).map(year => `<option value="${year}">${year} 年</option>`).join('');
}

// 运动类型分布同时作为年度筛选入口：计数始终是该范围的完整分布，不随筛选变化。
export function renderSportFilter(sports, selected = '') {
  const items = sports.map(({sport, count}) => ({sport, count}));
  // 保留已选类型：该范围没有记录时也显示当前筛选，便于直接清除。
  if (selected && !items.some(item => item.sport === selected)) items.push({sport:selected, count:0});
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const chip = (sport, count, label) => `<button type="button" class="legend-item" data-sport="${escapeHtml(sport)}" aria-pressed="${sport === selected}" aria-label="${escapeHtml(label)}，该范围 ${count} 次" title="${escapeHtml(label)}，该范围 ${count} 次">${escapeHtml(label)} <strong>${count}</strong> 次</button>`;
  return chip('', total, '全部运动') + items.map(item => chip(item.sport, item.count, item.sport)).join('');
}

function renderRecentSummary(recent, data, endDate) {
  const start = shiftDate(endDate, -6);
  const distance = recent.reduce((sum, activity) => sum + Math.round((activity.distanceKm ?? 0) * 100), 0) / 100;
  const duration = recent.reduce((sum, activity) => sum + activity.duration.split(':').reduce((value, part) => value * 60 + Number(part), 0), 0);
  const missing = recent.filter(activity => activity.distanceKm === null).length;
  const missingLoad = recent.filter(activity => activity.trainingLoad === null).length;
  const load = recent.reduce((sum, activity) => sum + (activity.trainingLoad ?? 0), 0);
  const unavailable = data.unavailableActivities.filter(activity => activity.date >= start && activity.date <= endDate).length;
  const notes = [];
  if (missing) notes.push(missing + ' 次运动' + dayStateLabels.missing + '（距离未提供）');
  if (missingLoad) notes.push(missingLoad + ' 次运动' + dayStateLabels.missing + '（负荷未提供' + (missingLoad < recent.length ? '，累计负荷仅含已提供值' : '') + '）');
  if (unavailable) notes.push('另有 ' + unavailable + ' 条' + dayStateLabels.unavailable + '，未计入统计');
  const distanceText = recent.length && missing === recent.length ? '—' : formatDistance(distance);
  const loadText = recent.length && missingLoad === recent.length ? '—' : formatLoad(load);
  return `<div class="summary-context"><span class="summary-label">最近 7 天</span><span class="summary-period"><time datetime="${start}">${start.replaceAll('-', '.')}</time> — <time datetime="${endDate}">${endDate.replaceAll('-', '.')}</time></span></div>
    <dl class="summary-stats"><div><dt>运动次数</dt><dd>${recent.length}<small>次</small></dd></div><div><dt>累计距离</dt><dd>${distanceText}<small>km</small></dd></div><div><dt>运动时长</dt><dd>${formatTime(duration)}</dd></div><div><dt>累计负荷</dt><dd>${loadText}</dd></div></dl>${notes.length ? '<p class="summary-note">' + notes.join(' · ') + '</p>' : ''}`;
}

// 一条已读取的活动只要应有的指标未提供，就计入“指标缺失”；与未同步、详情不可读取分开统计。
// 力量训练的主指标是组数，距离本就不适用，因此只看组数、平均心率与训练负荷。
export const hasMissingMetric = activity => activity.sport === '力量训练'
  ? activity.sets === null || activity.averageHeartRate === null || activity.trainingLoad === null
  : activity.distanceKm === null || activity.trainingLoad === null;

export function createJournal(data, endDate = data.period.end, range = 'recent', sport = '') {
  if (range !== 'recent' && !availableYears(data, endDate).includes(String(range))) throw new Error('所选年份不在已同步范围内');
  const period = range === 'recent' ? {start:shiftDate(endDate, -364), end:endDate} : {start:range + '-01-01', end:range + '-12-31'};
  const rangeActivities = data.activities.filter(a => a.date >= period.start && a.date <= period.end);
  const activities = (sport ? rangeActivities.filter(a => a.sport === sport) : rangeActivities).slice().sort(compareActivityDates);
  // 详情不可读取的运动没有类型信息，筛选单个类型时不计入统计，避免把未知归属算进所选类型。
  const unavailableInRange = data.unavailableActivities.filter(a => a.date >= period.start && a.date <= period.end);
  const unavailableActivities = sport ? [] : unavailableInRange;
  const unavailableCount = unavailableActivities.length;
  const unavailableExcluded = sport ? unavailableInRange.length : 0;
  const recent = data.activities.filter(a => a.date >= shiftDate(endDate, -6) && a.date <= endDate).slice().sort(compareActivityDates);
  const daily = [];
  for (let date = period.start; date <= period.end; date = shiftDate(date, 1)) {
    const records = activities.filter(a => a.date === date);
    daily.push({date, records, count:records.length, unavailable:unavailableActivities.filter(a => a.date === date).length, pending:date < data.period.start || date > data.period.end || date > endDate,
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
  const missingMetrics = activities.filter(hasMissingMetric).length;
  const sports = [...new Set(rangeActivities.map(a => a.sport))].map(name => ({sport:name, count:rangeActivities.filter(a => a.sport === name).length}));
  const first = new Date(period.start + 'T00:00:00Z');
  const last = new Date(period.end + 'T00:00:00Z');
  const start = shiftDate(period.start, -((first.getUTCDay() + 6) % 7));
  const end = shiftDate(period.end, (7 - last.getUTCDay()) % 7);
  const byDate = new Map(daily.map(d => [d.date, d]));
  const padded = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) padded.push(byDate.get(date) ?? {date, padding:true});
  const columns = padded.length / 7;
  // 初始快照按默认距离指标写状态属性，随后 app.js 切换指标时只更新属性，不改结构。
  const cells = padded.map(d => {
    if (d.padding) return '<span class="day-cell padding" aria-hidden="true"></span>';
    const state = dayMetricState(d, 'distanceKm');
    return '<button class="day-cell" type="button" data-date="' + d.date + '" data-level="' + state.level + '" data-state="' + state.state + '" data-unavailable="' + state.unavailable + '" tabindex="-1" aria-label="' + escapeHtml(state.label) + '"></button>';
  }).join('');
  const months = [];
  padded.forEach((d,i) => {if(d.date.endsWith('-01') && d.date >= period.start && d.date <= period.end) months.push({column:Math.floor(i/7)+1, label:Number(d.date.slice(5,7))+'月'});});
  const monthLabels = months.map((m,i) => '<span style="grid-column:' + m.column + '/' + (months[i+1]?.column ?? columns+1) + '">' + m.label + '</span>').join('');
  const cards = recent.length ? recent.map(recordCard).join('') : '<p class="records-empty">最近一周还没有运动记录。</p>';
  const initialDate = daily.findLast(d => d.count > 0)?.date ?? daily.findLast(d => !d.pending)?.date ?? period.end;
  return {activities, recent, recentSummary:renderRecentSummary(recent, data, endDate), unavailableCount, unavailableExcluded, period, syncedAt:data.syncedAt, daily, distance, duration, activeDays, missingDistance, missingLoad, missingMetrics, pendingDays:daily.filter(d => d.pending).length, sports, columns, cells, monthLabels, cards, initialDate};
}
