import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePersonalBests, renderPersonalBests, renderPersonalBestsPanel, initializePersonalBests, personalRecordTimeline, renderRecordHistory} from '../docs/personal-bests.mjs';

const record = {sport:'Run', event:'run5k', value:1262, date:'2025-05-01', activityUrl:'https://intervals.icu/activities/i123', stravaUrl:'https://www.strava.com/activities/9123'};
const opened = event => new Map([[event, {open:true}]]);
const snapshot = records => ({source:'Intervals.icu', syncedAt:'2026-10-16T04:00:00.000Z', records, history:records.map(r => ({...r, startTime:'08:00:00'}))});

test('统一显示用时且保留快照原文、按运动分组，并链接正确活动', () => {
  const data = snapshot([record, {...record, event:'run10k', value:2643}, {...record, sport:'Ride', event:'cp20', value:233}]);
  const before = structuredClone(data);
  const html = renderPersonalBests(data, opened(data.records[0].event));
  assert.equal((html.match(/class="pb-group"/g) ?? []).length, 2);
  assert.match(html, />0:21:02/);
  assert.match(html, />0:44:03/);
  assert.match(html, /href="https:\/\/www\.strava\.com\/activities\/9123"/);
  assert.doesNotMatch(html, /href="https:\/\/intervals\.icu/);
  assert.match(html, /datetime="2025-05-01"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.deepEqual(data, before);
  assert.match(renderPersonalBestsPanel(data), /id="personal-bests"/);
  assert.match(renderPersonalBestsPanel(data), /2026-10-16 12:00（北京时间）/);
});

test('成绩板只展示标题与同步时间，不重复来源说明', () => {
  const html = renderPersonalBestsPanel(snapshot([record]));
  assert.match(html, /<p>全部历史<\/p>/);
  assert.doesNotMatch(html, /数据来自|section-help/);
  assert.doesNotMatch(html, /pb-intro|Intervals\.icu ↗/);
});

test('功率名称直接说明时长，标准单位缩小显示且保留原始精度', () => {
  const data = snapshot([
    {...record, sport:'Ride', event:'longestRide', value:154.86},
    {...record, sport:'Ride', event:'cp5', value:288},
    {...record, sport:'Ride', event:'cp20', value:233},
  ]);
  const html = renderPersonalBests(data, opened('cp5'));
  assert.match(html, /data-sport="Ride"/);
  assert.match(html, /<h4>5 分钟功率<\/h4>/);
  assert.match(html, /<h4>20 分钟功率<\/h4>/);
  assert.match(html, /154\.86 <small class="pb-unit">km<\/small>/);
  assert.match(html, /288 <small class="pb-unit">W<\/small>/);
  assert.match(html, /aria-label="2025-05-01 骑行 5 分钟功率，288 W，查看活动（新标签页）"/);
  assert.equal(data.records[0].value, 154.86);
  for (const value of ['288 W', 'banana', null, NaN, Infinity, 0, -1]) {
    assert.throws(() => validatePersonalBests(snapshot([{...record, value}])), /格式无效/);
  }
});

test('卡片成绩不可跳转，只有时间线的成绩保留真实链接', () => {
  const html = renderPersonalBests(snapshot([record]), opened('run5k'));
  assert.doesNotMatch(html, /pb-link|pb-arrow|<p class="pb-result">\s*<a/);
  assert.match(html, /aria-label="2025-05-01 跑步 5 公里，0:21:02，查看活动（新标签页）"/);
});

test('分组与组内顺序固定，不随记录顺序变化', () => {
  const shuffled = snapshot([{...record, sport:'Ride', event:'cp20', value:233}, {...record, event:'run10k', value:2643},
    {...record, sport:'Ride', event:'longestRide', value:154.86}, {...record, event:'run5k', value:1262}]);
  assert.deepEqual(renderPersonalBests(shuffled), renderPersonalBests(snapshot([...shuffled.records].reverse())));
  const html = renderPersonalBests(shuffled);
  assert.match(html, /<h3>跑步<\/h3>[\s\S]*<h3>骑行<\/h3>/);
  assert.match(html, /5 公里[\s\S]*10 公里/);
  assert.match(html, /最远距离[\s\S]*20 分钟功率/);
});

test('首次未同步与成功空列表分别表达，拒绝缺失日期并保留上游活动链接', () => {
  assert.match(renderPersonalBests({source:'Intervals.icu', syncedAt:null, records:[], history:[]}), /尚未同步/);
  assert.match(renderPersonalBests(snapshot([])), /暂无个人最佳成绩/);
  const {stravaUrl, ...unlinked} = record;
  const html = renderPersonalBests(snapshot([unlinked]), opened('run5k'));
  assert.throws(() => validatePersonalBests(snapshot([{...unlinked, date:null}])));
  assert.doesNotMatch(html, /Strava 链接未提供/);
  assert.match(html, /href="https:\/\/intervals\.icu\/activities\/i123"/);
  assert.doesNotMatch(html, /pb-arrow/);
});

test('拒绝重复项目、错误来源、异常日期、额外字段与非法平台链接', () => {
  for (const data of [snapshot([record, record]), {...snapshot([]), source:'Strava'}, {...snapshot([]), syncedAt:'2026-02-30T04:00:00.000Z'}, {source:'Intervals.icu', syncedAt:null, records:[record]},
    snapshot([{...record, date:'2026-02-30'}]), snapshot([{...record, activityUrl:'javascript:alert(1)'}]), snapshot([{...record, activityUrl:'https://intervals.icu.evil/activities/i123'}]),
    snapshot([{...record, sport:'WeightTraining'}]), snapshot([{...record, sport:'Ride'}]), snapshot([{...record, event:'<script>alert(1)</script>'}]), snapshot([{...record, secret:'no'}])]) {
    assert.throws(() => validatePersonalBests(data), /格式无效/);
  }
  for (const stravaUrl of ['javascript:alert(1)', 'https://strava.com.evil/activities/1', 'https://www.strava.com/activities/i123', 'https://www.strava.com/activities/123?x=1', null]) {
    assert.throws(() => validatePersonalBests(snapshot([{...record, stravaUrl}])), /格式无效/);
  }
  assert.throws(() => validatePersonalBests(snapshot([{...record, value:'<img src=x>onerror=alert(1)'}])), /格式无效/);
});

test('PB 独立刷新拒绝旧快照，失败保留成绩，恢复后清除提示', async t => {
  const nodes = new Map();
  const initial = snapshot([record]);
  const content = {html:renderPersonalBests(initial), writes:0, contains:() => false, querySelector:() => null, querySelectorAll:() => [], addEventListener() {},
    get innerHTML() { return this.html; }, set innerHTML(value) { this.html = value; this.writes++; }};
  nodes.set('pb-content', content);
  nodes.set('pb-sync', {});
  nodes.set('pb-status', {});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:id => nodes.get(id), activeElement:null}});
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'document', descriptor) : delete globalThis.document);
  let latest = structuredClone(initial);
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url.pathname, /personal-bests\.json$/);
    assert.equal(options.cache, 'no-cache');
    if (fail) throw new Error('offline');
    return {ok:true, json:async () => latest};
  });
  const refresh = initializePersonalBests(initial);
  await refresh();
  assert.equal(content.writes, 0, '首屏和无变化刷新保留静态节点');
  latest = snapshot([{...record, value:1200}]);
  await refresh();
  assert.equal(content.writes, 1);
  fail = true;
  await refresh();
  assert.match(content.innerHTML, /20:00/);
  assert.match(nodes.get('pb-status').textContent, /保留最近成功同步/);
  fail = false;
  latest = {...initial, syncedAt:'2026-10-15T04:00:00.000Z'};
  await refresh();
  assert.equal(content.writes, 1, '旧快照不覆盖新成绩');
  latest = snapshot([]);
  await refresh();
  assert.match(content.innerHTML, /暂无个人最佳成绩/);
  assert.equal(nodes.get('pb-status').textContent, '');
});

