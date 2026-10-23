const version = new URL(import.meta.url).searchParams.get('v');
const {escapeHtml:esc, formatDistance, formatTime, durationSeconds} = await import('./journal.mjs' + (version ? '?v=' + version : ''));

const runSports = new Set(['跑步', '越野跑', '虚拟跑步']);
const isRide = sport => sport.includes('骑行');

const icons = {
  distance:'<path d="M4 24h5l5-16 8 16h6"/><circle cx="9" cy="24" r="2"/><circle cx="28" cy="24" r="2"/>',
  ride:'<circle cx="7" cy="23" r="6"/><circle cx="25" cy="23" r="6"/><circle cx="22" cy="5" r="2"/><path d="m16 8-5 6 7 4-2 6m0-16 6 6h5M7 23l5-9"/>',
  run:'<circle cx="19" cy="5" r="2"/><path d="m12 12 4-4 4 4 5 1M16 8l-3 9 5 4 1 6M13 17l-4 5H4M7 10l5 2"/>',
  count:'<path d="M5 27V18m6 9V13m6 14V8m6 19V15m6 12V5"/>',
  activeDays:'<rect x="5" y="7" width="22" height="20" rx="3"/><path d="M5 12h22M10 4v6m12-6v6"/><path d="m11 20 3 3 6-7"/>',
  duration:'<circle cx="16" cy="16" r="11"/><path d="M16 9v7l5 3M13 2h6"/>',
};

// 目标是固定的个人累计里程碑，不写入快照或配置；修改这里即可调整下一阶段。
const definitions = [
  {key:'distance', label:'累计里程', targets:[5000, 10000, 20000, 30000, 50000], amount:activity => activity.distanceKm},
  {key:'ride', label:'骑行里程', targets:[5000, 10000, 20000, 30000], amount:activity => isRide(activity.sport) ? activity.distanceKm : null},
  {key:'run', label:'跑步里程', targets:[1000, 2000, 5000, 10000], amount:activity => runSports.has(activity.sport) ? activity.distanceKm : null},
  {key:'count', label:'运动次数', targets:[100, 500, 1000, 1500, 2000], amount:() => 1},
  {key:'activeDays', label:'活跃天数', targets:[100, 365, 730, 1000, 1500], amount:() => 1},
  {key:'duration', label:'运动时长', targets:[500, 1000, 1500, 2000], amount:activity => durationSeconds(activity.duration)},
];

const targetValue = (key, target) => key === 'duration' ? target * 3600 : target;
const roundDistance = value => Math.round(value * 100) / 100;
const valueText = (key, value) => key === 'duration' ? formatTime(value)
  : key === 'distance' || key === 'ride' || key === 'run' ? formatDistance(value)
  : value.toLocaleString('zh-CN');
const targetText = (key, target) => key === 'duration' ? target.toLocaleString('zh-CN') + ' 小时'
  : key === 'distance' || key === 'ride' || key === 'run' ? formatDistance(target) + ' km'
  : target.toLocaleString('zh-CN') + (key === 'count' ? ' 次' : ' 天');
const unitText = key => key === 'distance' || key === 'ride' || key === 'run' ? 'km' : key === 'count' ? '次' : key === 'activeDays' ? '天' : '';
const remainingText = (track) => {
  if (!track.next) return '已达成全部目标';
  const remaining = targetValue(track.key, track.next.value) - track.total;
  if (track.key === 'duration') return '还差 ' + formatTime(remaining);
  return '还差 ' + valueText(track.key, roundDistance(remaining)) + (unitText(track.key) ? ' ' + unitText(track.key) : '');
};

function track(definition, activities) {
  const sorted = activities.slice().sort((a, b) => a.date.localeCompare(b.date));
  const reachedOn = new Map();
  const activeDates = new Set();
  let total = 0;
  for (const activity of sorted) {
    if (definition.key === 'activeDays') {
      if (activeDates.has(activity.date)) continue;
      activeDates.add(activity.date);
    }
    const amount = definition.amount(activity);
    if (amount === null || !Number.isFinite(amount)) continue;
    total = definition.key === 'distance' || definition.key === 'ride' || definition.key === 'run' ? roundDistance(total + amount) : total + amount;
    for (const target of definition.targets) {
      if (!reachedOn.has(target) && total >= targetValue(definition.key, target)) reachedOn.set(target, activity.date);
    }
  }
  const milestones = definition.targets.map(value => ({value, reached:reachedOn.has(value), date:reachedOn.get(value) ?? null}));
  const reached = milestones.filter(milestone => milestone.reached);
  const latest = reached.at(-1) ?? null;
  const next = milestones.find(milestone => !milestone.reached) ?? null;
  const progress = next ? Math.max(0, Math.min(1, total / targetValue(definition.key, next.value))) : 1;
  const result = {...definition, total, valueText:valueText(definition.key, total), milestones, latest, next, progress, reached:reached.length};
  return {...result, remainingText:remainingText(result)};
}

