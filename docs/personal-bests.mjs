const version = new URL(import.meta.url).searchParams.get('v');
const {escapeHtml:esc, isDate, formatDistance, formatTime, durationSeconds} = await import('./journal.mjs' + (version ? '?v=' + version : ''));

// 事件白名单同时决定分组的展示顺序：跑步按距离，骑行按距离与功率。
export const personalBestEvents = {'跑步':['5 公里', '10 公里', '半程马拉松', '全程马拉松'], '骑行':['最远距离', 'CP5', 'CP20']};
const eventOrder = Object.values(personalBestEvents).flat();
const eventSport = new Map(Object.entries(personalBestEvents).flatMap(([sport, events]) => events.map(event => [event, sport])));
const sportMarks = {
  '跑步':'<circle cx="19" cy="5" r="2"/><path d="m12 12 4-4 4 4 5 1M16 8l-3 9 5 4 1 6M13 17l-4 5H4M7 10l5 2"/>',
  '骑行':'<circle cx="7" cy="22" r="6"/><circle cx="25" cy="22" r="6"/><circle cx="21" cy="5" r="2"/><path d="m15 9-4 6 7 3-2 7m-1-16 6 5h6M7 22l4-7m10-1 4 8"/>',
};

export function validatePersonalBests(data) {
  const fail = () => { throw new Error('个人最佳成绩格式无效'); };
  if (!data || Object.keys(data).sort().join(',') !== 'records,source,syncedAt' || data.source !== 'Intervals.icu' || !Array.isArray(data.records)) fail();
  if (data.syncedAt === null) {
    if (data.records.length) fail();
  } else if (typeof data.syncedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.syncedAt) || !Number.isFinite(Date.parse(data.syncedAt)) || new Date(data.syncedAt).toISOString() !== data.syncedAt) fail();
  const keys = new Set();
  for (const record of data.records) {
    if (!record || Object.keys(record).filter(key => key !== 'stravaUrl').sort().join(',') !== 'activityUrl,date,event,result,sport' ||
      !['sport', 'event', 'result'].every(key => typeof record[key] === 'string' && record[key].trim()) ||
      !Object.hasOwn(personalBestEvents, record.sport) || eventSport.get(record.event) !== record.sport ||
      record.date !== null && !isDate(record.date) ||
      Object.hasOwn(record, 'stravaUrl') && (typeof record.stravaUrl !== 'string' || !/^https:\/\/www\.strava\.com\/activities\/[1-9]\d*$/.test(record.stravaUrl)) ||
      record.activityUrl !== null && (typeof record.activityUrl !== 'string' || !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(record.activityUrl))) fail();
    const key = JSON.stringify([record.sport, record.event]);
    if (keys.has(key)) fail();
    keys.add(key);
  }
}

export function renderPersonalBests(data) {
  validatePersonalBests(data);
  if (data.syncedAt === null) return '<p class="pb-empty">个人最佳成绩尚未同步。</p>';
  if (!data.records.length) return '<p class="pb-empty">暂无个人最佳成绩。</p>';
  // 分组与组内顺序都按固定事件顺序输出，不随同步顺序或手工编辑顺序变化。
  const groups = new Map(Object.keys(personalBestEvents).map(sport => [sport, []]));
  for (const record of data.records) groups.get(record.sport).push(record);
  for (const records of groups.values()) records.sort((a, b) => eventOrder.indexOf(a.event) - eventOrder.indexOf(b.event));
  for (const [sport, records] of groups) if (!records.length) groups.delete(sport);
  return [...groups].map(([sport, records]) => `<section class="pb-group" data-sport="${esc(sport)}"><div class="pb-group-head"><div class="pb-sport-heading"><span class="pb-sport-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${sportMarks[sport]}</svg></span><div><h3>${esc(sport)}</h3></div></div><span class="pb-count">${records.length} 项纪录</span></div><div class="pb-grid">${records.map(record => {
    const date = record.date ? `<time datetime="${record.date}">${record.date.replaceAll('-', '.')}</time>` : '<span>日期未提供</span>';
    const eventLabel = {CP5:'5 分钟功率', CP20:'20 分钟功率'}[record.event] ?? record.event;
    const displayedResult = record.event === '最远距离' && /^\d+(?:\.\d+)? km$/.test(record.result) ? formatDistance(Number.parseFloat(record.result)) + ' km'
      : sport === '跑步' && /^\d+:\d{2}(?::\d{2})?$/.test(record.result) ? formatTime(durationSeconds(record.result)) : record.result;
    const units = /^([\d,]+(?:\.\d+)?)(\s+)(km|W)$/.exec(displayedResult);
    const value = units ? `${esc(units[1])}${units[2]}<small class="pb-unit">${units[3]}</small>` : esc(displayedResult);
    const result = record.stravaUrl ? `<a class="pb-link" href="${esc(record.stravaUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(sport + ' ' + eventLabel + '，' + displayedResult + '，' + (record.date ?? '日期未提供') + '，在 Strava 查看（新标签页）')}">${value}<span class="pb-arrow" aria-hidden="true">↗</span></a>` : value;
    return `<article class="pb-card" data-event="${esc(record.event)}"><h4>${esc(eventLabel)}</h4><p class="pb-result">${result}</p><p class="pb-meta">${date}${record.stravaUrl ? '' : '<span>Strava 链接未提供</span>'}</p></article>`;
  }).join('')}</div></section>`).join('');
}

export function personalBestsSyncLabel(data) {
  if (!data.syncedAt) return '尚未同步';
  return '同步于 ' + new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(data.syncedAt)) + '（北京时间）';
}

export function renderPersonalBestsPanel(data) {
  return `<section class="pb-section" id="personal-bests" aria-labelledby="pb-title"><div class="section-head"><h2 id="pb-title"><span class="section-number">04</span>个人最佳成绩</h2><p>全部历史</p></div><div id="pb-content">${renderPersonalBests(data)}</div><p class="pb-sync" id="pb-sync">${personalBestsSyncLabel(data)}</p><p class="pb-status" id="pb-status" role="status" aria-live="polite"></p></section>`;
}

export function initializePersonalBests(initial) {
  validatePersonalBests(initial);
  let data = initial;
  const content = document.getElementById('pb-content');
  const sync = document.getElementById('pb-sync');
  const status = document.getElementById('pb-status');
  const render = () => {
    const html = renderPersonalBests(data);
    if (content.innerHTML !== html) {
      const activeUrl = content.contains(document.activeElement) ? document.activeElement?.closest('a')?.href : null;
      content.innerHTML = html;
      if (activeUrl) [...content.querySelectorAll('a')].find(link => link.href === activeUrl)?.focus({preventScroll:true});
    }
    sync.textContent = personalBestsSyncLabel(data);
  };
  render();
  return async () => {
    try {
      const response = await fetch(new URL('personal-bests.json', import.meta.url), {cache:'no-cache', signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('PB 请求失败');
      const latest = await response.json();
      validatePersonalBests(latest);
      if (data.syncedAt && (!latest.syncedAt || latest.syncedAt < data.syncedAt)) throw new Error('PB 快照尚未更新');
      data = latest;
      render();
      status.textContent = '';
    } catch {
      status.textContent = data.syncedAt ? '暂时无法读取最新 PB，保留最近成功同步的成绩。' : '暂时无法读取 PB，等待首次成功同步。';
    }
  };
}