test('纪录历程倒序按年分组、项目隔离与正确提升方向', () => {
  const history = [
    {...record, value:1500, date:'2024-01-01', startTime:'08:00:00'},
    {...record, value:1400, date:'2025-01-01', startTime:'08:00:00'},
    {...record, sport:'Ride', event:'longestRide', value:100, date:'2024-02-01', startTime:'08:00:00'},
    {...record, sport:'Ride', event:'longestRide', value:120, date:'2025-02-01', startTime:'08:00:00'},
    {...record, sport:'Ride', event:'cp5', value:200, date:'2024-03-01', startTime:'08:00:00'},
    {...record, sport:'Ride', event:'cp5', value:220, date:'2025-03-01', startTime:'08:00:00'},
  ];
  const records = history.filter(r => r.date.startsWith('2025')).map(({startTime, ...r}) => r);
  const data = {...snapshot(records), history:history.toReversed()};
  assert.deepEqual(personalRecordTimeline(data).records.map(r => r.value), [220, 120, 1400, 200, 100, 1500]);
  assert.equal(personalRecordTimeline(data, {event:'run5k'}).total, 2);
  assert.deepEqual(personalRecordTimeline(data, {event:'run5k'}).records.map(r => r.value), [1400, 1500]);
  const {html} = renderRecordHistory(data);
  assert.match(html, /2025 年纪录[\s\S]*2024 年纪录/);
  assert.match(html, /缩短 0:01:40/);
  assert.match(html, /提升 20\.00 km/);
  assert.match(html, /提升 20 W/);
  assert.equal((html.match(/首次成绩/g) ?? []).length, 3);
});

