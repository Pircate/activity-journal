import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {normalizeGear, fetchYear} from './update-data.mjs';
import {renderGearLibrary, validateData, createJournal} from '../docs/journal.mjs';

const part = (id, type, extra = {}) => ({id, type, name:id, component:true, distance:12000000, ...extra});
const bike = (id, component_ids = [], extra = {}) => ({id, name:id, type:'Bike', distance:24000000, component_ids, ...extra});
const reminder = (distance_used = 0, extra = {}) => ({name:'更换', last_reset:'2026-10-14T16:30:00Z', distance_used, ...extra});
const snapshot = gearLibrary => ({period:{start:'2025-10-16',end:'2026-10-15'}, syncedAt:'2026-10-15 12:00:00 +08:00', activities:[], unavailableActivities:[], gearLibrary});

test('按车解析嵌套和共享配件，去重并隐藏退役装备', () => {
  const gears = [bike('公路车',['链条','轮组','前胎','旧飞轮']), bike('通勤车',['链条']),
    bike('旧车',[],{retired:'2026-01-01'}), part('链条','Chain',{reminders:[reminder(1200000)]}),
    part('轮组','Wheelset',{component_ids:['前胎','后胎']}), part('前胎','Tyre'), part('后胎','Tyre'),
    part('旧飞轮','Cassette',{retired:'2026-01-01'}), part('未装车配件','Chain')];
  const library = normalizeGear(gears);
  assert.deepEqual(library.map(b => b.name), ['公路车','通勤车']);
  assert.deepEqual(library[0].components.map(p => p.name), ['链条','轮组','前胎','后胎']);
  assert.deepEqual(library[1].components, [library[0].components[0]]);
  assert.equal(library[0].distanceKm, 24000);
  assert.equal(library[0].components[0].distanceKm, 12000);
  assert.equal(library[0].components[0].replacement.distanceKm, 1200);
  validateData(snapshot(library));
});

test('只读专用更换提醒，前后胎独立记录，转换北京时间并保留零里程', () => {
  const library = normalizeGear([bike('车',['前胎 A','后胎 B']),
    part('前胎 A','Tyre',{reminders:[reminder(999999,{name:'补胎液'}),reminder(0)]}),
    part('后胎 B','Tyre',{reminders:[reminder(4200000,{last_reset:'2025-01-01T01:00:00+09:00',distance:123})]})]);
  const [front,rear] = library[0].components;
  assert.deepEqual(front.replacement, {status:'available',date:'2026-10-15',distanceKm:0});
  assert.deepEqual(rear.replacement, {status:'available',date:'2025-01-01',distanceKm:4200});
  const html = renderGearLibrary(library);
  assert.match(html, /前胎<\/span>/);
  assert.match(html, /后胎<\/span>/);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /aria-valuenow="4200"/);
  assert.equal((html.match(/aria-valuemax="5000"/g) ?? []).length, 2);
});

test('缺失、重名和不完整提醒保留未知，不冒用购买日期或累计里程', () => {
  const library = normalizeGear([bike('车',['无提醒','重名','缺字段','未知位置']),
    part('无提醒','Chain',{purchased:'2020-01-01'}), part('重名','Cassette',{reminders:[reminder(),reminder()]}),
    part('缺字段','Tyre',{reminders:[{name:'更换'}]}), part('未知位置','Tyre',{distance:null})]);
  const parts = library[0].components;
  assert.deepEqual(parts.map(p => p.replacement.status), ['missing-reminder','duplicate-reminder','available','missing-reminder']);
  assert.ok(parts.every(p => p.replacement.date === null && p.replacement.distanceKm === null));
  validateData(snapshot(library));
  const html = renderGearLibrary(library);
  assert.match(html,/未设置更换提醒/);
  assert.match(html,/提醒重名/);
  assert.match(html,/更换后里程未提供/);
  assert.match(html,/未标记前后位置/);
  assert.doesNotMatch(html,/role="progressbar"|2020\.01\.01/);
});

test('历史更换日期只作用于补录时的提醒，后续重置与更换提醒自动失效', () => {
  const initial = reminder(3064059,{id:123,starting_distance:0,starting_time:0,starting_activities:0});
  const entry = {date:'2025-10-07',reminderId:123,resetAt:initial.last_reset,baseline:[0,0,0]};
  const notes = '原有私人备注\n运动装备库更换记录：'+JSON.stringify(entry);
  const read = (r, note = notes) => normalizeGear([bike('车',['链条']),part('链条','Chain',{notes:note,reminders:[r]})])[0].components[0].replacement;
  assert.equal(read(initial).date,'2025-10-07');
  assert.equal(read({...initial,last_reset:'2026-10-15T00:30:00+08:00'}).date,'2025-10-07');
  assert.equal(read({...initial,last_reset:'2026-10-15T16:00:00Z'}).date,'2026-10-16');
  assert.equal(read({...initial,starting_distance:3064059}).date,'2026-10-15');
  assert.equal(read({...initial,starting_time:50}).date,'2026-10-15');
  assert.equal(read({...initial,starting_activities:1}).date,'2026-10-15');
  assert.equal(read({...initial,id:124}).date,'2026-10-15');
  assert.equal(read(initial,'普通备注：2025-10-07').date,'2026-10-15');
  const unknownDate = '运动装备库更换记录：'+JSON.stringify({...entry,date:null});
  assert.equal(read(initial,unknownDate).date,null);
  assert.equal(read({...initial,starting_distance:3064059},unknownDate).date,'2026-10-15');
  assert.throws(() => read(initial,'运动装备库更换记录：{}'));
  assert.throws(() => read(initial,notes+'\n运动装备库更换记录：'+JSON.stringify(entry)));
});

