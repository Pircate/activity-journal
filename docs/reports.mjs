const version = new URL(import.meta.url).searchParams.get('v');
const {beijingDate, availableYears, createJournal, formatDistance, formatLoad} = await import('./journal.mjs' + (version ? '?v=' + version : ''));
const {sportLabel, summarizeActivities} = await import('./activity-data.mjs' + (version ? '?v=' + version : ''));
const pretty = date => date.replaceAll('-', '.');
const reportMetrics = {
  distanceKm:{label:'距离', unit:'km'},
  durationSeconds:{label:'时长', unit:'h'},
  count:{label:'次数', unit:'次'},
  trainingLoad:{label:'负荷', unit:'TL'},
};
// 单位用弱化的次级色；橙色主视觉沿用数字墨色，只靠字号和字重区分，避免叠色发浑。
const unitColors = {light:'#77796e', dark:'#bec5b7', orange:'#202820'};
// 桌面浏览器同样可能支持 navigator.share，但桌面没有相册，仍应使用下载。
const isMobile = () => {
  const nav = globalThis.navigator;
  if (!nav) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '')) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
};
const distanceNumber = value => value === null ? '—' : formatDistance(value);
const loadNumber = value => value === null ? '—' : formatLoad(value);
const number = value => value === null ? '—' : value.toLocaleString('zh-CN', {maximumFractionDigits:2});
const durationParts = seconds => {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  return hours ? [[String(hours), 'h'], [String(totalMinutes % 60), 'min']] : [[String(totalMinutes), 'min']];
};
const durationText = seconds => {
  if (seconds === null) return '未提供';
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  return hours ? `${hours} 小时 ${totalMinutes % 60} 分钟` : `${totalMinutes} 分钟`;
};
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
  const sports = report.sports.map(item => `${sportLabel(item.sport)} ${item.count} 次 / ${distanceNumber(item.distanceKm)} km / ${durationText(item.durationSeconds)} / ${loadNumber(item.trainingLoad)} TL`).join('；');
  return `${report.title}，${pretty(report.start)} 至 ${pretty(report.end)}${report.ongoing ? '（周期进行中）' : ''}。已记录距离 ${distance}，运动时长 ${durationText(report.durationSeconds)}，总负荷 ${loadNumber(report.trainingLoad)} TL，运动 ${report.count ?? '未知'} 次，活跃 ${report.activeDays ?? '未知'} 天。${sports ? '各运动统计：' + sports + '。' : ''}${report.notes.join('；')}。`;
}

