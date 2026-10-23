import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestones, renderMilestones, renderMilestonePanel, initializeMilestones} from '../docs/milestones.mjs';

const activity = (date, overrides = {}) => ({date, sport:'骑行', distanceKm:10, duration:'1:00:00', trainingLoad:30, ...overrides});
const snapshot = (activities, unavailableActivities = []) => ({period:{start:'2021-01-01', end:'2026-10-16'}, syncedAt:'2026-10-16 12:00:00 +08:00', activities, unavailableActivities, gearLibrary:[]});
const track = (summary, key) => summary.tracks.find(item => item.key === key);

test('进度表示累计值占下一目标的比例，达成上一目标后不归零', () => {
  const data = snapshot([activity('2026-01-01', {distanceKm:33232.39})]);
  assert.equal(track(createMilestones(data), 'distance').progress, 33232.39 / 50000);
  const html = renderMilestones(data);
  assert.match(html, /aria-label="累计里程目标进度"[^>]*aria-valuenow="66"[^>]*><span style="width:66\.46%"/);
  for (const [total, expected] of [[0, 0], [5000, 0.5], [30000, 0.6], [50000, 1], [60000, 1]]) {
    assert.equal(track(createMilestones(snapshot([activity('2026-01-01', {distanceKm:total})])), 'distance').progress, expected);
  }
});

test('按日期顺序累计，跨过目标的活动记录达成日期，下一目标和剩余量正确', () => {
  const data = snapshot([
    activity('2026-01-03', {distanceKm:3000}),
    activity('2026-01-01', {distanceKm:2500}),
    activity('2026-01-04', {distanceKm:500, sport:'力量训练', sets:10, averageHeartRate:120}),
  ]);
  const before = structuredClone(data);
  const summary = createMilestones(data);
  const distance = track(summary, 'distance');
  assert.equal(distance.total, 6000);
  assert.deepEqual(distance.milestones[0], {value:5000, reached:true, date:'2026-01-03'});
  assert.deepEqual(distance.milestones[1], {value:10000, reached:false, date:null});
  assert.equal(distance.next.value, 10000);
  assert.equal(distance.remainingText, '还差 4,000.00 km');
  assert.deepEqual(data, before, '不修改输入快照');
});

test('同一日多次运动只算一个活跃日，全部类型与跑步口径正确', () => {
  const summary = createMilestones(snapshot([
    activity('2026-01-01', {distanceKm:600, sport:'跑步'}),
    activity('2026-01-01', {distanceKm:500, sport:'越野跑'}),
    activity('2026-01-02', {distanceKm:500, sport:'虚拟跑步'}),
    activity('2026-01-02', {distanceKm:100, sport:'力量训练', sets:8, averageHeartRate:110}),
  ]));
  assert.equal(track(summary, 'activeDays').total, 2);
  assert.equal(track(summary, 'run').total, 1600);
  assert.equal(track(summary, 'run').milestones[0].date, '2026-01-01');
  assert.equal(track(summary, 'distance').total, 1700);
});

test('距离未知不参与距离累计，但仍计入次数、活跃天和时长', () => {
  const summary = createMilestones(snapshot([
    activity('2026-01-01', {distanceKm:null, duration:'0:30:00'}),
    activity('2026-01-02', {distanceKm:2000, duration:'2:00:00'}),
  ]));
  assert.equal(track(summary, 'distance').total, 2000);
  assert.equal(track(summary, 'count').total, 2);
  assert.equal(track(summary, 'activeDays').total, 2);
  assert.equal(track(summary, 'duration').total, 9000);
});

