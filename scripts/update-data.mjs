import {readFile, writeFile} from 'node:fs/promises';
import {validateData, shiftDate, syncTimestamp} from '../docs/journal.mjs';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('用法：node scripts/update-data.mjs <规范化的 COROS 数据.json>');
const target = new URL('../docs/activities.json', import.meta.url);
const existing = JSON.parse(await readFile(target, 'utf8'));
const incoming = JSON.parse(await readFile(inputPath, 'utf8'));
validateData(existing);
validateData(incoming);
if (syncTimestamp(incoming.syncedAt) < syncTimestamp(existing.syncedAt) || incoming.period.end < existing.period.end) throw new Error('拒绝过期的同步数据');
if (incoming.period.start > shiftDate(existing.period.end, 1)) throw new Error('同步范围有缺口，需要补查缺失日期');
const period = {start:shiftDate(incoming.period.end, -364), end:incoming.period.end};
const activities = existing.activities.filter(a => a.date < incoming.period.start || a.date > incoming.period.end)
  .concat(incoming.activities).filter(a => a.date >= period.start && a.date <= period.end)
  .sort((a,b) => b.date.localeCompare(a.date));
const updated = {period, syncedAt:incoming.syncedAt, activities};
validateData(updated);
await writeFile(target, JSON.stringify(updated, null, 2) + '\n');
console.log(JSON.stringify({period, records:activities.length, replacedRange:incoming.period}));
