import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHtml} from './build.mjs';
import {normalizeStravaProfile} from './strava-data.mjs';

const data = {period:{start:'2026-01-01',end:'2026-10-29'}, syncedAt:'2026-10-29 12:00:00 +08:00',
  activities:[], unavailableActivities:[], gearLibrary:{active:[],retired:[]}};
const personalBests = {source:'Intervals.icu', syncedAt:'2026-10-29T04:00:00.000Z', records:[], history:[]};
const brand = {name:'Pogacha', nameZh:'波咖茶'};

test('接口资料用于姓名、位置和个人主页，品牌配置用于页头与标题，文本安全转义', async () => {
  const profile = normalizeStravaProfile({id:42, firstname:'新姓名<script>', state:'新省', city:'新城市&'});
  const html = await buildHtml({data, personalBests, profile, brand});
  assert.match(html, /<h1 id="title">新姓名&lt;script&gt;<\/h1>/);
  assert.match(html, /<title>波咖茶的运动日志 · Pogacha · 最近一年<\/title>/);
  assert.match(html, /<meta property="og:title" content="波咖茶的运动日志 · Pogacha">/);
  assert.match(html, /<meta property="og:site_name" content="Pogacha">/);
  assert.match(html, /<html lang="zh-CN" data-brand="Pogacha" data-brand-zh="波咖茶">/);
  assert.match(html, /<span class="brand-en">POGACHA<\/span><span class="brand-zh">波咖茶的运动日志<\/span>/);
  assert.match(html, /<p class="profile-location">新省，新城市&amp;<\/p>/);
  assert.match(html, /href="https:\/\/www.strava.com\/athletes\/42"/);
  assert.doesNotMatch(html, /安徽|合肥|@HRC|新姓名<script>/);
});

test('位置缺失时隐藏位置并保持标题描述完整', async () => {
  const profile = normalizeStravaProfile({id:42, firstname:'单名'});
  const html = await buildHtml({data, personalBests, profile, brand});
  assert.doesNotMatch(html, /class="profile-location"/);
  assert.match(html, /content="波咖茶的运动日志。查看近期运动与全年活动。"/);
  assert.match(html, /property="og:description" content="日常运动记录。"/);
  await assert.rejects(buildHtml({data, personalBests, profile:{...profile, stravaUrl:'javascript:alert(1)'}, brand}), /个人资料格式无效/);
});

test('品牌配置校验字段完整且拒绝换行', async () => {
  const profile = normalizeStravaProfile({id:42, firstname:'单名'});
  await assert.rejects(buildHtml({data, personalBests, profile, brand:{name:'Pogacha', nameZh:'波咖茶', extra:'x'}}), /站点品牌格式无效/);
  await assert.rejects(buildHtml({data, personalBests, profile, brand:{name:'Pogacha', nameZh:'  '}}), /站点品牌格式无效/);
  await assert.rejects(buildHtml({data, personalBests, profile, brand:{name:'Pogacha\r\nBcc: x', nameZh:'波咖茶'}}), /站点品牌格式无效/);
});
