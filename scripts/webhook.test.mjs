import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {SyncCoordinator} from '../workers/strava-webhook/index.mjs';

const minute = 60_000;
const commit = 'a'.repeat(40);
const event = {owner_id:1, subscription_id:2, object_id:901, object_type:'activity', aspect_type:'create', event_time:100};
function coordinator() {
  const values = new Map();
  let alarm;
  let current = Date.parse('2026-10-27T00:00:00Z');
  let lock = Promise.resolve();
  const ctx = {
    blockConcurrencyWhile:fn => { const result = lock.then(fn); lock = result.catch(() => {}); return result; },
    storage:{get:async key => structuredClone(values.get(key)), put:async (key, state) => { values.set(key, structuredClone(state)); }, setAlarm:async at => {alarm = at;}, deleteAlarm:async () => {alarm = null;}},
  };
  const env = {WEBHOOK_PATH_SECRET:'secret-path', STRAVA_VERIFY_TOKEN:'verify', SYNC_TOKEN:'internal', STRAVA_ATHLETE_ID:'1', STRAVA_SUBSCRIPTION_ID:'2', GITHUB_REPOSITORY:'owner/repo', GITHUB_DISPATCH_TOKEN:'dispatch'};
  const object = new SyncCoordinator(ctx, env);
  object.now = () => current;
  const calls = [];
  object.fetchImpl = async (...args) => { calls.push(args); return new Response(null, {status:204}); };
  const request = (path, body, authenticated = true) => object.fetch(new Request('https://worker.test' + path, {
    method:body === undefined ? 'GET' : 'POST',
    headers:{...(authenticated ? {Authorization:'Bearer internal'} : {}), 'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  }));
  const post = (body = event) => request('/webhook/secret-path', body, false);
  const start = (runId = '1:1', extra = {}) => request('/sync/start', {runId, mode:'sync', ...extra});
  const complete = (runId = '1:1', sha = commit) => request('/sync/complete', {runId, commit:sha, deployedAt:new Date(current).toISOString()});
  return {object, ctx, env, calls, request, post, start, complete, advance:ms => {current += ms;}, alarm:() => alarm, state:() => structuredClone(values.get('state'))};
}

test('subscription challenge checks mode/token and management endpoints require separate authentication', async () => {
  const c = coordinator();
  const response = await c.request('/webhook/secret-path?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=hello', undefined, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {'hub.challenge':'hello'});
  assert.equal((await c.request('/webhook/secret-path?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=hello', undefined, false)).status, 403);
  assert.equal((await c.request('/sync/status', undefined, false)).status, 401);
  assert.equal((await c.request('/webhook/wrong', event, false)).status, 401);
});

test('only matching activity create events are persisted; malformed events fail', async () => {
  const c = coordinator();
  for (const override of [{owner_id:3}, {subscription_id:3}, {aspect_type:'delete'}, {object_type:'athlete'}]) {
    assert.equal((await c.post({...event, ...override})).status, 200);
    assert.equal(c.state(), undefined);
  }
  assert.equal((await c.post({...event, object_id:'901'})).status, 400);
  assert.equal((await c.post({...event, object_id:Number.MAX_SAFE_INTEGER + 1})).status, 400);
  delete c.env.STRAVA_SUBSCRIPTION_ID;
  assert.equal((await c.post()).status, 503);
});

test('persisted events survive a fresh instance; duplicates and batching preserve the first alarm', async () => {
  const c = coordinator();
  await c.post();
  const firstAlarm = c.alarm();
  c.advance(minute);
  await c.post();
  await c.post({...event, object_id:902});
  assert.equal(c.state().pending.length, 2);
  assert.equal(c.alarm(), firstAlarm);
  const restarted = new SyncCoordinator(c.ctx, c.env);
  assert.equal((await (await restarted.fetch(new Request('https://worker.test/sync/status', {headers:{Authorization:'Bearer internal'}}))).json()).pending, 2);
  c.advance(minute);
  await c.object.alarm();
  assert.equal(c.calls.length, 1);
  assert.deepEqual(JSON.parse(c.calls[0][1].body), {event_type:'strava-activity-created'});
  assert.equal(c.state().pending.length, 2, 'dispatch is not event acknowledgment');
});

test('claim is idempotent and concurrent claims do not overwrite an active batch', async () => {
  const c = coordinator();
  await c.post();
  const responses = await Promise.all([c.start(), c.start('2:1')]);
  assert.deepEqual(responses.map(r => r.status), [200, 409]);
  const claim = await (await c.start()).json();
  c.advance(minute);
  assert.deepEqual(await (await c.start()).json(), claim);
});

test('cursor uses batch start; only claimed events are acknowledged after deployment', async () => {
  const c = coordinator();
  await c.post();
  const batch = await (await c.start()).json();
  c.advance(3 * minute);
  await c.post({...event, object_id:902});
  assert.equal(c.state().cursor, null);
  assert.equal((await c.complete()).status, 200);
  assert.equal(c.state().cursor, batch.startedAt);
  assert.equal(c.state().lastSuccessfulAt, '2026-10-27T00:03:00.000Z');
  assert.equal(c.state().publishedCommit, commit);
  assert.deepEqual(c.state().pending.map(e => e.activityId), ['902']);
  await c.post();
  assert.equal(c.state().pending.length, 1, 'a completed duplicate stays deduplicated');
  assert.equal((await c.complete()).status, 200, 'lost completion response can be retried');
  assert.equal((await c.complete('1:1', 'b'.repeat(40))).status, 409);
});

test('failure, stale receipts and invalid deployment receipts never advance state', async () => {
  const c = coordinator();
  await c.post();
  await c.start();
  assert.equal((await c.complete('2:1')).status, 409);
  assert.equal((await c.complete('1:1', 'bad')).status, 400);
  assert.equal((await c.request('/sync/complete', {runId:'1:1', commit, deployedAt:'2026-10-26T00:00:00Z'})).status, 400);
  await c.request('/sync/fail', {runId:'1:1'});
  assert.equal(c.state().cursor, null);
  assert.equal(c.state().lastSuccessfulAt, null);
  assert.equal(c.state().pending.length, 1);
  assert.equal((await c.complete()).status, 409);
});

test('workflow failures back off 5/15/60 minutes then retain events for manual recovery or new events', async () => {
  const c = coordinator();
  await c.post();
  for (const [index, delay] of [5, 15, 60, null].entries()) {
    await c.start(`${index + 1}:1`);
    await c.request('/sync/fail', {runId:`${index + 1}:1`});
    if (delay === null) assert.equal(c.alarm(), null);
    else {
      assert.equal(c.alarm() - Date.parse('2026-10-27T00:00:00Z'), delay * minute);
    }
  }
  assert.equal(c.state().pending.length, 1);
  await c.post();
  assert.equal(c.alarm(), null, 'duplicates must not reset exhausted retries');
  await c.post({...event, object_id:902});
  assert.ok(c.alarm());
  assert.equal(c.state().attempts, 0);
});

test('dispatch error, unclaimed dispatch and expired lease retain pending events', async () => {
  const c = coordinator();
  await c.post();
  c.object.fetchImpl = async () => new Response(null, {status:500});
  c.advance(2 * minute);
  await c.object.alarm();
  assert.equal(c.state().attempts, 1);
  assert.equal(c.state().pending.length, 1);
  c.object.fetchImpl = async () => new Response(null, {status:204});
  c.advance(5 * minute);
  await c.object.alarm();
  c.advance(10 * minute);
  await c.object.alarm();
  assert.equal(c.state().attempts, 2);
  await c.start();
  c.advance(30 * minute);
  await c.object.alarm();
  assert.equal(c.state().active, null);
  assert.equal(c.state().cursor, null);
  assert.equal(c.state().pending.length, 1);
});

test('code-only deployment does not advance the data baseline or acknowledge events', async () => {
  const c = coordinator();
  await c.post();
  await c.start();
  await c.complete();
  const before = c.state();
  c.advance(minute);
  await c.post({...event, object_id:902});
  await c.start('2:1', {mode:'publish'});
  await c.complete('2:1', 'b'.repeat(40));
  assert.equal(c.state().cursor, before.cursor);
  assert.equal(c.state().publishedCommit, before.publishedCommit);
  assert.equal(c.state().pending.length, 1);
});

test('manual sync can recover without pending events and redundant dispatch skips work', async () => {
  const c = coordinator();
  assert.deepEqual(await (await c.start()).json(), {skip:true});
  assert.equal((await c.start('2:1', {force:true})).status, 200);
  assert.equal((await c.complete('2:1')).status, 200);
});

test('lost completion write leaves old cursor and all events available for retry', async () => {
  const c = coordinator();
  await c.post();
  await c.start();
  const put = c.ctx.storage.put;
  c.ctx.storage.put = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(c.complete(), /storage unavailable/);
  assert.equal(c.state().cursor, null);
  assert.equal(c.state().pending.length, 1);
  c.ctx.storage.put = put;
  assert.equal((await c.complete()).status, 200);
});

test('storage failures return 503 without exposing the webhook path or secrets', async () => {
  const response = await worker.fetch(new Request('https://worker.test/webhook/private-path'), {SYNC:{idFromName:() => 'id', get:() => {throw new Error('private-path');}}});
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('private-path'), false);
});

test('the default dispatch transport keeps the global fetch receiver', async () => {
  // Regression: assigning the global fetch to this.fetchImpl made Workers
  // reject every dispatch with an illegal invocation error, and the stubbed
  // transport here hid it because production never replaced fetchImpl.
  const c = coordinator();
  c.object.fetchImpl = new SyncCoordinator(c.ctx, c.env).fetchImpl;
  let receivedThis;
  const original = globalThis.fetch;
  globalThis.fetch = function () { receivedThis = this; return Promise.resolve(new Response(null, {status:204})); };
  try {
    await c.post();
    c.advance(2 * minute);
    await c.object.alarm();
  } finally { globalThis.fetch = original; }
  assert.notEqual(receivedThis, c.object, 'the global fetch must not be called with the coordinator as this');
  assert.equal(c.state().dispatchUntil !== null, true);
});

test('dispatch uses only request options the Workers runtime implements', async () => {
  // Regression: redirect:'error' is not implemented at the edge and made every
  // dispatch throw, so the guards below pin the transport to supported values.
  const c = coordinator();
  await c.post();
  c.advance(2 * minute);
  await c.object.alarm();
  const [url, init] = c.calls.at(-1);
  assert.equal(url, 'https://api.github.com/repos/owner/repo/dispatches');
  assert.equal(init.method, 'POST');
  assert.ok(['follow', 'manual'].includes(init.redirect), 'redirect must be follow or manual');
  assert.equal(init.body, JSON.stringify({event_type:'strava-activity-created'}));
});

function stravaAuth(c) {
  const credentials={clientId:'123',clientSecret:'client-secret',refreshToken:'seed-refresh'};
  const request=c.request;
  c.request=(path,body,authenticated=true)=>request(path,path==='/sync/strava-token'?{...credentials,...body}:body,authenticated);
  const exchanges=[];
  c.object.fetchImpl=async (url,options)=>{
    if(url.endsWith('/oauth/token')) {
      exchanges.push(options.body.get('refresh_token'));
      return Response.json({access_token:'access-'+exchanges.length,refresh_token:'refresh-'+exchanges.length,
        expires_at:Math.floor(Date.parse('2026-10-27T00:00:00Z')/1000)+3600*exchanges.length,scope:'read,activity:read_all'});
    }
    return Response.json({id:1});
  };
  return exchanges;
}
test('Strava 令牌只对有效同步租约开放，检查私密权限和账号',async()=>{
  const c=coordinator();stravaAuth(c);
  assert.equal((await c.request('/sync/strava-token',{runId:'1:1'})).status,409);
  await c.start('1:1',{force:true,mode:'publish'});
  assert.equal((await c.request('/sync/strava-token',{runId:'1:1'})).status,409);
  await c.complete();await c.start('2:1',{force:true});
  assert.equal((await c.request('/sync/strava-token',{runId:'1:1'})).status,409);
  c.object.fetchImpl=async url=>url.endsWith('/oauth/token')?Response.json({access_token:'access',refresh_token:'refresh',
    expires_at:Date.parse('2026-10-27T01:00:00Z')/1000,scope:'activity:read'}):Response.json({id:999});
  assert.equal((await c.request('/sync/strava-token',{runId:'2:1'})).status,403);
  c.advance(31*minute);
  assert.equal((await c.request('/sync/strava-token',{runId:'2:1'})).status,409);
});
test('Strava 刷新令牌轮换在返回前持久化，重复调用和发布失败不回退',async()=>{
  const c=coordinator(),exchanges=stravaAuth(c);
  await c.start('1:1',{force:true});
  const token=await (await c.request('/sync/strava-token',{runId:'1:1'})).json();
  assert.deepEqual(Object.keys(token).sort(),['accessToken','expiresAt']);
  assert.equal(token.accessToken,'access-1');
  assert.equal((await c.ctx.storage.get('strava-token')).refreshToken,'refresh-1');
  await c.request('/sync/strava-token',{runId:'1:1'});assert.equal(exchanges.length,1);
  const status=JSON.stringify(await (await c.request('/sync/status')).json());
  assert.doesNotMatch(status,/access-1|refresh-1|client-secret/);
  await c.request('/sync/fail',{runId:'1:1'});c.advance(60*minute);
  await c.start('2:1',{force:true});
  await c.request('/sync/strava-token',{runId:'2:1'});
  assert.deepEqual(exchanges,['seed-refresh','refresh-1']);
  assert.equal(c.state().cursor,null);
});
test('Strava 刷新响应未提供 scope 时由活动接口验证读取权限',async()=>{
  const c=coordinator();stravaAuth(c);
  let athleteId=2;
  c.object.fetchImpl=async url=>url.endsWith('/oauth/token')?Response.json({access_token:'access',refresh_token:'refresh',
    expires_at:Date.parse('2026-10-27T01:00:00Z')/1000}):Response.json({id:athleteId});
  await c.start('1:1',{force:true});
  assert.equal((await c.request('/sync/strava-token',{runId:'1:1'})).status,403);
  athleteId=1;
  assert.equal((await c.request('/sync/strava-token',{runId:'1:1'})).status,200);
});
test('令牌持久化失败和 OAuth 失败不能返回令牌或推进同步状态',async()=>{
  const c=coordinator();stravaAuth(c);await c.start('1:1',{force:true});
  const put=c.ctx.storage.put;c.ctx.storage.put=async(key,value)=>{if(key==='strava-token')throw Error('storage failure');return put(key,value);};
  await assert.rejects(c.request('/sync/strava-token',{runId:'1:1'}),/storage failure/);
  assert.equal(c.state().cursor,null);
  c.object.fetchImpl=async()=>new Response('private OAuth response',{status:401});
  const response=await c.request('/sync/strava-token',{runId:'1:1'});
  assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/private OAuth/);
});
