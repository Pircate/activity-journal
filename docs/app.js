'use strict';
const { daily, initialDate } = JSON.parse(document.getElementById('daily-data').textContent);
const byDate = new Map(daily.map(day => [day.date, day]));
const buttons = [...document.querySelectorAll('.day-cell[data-date]')];
const buttonByDate = new Map(buttons.map(button => [button.dataset.date, button]));
const dateInput = document.getElementById('selected-date');
const description = document.getElementById('day-description');
const explanation = document.getElementById('metric-explanation');
const metrics = {
  distanceKm: { label: '距离', thresholds: [10, 30, 60], format: value => value.toFixed(2) + ' 公里', missing: 'missingDistance' },
  durationSeconds: { label: '时长', thresholds: [1800, 3600, 7200], format: formatTime },
  trainingLoad: { label: '负荷', thresholds: [50, 150, 300], format: value => String(value), missing: 'missingLoad' }
};
let selectedDate = initialDate;
let metric = 'distanceKm';
function formatTime(seconds) {
  return Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function display(day, key) {
  if (day.count === 0) return key === 'durationSeconds' ? '0:00:00' : metrics[key].format(0);
  const missing = metrics[key].missing && day[metrics[key].missing];
  if (day[key] === null || missing === day.count) return '未提供';
  return metrics[key].format(day[key]) + (missing ? '（' + missing + ' 次未提供）' : '');
}
function sentence(day) {
  return day.date + ' · ' + day.count + ' 次运动 · ' + display(day, 'distanceKm') + ' · ' + display(day, 'durationSeconds') + ' · 负荷 ' + display(day, 'trainingLoad');
}
function selectDay(date, focus = false) {
  if (!byDate.has(date)) return;
  selectedDate = date;
  dateInput.value = date;
  for (const button of buttons) {
    const active = button.dataset.date === date;
    button.tabIndex = active ? 0 : -1;
    button.setAttribute('aria-current', String(active));
  }
  description.textContent = sentence(byDate.get(date));
  if (focus) buttonByDate.get(date).focus();
}
function render() {
  const spec = metrics[metric];
  for (const day of daily) {
    const button = buttonByDate.get(day.date);
    const value = day[metric];
    const missing = spec.missing && day[spec.missing];
    const entirelyMissing = day.count > 0 && (value === null || missing === day.count);
    button.dataset.level = entirelyMissing ? 'missing' : day.count === 0 || value === 0 ? '0' : String(1 + spec.thresholds.filter(threshold => value >= threshold).length);
    button.dataset.missing = String(Boolean(missing && !entirelyMissing));
    button.setAttribute('aria-label', day.date + '，' + day.count + ' 次运动，' + spec.label + ' ' + display(day, metric));
    button.title = sentence(day);
  }
  for (const button of document.querySelectorAll('[data-metric]')) button.setAttribute('aria-pressed', String(button.dataset.metric === metric));
  const ranges = {
    distanceKm: '10 / 30 / 60 公里',
    durationSeconds: '30 / 60 / 120 分钟',
    trainingLoad: '50 / 150 / 300'
  };
  explanation.textContent = '颜色越亮，累计' + spec.label + '越多 · 分级界限 ' + ranges[metric];
  selectDay(selectedDate);
}
for (const button of document.querySelectorAll('[data-metric]')) button.addEventListener('click', () => {
  metric = button.dataset.metric;
  render();
});
for (const button of buttons) {
  button.addEventListener('click', () => selectDay(button.dataset.date));
  button.addEventListener('keydown', event => {
    const index = daily.findIndex(day => day.date === button.dataset.date);
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? daily.length - 1 : step === undefined ? undefined : index + step;
    if (target === undefined) return;
    event.preventDefault();
    selectDay(daily[Math.max(0, Math.min(daily.length - 1, target))].date, true);
  });
}
dateInput.addEventListener('change', () => {
  if (dateInput.validity.valid && byDate.has(dateInput.value)) selectDay(dateInput.value);
  else dateInput.value = selectedDate;
});
render();
if (matchMedia('(max-width: 600px)').matches) {
  const scroller = document.querySelector('.heatmap-scroll');
  scroller.scrollLeft = scroller.scrollWidth;
}