test('运行时只接受含 history 的新格式，并核对时间线末条与当前最佳', () => {
  const valid = snapshot([record]);
  const {history, ...old} = valid;
  for (const invalid of [old, {...valid, history:null}, {...valid, history:[]},
    {...valid, history:[{...history[0], startTime:'25:00:00'}]},
    {...valid, history:[{...history[0], extra:true}]},
    {...valid, history:[history[0], {...history[0], date:'2026-01-01'}]},
    {...valid, history:[{...history[0], value:record.value - 1}]},
    {...valid, records:[{...record, stravaUrl:'https://www.strava.com/activities/888'}]}]) {
    assert.throws(() => validatePersonalBests(invalid), /格式无效/);
  }
});


test('卡片保持原顺序，时间线嵌入所属运动分组且展示全部历史', () => {
  const history = Array.from({length:25}, (_, i) => ({...record, value:1600 - i * 10, date:'2025-01-' + String(i + 1).padStart(2, '0'), startTime:'08:00:00'}));
  const {startTime, ...best} = history.at(-1);
  const ride = {...record, sport:'Ride', event:'cp20', value:220};
  const data = {...snapshot([best, ride]), history:[...history, {...ride, startTime:'08:00:00'}]};
  const closed = renderPersonalBests(data);
  const html = renderPersonalBests(data, opened('run5k'));
  assert.doesNotMatch(closed, /id="pb-history-panel"/);
  assert.equal((html.match(/class="pb-card"/g) ?? []).length, 2);
  assert.equal((html.match(/class="pb-history-entry"/g) ?? []).length, 25);
  assert.ok(html.indexOf('id="pb-history-panel"') > html.indexOf('data-event="run5k"'));
  assert.ok(html.indexOf('id="pb-history-panel"') < html.indexOf('data-sport="Ride"'));
  assert.match(html, /<section class="pb-group" data-sport="Run">[\s\S]*id="pb-history-panel"[\s\S]*<\/section><section class="pb-group" data-sport="Ride">/);
  assert.doesNotMatch(html, /显示更多|已显示|data-pb-more|data-limit/);
  assert.match(html, /data-pb-event="run5k" open/);
  assert.doesNotMatch(html, /data-pb-event="cp20" open/);
  assert.match(html, /role="region" aria-label="5 公里纪录时间线，可左右滚动"/);
  const rideHtml = renderPersonalBests(data, opened('cp20'));
  assert.ok(rideHtml.indexOf('id="pb-history-panel"') > rideHtml.indexOf('data-sport="Ride"'));
  assert.equal((rideHtml.match(/id="pb-history-panel"/g) ?? []).length, 1);
});

