const version = new URL(import.meta.url).searchParams.get('v');
const {beijingDate, availableYears, createJournal, formatTime, formatDistance, formatLoad} = await import('./journal.mjs' + (version ? '?v=' + version : ''));
const {sportLabel, summarizeActivities} = await import('./activity-data.mjs' + (version ? '?v=' + version : ''));
const pretty = date => date.replaceAll('-', '.');
const reportMetrics = {
  distanceKm:{label:'距离', unit:'km'},
  durationSeconds:{label:'时长', unit:'小时'},
  count:{label:'次数', unit:'次'},
  trainingLoad:{label:'负荷', unit:'TL'},
};
const distanceNumber = value => value === null ? '—' : formatDistance(value);
const loadNumber = value => value === null ? '—' : formatLoad(value);
const number = value => value === null ? '—' : value.toLocaleString('zh-CN', {maximumFractionDigits:2});
function summarize(records, unknown = false) {
  const summary = summarizeActivities(records);
  return unknown ? {...summary, count:null, distanceKm:null, durationSeconds:null, trainingLoad:null} : summary;
}

export function createReport(data, mode, selection, today = beijingDate()) {
  if (!['month', 'year'].includes(mode) || !(mode === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}$/).test(selection)) throw new Error('请选择有效的报表周期。');
  const year = selection.slice(0, 4);
  const start = mode === 'month' ? selection + '-01' : year + '-01-01';
  if (!availableYears(data, today).includes(year) || start > today) throw new Error('请选择已开始且在记录范围内的周期。');
  const fullEnd = mode === 'month' ? new Date(Date.UTC(Number(year), Number(selection.slice(5)), 0)).toISOString().slice(0, 10) : year + '-12-31';
  const end = fullEnd < today ? fullEnd : today;
  const journal = createJournal(data, today, year);
  const daily = journal.daily.filter(day => day.date >= start && day.date <= end);
  const records = daily.flatMap(day => day.records);
  const pendingDays = daily.filter(day => day.pending).length;
  const unavailable = daily.reduce((sum, day) => sum + day.unavailable, 0);
  const unknown = !records.length && Boolean(pendingDays || unavailable);
  const summary = summarize(records, unknown);
  const sports = [...new Set(records.map(activity => activity.sport))].map(sport => ({sport, ...summarize(records.filter(activity => activity.sport === sport))})).sort((a, b) => b.count - a.count || sportLabel(a.sport).localeCompare(sportLabel(b.sport), 'zh-CN'));
  const bucket = (label, days) => {
    const pending = days.some(day => day.pending || day.unavailable);
    const records = days.flatMap(day => day.records);
    return {label, ...summarize(records, !records.length && pending), incomplete:pending};
  };
  // 横轴只保留已开始的月份／日期，缺失标记仅用于已过时间。
  const buckets = mode === 'year'
    ? Array.from({length:Number(end.slice(5, 7))}, (_, index) => {
      const prefix = year + '-' + String(index + 1).padStart(2, '0');
      const days = daily.filter(day => day.date.startsWith(prefix));
      return bucket(String(index + 1), days);
    })
    : daily.map(day => bucket(String(Number(day.date.slice(8))), [day]));
  const title = mode === 'month' ? year + ' 年 ' + Number(selection.slice(5)) + ' 月运动月报' : year + ' 年运动年报';
  const notes = ['仅统计可读取记录 · 力量训练不计距离 · 日期按北京时间'];
  if (pendingDays) notes.push('未同步 ' + pendingDays + ' 天，不当作没有运动');
  if (unavailable) notes.push('详情不可读取 ' + unavailable + ' 条，未计入统计');
  if (summary.missingMetrics) notes.push('指标缺失 ' + summary.missingMetrics + ' 次：距离未提供 ' + summary.missingDistance + ' 次，负荷未提供 ' + summary.missingLoad + ' 次');
  return {mode, selection, title, start, end, ongoing:end < fullEnd, syncedAt:data.syncedAt,
    ...summary,
    activeDays:unknown ? null : daily.filter(day => day.count).length,
    pendingDays, unavailable, sports, buckets, notes};
}

export function reportSummary(report) {
  const distance = report.distanceKm === null ? '未提供' : formatDistance(report.distanceKm) + ' km';
  const sports = report.sports.map(item => `${sportLabel(item.sport)} ${item.count} 次 / ${distanceNumber(item.distanceKm)} km / ${formatTime(item.durationSeconds)} / ${loadNumber(item.trainingLoad)} TL`).join('；');
  return `${report.title}，${pretty(report.start)} 至 ${pretty(report.end)}${report.ongoing ? '（周期进行中）' : ''}。已记录距离 ${distance}，运动时长 ${report.durationSeconds === null ? '未提供' : formatTime(report.durationSeconds)}，总负荷 ${loadNumber(report.trainingLoad)} TL，运动 ${report.count ?? '未知'} 次，活跃 ${report.activeDays ?? '未知'} 天。${sports ? '各运动统计：' + sports + '。' : ''}${report.notes.join('；')}。`;
}

