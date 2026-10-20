import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access, mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {normalizeGear, fetchAllActivities} from './update-data.mjs';
import {renderGearLibrary, summarizeGear, validateData, createJournal} from '../docs/journal.mjs';

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
  assert.deepEqual(library[0].components[0].sharedBy, ['公路车','通勤车']);
  assert.equal(library[0].components[1].sharedBy, undefined);
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

test('进度准确区分 80%、达到和超过建议里程，超出时填充及可访问数值不溢出', () => {
  for (const [type,target] of [['Chain',5000],['Tyre',5000],['Cassette',10000],['Chainrings',30000]]) {
    for (const [ratio,state] of [[0,'normal'],[.79999,'normal'],[.8,'soon'],[.99999,'soon'],[1,'due'],[1.2,'due']]) {
      const html = renderGearLibrary(normalizeGear([bike('车',['配件']),part('配件',type,{reminders:[reminder(target * ratio * 1000)]})]));
      assert.match(html,new RegExp('data-state="'+state+'"'));
      assert.match(html,new RegExp('aria-valuemax="'+target+'"'));
      assert.match(html,new RegExp('aria-valuenow="'+Math.min(target*ratio,target)+'"'));
      const heading = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)[1];
      if (state === 'normal') assert.doesNotMatch(heading, /class="gear-alert"/);
      else assert.match(heading, new RegExp('1 项' + (state === 'due' ? '已达建议更换里程' : '接近建议更换里程')));
      if (ratio > 1) {
        assert.match(html,/width:100%/);
        assert.match(html,/已超出/);
        assert.match(html,/120%/);
      }
    }
  }
});

test('折叠提醒区分未知和已达建议里程，展开优先显示需更换配件；同名配件不推断共享', () => {
  const library = normalizeGear([bike('甲',['轮组','链条','飞轮','外胎']), bike('乙',['另一链条']),
    part('轮组','Wheelset'), part('链条','Chain',{name:'同名链条',reminders:[reminder(4000000)]}),
    part('飞轮','Cassette',{reminders:[reminder(10000000)]}), part('外胎','Tyre'),
    part('另一链条','Chain',{name:'同名链条',reminders:[reminder(4000000)]})]);
  assert.equal(library[0].components[1].sharedBy, undefined);
  assert.equal(library[1].components[0].sharedBy, undefined);
  const html = renderGearLibrary(library);
  const heading = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)[1];
  for (const label of ['1 项已达建议更换里程','1 项接近建议更换里程','1 项信息待完善']) assert.ok(heading.includes(label));
  assert.ok(html.indexOf('<h4>飞轮</h4>') < html.indexOf('<h4>同名链条</h4>'));
  assert.ok(html.indexOf('<h4>外胎</h4>') < html.indexOf('<h4>轮组</h4>'));
  const shared = normalizeGear([bike('<甲>',['共享']),bike('乙',['共享']),part('共享','Chain',{reminders:[reminder()]})]);
  assert.match(renderGearLibrary(shared), /共享配件 · &lt;甲&gt; \/ 乙/);
  assert.doesNotMatch(renderGearLibrary(library), /共享配件/);
  for (const sharedBy of [[], ['甲'], ['甲','不存在'], '甲']) {
    const invalid = structuredClone(library);
    invalid[0].components[0].sharedBy = sharedBy;
    assert.throws(() => validateData(snapshot(invalid)), /共享关系无效/);
  }
});

test('普通配件显示总里程；页面转义装备名称，且公开数据只含许可字段', () => {
  const library = normalizeGear([bike('<script>车</script>',['internal-part'],{athlete_id:'secret-athlete',notes:'私密备注'}),
    part('internal-part','Wheelset',{name:'<img src=x onerror=alert(1)>',reminders:[reminder()]})]);
  const html = renderGearLibrary(library);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img/);
  assert.match(html,/累计里程 12,000\.00 km/);
  assert.doesNotMatch(html,/<script>|<img|role="progressbar"/);
  assert.doesNotMatch(JSON.stringify(library),/internal-part|secret-athlete|私密备注|athlete_id|component_ids/);
  validateData(snapshot(library));
  assert.throws(() => validateData(snapshot([{...library[0],id:'leak'}])));
  assert.throws(() => validateData(snapshot([{...library[0],components:[{...library[0].components[0],notes:'leak'}]}])));
});

