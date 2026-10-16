import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePersonalBests, renderPersonalBests, renderPersonalBestsPanel, initializePersonalBests} from '../docs/personal-bests.mjs';

const record = {sport:'跑步', event:'5 公里', result:'21:02', date:'2025-05-01', activityUrl:'https://intervals.icu/activities/i123'};
const snapshot = records => ({source:'Intervals.icu', syncedAt:'2026-10-16T04:00:00.000Z', records});

test('保留成绩原文、按运动分组，并链接正确活动', () => {
  const data = snapshot([record, {...record, event:'10 公里', result:'44:03'}, {...record, sport:'骑行', event:'CP20', result:'233 W'}]);
  const before = structuredClone(data);
  const html = renderPersonalBests(data);
  assert.equal((html.match(/class="pb-group"/g) ?? []).length, 2);
  assert.match(html, /21:02/);
  assert.match(html, /https:\/\/intervals\.icu\/activities\/i123/);
  assert.match(html, /datetime="2025-05-01"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.deepEqual(data, before);
  assert.match(renderPersonalBestsPanel(data), /id="personal-bests"/);
  assert.match(renderPersonalBestsPanel(data), /2026-10-16 12:00（北京时间）/);
});

test('成绩板简化标题说明，统一展示来源与同步信息', () => {
  const html = renderPersonalBestsPanel(snapshot([record]));
  assert.match(html, /<p>全部历史<\/p>/);
  assert.equal((html.match(/数据来自 Intervals\.icu/g) ?? []).length, 1);
  assert.match(html, /全部历史纪录，不受其他栏目的筛选影响。/);
  assert.doesNotMatch(html, /pb-intro|Intervals\.icu ↗/);
});

test('功率名称直接说明时长，标准单位缩小显示且保留原始精度', () => {
  const data = snapshot([
    {...record, sport:'骑行', event:'最远距离', result:'154.86 km'},
    {...record, sport:'骑行', event:'CP5', result:'288 W'},
    {...record, sport:'骑行', event:'CP20', result:'233 W'},
  ]);
  const html = renderPersonalBests(data);
  assert.match(html, /data-sport="骑行"/);
  assert.match(html, /<h4>5 分钟功率<\/h4>/);
  assert.match(html, /<h4>20 分钟功率<\/h4>/);
  assert.match(html, /154\.86 <small class="pb-unit">km<\/small>/);
  assert.match(html, /288 <small class="pb-unit">W<\/small>/);
  assert.match(html, /aria-label="骑行 5 分钟功率，288 W，2025-05-01，在 Intervals\.icu 查看（新标签页）"/);
  assert.equal(data.records[0].result, '154.86 km');
  for (const result of ['1:24:29', '约 288 W', '288 W 估算', '288 <W>']) {
    assert.doesNotMatch(renderPersonalBests(snapshot([{...record, result}])), /pb-unit/);
  }
});

test('有链接时显示装饰箭头，日期缺失时仍提供完整链接名称', () => {
  const html = renderPersonalBests(snapshot([{...record, date:null}]));
  assert.match(html, /class="pb-arrow" aria-hidden="true">↗<\/span>/);
  assert.match(html, /aria-label="跑步 5 公里，21:02，日期未提供，在 Intervals\.icu 查看（新标签页）"/);
});

test('分组与组内顺序固定，不随记录顺序变化', () => {
  const shuffled = snapshot([{...record, sport:'骑行', event:'CP20', result:'233 W'}, {...record, event:'10 公里', result:'44:03'},
    {...record, sport:'骑行', event:'最远距离', result:'154.86 km'}, {...record, event:'5 公里', result:'21:02'}]);
  assert.deepEqual(renderPersonalBests(shuffled), renderPersonalBests(snapshot([...shuffled.records].reverse())));
  const html = renderPersonalBests(shuffled);
  assert.match(html, /<h3>跑步<\/h3>[\s\S]*<h3>骑行<\/h3>/);
  assert.match(html, /5 公里[\s\S]*10 公里/);
  assert.match(html, /最远距离[\s\S]*20 分钟功率/);
});

test('首次未同步、成功空列表与缺失日期链接分别表达', () => {
  assert.match(renderPersonalBests({source:'Intervals.icu', syncedAt:null, records:[]}), /尚未同步/);
  assert.match(renderPersonalBests(snapshot([])), /暂无个人最佳成绩/);
  const html = renderPersonalBests(snapshot([{...record, date:null, activityUrl:null}]));
  assert.match(html, /日期未提供/);
  assert.match(html, /活动链接未提供/);
  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /pb-arrow/);
});

test('拒绝重复项目、错误来源、异常日期、额外字段与非 Intervals.icu 活动链接', () => {
  for (const data of [snapshot([record, record]), {...snapshot([]), source:'Strava'}, {...snapshot([]), syncedAt:'2026-02-30T04:00:00.000Z'}, {source:'Intervals.icu', syncedAt:null, records:[record]},
    snapshot([{...record, date:'2026-02-30'}]), snapshot([{...record, activityUrl:'javascript:alert(1)'}]), snapshot([{...record, activityUrl:'https://intervals.icu.evil/activities/i123'}]),
    snapshot([{...record, sport:'力量训练'}]), snapshot([{...record, sport:'骑行'}]), snapshot([{...record, event:'<script>alert(1)</script>'}]), snapshot([{...record, secret:'no'}])]) {
    assert.throws(() => validatePersonalBests(data), /格式无效/);
  }
  const html = renderPersonalBests(snapshot([{...record, result:'<img src=x>onerror=alert(1)'}]));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('PB 独立刷新拒绝旧快照，失败保留成绩，恢复后清除提示', async t => {
  const nodes = new Map();
  const initial = snapshot([record]);
  const content = {html:renderPersonalBests(initial), writes:0, contains:() => false, querySelectorAll:() => [],
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
  latest = snapshot([{...record, result:'20:00'}]);
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
