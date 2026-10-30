const version = new URL(import.meta.url).searchParams.get('v');
const {escapeHtml:esc, isDate, formatDistance, formatTime} = await import('./journal.mjs' + (version ? '?v=' + version : ''));

// 事件白名单同时决定分组的展示顺序：跑步按距离，骑行按距离与功率。
const {sportLabel} = await import('./activity-data.mjs' + (version ? '?v=' + version : ''));
export const personalBestEvents = {Run:['run5k', 'run10k', 'halfMarathon', 'marathon'], Ride:['longestRide', 'cp5', 'cp20']};
const events = {
  run5k:{label:'5 公里', unit:'seconds'}, run10k:{label:'10 公里', unit:'seconds'},
  halfMarathon:{label:'半程马拉松', unit:'seconds'}, marathon:{label:'全程马拉松', unit:'seconds'},
  longestRide:{label:'最远距离', unit:'km'}, cp5:{label:'5 分钟功率', unit:'W'}, cp20:{label:'20 分钟功率', unit:'W'},
};
const eventOrder = Object.values(personalBestEvents).flat();
const eventSport = new Map(Object.entries(personalBestEvents).flatMap(([sport, events]) => events.map(event => [event, sport])));
export const compareRecordHistory = (a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
  (a.activityUrl ?? a.stravaUrl ?? '').localeCompare(b.activityUrl ?? b.stravaUrl ?? '') || eventOrder.indexOf(a.event) - eventOrder.indexOf(b.event);
export const improvesRecord = (event, value, previous) => events[event].unit === 'seconds' ? value < previous : value > previous;
const sportMarks = {
  Run:'<circle cx="19" cy="5" r="2"/><path d="m12 12 4-4 4 4 5 1M16 8l-3 9 5 4 1 6M13 17l-4 5H4M7 10l5 2"/>',
  Ride:'<circle cx="7" cy="22" r="6"/><circle cx="25" cy="22" r="6"/><circle cx="21" cy="5" r="2"/><path d="m15 9-4 6 7 3-2 7m-1-16 6 5h6M7 22l4-7m10-1 4 8"/>',
};

export function validatePersonalBests(data) {
  const fail = () => { throw new Error('个人最佳成绩格式无效'); };
  if (!data || Object.keys(data).sort().join(',') !== 'history,records,source,syncedAt' || data.source !== 'Intervals.icu' || !Array.isArray(data.records) || !Array.isArray(data.history)) fail();
  if (data.syncedAt === null) {
    if (data.records.length || data.history.length) fail();
  } else if (typeof data.syncedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.syncedAt) || !Number.isFinite(Date.parse(data.syncedAt)) || new Date(data.syncedAt).toISOString() !== data.syncedAt) fail();
  const keys = new Set();
  for (const [records, historical] of [[data.records, false], [data.history, true]]) for (const record of records) {
    if (!record || Object.keys(record).filter(key => key !== 'stravaUrl' && !(historical && key === 'startTime')).sort().join(',') !== 'activityUrl,date,event,sport,value' ||
      !['sport', 'event'].every(key => typeof record[key] === 'string' && record[key].trim()) ||
      !Object.hasOwn(personalBestEvents, record.sport) || eventSport.get(record.event) !== record.sport || typeof record.value !== 'number' || !Number.isFinite(record.value) || record.value <= 0 ||
      !isDate(record.date) ||
      Object.hasOwn(record, 'stravaUrl') && (typeof record.stravaUrl !== 'string' || !/^https:\/\/www\.strava\.com\/activities\/[1-9]\d*$/.test(record.stravaUrl)) ||
      record.activityUrl !== null && (typeof record.activityUrl !== 'string' || !/^https:\/\/intervals\.icu\/activities\/i?\d+$/.test(record.activityUrl)) ||
      !record.activityUrl && !record.stravaUrl ||
      historical && (!Object.hasOwn(record, 'startTime') || record.startTime !== null && (typeof record.startTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(record.startTime)))) fail();
    if (historical) continue;
    const key = JSON.stringify([record.sport, record.event]);
    if (keys.has(key)) fail();
    keys.add(key);
  }
  const latest = new Map();
  for (const record of data.history.slice().sort(compareRecordHistory)) {
    const previous = latest.get(record.event);
    if (previous && !improvesRecord(record.event, record.value, previous.value)) fail();
    latest.set(record.event, record);
  }
  for (const [event, record] of latest) {
    const current = data.records.find(item => item.event === event);
    if (!current || ['sport', 'value', 'date', 'activityUrl', 'stravaUrl'].some(key => current[key] !== record[key])) fail();
  }
  if (data.records.some(record => !latest.has(record.event))) fail();
}

const historyValue = (event, value) => events[event].unit === 'seconds' ? formatTime(Math.round(value))
  : events[event].unit === 'km' ? formatDistance(value) + ' km' : Math.round(value) + ' W';

