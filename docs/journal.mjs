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
  const {date, sport, distanceKm, duration, trainingLoad, activityUrl} = activity;
  const seconds = duration.split(':').reduce((value, part) => value * 60 + Number(part), 0);
  const speed = distanceKm !== null && seconds > 0 ? (distanceKm * 3600 / seconds).toFixed(1) : null;
  const weekday = new Intl.DateTimeFormat('zh-CN', {timeZone:'UTC', weekday:'long'}).format(new Date(date + 'T00:00:00Z'));
  const distance = distanceKm === null ? '<span class="record-distance-missing">未记录距离</span>' : distanceKm.toFixed(2) + '<small>km</small>';
  const heading = `${sportIcon(sport)}<span><span class="sr-only">距离 </span>${distance}</span>`;
  return `<article class="record-card${sport === '徒步' ? ' hike' : ''}">
    <div class="record-body">
      <h3 class="record-distance">${activityUrl ? `<a class="record-link" href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(date + ' ' + sport + ' ' + duration)}，在 Intervals.icu 查看（新标签页）">${heading}</a>` : heading}</h3>
      <div class="record-meta"><span><span class="sr-only">运动时长 </span>${escapeHtml(duration)}</span>${speed === null ? '' : '<span><span class="sr-only">平均速度 </span>' + speed + '<small>km/h</small></span>'}</div>
      <p class="record-details"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日</time><span>${weekday}</span><span class="record-sport">${escapeHtml(sport)}</span>${activityUrl ? '<span class="record-open" aria-hidden="true">Intervals.icu ↗</span>' : ''}</p>
    </div>
    <div class="record-load"><span class="record-load-value${trainingLoad === null ? ' missing' : ''}">${trainingLoad ?? '未记录'}</span><span class="record-load-label">训练负荷</span></div>
  </article>`;
}
export function renderDayRecords(records) {
  if (!records.length) return '';
  const rows = records.map(({date, sport, distanceKm, duration, trainingLoad, activityUrl}) => {
    const seconds = duration.split(':').reduce((value, part) => value * 60 + Number(part), 0);
    const speed = distanceKm !== null && seconds > 0 ? (distanceKm * 3600 / seconds).toFixed(1) + '<small>km/h</small>' : '未提供';
    const name = sportIcon(sport) + '<span>' + escapeHtml(sport) + '</span>';
    return `<tr class="activity-row${sport === '徒步' ? ' hike' : ''}" role="row">
      <td role="cell"><time datetime="${date}">${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日<small>${date.slice(0, 4)}</small></time></td>
      <td role="cell">${activityUrl ? `<a class="activity-link activity-name" href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(date + ' ' + sport + ' ' + duration)}，在 Intervals.icu 查看（新标签页）">${name}<span class="activity-open" aria-hidden="true">↗</span></a>` : `<span class="activity-name">${name}</span>`}</td>
      <td role="cell" data-label="距离">${distanceKm === null ? '未提供' : distanceKm.toFixed(2) + '<small>km</small>'}</td>
      <td role="cell" data-label="运动时间">${escapeHtml(duration)}</td><td role="cell" data-label="平均速度">${speed}</td><td role="cell" data-label="训练负荷">${trainingLoad ?? '未提供'}</td>
    </tr>`;
  }).join('');
  return `<div class="day-records-heading"><span>当天运动记录</span><span>${records.length} 条活动</span></div>
    <div class="activity-table-scroll" tabindex="0" role="region" aria-label="当天运动记录"><table class="activity-table" role="table"><caption class="sr-only">当天的运动记录，点击运动可在新标签页打开 Intervals.icu 详情</caption><thead role="rowgroup"><tr role="row"><th scope="col">日期</th><th scope="col">运动</th><th scope="col">距离</th><th scope="col">运动时间</th><th scope="col">平均速度</th><th scope="col">训练负荷</th></tr></thead><tbody role="rowgroup">${rows}</tbody></table></div>`;
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
  for (const bike of library) {
    if (!bike || Object.keys(bike).sort().join(',') !== 'components,distanceKm,name,type' || bike.type !== 'Bike' ||
        typeof bike.name !== 'string' || !bike.name.trim() || !isDistance(bike.distanceKm) || !Array.isArray(bike.components)) throw new Error('自行车信息无效');
    for (const part of bike.components) {
      if (!part || Object.keys(part).sort().join(',') !== 'distanceKm,name,replacement,type' ||
          typeof part.name !== 'string' || !part.name.trim() || typeof part.type !== 'string' || !part.type || !isDistance(part.distanceKm)) throw new Error('配件信息无效');
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

function componentCard(part, bikeName) {
  const type = gearType(part);
  const positionNote = part.type === 'Tyre' && type === '外胎' ? '<p class="gear-note">未标记前后位置</p>' : '';
  const heading = `<div class="gear-part-heading"><span class="gear-type">${escapeHtml(type)}</span><h4>${escapeHtml(part.name)}</h4></div>`;
  const total = `<p class="gear-note">累计里程 ${gearDistance(part.distanceKm)}</p>`;
  if (part.replacement === null) return `<article class="gear-part">${heading}${total}</article>`;
  const {status, date, distanceKm} = part.replacement;
  const target = replacementTargets[part.type];
  const warning = status === 'missing-reminder' ? '未设置更换提醒' : status === 'duplicate-reminder' ? '“更换”提醒重名，请保留一个' : null;
  const state = distanceKm === null ? 'unknown' : distanceKm >= target ? 'due' : distanceKm >= target * .8 ? 'soon' : 'normal';
  const label = warning ?? (state === 'unknown' ? '更换后里程未提供' : state === 'due' ? '建议更换' : state === 'soon' ? '即将到期' : '使用中');
  const remaining = distanceKm === null ? '目标 ' + kilometers(target) + ' km'
    : distanceKm > target ? '已超出 ' + gearDistance(distanceKm - target) : '剩余 ' + gearDistance(target - distanceKm);
  const progress = distanceKm === null ? '' : `<div class="gear-progress" role="progressbar" aria-label="${escapeHtml(bikeName + ' · ' + type + ' · ' + part.name + '更换里程')}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(distanceKm,target)}" aria-valuetext="已使用 ${gearDistance(distanceKm)}，目标 ${kilometers(target)} km，${remaining}"><span style="width:${Math.min(distanceKm / target * 100,100)}%"></span></div>`;
  return `<article class="gear-part gear-part-tracked" data-state="${state}">${heading}
    <p class="gear-replaced">最近更换 ${date === null ? '<span>未记录</span>' : '<time datetime="' + date + '">' + date.replaceAll('-','.') + '</time>'}</p>
    <p class="gear-used"><strong>${gearDistance(distanceKm)}</strong><span> / ${kilometers(target)} km</span></p>
    ${progress}<div class="gear-progress-caption"><span>${remaining}</span>${distanceKm === null ? '' : '<span>' + Math.floor(distanceKm / target * 100) + '%</span>'}</div>
    <p class="gear-state">${label}</p>${positionNote}${total}</article>`;
}

export function renderGearLibrary(library) {
  validateGearLibrary(library);
  if (library === null) return '<p class="gear-empty">装备尚未同步。完成 Intervals.icu 装备同步后，将在这里显示自行车和配件使用情况。</p>';
  if (!library.length) return '<p class="gear-empty">还没有在用的自行车。在 Intervals.icu 添加自行车并关联配件后，会随每日同步显示。</p>';
  return library.map(bike => `<details class="gear-bike"><summary class="gear-bike-heading"><div><span class="gear-type">自行车 · ${bike.components.length} 件配件</span><h3>${escapeHtml(bike.name)}</h3></div><p><span>累计使用</span><strong>${gearDistance(bike.distanceKm)}</strong></p><svg class="gear-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    ${bike.components.length ? '<div class="gear-parts">' + bike.components.map(part => componentCard(part,bike.name)).join('') + '</div>' : '<p class="gear-note">尚未关联在用配件。</p>'}</details>`).join('');
}