test('装备使用总里程与年度范围无关，首次未同步与真实空列表明确区分', () => {
  const data = snapshot(normalizeGear([bike('车',['链条']),part('链条','Chain',{reminders:[reminder(6500000)]})]));
  assert.notEqual(createJournal(data).period.end,createJournal(data,'2027-10-15').period.end);
  assert.match(renderGearLibrary(data.gearLibrary),/24,000\.00 km/);
  assert.match(renderGearLibrary(data.gearLibrary),/6,500\.00 km/);
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

test('装备 API 失败时整次同步失败，CLI 从本地配置取密钥并保留已发布文件', async t => {
  const dataPath = new URL('../docs/activities.json',import.meta.url);
  const before = await readFile(dataPath,'utf8');
  const fetchMock = async url => url.endsWith('/gear') ? {ok:false,status:503}
    : {ok:true,json:async () => url.endsWith('/athlete/0') ? {id:'athlete-test'} : []};
  await assert.rejects(fetchAllActivities({config:{INTERVALS_ICU_API_KEY:'test'},fetchImpl:fetchMock}),/HTTP 503/);
  const directory = await mkdtemp(join(tmpdir(),'interval-icu-cli-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'.config/interval-icu'),{recursive:true});
  await writeFile(join(directory,'.config/interval-icu/config.json'),JSON.stringify({INTERVALS_ICU_API_KEY:'test'}));
  const bootstrap = `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
    os.homedir = () => ${JSON.stringify(directory)}; syncBuiltinESMExports();
    globalThis.fetch = ${fetchMock.toString()};`;
  const result = spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(bootstrap),fileURLToPath(new URL('./update-data.mjs',import.meta.url))],{
    encoding:'utf8',
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/HTTP 503/);
  assert.equal(await readFile(dataPath,'utf8'),before);
  await assert.rejects(access(new URL('../docs/activities.json.tmp',import.meta.url)),{code:'ENOENT'});
});

test('维护摘要合并真实共享实例，同名同里程的不同共享配件仍分别计数', () => {
  const library = normalizeGear([bike('甲',['共享一','共享二','独立一']),bike('乙',['共享一','共享二','独立二']),
    ...['共享一','共享二','独立一','独立二'].map(id => part(id,'Chain',{name:'同名链条',reminders:[reminder(4900000)]}))]);
  assert.equal(library[0].components[0].sharedGroup, library[1].components[0].sharedGroup);
  assert.notEqual(library[0].components[0].sharedGroup, library[0].components[1].sharedGroup);
  assert.equal(library[0].components[2].sharedGroup, undefined);
  const summary = summarizeGear(library);
  assert.equal(summary.parts.length, 4);
  assert.equal(summary.shared, 2);
  assert.deepEqual(summary.counts, {due:0, soon:4, unknown:0, normal:0});
  assert.deepEqual(summary.parts.map(entry => entry.owners.length), [2,2,1,1]);
  const html = renderGearLibrary(library);
  const maintenance = html.slice(0, html.indexOf('<details'));
  assert.equal((maintenance.match(/<li data-state="soon"/g) ?? []).length, 4);
  assert.equal((maintenance.match(/data-gear-target=/g) ?? []).length, 6);
  assert.match(maintenance, /4 件重点配件 · 2 件共享配件各计一次/);
});

test('维护摘要优先已达、接近、信息缺失；未知日期和零里程准确区分', () => {
  const library = normalizeGear([bike('车',['正常','未知日期','接近','已达','无提醒','普通配件']),
    part('正常','Chain',{reminders:[reminder(0)]}),
    part('未知日期','Chain',{reminders:[{name:'更换',distance_used:100000}]}),
    part('接近','Chain',{reminders:[reminder(4000000)]}),
    part('已达','Chain',{reminders:[reminder(6000000)]}),
    part('无提醒','Cassette'),part('普通配件','Wheelset')]);
  const summary = summarizeGear(library);
  assert.equal(summary.parts.length, 5);
  assert.deepEqual(summary.counts, {due:1, soon:1, unknown:2, normal:1});
  assert.deepEqual(summary.parts.map(entry => entry.state), ['due','soon','unknown','unknown','normal']);
  const html = renderGearLibrary(library);
  const maintenance = html.slice(0, html.indexOf('<details'));
  assert.match(maintenance, /已超出 1,000\.00 km/);
  assert.match(maintenance, /距建议里程 1,000\.00 km/);
  assert.match(maintenance, /最近更换日期未记录/);
  assert.doesNotMatch(maintenance, /NaN|Infinity/);
  assert.doesNotMatch(maintenance, /<h4>正常<\/h4>|<h4>普通配件<\/h4>/);
});

test('维护定位链接使用排序前索引，精确指向共享配件的每个车辆条目', () => {
  const library = normalizeGear([bike('甲',['正常','共享']),bike('乙',['共享']),
    part('正常','Chain',{reminders:[reminder()]}),part('共享','Chain',{reminders:[reminder(4900000)]})]);
  const html = renderGearLibrary(library);
  assert.match(html, /href="#gear-part-0-1" data-gear-target="gear-part-0-1"/);
  assert.match(html, /href="#gear-part-1-0" data-gear-target="gear-part-1-0"/);
  assert.match(html, /id="gear-part-0-1" tabindex="-1" data-state="soon"/);
  assert.match(html, /id="gear-part-1-0" tabindex="-1" data-state="soon"/);
  const targets = [...html.matchAll(/data-gear-target="([^"]+)"/g)].map(match => match[1]);
  for (const target of targets) assert.equal((html.match(new RegExp('id="' + target + '"', 'g')) ?? []).length, 1);
  assert.ok(html.indexOf('id="gear-part-0-1"') < html.indexOf('id="gear-part-0-0"'), '优先展示需关注配件，仍保持链接对应原配件');
});

test('共享分组缺失、复用或归属及数值不一致时拒绝整个快照', () => {
  const library = normalizeGear([bike('甲',['共享','共享二']),bike('乙',['共享','共享二']),
    part('共享','Chain',{reminders:[reminder(4900000)]}),part('共享二','Chain',{reminders:[reminder()]})]);
  const changes = [
    value => delete value[0].components[0].sharedGroup,
    value => delete value[0].components[0].sharedBy,
    value => value[0].components[0].sharedGroup = 0,
    value => value[0].components[0].sharedGroup = 1.5,
    value => value[0].components[0].sharedGroup = 99,
    value => value[1].components[0].replacement.distanceKm = 1,
    value => value[0].components[0].sharedBy.push('甲'),
    value => value[0].components[1].sharedGroup = value[0].components[0].sharedGroup,
  ];
  for (const mutate of changes) {
    const invalid = structuredClone(library);
    mutate(invalid);
    assert.throws(() => validateData(snapshot(invalid)), /共享/);
  }
});

test('维护摘要区分首次未同步、没有车辆、没有重点配件及全部正常', () => {
  assert.equal(summarizeGear(null), null);
  assert.doesNotMatch(renderGearLibrary(null), /maintenance-counts/);
  assert.doesNotMatch(renderGearLibrary([]), /maintenance-counts/);
  const noTracked = normalizeGear([bike('车',['轮组']),part('轮组','Wheelset')]);
  assert.equal(summarizeGear(noTracked).parts.length, 0);
  assert.match(renderGearLibrary(noTracked), /尚未关联链条、飞轮、外胎或牙盘/);
  const normal = normalizeGear([bike('车',['链条']),part('链条','Chain',{reminders:[reminder(0)]})]);
  assert.match(renderGearLibrary(normal), /更换信息完整，暂无接近或已达建议里程的配件/);
  assert.doesNotMatch(renderGearLibrary(normal), /class="maintenance-list"/);
});