export function personalRecordTimeline(data, {event = ''} = {}) {
  validatePersonalBests(data);
  const previous = new Map();
  const records = data.history.slice().sort(compareRecordHistory).map(record => {
    const previousValue = previous.get(record.event) ?? null;
    previous.set(record.event, record.value);
    return {...record, previousValue};
  }).reverse().filter(record => !event || record.event === event);
  return {total:records.length, records};
}

export function renderRecordHistory(data, options = {}) {
  const {records, total} = personalRecordTimeline(data, options);
  const years = new Map();
  for (const record of records) {
    const year = record.date.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(record);
  }
  const html = [...years].map(([year, entries]) => `<section class="pb-history-year" style="--pb-year-records:${entries.length}" aria-label="${year} 年纪录"><h5>${year}</h5><ol>${entries.map(record => {
    const {event, value, previousValue} = record;
    const delta = previousValue === null ? null : Math.abs(value - previousValue);
    const improvement = delta === null ? '首次成绩' : events[event].unit === 'seconds' ? '缩短 ' + (delta < 1 ? '不足 1 秒' : historyValue(event, delta))
      : '提升 ' + (events[event].unit === 'km' && delta < .01 ? '不足 0.01 km' : events[event].unit === 'W' && delta < 1 ? '不足 1 W' : historyValue(event, delta));
    const url = record.stravaUrl ?? record.activityUrl;
    const label = event === 'longestRide' ? '最远骑行' : sportLabel(record.sport) + ' ' + events[event].label;
    return `<li class="pb-history-entry" data-event="${event}" data-first="${previousValue === null}"><time datetime="${record.date}${record.startTime ? 'T' + record.startTime + '+08:00' : ''}">${record.date.replaceAll('-', '.')}</time><div class="pb-history-detail"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(record.date + ' ' + label + '，' + historyValue(event, value) + '，查看活动（新标签页）')}"><strong>${historyValue(event, value)}</strong><span aria-hidden="true"> ↗</span></a><span class="pb-history-improvement">${improvement}</span></div></li>`;
  }).join('')}</ol></section>`).join('');
  return {html:html || '<p class="pb-empty">暂无可读取的纪录历程。</p>', total};
}

function renderCardHistory(data, event, {open = false} = {}) {
  const total = data.history.filter(record => record.event === event).length;
  return `<details class="pb-record-history" data-pb-event="${event}"${open ? ' open' : ''}><summary aria-label="${esc(events[event].label + '记录历程，' + total + ' 项')}" aria-controls="pb-history-panel"><span>记录历程</span><span class="pb-history-count">${total} 项</span><span class="pb-history-toggle" aria-hidden="true"></span></summary></details>`;
}

function renderHistoryContent(data, event) {
  return `<p class="pb-history-note">基于可读取的历史成绩</p><div class="pb-history-track" data-pb-event="${event}" tabindex="0" role="region" aria-label="${esc(events[event].label + '纪录时间线，可左右滚动')}">${renderRecordHistory(data, {event}).html}</div>`;
}

export function renderPersonalBests(data, historyState = new Map()) {
  validatePersonalBests(data);
  if (data.syncedAt === null) return '<p class="pb-empty">个人最佳成绩尚未同步。</p>';
  if (!data.records.length) return '<p class="pb-empty">暂无个人最佳成绩。</p>';
  // 分组与组内顺序都按固定事件顺序输出，不随同步顺序或手工编辑顺序变化。
  const groups = new Map(Object.keys(personalBestEvents).map(sport => [sport, []]));
  for (const record of data.records) groups.get(record.sport).push(record);
  for (const records of groups.values()) records.sort((a, b) => eventOrder.indexOf(a.event) - eventOrder.indexOf(b.event));
  for (const [sport, records] of groups) if (!records.length) groups.delete(sport);
  const selected = data.records.find(record => historyState.get(record.event)?.open)?.event;
  return [...groups].map(([sport, records]) => `<section class="pb-group" data-sport="${esc(sport)}"><div class="pb-group-head"><div class="pb-sport-heading"><span class="pb-sport-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${sportMarks[sport]}</svg></span><div><h3>${esc(sportLabel(sport))}</h3></div></div><span class="pb-count">${records.length} 项纪录</span></div><div class="pb-grid">${records.map(record => {
    const date = `<time datetime="${record.date}">${record.date.replaceAll('-', '.')}</time>`;
    const {label:eventLabel, unit} = events[record.event];
    const number = unit === 'seconds' ? formatTime(Math.round(record.value)) : unit === 'km' ? formatDistance(record.value) : String(Math.round(record.value));
    const value = esc(number) + (unit === 'seconds' ? '' : ` <small class="pb-unit">${unit}</small>`);
    return `<article class="pb-card" data-event="${esc(record.event)}"><h4>${esc(eventLabel)}</h4><p class="pb-result">${value}</p><p class="pb-meta">${date}</p>${renderCardHistory(data, record.event, historyState.get(record.event))}</article>`;
  }).join('')}</div>${selected && eventSport.get(selected) === sport ? `<div class="pb-history-panel" id="pb-history-panel">${renderHistoryContent(data, selected)}</div>` : ''}</section>`).join('');
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
  const historyState = new Map();
  const rememberHistory = () => {
    const track = content.querySelector('.pb-history-track');
    if (track) historyState.set(track.dataset.pbEvent, {...historyState.get(track.dataset.pbEvent), scrollLeft:track.scrollLeft});
    for (const details of content.querySelectorAll('details[data-pb-event]')) {
      historyState.set(details.dataset.pbEvent, {...historyState.get(details.dataset.pbEvent), open:details.open});
    }
  };
  const renderHistory = () => {
    const selected = [...content.querySelectorAll('details[data-pb-event]')].find(details => details.open)?.dataset.pbEvent;
    const existing = content.querySelector('#pb-history-panel');
    if (!selected) {
      existing?.remove();
      return;
    }
    const group = content.querySelector('details[data-pb-event="' + selected + '"]').closest('.pb-group');
    const html = selected ? renderHistoryContent(data, selected) : '';
    if (existing?.closest('.pb-group') !== group) {
      existing?.remove();
      group.insertAdjacentHTML('beforeend', `<div class="pb-history-panel" id="pb-history-panel">${html}</div>`);
    } else if (existing.innerHTML !== html) existing.innerHTML = html;
    const panel = group.querySelector('#pb-history-panel');
    if (selected) panel.querySelector('.pb-history-track').scrollLeft = historyState.get(selected)?.scrollLeft ?? 0;
  };
  content.addEventListener('toggle', event => {
    const opened = event.target;
    if (!opened.matches('details[data-pb-event]')) return;
    rememberHistory();
    if (opened.open) for (const details of content.querySelectorAll('details[data-pb-event]')) {
      if (details !== opened) details.open = false;
    }
    rememberHistory();
    renderHistory();
  }, true);
  const render = () => {
    const html = renderPersonalBests(data, historyState);
    if (content.innerHTML !== html) {
      const active = content.contains(document.activeElement) ? document.activeElement : null;
      const activeEvent = active?.closest('details')?.dataset.pbEvent;
      content.innerHTML = html;
      const track = content.querySelector('.pb-history-track');
      if (track) track.scrollLeft = historyState.get(track.dataset.pbEvent)?.scrollLeft ?? 0;
      const details = [...content.querySelectorAll('details[data-pb-event]')].find(node => node.dataset.pbEvent === activeEvent);
      if (active?.matches('summary')) details?.querySelector('summary')?.focus({preventScroll:true});
      else if (active?.matches('.pb-history-track')) track?.focus({preventScroll:true});
      else if (active?.matches('a')) [...content.querySelectorAll('a')].find(link => link.href === active.href)?.focus({preventScroll:true});
    }
    sync.textContent = personalBestsSyncLabel(data);
  };
  let drag = null;
  let suppressClick = false;
  content.addEventListener('pointerdown', event => {
    suppressClick = false;
    const track = event.target.closest('.pb-history-track');
    if (event.pointerType !== 'mouse' || event.button !== 0 || !track || track.scrollWidth <= track.clientWidth) return;
    drag = {track, id:event.pointerId, x:event.clientX, y:event.clientY, left:track.scrollLeft, moved:false};
  });
  content.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const distance = event.clientX - drag.x;
    if (!drag.moved && (Math.abs(distance) < 6 || Math.abs(distance) <= Math.abs(event.clientY - drag.y))) return;
    if (!drag.moved) {
      drag.track.setPointerCapture(drag.id);
      drag.track.classList.add('is-dragging');
      drag.moved = true;
    }
    event.preventDefault();
    drag.track.scrollLeft = drag.left - distance;
  });
  const finishDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    suppressClick = drag.moved && event.type !== 'pointercancel';
    drag.track.classList.remove('is-dragging');
    if (drag.track.hasPointerCapture(drag.id)) drag.track.releasePointerCapture(drag.id);
    drag = null;
  };
  content.addEventListener('pointerup', finishDrag);
  content.addEventListener('pointercancel', finishDrag);
  content.addEventListener('dragstart', event => {if (event.target.closest('.pb-history-track')) event.preventDefault();});
  content.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0 && event.target.closest('.pb-history-track')) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
      return;
    }
  });
  rememberHistory();
  render();
  return async () => {
    try {
      const response = await fetch(new URL('personal-bests.json', import.meta.url), {cache:'no-cache', signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('PB 请求失败');
      const latest = await response.json();
      validatePersonalBests(latest);
      if (data.syncedAt && (!latest.syncedAt || latest.syncedAt < data.syncedAt)) throw new Error('PB 快照尚未更新');
      rememberHistory();
      data = latest;
      render();
      status.textContent = '';
    } catch {
      status.textContent = data.syncedAt ? '暂时无法读取最新 PB，保留最近成功同步的成绩。' : '暂时无法读取 PB，等待首次成功同步。';
    }
  };
}