test('时长以小时为目标，展示精确时分秒；全部目标达成后显示完成态', () => {
  const summary = createMilestones(snapshot([activity('2026-01-01', {distanceKm:100, duration:'501:00:00'})]));
  const duration = track(summary, 'duration');
  assert.equal(duration.total, 1803600);
  assert.equal(duration.valueText, '501:00:00');
  assert.equal(duration.milestones[0].date, '2026-01-01');
  assert.equal(duration.next.value, 1000);
  assert.equal(duration.remainingText, '还差 499:00:00');
  const done = track(createMilestones(snapshot([activity('2026-01-01', {distanceKm:60000, duration:'2100:00:00'})])), 'duration');
  assert.equal(done.next, null);
  assert.equal(done.progress, 1);
  assert.equal(done.remainingText, '已达成全部目标');
});

test('最近达成按日期排序，同日按较高里程碑和固定栏目顺序稳定', () => {
  const summary = createMilestones(snapshot([
    activity('2026-01-01', {distanceKm:1000}),
    activity('2026-01-02', {distanceKm:1000}),
    activity('2026-01-03', {distanceKm:4000}),
  ]));
  assert.equal(summary.latest.date, '2026-01-03');
  assert.equal(summary.latest.text, '累计里程 · 5,000.00 km');
  assert.equal(summary.reached, 2);
});

test('同一活动跨过多个目标时共享达成日期，并进入下一阶段或完成态', () => {
  const summary = createMilestones(snapshot([
    activity('2026-01-01', {distanceKm:3000, sport:'跑步'}),
    activity('2026-01-02', {distanceKm:8000, sport:'跑步'}),
  ]));
  const run = track(summary, 'run');
  assert.deepEqual(run.milestones.filter(item => item.reached).map(item => [item.value, item.date]), [[1000, '2026-01-01'], [2000, '2026-01-01'], [5000, '2026-01-02'], [10000, '2026-01-02']]);
  assert.equal(run.next, null);
  assert.equal(run.progress, 1);
});

test('空记录显示第一个目标而非虚假达成', () => {
  const summary = createMilestones(snapshot([], [{date:'2026-01-01'}]));
  const html = renderMilestones(snapshot([], [{date:'2026-01-01'}]));
  assert.equal(summary.reached, 0);
  assert.match(html, /第一个里程碑/);
  assert.match(html, /累计里程 · 5,000\.00 km/);
  assert.equal(summary.unavailableCount, 1);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test('专栏输出固定顺序、进度语义、达成状态与键盘可读文本', () => {
  const data = snapshot([activity('2026-01-01', {distanceKm:5000})]);
  const html = renderMilestones(data);
  for (const id of ['distance', 'ride', 'run', 'count', 'activeDays', 'duration']) assert.match(html, new RegExp(`data-track="${id}"`));
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 6);
  assert.match(html, /aria-valuetext="已累计 5,000\.00 km，下一目标 10,000\.00 km，还差 5,000\.00 km"/);
  assert.match(html, /data-state="reached"><span>5,000\.00<\/span><small><time datetime="2026-01-01">2026\.01\.01<\/time>/);
  assert.match(html, /data-state="future" data-next="true"><span>10,000\.00<\/span><small>待达成<\/small>/);
  assert.doesNotMatch(html, /<script|onerror=/);
  const escaped = renderMilestones(snapshot([activity('2026-01-01', {sport:'<img src=x>'})]));
  assert.doesNotMatch(escaped, /<img/);
  assert.match(renderMilestonePanel(data), /id="milestones"[\s\S]*运动里程碑/);
});

test('数据刷新只在内容变化时重绘，保留节点', async t => {
  const content = {html:renderMilestones(snapshot([])), writes:0,
    get innerHTML() { return this.html; }, set innerHTML(value) { this.html = value; this.writes++; }};
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:id => id === 'milestone-content' ? content : null}});
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'document', descriptor) : delete globalThis.document);
  const update = initializeMilestones(snapshot([]));
  assert.equal(content.writes, 0);
  update(snapshot([]));
  assert.equal(content.writes, 0);
  update(snapshot([activity('2026-01-01', {distanceKm:5000})]));
  assert.equal(content.writes, 1);
  assert.match(content.innerHTML, /已达成 2 \/ 27 项/);
});