export function validateData(data) {
  if (!data || Object.keys(data).sort().join(',') !== 'activities,gearLibrary,period,syncedAt,unavailableActivities' || !isDate(data.period?.start) || !isDate(data.period?.end) || Object.keys(data.period).sort().join(',') !== 'end,start' || data.period.start > data.period.end || !Array.isArray(data.activities) || typeof data.syncedAt !== 'string' || !/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d \+08:00$/.test(data.syncedAt) || !Number.isFinite(syncTimestamp(data.syncedAt))) throw new Error('运动数据格式无效');
  validateGearLibrary(data.gearLibrary);
  if (!Array.isArray(data.unavailableActivities) || data.unavailableActivities.some(a => !a || Object.keys(a).join(',') !== 'date' || !isDate(a.date) || a.date < data.period.start || a.date > data.period.end)) throw new Error('无法读取的活动日期无效');
  for (const a of data.activities) {
    if (!a || Object.keys(a).filter(key => key !== 'activityUrl').sort().join(',') !== 'date,distanceKm,duration,sport,trainingLoad' || Object.hasOwn(a, 'activityUrl') && (typeof a.activityUrl !== 'string' || !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(a.activityUrl)) || !isDate(a.date) || a.date < data.period.start || a.date > data.period.end || typeof a.sport !== 'string' || !a.sport || typeof a.duration !== 'string' || !/^\d+(?::[0-5]\d){1,2}$/.test(a.duration) || ![a.distanceKm,a.trainingLoad].every(v => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw new Error('运动记录格式无效');
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

export function createJournal(data, endDate = data.period.end, range = 'recent') {
  if (range !== 'recent' && !availableYears(data, endDate).includes(String(range))) throw new Error('所选年份不在已同步范围内');
  const period = range === 'recent' ? {start:shiftDate(endDate, -364), end:endDate} : {start:range + '-01-01', end:range + '-12-31'};
  const activities = data.activities.filter(a => a.date >= period.start && a.date <= period.end).slice().sort((a,b) => b.date.localeCompare(a.date));
  const unavailableActivities = data.unavailableActivities.filter(a => a.date >= period.start && a.date <= period.end);
  const unavailableCount = unavailableActivities.length;
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
  const initialDate = daily.findLast(d => d.count > 0)?.date ?? daily.findLast(d => !d.pending)?.date ?? period.end;
  return {activities, recent, recentSummary:renderRecentSummary(recent, data, endDate), unavailableCount, period, syncedAt:data.syncedAt, daily, distance, duration, activeDays, missingDistance, missingLoad, sports, columns, cells, monthLabels, cards, initialDate};
}
