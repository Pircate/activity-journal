export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  return {label:'平均速度', ...measurable ? measuredMetric((distanceKm * 3600 / seconds).toFixed(1) + ' km/h', (distanceKm * 3600 / seconds).toFixed(1) + '<small>km/h</small>') : missingMetric};
}
const primaryOrder = ['距离', '组数'];
const secondaryOrder = ['平均配速', '每百米配速', '平均速度', '平均心率'];
const orderedLabels = (order, labels) => order.filter(label => labels.includes(label)).join(' / ');
export const trainingLoadNote = '训练负荷来自 Intervals.icu，用于对照单次运动的训练投入，仅作统计参考，不构成训练建议。';
export const dayMetrics = {
  distanceKm:{label:'距离', thresholds:[10, 30, 60], format:value => value.toFixed(2) + ' 公里', missing:'missingDistance'},
  durationSeconds:{label:'时长', thresholds:[1800, 3600, 7200], format:formatTime},
  trainingLoad:{label:'负荷', thresholds:[50, 150, 300], format:String, missing:'missingLoad'},
};
export function formatDayMetric(day, key) {
  const spec = dayMetrics[key];
  if (day.count === 0) return spec.format(0);
  const missing = spec.missing && day[spec.missing];
  if (day[key] === null || missing === day.count) return '未提供';
  return spec.format(day[key]) + (missing ? '（' + missing + ' 次未提供）' : '');
}
export function describeDay(day) {
  if (day.pending) return day.date + ' · 尚未同步该日期的运动记录';
  return day.date + ' · ' + day.count + ' 次运动 · ' + formatDayMetric(day, 'distanceKm') + ' · ' + formatDayMetric(day, 'durationSeconds') + ' · 负荷 ' + formatDayMetric(day, 'trainingLoad') + (day.unavailable ? ' · 另有 ' + day.unavailable + ' 次运动详情无法读取（日期为平台当地日期），未计入统计' : '');
}
export function dayMetricState(day, key) {
  const spec = dayMetrics[key];
  const value = day[key];
  const missing = spec.missing && day[spec.missing];
  const entirelyMissing = day.count > 0 && (value === null || missing === day.count);
  return {
    level:day.pending || entirelyMissing || day.unavailable && day.count === 0 ? 'missing' : day.count === 0 || value === 0 ? '0' : String(1 + spec.thresholds.filter(threshold => value >= threshold).length),
    missing:Boolean(day.unavailable || missing && !entirelyMissing),
    label:day.unavailable ? describeDay(day) : day.pending ? day.date + '，尚未同步' : day.date + '，' + day.count + ' 次运动，' + spec.label + ' ' + formatDayMetric(day, key),
  };
}
const sportIcon = sport => {
  const paths = sport === '徒步'
    ? '<circle cx="17" cy="4" r="2" fill="currentColor" stroke="none"/><path d="m14 9-3 7-5 4m8-11 5 5 5 1m-10-6 4 10-1 9m-4-10-3 10m14-14 2 14M9 8l-2 7 4 1"/>'
    : sport === '力量训练'
      ? '<path d="M10 16h12M5 12v8m4-11v14m14-14v14m4-11v8M5 16H3m26 0h-2"/>'
    : sport.includes('骑行')
      ? '<circle cx="7" cy="23" r="6"/><circle cx="25" cy="23" r="6"/><circle cx="22" cy="5" r="2" fill="currentColor" stroke="none"/><path d="m16 8-5 6 7 4-2 7m0-17 6 6h5m-6 0 4 9M7 23l5-9"/>'
      : '<path d="M2 17h6l4-11 7 21 4-10h7"/>';
  return '<svg class="record-icon' + (sport === '力量训练' ? ' strength-icon' : '') + '" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
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
  return {primaryLabel:'距离', primary:activity.distanceKm === null ? missingMetric : measuredMetric(activity.distanceKm.toFixed(2) + ' km', activity.distanceKm.toFixed(2) + '<small>km</small>'), secondaryLabel:metric.label, secondary:metric};
}

