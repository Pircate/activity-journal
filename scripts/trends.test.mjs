import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrends, compareTrend, renderTrendContent} from '../docs/trends.mjs';

const activity = (date, distanceKm = 10, duration = '1:00:00', trainingLoad = 30) => ({date, sport:'骑行', distanceKm, duration, trainingLoad});
const snapshot = activities => ({period:{start:'2020-01-01', end:'2026-10-16'}, activities, unavailableActivities:[]});

test('自然周按周一开始、跨年不断开，保留同日多次记录并精确累计', () => {
  const data = snapshot([activity('2025-12-28', 99), activity('2025-12-29', 0.1), activity('2026-01-01', 0.2, '10:00:00'), activity('2026-01-01', 0, '0:00:01'), activity('2026-01-04', 30), activity('2026-01-05', 50)]);
  const before = structuredClone(data);
  const first = createTrends(data, '2026', 'week', '2026-10-16')[0];
  assert.equal(first.start, '2025-12-29');
  assert.equal(first.end, '2026-01-04');
  assert.equal(first.count, 4);
  assert.equal(first.distanceKm, 30.3);
  assert.equal(first.durationSeconds, 43201);
  assert.equal(first.previous.start, '2025-12-22');
  assert.equal(first.previous.end, '2025-12-28');
  assert.equal(first.previous.distanceKm, 99);
  assert.deepEqual(data, before);
});

test('自然月包含闰日，历史完整周期与上一完整周期比较', () => {
  const months = createTrends(snapshot([activity('2024-02-29'), activity('2024-03-01')]), '2024', 'month', '2026-10-16');
  assert.equal(months.length, 12);
  assert.equal(months[1].end, '2024-02-29');
  assert.equal(months[1].count, 1);
  assert.equal(months[2].previous.end, '2024-02-29');
  assert.equal(months[2].previous.count, 1);
  assert.equal(months[2].ongoing, false);
});

test('进行中的周和月与上周期同天数比较，不计未来活动', () => {
  const data = snapshot([activity('2026-10-16'), activity('2026-10-17', 900), activity('2026-09-16', 20), activity('2026-09-17', 900)]);
  const month = createTrends(data, '2026', 'month', '2026-10-16').at(-1);
  assert.equal(month.start, '2026-10-01');
  assert.equal(month.fullEnd, '2026-10-31');
  assert.equal(month.end, '2026-10-16');
  assert.equal(month.previous.end, '2026-09-16');
  assert.equal(month.previous.distanceKm, 20);
  assert.equal(month.distanceKm, 10);
  assert.equal(month.ongoing, true);
  const week = createTrends(data, 'recent', 'week', '2026-10-16').at(-1);
  assert.equal(week.start, '2026-10-12');
  assert.equal(week.end, '2026-10-16');
  assert.equal(week.previous.start, '2026-10-05');
  assert.equal(week.previous.end, '2026-10-09');
  assert.equal(week.count, 1);
});

test('月同期截止到上一短月末，1 月比较跨到上一年', () => {
  const data = snapshot([]);
  const march = createTrends(data, '2024', 'month', '2024-03-30').at(-1);
  assert.equal(march.previous.start, '2024-02-01');
  assert.equal(march.previous.end, '2024-02-29');
  const january = createTrends(data, '2026', 'month', '2026-01-05').at(-1);
  assert.equal(january.previous.start, '2025-12-01');
  assert.equal(january.previous.end, '2025-12-05');
});

test('环比区分零基数、持平、增减和缺失指标，不把未知当作零', () => {
  const months = createTrends(snapshot([activity('2026-01-02', 10), activity('2026-02-02', 20), activity('2026-03-02', 10)]), '2026', 'month', '2026-10-16');
  assert.equal(compareTrend(months[0], months[0].previous, 'distanceKm'), '上周期为 0');
  assert.equal(compareTrend(months[1], months[1].previous, 'distanceKm'), '增加 100.0%');
  assert.equal(compareTrend(months[2], months[2].previous, 'distanceKm'), '减少 50.0%');
  assert.equal(compareTrend(months[3], months[3].previous, 'distanceKm'), '减少 100.0%');
  assert.equal(compareTrend(months[4], months[4].previous, 'distanceKm'), '持平');
  const missing = createTrends(snapshot([activity('2026-02-01', null, '1:00:00', null)]), '2026', 'month', '2026-10-16')[1];
  assert.equal(missing.distanceKm, null);
  assert.equal(missing.trainingLoad, null);
  assert.equal(compareTrend(missing, missing.previous, 'distanceKm'), '数据不完整，暂不比较');
  assert.equal(compareTrend(missing, missing.previous, 'durationSeconds'), '上周期为 0');
  assert.match(renderTrendContent([missing]), /未提供/);
});