export function drawReport(canvas, report, name, metric = 'distanceKm') {
  const spec = reportMetrics[metric];
  if (!spec) throw new Error('请选择有效的图表指标。');
  canvas.width = 1080;
  canvas.height = 1100 + Math.max(1, report.sports.length) * 68;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片。');
  const text = (value, x, y, size = 26, color = '#f5f5f5', weight = 400, width = 936) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(String(value), x, y, width);
  };
  const line = y => { ctx.fillStyle = '#353535'; ctx.fillRect(72, y, 936, 1); };
  ctx.fillStyle = '#131313'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fc4c02'; ctx.fillRect(72, 68, 56, 7);
  text(name + '的运动日志', 72, 126, 28, '#ff8a4c', 600);
  text(report.title, 72, 208, 54, '#f5f5f5', 700);
  text(`${pretty(report.start)} — ${pretty(report.end)}`, 72, 260, 25, '#b5b5b5');
  line(296);
  text('已记录距离 / km', 72, 349, 26, '#b5b5b5');
  text(report.distanceKm === null ? '—' : formatDistance(report.distanceKm), 72, 459, 102, '#fc4c02', 700);
  const metrics = [
    ['时长', report.durationSeconds === null ? '—' : formatTime(report.durationSeconds)],
    ['次数', report.count === null ? '—' : report.count + ' 次'],
    ['负荷 / TL', loadNumber(report.trainingLoad)],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 72 + index * 320;
    text(label, x, 526, 24, '#b5b5b5');
    text(value, x, 579, 43, '#f5f5f5', 600, 295);
  });
  text('活跃 ' + (report.activeDays ?? '—') + ' 天', 72, 626, 24, '#b5b5b5');
  line(654);
  text((report.mode === 'year' ? '每月' : '每日') + spec.label + ' / ' + spec.unit, 72, 705, 28, '#f5f5f5', 600);
  const value = bucket => metric === 'durationSeconds' && bucket[metric] !== null ? bucket[metric] / 3600
    : metric === 'distanceKm' && bucket.distanceKm === null && !bucket.missingDistance && !bucket.incomplete ? 0 : bucket[metric];
  const max = Math.max(1, ...report.buckets.map(bucket => value(bucket) ?? 0));
  const step = 850 / report.buckets.length;
  // 保留量纲和刻度，图中只绘制已记录值。
  for (const tick of [0, max / 2, max]) {
    const y = 850 - tick / max * 130;
    ctx.fillStyle = '#303030'; ctx.fillRect(72, y, 850, 1);
    text(number(tick), 942, y + 7, 20, '#b5b5b5', 400, 68);
  }
  report.buckets.forEach((bucket, index) => {
    const barWidth = Math.min(12, step * 0.3);
    const x = 72 + index * step + (step - barWidth) / 2;
    const amount = value(bucket);
    const height = (amount ?? 0) / max * 130;
    ctx.fillStyle = '#fc4c02';
    if (amount !== null && amount > 0) ctx.fillRect(x, 850 - height, barWidth, height);
    if (report.mode === 'year' || index === 0 || Number(bucket.label) % 5 === 0 || index === report.buckets.length - 1 && (step >= 40 || Number(bucket.label) % 5 > 2)) {
      text(bucket.label, x, 883, 21, '#b5b5b5', 400, step - 1);
    }
  });
  line(922);
  text('运动统计', 72, 973, 28, '#f5f5f5', 600);
  [['运动 / 次数',72], ['距离 / km',350], ['时长',590], ['负荷 / TL',850]].forEach(([label,x]) => text(label, x, 1017, 22, '#b5b5b5'));
  if (!report.sports.length) text(report.pendingDays || report.unavailable ? '暂无可读取记录' : '暂无运动记录', 72, 1070, 26, '#b5b5b5');
  report.sports.forEach((item, index) => {
    const y = 1064 + index * 68;
    text(sportLabel(item.sport), 72, y, 25, '#f5f5f5', 600, 250);
    text(item.count + ' 次', 72, y + 26, 20, '#b5b5b5');
    text(distanceNumber(item.distanceKm), 350, y + 9, 27, '#f5f5f5', 600, 215);
    text(formatTime(item.durationSeconds), 590, y + 9, 27, '#f5f5f5', 600, 235);
    text(loadNumber(item.trainingLoad), 850, y + 9, 27, '#f5f5f5', 600, 158);
  });
}