function recordCard(activity) {
  const {date, sport, duration, trainingLoad, activityUrl} = activity;
  const {primaryLabel, primary, secondaryLabel, secondary} = activityMetrics(activity);
  const weekday = new Intl.DateTimeFormat('zh-CN', {timeZone:'UTC', weekday:'long'}).format(new Date(date + 'T00:00:00Z'));
  const heading = `<span class="record-metric-label">${primaryLabel}</span><span class="record-metric-value">${primary.html}</span>`;
  return `<article class="record-card${sport === '徒步' ? ' hike' : ''}">
    <div class="record-body">
      <p class="record-top"><span class="record-sport">${sportIcon(sport)}${escapeHtml(sport)}</span></p>
      <h3 class="record-distance">${activityUrl ? `<a class="record-link" href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(date + ' ' + sport + '，' + primaryLabel + ' ' + primary.text + '，' + secondaryLabel + ' ' + secondary.text + '，时长 ' + duration)}，在 Intervals.icu 查看（新标签页）">${heading}</a>` : heading}</h3>
      <div class="record-meta"><span><span class="record-meta-label">时长</span>${escapeHtml(duration)}</span><span><span class="record-meta-label">${secondaryLabel}</span>${secondary.html}</span></div>
      <p class="record-details"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日</time><span>${weekday}</span>${activityUrl ? '<span class="record-open" aria-hidden="true">Intervals.icu ↗</span>' : ''}</p>
    </div>
    <div class="record-load"><span class="record-load-value${trainingLoad === null ? ' missing' : ''}">${trainingLoad ?? '未记录'}</span><span class="record-load-label">训练负荷</span></div>
  </article>`;
}
export function renderDayRecords(records, title = '当天运动记录') {
  if (!records.length) return '';
  const metricsByRecord = records.map(activity => ({activity, metric:activityMetrics(activity)}));
  const rows = metricsByRecord.map(({activity, metric:{primaryLabel, primary, secondaryLabel, secondary}}) => {
    const {date, sport, duration, trainingLoad, activityUrl} = activity;
    const name = sportIcon(sport) + '<span>' + escapeHtml(sport) + '</span>';
    const aria = date + ' ' + sport + ' ' + duration + '，' + primaryLabel + ' ' + primary.text + '，' + secondaryLabel + ' ' + secondary.text;
    return `<tr class="activity-row${sport === '徒步' ? ' hike' : ''}" role="row">
      <td role="cell"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日<small>${date.slice(0, 4)}</small></time></td>
      <td role="cell">${activityUrl ? `<a class="activity-link activity-name" href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(aria)}，在 Intervals.icu 查看（新标签页）">${name}<span class="activity-open" aria-hidden="true">↗</span></a>` : `<span class="activity-name">${name}</span>`}</td>
      <td role="cell" data-label="${primaryLabel}">${primary.html}</td>
      <td role="cell" data-label="运动时间">${escapeHtml(duration)}</td><td role="cell" data-label="${secondaryLabel}">${secondary.html}</td><td role="cell" data-label="训练负荷">${trainingLoad ?? '未提供'}</td>
    </tr>`;
  }).join('');
  const labels = metricsByRecord.map(({metric}) => metric);
  return `<div class="day-records-heading"><span>${escapeHtml(title)}</span><span>${records.length} 条活动</span></div>
    <div class="activity-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(title)}"><table class="activity-table" role="table"><caption class="sr-only">${escapeHtml(title)}，点击运动可在新标签页打开 Intervals.icu 详情。训练负荷为 Intervals.icu 的统计值，不含训练建议。</caption><thead role="rowgroup"><tr role="row"><th scope="col">日期</th><th scope="col">运动</th><th scope="col">${orderedLabels(primaryOrder, labels.map(metric => metric.primaryLabel))}</th><th scope="col">运动时间</th><th scope="col">${orderedLabels(secondaryOrder, labels.map(metric => metric.secondaryLabel))}</th><th scope="col">训练负荷</th></tr></thead><tbody role="rowgroup">${rows}</tbody></table></div>`;
}
export const beijingDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
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
const kilometers = value => value.toLocaleString('zh-CN', {maximumFractionDigits:2});
const gearDistance = value => value === null ? '未提供' : kilometers(value) + ' km';
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
  const remaining = distanceKm === null ? '建议更换里程 ' + kilometers(target) + ' km'
    : distanceKm > target ? '已超出建议里程 ' + gearDistance(distanceKm - target) : '距建议里程 ' + gearDistance(target - distanceKm);
  const progress = distanceKm === null ? '' : `<div class="gear-progress" role="progressbar" aria-label="${escapeHtml(bikeName + ' · ' + type + ' · ' + part.name + '更换里程')}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(distanceKm,target)}" aria-valuetext="已使用 ${gearDistance(distanceKm)}，建议更换里程 ${kilometers(target)} km，${remaining}"><span style="width:${Math.min(distanceKm / target * 100,100)}%"></span></div>`;
  return `<article class="gear-part gear-part-tracked" id="${id}" tabindex="-1" data-state="${state}">${heading}
    <p class="gear-replaced">最近更换 ${date === null ? '<span>未记录</span>' : '<time datetime="' + date + '">' + date.replaceAll('-','.') + '</time>'}</p>
    <p class="gear-used"><strong>${gearDistance(distanceKm)}</strong><span> / ${kilometers(target)} km</span></p>
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
      const usage = distance === null ? '更换后里程未提供' : `已使用 ${gearDistance(distance)} / ${kilometers(target)} km · ${distance > target ? '已超出 ' + gearDistance(distance - target) : '距建议里程 ' + gearDistance(target - distance)}`;
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
    if (!a || Object.keys(a).filter(key => key !== 'activityUrl').sort().join(',') !== keys || Object.hasOwn(a, 'activityUrl') && (typeof a.activityUrl !== 'string' || !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(a.activityUrl)) || !isDate(a.date) || a.date < data.period.start || a.date > data.period.end || typeof a.sport !== 'string' || !a.sport || typeof a.duration !== 'string' || !/^\d+(?::[0-5]\d){1,2}$/.test(a.duration) || ![a.distanceKm,a.trainingLoad].every(v => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0) ||
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
  const unavailable = data.unavailableActivities.filter(activity => activity.date >= start && activity.date <= endDate).length;
  const notes = [];
  if (missing) notes.push(missing + ' 次运动未提供距离');
  if (unavailable) notes.push('另有 ' + unavailable + ' 次运动详情无法读取，未计入统计');
  if (start < data.period.start || endDate > data.period.end) notes.push('部分日期尚未同步，当前为已同步记录');
  const distanceText = recent.length && missing === recent.length ? '—' : distance.toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});
  return `<div class="summary-context"><span class="summary-label">最近 7 天</span><span class="summary-period"><time datetime="${start}">${start.replaceAll('-', '.')}</time> — <time datetime="${endDate}">${endDate.replaceAll('-', '.')}</time></span></div>
    <dl class="summary-stats"><div><dt>运动次数</dt><dd>${recent.length}<small>次</small></dd></div><div><dt>累计距离</dt><dd>${distanceText}<small>公里</small></dd></div><div><dt>运动时长</dt><dd>${formatTime(duration)}</dd></div></dl>${notes.length ? '<p class="summary-note">' + notes.join(' · ') + '</p>' : ''}`;
}