test('进度准确区分 80%、到期和超期，超期填充及可访问数值不溢出', () => {
  for (const [type,target] of [['Chain',5000],['Tyre',5000],['Cassette',10000],['Chainrings',30000]]) {
    for (const [ratio,state] of [[0,'normal'],[.79999,'normal'],[.8,'soon'],[.99999,'soon'],[1,'due'],[1.2,'due']]) {
      const html = renderGearLibrary(normalizeGear([bike('车',['配件']),part('配件',type,{reminders:[reminder(target * ratio * 1000)]})]));
      assert.match(html,new RegExp('data-state="'+state+'"'));
      assert.match(html,new RegExp('aria-valuemax="'+target+'"'));
      assert.match(html,new RegExp('aria-valuenow="'+Math.min(target*ratio,target)+'"'));
      if (ratio > 1) {
        assert.match(html,/width:100%/);
        assert.match(html,/已超出/);
        assert.match(html,/120%/);
      }
    }
  }
});

test('普通配件显示总里程；页面转义装备名称，且公开数据只含许可字段', () => {
  const library = normalizeGear([bike('<script>车</script>',['internal-part'],{athlete_id:'secret-athlete',notes:'私密备注'}),
    part('internal-part','Wheelset',{name:'<img src=x onerror=alert(1)>',reminders:[reminder()]})]);
  const html = renderGearLibrary(library);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img/);
  assert.match(html,/累计里程 12,000 km/);
  assert.doesNotMatch(html,/<script>|<img|role="progressbar"/);
  assert.doesNotMatch(JSON.stringify(library),/internal-part|secret-athlete|私密备注|athlete_id|component_ids/);
  validateData(snapshot(library));
  assert.throws(() => validateData(snapshot([{...library[0],id:'leak'}])));
  assert.throws(() => validateData(snapshot([{...library[0],components:[{...library[0].components[0],notes:'leak'}]}])));
});

test('装备使用总里程与年度范围无关，首次未同步与真实空列表明确区分', () => {
  const data = snapshot(normalizeGear([bike('车',['链条']),part('链条','Chain',{reminders:[reminder(6500000)]})]));
  assert.notEqual(createJournal(data).period.end,createJournal(data,'2027-10-15').period.end);
  assert.match(renderGearLibrary(data.gearLibrary),/24,000 km/);
  assert.match(renderGearLibrary(data.gearLibrary),/6,500 km/);
  for (const value of [null,[]]) validateData(snapshot(value));
  assert.match(renderGearLibrary(null),/装备尚未同步/);
  assert.match(renderGearLibrary([]),/还没有在用的自行车/);
  const {gearLibrary,...oldData} = data;
  assert.throws(() => validateData(oldData));
});

test('拒绝无效装备列表、重复标识、循环、缺失引用及无效提醒数值', () => {
  for (const records of [null,{},[bike('车'),bike('车')], [bike('车',['不存在'])],
    [bike('车',['链条']),part('链条','Chain',{component_ids:['车']})],
    [bike('车',[],{distance:-1})], [bike('车',['链条']),part('链条','Chain',{reminders:[reminder(-1)]})],
    [bike('车',[],{component:'false'})],
    [bike('车',['链条']),part('链条','Chain',{reminders:[reminder(0,{last_reset:'2026-02-30T00:00:00Z'})]})],
    [bike('车',['链条']),part('链条','Chain',{reminders:[reminder(0,{last_reset:'2026-10-15T12:00:00'})]})]]) {
    assert.throws(() => normalizeGear(records));
  }
  const data = snapshot(normalizeGear([bike('车',['链条']),part('链条','Chain',{reminders:[reminder()]})]));
  data.gearLibrary[0].components[0].replacement.date = '2026-02-30';
  assert.throws(() => validateData(data));
});

test('装备 API 失败时整次同步失败，CLI 保留已发布文件且不产生临时文件', async () => {
  const dataPath = new URL('../docs/activities.json',import.meta.url);
  const before = await readFile(dataPath,'utf8');
  const fetchMock = async url => url.endsWith('/gear') ? {ok:false,status:503}
    : {ok:true,json:async () => url.endsWith('/athlete/0') ? {id:'athlete-test'} : []};
  await assert.rejects(fetchYear({env:{INTERVALS_ICU_TOKEN:'test'},fetchImpl:fetchMock}),/HTTP 503/);
  const bootstrap = 'globalThis.fetch = ' + fetchMock.toString();
  const result = spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(bootstrap),new URL('./update-data.mjs',import.meta.url).pathname],{
    env:{...process.env,INTERVALS_ICU_TOKEN:'test',INTERVALS_ICU_API_KEY:''},encoding:'utf8',
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/HTTP 503/);
  assert.equal(await readFile(dataPath,'utf8'),before);
  await assert.rejects(access(new URL('../docs/activities.json.tmp',import.meta.url)),{code:'ENOENT'});
});
