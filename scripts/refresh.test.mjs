import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';

// 运行真实 app.js，仅替换浏览器边界，检查刷新是否重建内容及日期是否滚动。
test('刷新复用缓存、只在内容或北京时间日期改变时重绘，并保留失败兜底', async t => {
  const initial = {
    period:{start:'2025-01-01', end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00',
    activities:[{date:'2026-10-09', sport:'骑行', distanceKm:20, duration:'1:00:00', trainingLoad:30}],
    unavailableActivities:[], gearLibrary:[{name:'公路车', type:'Bike', distanceKm:100, components:[]}, {name:'通勤车', type:'Bike', distanceKm:200, components:[]}],
  };
  let latest = structuredClone(initial);
  let respond = async () => ({ok:true, json:async () => structuredClone(latest)});
  const requests = [];
  const elements = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const intervals = [];
  const document = {hidden:false, activeElement:null,
    getElementById:id => element('#' + id), querySelector:selector => element(selector),
    querySelectorAll:selector => groups.get(selector) ?? [],
    addEventListener:(name, callback) => documentEvents.set(name, callback),
  };
  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const node = {value:'', textContent:'', dataset:{}, writes:0, children:[], style:{setProperty() {}},
      events:new Map(), attributes:new Map(),
      addEventListener(name, callback) { this.events.set(name, callback); },
      setAttribute(name, value) { this.attributes.set(name, value); },
      querySelectorAll() { return this.children; },
      querySelector() { return null; },
      matches() { return Boolean(this.dataset.date); },
      focus() { document.activeElement = this; },
      set innerHTML(html) {
        this.html = html;
        this.writes++;
        if (selector === '.day-grid') this.children = [...html.matchAll(/<button class="day-cell"[^>]*data-date="([^"]+)"/g)]
          .map(([,date]) => ({dataset:{date}, setAttribute() {}, matches:() => true, scrollIntoView() {}, focus() { document.activeElement = this; }}));
      },
      get innerHTML() { return this.html; },
    };
    elements.set(selector, node);
    return node;
  }
  const groups = new Map(['.metric-value', '.metric-note', '[data-metric]'].map(selector =>
    [selector, Array.from({length:3}, (_, index) => element(selector + index))]));
  groups.set('[data-activity-view]', ['month','year'].map(view => {
    const toggle = element('activity-view-' + view);
    toggle.dataset.activityView = view;
    return toggle;
  }));
  groups.get('[data-metric]').forEach((node, index) => node.dataset.metric = ['distanceKm','durationSeconds','trainingLoad'][index]);
  element('#journal-data').textContent = JSON.stringify(initial);
  const replacements = {document, window:{addEventListener:(name, callback) => windowEvents.set(name, callback)},
    matchMedia:() => ({matches:false}), setInterval:(callback, delay) => intervals.push({callback, delay})};
  for (const [name, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable:true, writable:true, value});
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-10-15T04:00:00Z')});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({url, options});
    return respond();
  });
  await import('../docs/app.js');
  await setImmediate();
  const grid = element('.day-grid');
  const gear = element('.gear-library');
  const trends = element('#trend-content');
  const status = element('#sync-status');
  const refresh = async () => { intervals[0].callback(); await setImmediate(); };

  assert.equal(grid.writes, 1, '首次 JSON 与内嵌快照相同时不重绘');
  assert.equal(trends.writes, 1);
  assert.equal(intervals[0].delay, 5 * 60000);
  assert.equal(requests[0].options.cache, 'no-cache');
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.match(requests[0].url.pathname, /\/activities\.json$/);
  const focused = grid.children[0];
  document.activeElement = focused;
  await refresh();
  assert.equal(grid.writes, 1);
  assert.equal(gear.writes, 1);
  assert.equal(trends.writes, 1, '数据未变化时不重建趋势');
  assert.equal(document.activeElement, focused);
  assert.equal(status.textContent, '已读取最新已同步数据');

  latest.syncedAt = '2026-10-15 12:01:00 +08:00';
  await refresh();
  assert.equal(grid.writes, 2, '新快照正常刷新');
  latest.activities[0].distanceKm = 25;
  await refresh();
  assert.equal(grid.writes, 3, '同步时间相同但内容变化也刷新');
  assert.match(groups.get('.metric-value')[0].innerHTML, /25\.00/);
  const chooseTrend = (selector, dataset) => element('.trend-panel').events.get('click')({target:{closest:query => query === selector ? {dataset} : null}});
  chooseTrend('[data-trend-mode]', {trendMode:'week'});
  chooseTrend('[data-period]', {period:'2026-10-05'});
  element('#trend-metric').events.get('change')({target:{value:'durationSeconds'}});
  assert.match(trends.innerHTML, /周一至周日汇总 · 时长/);
  assert.match(trends.innerHTML, /2026\.10\.05 — 2026\.10\.11/);

  latest = structuredClone(initial);
  await refresh();
  assert.equal(grid.writes, 3, '拒绝旧快照');
  assert.match(status.textContent, /暂时无法读取/);
  latest.syncedAt = '2026-10-15 12:01:00 +08:00';
  latest.activities[0].distanceKm = -1;
  await refresh();
  assert.equal(grid.writes, 3, '拒绝无效快照');
  latest.activities[0].distanceKm = 25;
  await refresh();
  assert.equal(grid.writes, 3);
  assert.equal(status.textContent, '已读取最新已同步数据', '未重绘也更新恢复提示');

  t.mock.timers.setTime(Date.parse('2026-10-16T04:00:00Z'));
  await refresh();
  assert.equal(grid.writes, 4);
  assert.match(trends.innerHTML, /周一至周日汇总 · 时长/);
  assert.match(trends.innerHTML, /2026\.10\.05 — 2026\.10\.11/, '跨天刷新保留选中周期和指标');
  assert.equal(element('#selected-date').max, '2026-10-16');
  assert.match(element('#calendar-days').innerHTML, /data-date="2026-10-16" data-level="missing"/, '月历跨天保留未同步状态');
  assert.equal(element('.records-grid').innerHTML.includes('record-card'), false, '最近一周剔除过期记录');
  assert.equal(grid.children.at(-1).dataset.date, '2026-10-16');
  assert.match(grid.children.at(-1).title, /尚未同步/);
  assert.match(status.textContent, /最近成功同步/);

  respond = async () => { throw new Error('offline'); };
  t.mock.timers.setTime(Date.parse('2026-10-17T04:00:00Z'));
  await refresh();
  assert.equal(grid.writes, 5, '网络失败也滚动日期');
  assert.equal(element('#selected-date').max, '2026-10-17');
  assert.match(status.textContent, /暂时无法读取/);
  assert.match(groups.get('.metric-value')[0].innerHTML, /25\.00/, '失败保留旧数据');

  let rejectRequest;
  respond = () => new Promise((resolve, reject) => { rejectRequest = reject; });
  await refresh();
  const count = requests.length;
  await refresh();
  assert.equal(requests.length, count, '请求进行中不重复请求');
  t.mock.timers.setTime(Date.parse('2026-10-18T04:00:00Z'));
  rejectRequest(new Error('timeout'));
  await setImmediate();
  assert.equal(grid.writes, 6, '请求期间跨天且失败也滚动日期');
  assert.equal(element('#selected-date').max, '2026-10-18');

  respond = async () => ({ok:false, status:503});
  await refresh();
  assert.equal(grid.writes, 6);
  assert.match(status.textContent, /暂时无法读取/);
  document.hidden = true;
  await refresh();
  assert.equal(requests.length, count + 1, '后台暂停定时检查');
  document.hidden = false;
  documentEvents.get('visibilitychange')();
  await setImmediate();
  windowEvents.get('pageshow')({persisted:true});
  await setImmediate();
  assert.equal(requests.length, count + 3, '返回前台和 bfcache 恢复继续检查');

  await t.test('切换年度仅更新年度内容，保留装备节点及区域内焦点', () => {
    const year = element('#activity-year');
    const gearWrites = gear.writes;
    const recent = element('.records-grid');
    const recentWrites = recent.writes;
    const summaryWrites = element('.recent-summary').writes;
    const historyResults = element('#history-results');
    element('#history-min-distance').value = '30';
    element('#history-filters').events.get('submit')({preventDefault() {}});
    const historyWrites = historyResults.writes;
    const summary = element('装备标题');
    summary.focus();
    for (const range of ['2025', '2026', 'recent']) {
      const previousGridWrites = grid.writes;
      year.value = range;
      year.events.get('change')();
      assert.equal(gear.writes, gearWrites, '不替换装备节点，保留原有展开状态');
      assert.equal(recent.writes, recentWrites, '年度筛选不重建最近一周记录');
      assert.equal(element('.recent-summary').writes, summaryWrites, '年度筛选不重建最近七天摘要');
      assert.equal(historyResults.writes, historyWrites, '年度筛选不重建历史列表');
      assert.equal(element('#history-min-distance').value, '30', '历史筛选独立保留');
      assert.equal(document.activeElement, summary, '不移除装备区域内的焦点');
      assert.equal(grid.writes, previousGridWrites + 1, '年度热力图正常更新');
      assert.equal(element('.overview-range').textContent, range === 'recent' ? '最近一年' : range + ' 年');
      assert.match(trends.innerHTML, /周一至周日汇总 · 时长/, '切换年度保留趋势周期和指标');
      if (range === '2025') assert.match(trends.innerHTML, /2025\.12\.29 — 2026\.01\.04/, '年度末周展示完整自然周');
      assert.equal(element('#selected-date').min, range === 'recent' ? '2025-10-19' : range + '-01-01');
      assert.equal(element('#selected-date').max, range === 'recent' ? '2026-10-18' : range + '-12-31');
      assert.match(groups.get('.metric-value')[0].innerHTML, range === '2025' ? /0\.00/ : /25\.00/);
      assert.match(element('#day-description').textContent, range === '2025' ? /2025-12-31/ : /2026-10-09/);
      assert.equal(element('#day-records').hidden, range === '2025');
    }
  });

  await t.test('装备内容变化时正常更新装备区域', async () => {
    const gearWrites = gear.writes;
    latest.gearLibrary[0].distanceKm = 123;
    respond = async () => ({ok:true, json:async () => structuredClone(latest)});
    await refresh();
    assert.equal(gear.writes, gearWrites + 1);
    assert.match(gear.innerHTML, /<strong>123 km<\/strong>/);
    assert.match(gear.innerHTML, /公路车/);
  });

  await t.test('维护入口展开目标车辆并聚焦配件，年度切换及无变化刷新保留状态', async () => {
    const bike = element('目标车辆');
    const other = element('其他车辆');
    bike.open = false;
    other.open = true;
    const part = element('#gear-part-1-0');
    part.closest = selector => selector === '.gear-bike' ? bike : null;
    const link = {dataset:{gearTarget:'gear-part-1-0'}};
    gear.events.get('click')({target:{closest:() => link}});
    assert.equal(bike.open, true);
    assert.equal(other.open, true);
    assert.equal(document.activeElement, part);
    const writes = gear.writes;
    const year = element('#activity-year');
    for (const range of ['2025','recent']) {
      year.value = range;
      year.events.get('change')();
      assert.equal(gear.writes, writes);
      assert.equal(bike.open, true);
      assert.equal(other.open, true);
      assert.equal(document.activeElement, part);
    }
    await refresh();
    assert.equal(gear.writes, writes);
    assert.equal(document.activeElement, part);
  });

  await t.test('月历翻月、点日期、键盘边界和回到今天同步更新明细及年度范围', () => {
    const calendar = element('#calendar-days');
    const date = element('#selected-date');
    const year = element('#activity-year');
    const click = id => element('#' + id).events.get('click')();
    const choose = day => calendar.events.get('click')({target:{closest:() => ({dataset:{date:day}})}});
    const key = (day, key) => calendar.events.get('keydown')({key, preventDefault() {}, target:{closest:() => ({dataset:{date:day}})}});
    choose('2026-10-09');
    assert.equal(date.value, '2026-10-09');
    assert.equal(element('#day-records').hidden, false);
    click('calendar-previous');
    assert.equal(date.value, '2026-09-09');
    assert.equal(element('#calendar-month').textContent, '2026 年 9 月');
    assert.equal(element('#day-records').hidden, true);
    click('calendar-next');
    assert.equal(date.value, '2026-10-09');
    key('2026-10-09', 'ArrowDown');
    assert.equal(date.value, '2026-10-16');
    key('2026-10-16', 'PageDown');
    assert.equal(date.value, '2026-10-18', '最近一年右边界夹紧至北京时间今天');
    assert.equal(element('#calendar-next').disabled, true);
    const writes = calendar.writes;
    click('calendar-next');
    assert.equal(calendar.writes, writes, '边界翻月无效');
    element('activity-view-year').events.get('click')();
    assert.equal(element('.heatmap-card').dataset.mobileView, 'year');
    element('activity-view-month').events.get('click')();
    assert.equal(element('.heatmap-card').dataset.mobileView, 'month');
    assert.equal(date.value, '2026-10-18', '切换视图保留日期');
    year.value = '2025';
    year.events.get('change')();
    assert.equal(element('#calendar-month').textContent, '2025 年 12 月');
    click('back-to-today');
    assert.equal(year.value, 'recent');
    assert.equal(date.value, '2026-10-18');
    assert.equal(element('#calendar-month').textContent, '2026 年 10 月');
    assert.match(element('#day-description').textContent, /尚未同步/);
    assert.equal(element('#day-records').hidden, true);
  });
});