function yearOptions(data, today) {
  return availableYears(data, today).map(year => `<option value="${year}">${year} 年</option>`).join('');
}

export function renderReportPanel(data, today = beijingDate()) {
  return `<section class="report-section" id="reports" aria-labelledby="report-title"><div class="section-head"><h2 id="report-title"><span class="section-number">06</span>月报／年报分享</h2><p>把这一程，存成一张图片</p></div>
    <div class="report-panel">
    <form id="report-form" class="report-controls"><div class="history-field"><label for="report-mode">报表类型</label><select id="report-mode"><option value="month">运动月报</option><option value="year">运动年报</option></select></div>
    <div class="history-field" id="report-month-field"><label for="report-month">月份</label><input id="report-month" type="month" required min="${data.period.start.slice(0, 7)}" max="${today.slice(0, 7)}" value="${(data.period.end < today ? data.period.end : today).slice(0, 7)}"></div>
    <div class="history-field" id="report-year-field" hidden><label for="report-year">年份</label><select id="report-year" disabled>${yearOptions(data, today)}</select></div>
    <div class="history-field"><label for="report-metric">图表指标</label><select id="report-metric">${Object.entries(reportMetrics).map(([key, spec]) => `<option value="${key}">${spec.label}</option>`).join('')}</select></div>
    <button type="submit" id="report-generate">生成分享图片</button></form>
    <p id="report-status" class="report-intro" role="status" aria-live="polite"></p>
    <div id="report-result" hidden><a id="report-download" class="report-download">下载 PNG 图片</a><p class="report-intro" id="report-image-info">图片宽 1080 像素，高度随运动类型数量调整 · 手机也可长按下方图片保存。</p><p id="report-summary" class="sr-only"></p><img id="report-image" class="report-image" width="1080" height="1440" alt=""></div>
    <noscript><p>启用 JavaScript 后可生成与下载图片。</p></noscript></div></section>`;
}

export function initializeReports(initialData, name) {
  let data = initialData;
  let revision = 0;
  let imageUrl;
  const form = document.getElementById('report-form');
  const mode = document.getElementById('report-mode');
  const month = document.getElementById('report-month');
  const year = document.getElementById('report-year');
  const metric = document.getElementById('report-metric');
  const result = document.getElementById('report-result');
  const status = document.getElementById('report-status');
  const image = document.getElementById('report-image');
  const download = document.getElementById('report-download');
  const generate = document.getElementById('report-generate');
  function invalidate(message) {
    revision++;
    result.hidden = true;
    image.removeAttribute('src');
    download.removeAttribute('href');
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
    generate.disabled = false;
    status.textContent = message;
  }
  form.addEventListener('change', () => {
    const annual = mode.value === 'year';
    document.getElementById('report-month-field').hidden = annual;
    document.getElementById('report-year-field').hidden = !annual;
    month.disabled = annual;
    year.disabled = !annual;
    invalidate('报表选项已调整，请生成分享图片。');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    invalidate('正在生成分享图片…');
    const request = revision;
    generate.disabled = true;
    try {
      const report = createReport(data, mode.value, mode.value === 'month' ? month.value : year.value, beijingDate());
      await document.fonts.ready;
      if (request !== revision) return;
      const canvas = document.createElement('canvas');
      drawReport(canvas, report, name, metric.value || 'distanceKm');
      const blob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败，请重试。')), 'image/png'));
      if (request !== revision) return;
      imageUrl = URL.createObjectURL(blob);
      image.src = imageUrl;
      image.height = canvas.height;
      image.alt = reportSummary(report);
      document.getElementById('report-summary').textContent = image.alt;
      document.getElementById('report-image-info').textContent = `1080 × ${canvas.height} 像素 · 手机也可长按下方图片保存。`;
      download.href = imageUrl;
      download.download = '运动' + (report.mode === 'month' ? '月报' : '年报') + '-' + report.selection + '.png';
      result.hidden = false;
      status.textContent = report.title + '已生成，可预览并下载。';
    } catch (error) {
      if (request === revision) status.textContent = error.message || '图片生成失败，请重试。';
    } finally {
      if (request === revision) generate.disabled = false;
    }
  });
  return (latest, nextToday) => {
    data = latest;
    month.min = data.period.start.slice(0, 7);
    month.max = nextToday.slice(0, 7);
    if (month.value < month.min || month.value > month.max || !availableYears(data, nextToday).includes(month.value.slice(0, 4))) month.value = (data.period.end < nextToday ? data.period.end : nextToday).slice(0, 7);
    const previous = year.value;
    year.innerHTML = yearOptions(data, nextToday);
    if (availableYears(data, nextToday).includes(previous)) year.value = previous;
    invalidate('数据或日期已更新，请重新生成分享图片。');
  };
}