export function createMilestones(data) {
  if (!data || !Array.isArray(data.activities)) throw new Error('运动数据格式无效');
  const tracks = definitions.map(definition => track(definition, data.activities));
  const achievements = tracks.flatMap((item, trackIndex) => item.milestones.filter(milestone => milestone.reached)
    .map(milestone => ({track:item, trackIndex, value:milestone.value, date:milestone.date,
      text:item.label + ' · ' + targetText(item.key, milestone.value)})))
    .sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value || a.trackIndex - b.trackIndex);
  const firstDate = data.activities.reduce((first, activity) => !first || activity.date < first ? activity.date : first, '') || data.period?.start || null;
  return {
    tracks,
    firstDate,
    latest:achievements[0] ?? null,
    reached:achievements.length,
    totalMilestones:tracks.reduce((sum, item) => sum + item.milestones.length, 0),
    activityCount:data.activities.length,
    activeDays:tracks.find(item => item.key === 'activeDays').total,
    distanceKm:tracks.find(item => item.key === 'distance').total,
    durationSeconds:tracks.find(item => item.key === 'duration').total,
    unavailableCount:data.unavailableActivities?.length ?? 0,
  };
}

function renderTrack(item) {
  const progressText = item.next
    ? '已累计 ' + item.valueText + (unitText(item.key) ? ' ' + unitText(item.key) : '') + '，下一目标 ' + targetText(item.key, item.next.value) + '，' + item.remainingText
    : '已累计 ' + item.valueText + (unitText(item.key) ? ' ' + unitText(item.key) : '') + '，全部目标已达成';
  return `<article class="ms-track" data-track="${item.key}">
    <header class="ms-track-head"><span class="ms-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[item.key]}</svg></span><div><h3>${esc(item.label)}</h3></div><span class="ms-track-count">${item.reached} / ${item.milestones.length}</span></header>
    <p class="ms-track-value"><strong>${item.valueText}</strong>${unitText(item.key) ? '<small>' + unitText(item.key) + '</small>' : ''}</p>
    <div class="ms-next-line"><span>${item.next ? '下一站 ' + targetText(item.key, item.next.value) : '全部目标已达成'}</span><strong>${item.remainingText}</strong></div>
    <div class="ms-progress" role="progressbar" aria-label="${esc(item.label)}目标进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(item.progress * 100)}" aria-valuetext="${esc(progressText)}"><span style="width:${(item.progress * 100).toFixed(2)}%"></span></div>
    <details class="ms-history"><summary>达成记录<span>${item.reached} 项</span></summary><ol class="ms-steps" aria-label="${esc(item.label)}里程碑">${item.milestones.map(milestone => `<li data-state="${milestone.reached ? 'reached' : 'future'}"${milestone === item.next ? ' data-next="true"' : ''}><span>${item.key === 'duration' ? milestone.value.toLocaleString('zh-CN') : valueText(item.key, milestone.value)}</span><small>${milestone.date ? '<time datetime="' + milestone.date + '">' + milestone.date.replaceAll('-', '.') + '</time>' : '待达成'}</small></li>`).join('')}</ol></details>
  </article>`;
}

export function renderMilestones(data) {
  const summary = createMilestones(data);
  const latest = summary.latest
    ? `<span>最近达成</span><strong>${esc(summary.latest.text)}</strong><time datetime="${summary.latest.date}">${summary.latest.date.replaceAll('-', '.')}</time>`
    : summary.tracks.find(item => item.next)
      ? (() => {
        const first = summary.tracks.find(item => item.next);
        return `<span>第一个里程碑</span><strong>${esc(first.label + ' · ' + targetText(first.key, first.next.value))}</strong><p>${esc(first.remainingText)}</p>`;
      })()
      : '<span>里程碑</span><strong>全部目标已达成</strong>';
  return `<div class="ms-overview"><div class="ms-overview-copy"><div class="ms-kicker"><span>记录以来${summary.firstDate ? ' · ' + summary.firstDate.replaceAll('-', '.') + ' 起' : ''}</span><span>已达成 ${summary.reached} / ${summary.totalMilestones} 项</span></div>
    <p class="ms-distance"><strong>${formatDistance(summary.distanceKm)}</strong><small>km</small></p>
    <p class="ms-meta">${summary.activityCount.toLocaleString('zh-CN')} 次运动 · ${summary.activeDays.toLocaleString('zh-CN')} 个活跃日 · ${formatTime(summary.durationSeconds)}</p></div>
    <div class="ms-latest"${summary.latest ? '' : ' data-state="empty"'}>${latest}</div></div>
    <div class="ms-grid">${summary.tracks.map(renderTrack).join('')}</div>
    `;
}

export function renderMilestonePanel(data) {
  return `<section class="ms-section" id="milestones" aria-labelledby="milestones-title"><div class="section-head"><h2 id="milestones-title"><span class="section-number">05</span>运动里程碑</h2><p>全部历史</p></div><div class="ms-panel" id="milestone-content">${renderMilestones(data)}</div></section>`;
}

export function initializeMilestones(initialData) {
  let data = initialData;
  const content = document.getElementById('milestone-content');
  const render = () => {
    const html = renderMilestones(data);
    if (content.innerHTML !== html) content.innerHTML = html;
  };
  render();
  return latest => {
    data = latest;
    render();
  };
}
