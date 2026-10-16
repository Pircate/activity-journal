import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';

// 运行真实 app.js，仅替换浏览器边界，检查刷新是否重建内容及日期是否滚动。
test('刷新复用缓存、只在内容或北京时间日期改变时重绘，并保留失败兜底', async t => {
  const initial = {
    period:{start:'2025-01-01', end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00',
    activities:[{date:'2026-10-09', sport:'骑行', distanceKm:20, duration:'1:00:00', trainingLoad:30, activityUrl:'https://intervals.icu/activities/i1'}],
    unavailableActivities:[], gearLibrary:[{name:'公路车', type:'Bike', distanceKm:100, components:[]}, {name:'通勤车', type:'Bike', distanceKm:200, components:[]}],
  };
  let latest = structuredClone(initial);
  let respond = async () => ({ok:true, json:async () => structuredClone(latest)});
  const requests = [];
  const initialBests = {source:'Intervals.icu', syncedAt:'2026-10-15T04:00:00.000Z', records:[{sport:'跑步', event:'5 公里', result:'25:00', date:'2026-10-09', activityUrl:'https://intervals.icu/activities/i123'}]};
  let latestBests = structuredClone(initialBests);
  let failBests = false;
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
      removeAttribute(name) { this.attributes.delete(name); },
      querySelectorAll() { return this.children; },
      querySelector() { return null; },
      contains(node) { return this.children.includes(node); },
      matches() { return Boolean(this.dataset.date); },
      focus() { document.activeElement = this; },
      set innerHTML(html) {
        this.html = html;
        this.writes++;
        if (selector === '.day-grid') this.children = [...html.matchAll(/<button class="day-cell"[^>]*data-date="([^"]+)" data-level="([^"]*)" data-state="([^"]*)" data-unavailable="([^"]*)"/g)]
          .map(([,date, level, state, unavailable]) => ({dataset:{date, level, state, unavailable}, setAttribute() {}, matches:() => true, scrollIntoView() {}, focus() { document.activeElement = this; }}));
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
  element('#personal-bests-data').textContent = JSON.stringify(initialBests);
  element('meta[property="og:title"]').content = '波咖茶的运动日志';
  const replacements = {document, window:{addEventListener:(name, callback) => windowEvents.set(name, callback)},
    matchMedia:() => ({matches:false}), setInterval:(callback, delay) => intervals.push({callback, delay})};
  for (const [name, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable:true, writable:true, value});
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  t.mock.timers.enable({apis:['Date'], now:new Date('2026-10-15T04:00:00Z')});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.pathname.endsWith('/personal-bests.json')) {
      if (failBests) throw new Error('PB offline');
      return {ok:true, json:async () => structuredClone(latestBests)};
    }
    requests.push({url, options});
    return respond();
  });
  await import('../docs/app.js');
  await setImmediate();
  const bests = element('#pb-content');
  assert.match(bests.innerHTML, /25:00/);
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
  assert.equal(bests.writes, 1, 'PB 内容相同时保留节点和焦点');
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
  assert.match(element('#calendar-days').innerHTML, /data-date="2026-10-16" data-level="missing" data-state="pending"/, '月历跨天保留未同步状态');
  assert.equal(element('.records-grid').innerHTML.includes('record-card'), false, '最近一周剔除过期记录');
  assert.equal(grid.children.at(-1).dataset.date, '2026-10-16');
  assert.match(grid.children.at(-1).title, /未同步/);
  assert.match(status.textContent, /最近成功同步/);

  latestBests.records[0].result = '24:00';
  latestBests.syncedAt = '2026-10-16T04:00:00.000Z';
  respond = async () => { throw new Error('offline'); };
  t.mock.timers.setTime(Date.parse('2026-10-17T04:00:00Z'));
  await refresh();
  assert.equal(grid.writes, 5, '网络失败也滚动日期');
  assert.match(bests.innerHTML, /24:00/, '活动请求失败不阻止 PB 独立更新');
  const bestWrites = bests.writes;
  failBests = true;
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
  assert.equal(bests.writes, bestWrites, 'PB 失败保留旧快照');
  assert.match(element('#pb-status').textContent, /保留最近成功同步/);
  failBests = false;
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
    const trendWrites = trends.writes;
    const trendHtml = trends.innerHTML;
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
      assert.equal(trends.writes, trendWrites, '年度范围不重建独立的运动趋势');
      assert.equal(bests.writes, bestWrites, '年度范围不重建 PB');
      assert.equal(trends.innerHTML, trendHtml, '年度范围不改变趋势选中周期及明细');
      assert.equal(element('#selected-date').min, range === 'recent' ? '2025-10-19' : range + '-01-01');
      assert.equal(element('#selected-date').max, range === 'recent' ? '2026-10-18' : range + '-12-31');
      assert.match(element('#stat-notes-body').innerHTML, new RegExp(range === 'recent' ? '最近一年' : range + ' 年'), '折叠说明跟随年度范围');
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

  await t.test('运动类型分布作为年度筛选入口，只更新年度区域', async () => {
    const filter = element('#sport-filter');
    const gridWrites = grid.writes;
    const recentWrites = element('.records-grid').writes;
    const summaryWrites = element('.recent-summary').writes;
    const historyWrites = element('#history-results').writes;
    const gearWrites = gear.writes;
    const trendWrites = trends.writes;
    const sport = element('sport-chip');
    sport.dataset = {sport:'骑行'};
    sport.closest = selector => selector === '#sport-filter' ? filter : null;
    sport.matches = () => false;
    sport.focus = () => { document.activeElement = sport; };
    groups.set('#sport-filter [data-sport]', [sport]);
    sport.focus();
    filter.events.get('click')({target:{closest:() => sport}});
    assert.equal(grid.writes, gridWrites + 1, '年度热力图随类型筛选更新');
    assert.equal(element('.records-grid').writes, recentWrites);
    assert.equal(element('.recent-summary').writes, summaryWrites);
    assert.equal(element('#history-results').writes, historyWrites);
    assert.equal(gear.writes, gearWrites);
    assert.equal(document.activeElement, sport, '重绘筛选后恢复键盘焦点');
    assert.match(element('#sport-filter-status').textContent, /^已筛选：骑行/);
    assert.match(filter.innerHTML, /data-sport="骑行" aria-pressed="true"/);
    assert.match(element('#stat-notes-body').innerHTML, /历史记录查询只列出详情可读取的 <strong>\d+<\/strong> 条活动/, '折叠说明跟随类型筛选更新');
    assert.match(element('#stat-notes-body').innerHTML, /详情不可读取的记录没有运动类型，未计入所选类型/, '筛选时说明排除的不可读取记录');
    assert.equal(trends.writes, trendWrites, '年度运动类型不重建独立的运动趋势');
    filter.events.get('click')({target:{closest:() => sport}});
    assert.equal(grid.writes, gridWrites + 2, '再次点击清除筛选');
    assert.match(filter.innerHTML, /data-sport="" aria-pressed="true"/);
    assert.equal(element('#sport-filter-status').textContent, '点选类型筛选年度范围，次数为该范围全部记录');
  });

  await t.test('趋势范围与类型独立筛选，刷新保留选择，且不改变全年活动', async () => {
    const year = element('#trend-year');
    const sport = element('#trend-sport');
    const gridWrites = grid.writes;
    const annualSport = element('#sport-filter').innerHTML;
    const annualRange = element('#activity-year').value;
    year.value = '2025';
    year.events.get('change')();
    assert.match(trends.innerHTML, /2025\.12\.29 — 2026\.01\.04/, '趋势范围的边界周包含完整自然周');
    sport.value = '骑行';
    sport.events.get('change')();
    const html = trends.innerHTML;
    assert.equal(grid.writes, gridWrites, '趋势筛选不重建全年活动');
    assert.equal(element('#activity-year').value, annualRange);
    assert.equal(element('#sport-filter').innerHTML, annualSport);
    latest.syncedAt = '2026-10-18 12:00:00 +08:00';
    await refresh();
    assert.equal(year.value, '2025', '数据刷新保留趋势范围');
    assert.equal(sport.value, '骑行', '数据刷新保留趋势运动类型');
    assert.equal(trends.innerHTML, html, '刷新保留周期、指标和选中项');
    year.value = 'recent';
    year.events.get('change')();
    chooseTrend('[data-period]', {period:'2026-10-05'});
    assert.match(trends.innerHTML, /周一至周日汇总 · 时长/);
    assert.match(trends.innerHTML, /<span>25 公里<\/span>/);
    // 合法但该范围内没有记录的类型应呈现零合计，不回退到全部运动。
    latest.activities.push({...latest.activities[0], date:'2025-01-01', sport:'跑步', distanceKm:5, activityUrl:'https://intervals.icu/activities/i2'});
    await refresh();
    sport.value = '跑步';
    sport.events.get('change')();
    assert.match(trends.innerHTML, /<span>0 次<\/span>/);
    assert.doesNotMatch(trends.innerHTML, /<span>25 公里<\/span>/);
    assert.match(sport.innerHTML, /value="跑步"/);
    sport.value = '';
    sport.events.get('change')();
    latest.activities.pop();
    await refresh();
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
    assert.match(element('#day-description').textContent, /未同步/);
    assert.equal(element('#day-records').hidden, true);
  });

});