export function drawReport(canvas, report, name, metric = 'distanceKm') {
  const spec = reportMetrics[metric];
  if (!spec) throw new Error('请选择有效的图表指标。');
  canvas.width = 1080;
  canvas.height = Math.max(1920, 1600 + Math.max(1, report.sports.length) * 80);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片。');
  const font = (size, weight) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const text = (value, x, y, size = 26, color = '#252821', weight = 400, width = 936) => {
    ctx.fillStyle = color;
    ctx.font = font(size, weight);
    ctx.fillText(String(value), x, y, width);
  };
  const measure = (value, size, weight = 400) => {
    ctx.font = font(size, weight);
    return ctx.measureText(String(value)).width;
  };
  // 数值与单位同基线绘制，单位用小字号和更浅的颜色；缺失值不附加单位。
  const annotated = (value, unit, x, y, size, color, weight = 600, unitSize = Math.round(size * 0.58), gap = Math.round(size * 0.15), unitColor = unitColors.light, unitWeight = 500) => {
    const label = String(value);
    const valueWidth = measure(label, size, weight);
    text(label, x, y, size, color, weight, valueWidth + 1);
    if (!unit || label === '—' || label === '未提供') return valueWidth;
    const unitWidth = measure(unit, unitSize, unitWeight);
    text(unit, x + valueWidth + gap, y, unitSize, unitColor, unitWeight, unitWidth + 1);
    return valueWidth + gap + unitWidth;
  };
  const annotatedParts = (parts, x, y, size, color, weight, unitColor = unitColors.light) => {
    const gap = Math.round(size * 0.22);
    let cursor = x;
    parts.forEach(([value, unit], index) => {
      if (index) cursor += gap;
      cursor += annotated(value, unit, cursor, y, size, color, weight, Math.round(size * 0.58), Math.round(size * 0.15), unitColor);
    });
    return cursor - x;
  };
  const line = y => { ctx.fillStyle = '#d4cfc3'; ctx.fillRect(72, y, 936, 1); };
  ctx.fillStyle = '#f1eee4'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#202820'; ctx.fillRect(0, 0, 1080, 820);
  ctx.fillStyle = '#e85a31'; ctx.fillRect(0, 330, 1080, 250);
  text('运动日志 / ' + name, 72, 78, 25, '#f1eee4', 600, 650);
  text(report.mode === 'year' ? '年度记录' : '月度记录', 830, 78, 24, '#f1eee4', 600, 178);
  text(report.selection.slice(0, 4), 68, 210, 120, '#f1eee4', 700, 440);
  // 年报右侧用已覆盖的月份数延续“数字 + 小字单位”的版式，避免孤立的“年”字。
  if (report.mode === 'month') text(report.selection.slice(5), 696, 252, 186, '#e85a31', 700, 300);
  else {
    const months = String(report.buckets.length);
    const monthsWidth = measure(months, 186, 700);
    text(months, 696, 252, 186, '#e85a31', 700, monthsWidth + 1);
    text('个月', 696 + monthsWidth + 10, 252, 34, '#bec5b7', 600, 90);
  }
  text(pretty(report.start) + ' — ' + pretty(report.end), 72, 262, 24, '#bec5b7');
  text('距离', 72, 390, 25, '#202820', 600);
  annotated(distanceNumber(report.distanceKm), 'km', 68, 522, 116, '#202820', 700, 46, 18, unitColors.orange);
  text('运动的痕迹', 837, 480, 25, '#202820', 600, 170);
  text('留在每一天', 837, 514, 25, '#202820', 600, 170);
  const metrics = [
    ['时长', report.durationSeconds === null ? null : durationParts(report.durationSeconds)],
    ['次数', [[report.count === null ? '—' : String(report.count), '次']]],
    ['负荷', [[loadNumber(report.trainingLoad), 'TL']]],
  ];
  metrics.forEach(([label, parts], index) => {
    const x = 72 + index * 320;
    text(label, x, 650, 24, '#bec5b7');
    if (parts === null) text('—', x, 704, 43, '#f1eee4', 600, 295);
    else annotatedParts(parts, x, 704, 43, '#f1eee4', 600, unitColors.dark);
  });
  text('活跃 ' + (report.activeDays ?? '—') + ' 天', 72, 762, 24, '#bec5b7');
  // 图表头部：小字标签说明统计口径，下方给出对应的日均／月均值。
  text((report.mode === 'year' ? '月均' : '日均') + spec.label, 72, 888, 22, '#77796e', 600);
  const days = report.buckets.length;
  const average = days ? {
    distanceKm:report.distanceKm === null ? null : formatDistance(report.distanceKm / days),
    durationSeconds:report.durationSeconds === null ? null : report.durationSeconds / days,
    count:report.count === null ? null : number(report.count / days),
    trainingLoad:report.trainingLoad === null ? null : formatLoad(report.trainingLoad / days),
  }[metric] : null;
  if (average !== null) {
    if (metric === 'durationSeconds') annotatedParts(durationParts(average), 72, 932, 34, '#292b25', 700, unitColors.light);
    else annotated(average, spec.unit, 72, 932, 34, '#292b25', 700, 18, 6, unitColors.light);
  }
  const value = bucket => metric === 'durationSeconds' && bucket[metric] !== null ? bucket[metric] / 3600
    : metric === 'distanceKm' && bucket.distanceKm === null && !bucket.missingDistance && !bucket.incomplete ? 0 : bucket[metric];
  const max = Math.max(1, ...report.buckets.map(bucket => value(bucket) ?? 0));
  const step = 850 / days;
  // 保留量纲和刻度，图中只绘制已记录值。
  for (const tick of [0, max / 2, max]) {
    const y = 1190 - tick / max * 230;
    ctx.fillStyle = '#d8d4c9'; ctx.fillRect(72, y, 850, 1);
    const label = number(tick);
    const unitWidth = measure(spec.unit, 13, 600);
    const valueWidth = measure(label, 20, 400);
    const right = 1008;
    text(label, right - unitWidth - 5 - valueWidth, y + 7, 20, '#55574d', 400, valueWidth + 1);
    text(spec.unit, right - unitWidth, y + 7, 13, unitColors.light, 600, unitWidth + 1);
  }
  report.buckets.forEach((bucket, index) => {
    const barWidth = Math.min(36, step * 0.65);
    const x = 72 + index * step + (step - barWidth) / 2;
    const amount = value(bucket);
    const height = (amount ?? 0) / max * 230;
    ctx.fillStyle = '#d9512b';
    if (amount !== null && amount > 0) ctx.fillRect(x, 1190 - height, barWidth, height);
    if (report.mode === 'year' || index === 0 || Number(bucket.label) % 5 === 0 || index === report.buckets.length - 1 && (step >= 40 || Number(bucket.label) % 5 > 2)) {
      text(bucket.label, x, 1227, 21, '#77796e', 400, step - 1);
    }
  });
  line(1280);
  text('运动统计', 72, 1350, 28, '#292b25', 600);
  [['运动 / 次数',72], ['距离',350], ['时长',590], ['负荷',850]].forEach(([label,x]) => text(label, x, 1410, 22, '#77796e'));
  if (!report.sports.length) text(report.pendingDays || report.unavailable ? '暂无可读取记录' : '暂无运动记录', 72, 1480, 26, '#77796e');
  report.sports.forEach((item, index) => {
    const y = 1480 + index * 80;
    text(sportLabel(item.sport), 72, y, 25, '#292b25', 600, 250);
    annotated(String(item.count), '次', 72, y + 26, 20, '#292b25', 400, 12, 4, unitColors.light);
    annotated(distanceNumber(item.distanceKm), 'km', 350, y + 9, 27, '#292b25', 600, 16, 7, unitColors.light);
    if (item.durationSeconds === null) text('—', 590, y + 9, 27, '#292b25', 600, 235);
    else annotatedParts(durationParts(item.durationSeconds), 590, y + 9, 27, '#292b25', 600, unitColors.light);
    annotated(loadNumber(item.trainingLoad), 'TL', 850, y + 9, 27, '#292b25', 600, 16, 7, unitColors.light);
  });
  line(canvas.height - 130);
  text('运动日志 / ' + name, 72, canvas.height - 75, 22, '#77796e', 600, 700);
  text(report.selection, 850, canvas.height - 75, 22, '#77796e', 600, 158);
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
    <button type="button" id="report-generate">生成分享图片</button></form>
    <p id="report-status" class="report-intro" role="status" aria-live="polite"></p>
    <div id="report-result" hidden><button type="button" id="report-save" class="report-download" hidden>保存到相册</button><a id="report-download" class="report-download">下载 PNG 图片</a><p class="report-intro" id="report-image-info">图片宽 1080 像素，高度随运动类型数量调整。</p><p id="report-summary" class="sr-only"></p><img id="report-image" class="report-image" width="1080" height="1440" alt=""></div>
    <noscript><p>启用 JavaScript 后可生成与下载图片。</p></noscript></div></section>`;
}

export function initializeReports(initialData, name) {
  let data = initialData;
  let revision = 0;
  let imageUrl;
  let imageFile;
  const form = document.getElementById('report-form');
  const mode = document.getElementById('report-mode');
  const month = document.getElementById('report-month');
  const year = document.getElementById('report-year');
  const metric = document.getElementById('report-metric');
  const result = document.getElementById('report-result');
  const status = document.getElementById('report-status');
  const image = document.getElementById('report-image');
  const save = document.getElementById('report-save');
  const download = document.getElementById('report-download');
  const generate = document.getElementById('report-generate');
  function invalidate(message) {
    revision++;
    result.hidden = true;
    image.removeAttribute('src');
    download.removeAttribute('href');
    imageFile = undefined;
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
  async function generateReport(event) {
    event?.preventDefault();
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
      imageFile = typeof File === 'function' ? new File([blob], '运动' + (report.mode === 'month' ? '月报' : '年报') + '-' + report.selection + '.png', {type:'image/png'}) : undefined;
      document.getElementById('report-summary').textContent = image.alt;
      document.getElementById('report-image-info').textContent = `1080 × ${canvas.height} 像素${isMobile() ? ' · 长按下方图片也可保存。' : ''}`;
      download.href = imageUrl;
      download.download = imageFile?.name || '运动' + (report.mode === 'month' ? '月报' : '年报') + '-' + report.selection + '.png';
      const canShareFile = isMobile() && imageFile && typeof globalThis.navigator?.canShare === 'function' && typeof globalThis.navigator.share === 'function' && globalThis.navigator.canShare({files:[imageFile]});
      save.hidden = !canShareFile;
      download.hidden = Boolean(canShareFile);
      result.hidden = false;
      status.textContent = report.title + '已生成，可预览并下载。';
    } catch (error) {
      if (request === revision) status.textContent = error.message || '图片生成失败，请重试。';
    } finally {
      if (request === revision) generate.disabled = false;
    }
  }
  form.addEventListener('submit', generateReport);
  generate.addEventListener('click', () => generateReport());
  save.addEventListener('click', async () => {
    if (!imageFile || typeof globalThis.navigator?.share !== 'function') return;
    try {
      await globalThis.navigator.share({files:[imageFile], title:imageFile.name});
      status.textContent = '已打开系统分享面板，请选择保存图片。';
    } catch (error) {
      if (error.name === 'AbortError') return;
      save.hidden = true;
      download.hidden = false;
      status.textContent = '系统保存面板不可用，可下载 PNG 图片。';
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