test('部分指标缺失只阻止该指标比较，受限记录和未同步日期阻止全部比较', () => {
  const data = snapshot([activity('2026-02-01', null), activity('2026-02-02', 20)]);
  let month = createTrends(data, '2026', 'month', '2026-10-16')[1];
  assert.equal(month.distanceKm, 20);
  assert.equal(compareTrend(month, month.previous, 'distanceKm'), '数据不完整，暂不比较');
  assert.equal(compareTrend(month, month.previous, 'count'), '上周期为 0');
  data.unavailableActivities.push({date:'2026-01-15'});
  month = createTrends(data, '2026', 'month', '2026-10-16')[1];
  assert.equal(compareTrend(month, month.previous, 'count'), '数据不完整，暂不比较');
  data.period.end = '2026-10-15';
  month = createTrends(data, '2026', 'month', '2026-10-16').at(-1);
  assert.equal(month.pending, true);
  assert.equal(compareTrend(month, month.previous, 'count'), '数据不完整，暂不比较');
  assert.match(renderTrendContent([month]), /未同步：部分日期不在已同步日期范围内，或晚于北京时间今天/);
  assert.match(renderTrendContent([month]), /<span>未同步<\/span>/, '周期内无可读取记录时明确区分未同步');
});

test('趋势明细区分未同步与详情不可读取，指标缺失只说指标缺失', () => {
  const data = snapshot([activity('2026-02-01', null, '1:00:00', 20)]);
  const januaryUnavailable = createTrends({...data, unavailableActivities:[{date:'2026-01-15'}]}, '2026', 'month', '2026-10-16')[0];
  const januaryHtml = renderTrendContent([januaryUnavailable]);
  assert.match(januaryHtml, /详情不可读取 1 条（平台只返回当地日期，没有距离、时长和运动类型），未计入统计/);
  assert.doesNotMatch(januaryHtml, /未同步：/);
  const februaryMissing = createTrends(data, '2026', 'month', '2026-10-16')[1];
  const februaryHtml = renderTrendContent([februaryMissing]);
  assert.match(februaryHtml, /指标缺失：1 次未提供距离/);
  assert.doesNotMatch(februaryHtml, /未同步：/);
});

test('最近一年显示相交的完整自然月，不输出未来周期；空周期可查看', () => {
  const periods = createTrends(snapshot([]), 'recent', 'month', '2026-10-16');
  assert.equal(periods.length, 13);
  assert.equal(periods[0].start, '2025-10-01');
  assert.equal(periods.at(-1).end, '2026-10-16');
  assert.match(renderTrendContent(periods), /此周期没有运动记录/);
  const data = snapshot([]);
  data.period.start = '2026-01-01';
  const january = createTrends(data, '2026', 'month', '2026-10-16')[0];
  assert.equal(january.previous.pending, true);
  assert.equal(compareTrend(january, january.previous, 'count'), '数据不完整，暂不比较');
});

test('周期明细每页 20 条，保留真实链接和力量训练指标，缩页时夹紧页码', () => {
  const records = Array.from({length:45}, (_, i) => ({...activity('2026-01-02', i), activityUrl:'https://intervals.icu/activities/i' + i}));
  records[0] = {...records[0], sport:'力量训练', sets:12, averageHeartRate:131};
  const periods = createTrends(snapshot(records), '2026', 'month', '2026-10-16');
  const first = renderTrendContent(periods, {selected:'2026-01-01'});
  assert.equal((first.match(/class="activity-row/g) ?? []).length, 20);
  assert.match(first, /12<small>组/);
  assert.match(first, /131<small>bpm/);
  assert.match(first, /href="https:\/\/intervals.icu\/activities\/i0"/);
  const last = renderTrendContent(periods, {selected:'2026-01-01', page:99});
  assert.equal((last.match(/class="activity-row/g) ?? []).length, 5);
  assert.match(last, /第 3 \/ 3 页/);
  assert.doesNotMatch(last, /NaN|Infinity/);
});