test('时间线归入各卡片，条目不重复显示项目名称，成绩链接仍可访问', () => {
  const data = snapshot([record]);
  const html = renderPersonalBestsPanel(data);
  assert.doesNotMatch(html, /pb-history-title|pb-history-event|<h3[^>]*>纪录历程/);
  assert.match(html, /<summary aria-label="5 公里记录历程，1 项"/);
  assert.match(html, /<summary[^>]+><span>记录历程<\/span><span class="pb-history-count">1 项<\/span><span class="pb-history-toggle" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(html, /pb-history-chevron/);
  assert.doesNotMatch(html, /pb-history-expand|pb-history-collapse|>展开<|>收起</);
  assert.doesNotMatch(html, /data-limit="10" open/);
  const {html:timeline} = renderRecordHistory(data, {event:'run5k'});
  assert.doesNotMatch(timeline, />跑步|>5 公里|查看活动 ↗/);
  assert.match(timeline, /<time[\s\S]*pb-history-detail[\s\S]*<strong>0:21:02<\/strong>[\s\S]*首次成绩/);
  assert.match(timeline, /href="https:\/\/www\.strava\.com\/activities\/9123"/);
});

test('横向时间线鼠标拖动、点击阈值、取消和触屏手势分别处理', () => {
  const handlers = new Map();
  const content = {innerHTML:'', addEventListener:(name, fn) => handlers.set(name, fn), querySelectorAll:() => [], querySelector:() => null, contains:() => false};
  const nodes = new Map([['pb-content', content], ['pb-sync', {}], ['pb-status', {}]]);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:id => nodes.get(id), activeElement:null}});
  try {
    initializePersonalBests(snapshot([record]));
    let captured = false;
    const classes = new Set();
    const track = {scrollLeft:0, scrollWidth:2000, clientWidth:300,
      setPointerCapture:() => {captured = true;}, hasPointerCapture:() => captured, releasePointerCapture:() => {captured = false;},
      classList:{add:value => classes.add(value), remove:value => classes.delete(value)},
    };
    let prevented = false;
    const event = (type, extra = {}) => ({type, pointerType:'mouse', pointerId:7, button:0, clientX:300, clientY:100, detail:1,
      target:{closest:selector => selector === '.pb-history-track' ? track : null},
      preventDefault:() => {prevented = true;}, stopPropagation() {}, ...extra});
    handlers.get('pointerdown')(event('pointerdown'));
    handlers.get('pointermove')(event('pointermove', {clientX:296}));
    handlers.get('pointerup')(event('pointerup'));
    handlers.get('click')(event('click'));
    assert.equal(prevented, false, '轻微移动仍允许点击成绩链接');
    handlers.get('pointerdown')(event('pointerdown'));
    handlers.get('pointermove')(event('pointermove', {clientX:140}));
    assert.equal(track.scrollLeft, 160);
    assert.equal(captured, true);
    assert.ok(classes.has('is-dragging'));
    handlers.get('pointerup')(event('pointerup'));
    assert.equal(captured, false);
    assert.equal(classes.size, 0);
    prevented = false;
    handlers.get('click')(event('click'));
    assert.equal(prevented, true, '拖动结束不打开活动链接');
    handlers.get('pointerdown')(event('pointerdown'));
    handlers.get('pointerup')(event('pointerup'));
    prevented = false;
    handlers.get('click')(event('click'));
    assert.equal(prevented, false, '下一次普通点击可正常跳转');
    handlers.get('pointerdown')(event('pointerdown'));
    handlers.get('pointermove')(event('pointermove', {clientX:200}));
    handlers.get('pointercancel')(event('pointercancel'));
    assert.equal(captured, false);
    assert.equal(classes.size, 0);
    prevented = false;
    handlers.get('click')(event('click', {detail:0}));
    assert.equal(prevented, false, '键盘激活链接不受拖动影响');
    const before = track.scrollLeft;
    handlers.get('pointerdown')(event('pointerdown', {pointerType:'touch'}));
    handlers.get('pointermove')(event('pointermove', {pointerType:'touch', clientX:100}));
    assert.equal(track.scrollLeft, before, '触屏由浏览器处理原生滑动');
    prevented = false;
    handlers.get('dragstart')(event('dragstart'));
    assert.equal(prevented, true, '禁止浏览器把成绩链接拖成文件或新标签页');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  }
});