export function createJournal(data, endDate = data.period.end, range = 'recent', sport = '') {
  if (range !== 'recent' && !availableYears(data, endDate).includes(String(range))) throw new Error('所选年份不在已同步范围内');
  const period = range === 'recent' ? {start:shiftDate(endDate, -364), end:endDate} : {start:range + '-01-01', end:range + '-12-31'};
  const rangeActivities = data.activities.filter(a => a.date >= period.start && a.date <= period.end);
  const activities = (sport ? rangeActivities.filter(a => a.sport === sport) : rangeActivities).slice().sort((a,b) => b.date.localeCompare(a.date));
  // 详情无法读取的运动没有类型信息，筛选单个类型时不计入统计，避免把未知归属算进所选类型。
  const unavailableInRange = data.unavailableActivities.filter(a => a.date >= period.start && a.date <= period.end);
  const unavailableActivities = sport ? [] : unavailableInRange;
  const unavailableCount = unavailableActivities.length;
  const unavailableExcluded = sport ? unavailableInRange.length : 0;
  const recent = data.activities.filter(a => a.date >= shiftDate(endDate, -6) && a.date <= endDate).slice().sort((a,b) => b.date.localeCompare(a.date));
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
  const sports = [...new Set(rangeActivities.map(a => a.sport))].map(name => ({sport:name, count:rangeActivities.filter(a => a.sport === name).length}));
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
  const initialDate = daily.findLast(d => d.count > 0)?.date ?? daily.findLast(d => !d.pending)?.date ?? period.end;
  return {activities, recent, recentSummary:renderRecentSummary(recent, data, endDate), unavailableCount, unavailableExcluded, period, syncedAt:data.syncedAt, daily, distance, duration, activeDays, missingDistance, missingLoad, sports, columns, cells, monthLabels, cards, initialDate};
}
