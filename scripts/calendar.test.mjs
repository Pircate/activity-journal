import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal, dayMetricState} from '../docs/journal.mjs';
import {moveCalendarDate, renderCalendar} from '../docs/calendar.mjs';

const activity = (date, distanceKm = 20, trainingLoad = 50) => ({date, sport:'Ride', distanceKm, durationSeconds:3600, trainingLoad});
const journal = (activities = [], range = '2026', end = '2026-10-16', unavailableActivities = []) => createJournal({period:{start:'2021-01-01', end}, activities, unavailableActivities, gearLibrary:{active:[],retired:[]}, syncedAt:'2026-10-16 12:00:00 +08:00'}, '2026-10-16', range);

test('月历按周一到周日对齐，当月只出现一次每个日期，闰日不遗漏', () => {
  const data = journal([], '2024');
  const html = renderCalendar(data.daily, '2024-02-29', 'distanceKm', '2026-10-16');
  assert.equal((html.match(/class="calendar-padding"/g) ?? []).length, 3, '2024-02-01 是周四');
  assert.equal((html.match(/class="calendar-day"/g) ?? []).length, 29);
  assert.equal((html.match(/data-date="2024-02-29"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-date="2024-03/);
  assert.equal((renderCalendar(journal([], '2023').daily, '2023-02-01').match(/class="calendar-day"/g) ?? []).length, 28);
  const september = renderCalendar(journal().daily, '2026-09-01');
  assert.equal((september.match(/class="calendar-day"/g) ?? []).length, 30);
});

test('翻月跨年并将月末日期夹紧到目标月，支持周历方向键与行首行末', () => {
  assert.equal(moveCalendarDate('2024-03-31', 'PageUp'), '2024-02-29');
  assert.equal(moveCalendarDate('2023-03-31', 'PageUp'), '2023-02-28');
  assert.equal(moveCalendarDate('2026-01-31', 'PageDown'), '2026-02-28');
  assert.equal(moveCalendarDate('2025-12-31', 'PageDown'), '2026-01-31');
  assert.equal(moveCalendarDate('2026-01-01', 'PageUp'), '2025-12-01');
  assert.equal(moveCalendarDate('2026-10-01', 'ArrowLeft'), '2026-09-30');
  assert.equal(moveCalendarDate('2026-10-31', 'ArrowRight'), '2026-11-01');
  assert.equal(moveCalendarDate('2026-10-16', 'ArrowUp'), '2026-10-09');
  assert.equal(moveCalendarDate('2026-10-16', 'ArrowDown'), '2026-10-23');
  assert.equal(moveCalendarDate('2026-10-16', 'Home'), '2026-10-12');
  assert.equal(moveCalendarDate('2026-10-16', 'End'), '2026-10-18');
  assert.equal(moveCalendarDate('2026-10-16', 'Tab'), undefined);
});

test('范围外日期不可选择，未来日期保留未同步标记，不当作零活动', () => {
  const recent = journal([], 'recent');
  const october = renderCalendar(recent.daily, '2025-10-17');
  assert.equal((october.match(/class="calendar-outside"/g) ?? []).length, 16);
  assert.equal((october.match(/class="calendar-day"/g) ?? []).length, 15);
  assert.doesNotMatch(october, /data-date="2025-10-16"/);
  const future = renderCalendar(journal().daily, '2026-12-01');
  assert.equal((future.match(/data-level="missing"/g) ?? []).length, 31);
  assert.equal((future.match(/data-state="pending"/g) ?? []).length, 31);
  assert.equal((future.match(/>未同步</g) ?? []).length, 31);
  assert.match(future, /2026-12-01，未同步：该日期不在已同步日期范围内，或晚于北京时间今天/);
});

test('同日多次活动只占一个日期，选中态和今天标记彼此独立', () => {
  const data = journal([activity('2026-10-15'), activity('2026-10-15', 30)]);
  const html = renderCalendar(data.daily, '2026-10-15', 'distanceKm', '2026-10-16');
  assert.equal((html.match(/data-date="2026-10-15"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /2026-10-15，2 次运动，距离 50\.00 km/);
  assert.match(html, /data-date="2026-10-16"[^>]*aria-current="date"/);
  assert.match(html, />2 次</);
});

test('月历与热力图共用分级及缺失标记，切换指标只更改统计颜色与描述', () => {
  const data = journal([activity('2026-10-15', null), activity('2026-10-15', 30, null)], '2026', '2026-10-16', [{date:'2026-10-14'}]);
  const day = data.daily.find(day => day.date === '2026-10-15');
  assert.deepEqual(dayMetricState(day, 'distanceKm'), {level:'3', state:'partial', missing:true, unavailable:false, label:'2026-10-15，2 次运动，距离 30.00 km（1 次未提供）（部分指标缺失）'});
  let html = renderCalendar(data.daily, '2026-10-15', 'distanceKm');
  assert.match(html, /data-date="2026-10-15" data-level="3" data-state="partial" data-unavailable="false"/);
  assert.match(html, /data-date="2026-10-14" data-level="missing" data-state="unavailable" data-unavailable="true"/);
  assert.match(html, />不可读</);
  html = renderCalendar(data.daily, '2026-10-15', 'durationSeconds');
  assert.match(html, /2026-10-15，2 次运动，时长 2:00:00/);
  assert.match(html, /data-date="2026-10-15" data-level="4" data-state="value" data-unavailable="false"/);
  const missing = journal([activity('2026-10-15', null, null)]);
  html = renderCalendar(missing.daily, '2026-10-15', 'trainingLoad');
  assert.match(html, /2026-10-15，1 次运动，负荷：指标缺失（活动已经读取，但该指标没有提供）/);
  assert.match(html, /data-date="2026-10-15" data-level="missing" data-state="missing"/);
});

test('未同步、指标缺失、详情不可读取三种状态在月历中互相区分', () => {
  const data = journal([activity('2026-10-14', 20), activity('2026-10-15', null, null)], '2026', '2026-10-16', [{date:'2026-10-13'}]);
  const html = renderCalendar(data.daily, '2026-10-15', 'distanceKm');
  assert.match(html, /data-date="2026-10-13" data-level="missing" data-state="unavailable" data-unavailable="true"/);
  assert.match(html, /data-date="2026-10-14" data-level="2" data-state="value" data-unavailable="false"/);
  assert.match(html, /data-date="2026-10-15" data-level="missing" data-state="missing"/);
  assert.match(html, /data-date="2026-10-16"[^>]*data-state="none"/, '当天在已同步范围内，没有记录不等于未同步');
  assert.match(html, /data-date="2026-10-17" data-level="missing" data-state="pending"/);
  assert.equal((html.match(/data-state="pending"/g) ?? []).length, 15, '10 月 17 日至 31 日尚未同步');
});
