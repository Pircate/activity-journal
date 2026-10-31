import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {workerRequest, updateSnapshot, commitSnapshot, publishedSnapshot} from './site-sync.mjs';
import {manageSubscription} from './strava-subscription.mjs';

const commit = 'a'.repeat(40);
const claim = {runId:'1:1', mode:'sync', startedAt:'2026-10-27T00:00:00Z', cursor:'2026-10-26T00:00:00Z', publishedCommit:commit, events:[{activityId:'901'}]};
const activities = JSON.stringify({period:{start:'2020-01-01',end:'2026-10-27'},syncedAt:'2026-10-27 12:00:00 +08:00',activities:[],unavailableActivities:[],gearLibrary:{active:[],retired:[]}});
const personalBests = JSON.stringify({source:'Intervals.icu',syncedAt:'2026-10-27T04:00:00.000Z',records:[],history:[]});
const profile = JSON.stringify({name:'成功版本姓名', location:'成功版本位置', stravaUrl:'https://www.strava.com/athletes/78720097'});
const env = {SYNC_WORKER_URL:'https://worker.test', SYNC_TOKEN:'test-token'};

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'site-sync-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  await mkdir(join(directory, 'docs'));
  return directory;
}

test('sync scripts use the published version, cursor and all claimed event IDs', async t => {
  const directory = await workspace(t);
  const calls = [];
  await updateSnapshot(claim, {directory, full:true, runImpl:(command, args) => {calls.push({command, args}); return args[1]?.endsWith('personal-bests.json') ? personalBests : activities;}});
  assert.deepEqual(calls[0].args, ['show', commit + ':docs/activities.json']);
  assert.equal(await readFile(join(directory, 'site-sync-baseline.json'), 'utf8'), activities);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'site-sync-events.json'), 'utf8')), ['901']);
  assert.deepEqual(calls[2].args, ['scripts/fetch-site-data.mjs', '--baseline', join(directory,'site-sync-baseline.json'), '--since', claim.cursor, '--events', join(directory,'site-sync-events.json'), '--report', join(directory,'history-correction.json'), '--full']);
  assert.deepEqual(calls.slice(3).map(call => call.args[0]), ['scripts/update-personal-bests.mjs', 'scripts/build.mjs']);
});

test('activities, personal bests and build failures stop before subsequent work', async t => {
  const directory = await workspace(t);
  for (const failAt of ['scripts/fetch-site-data.mjs', 'scripts/update-personal-bests.mjs', 'scripts/build.mjs']) {
    const calls = [];
    await assert.rejects(updateSnapshot(claim, {directory, runImpl:(command, args) => {
      calls.push(args[0]);
      if (args[0] === failAt) throw new Error('simulated failure');
      return args[1]?.endsWith('personal-bests.json') ? personalBests : activities;
    }}), /simulated failure/);
    assert.equal(calls.at(-1), failAt);
    assert.ok(!calls.includes('commit'));
  }
});

test('code-only publication restores the successful snapshot rather than a failed snapshot on main', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'data'));
  const original = process.cwd();
  process.chdir(directory);
  try {
    await writeFile('docs/activities.json', 'unpublished data');
    await writeFile('docs/personal-bests.json', 'unpublished PB');
    await writeFile('data/profile.json', 'unpublished profile');
    const calls = [];
    await updateSnapshot({...claim, mode:'publish'}, {directory, runImpl:(command, args) => {
      calls.push(args);
      return args[1]?.endsWith('personal-bests.json') ? personalBests : args[1]?.endsWith('profile.json') ? profile : activities;
    }});
    assert.equal(await readFile('docs/activities.json', 'utf8'), activities);
    assert.equal(await readFile('docs/personal-bests.json', 'utf8'), personalBests);
    assert.equal(await readFile('data/profile.json', 'utf8'), profile);
    assert.deepEqual(calls.map(args => args[0]), ['show', 'show', 'show', 'scripts/build.mjs']);
  } finally { process.chdir(original); }
});

test('云端提交包含个人资料快照，即使只有资料发生变化', () => {
  const calls=[];
  commitSnapshot(claim, (command, args) => {
    calls.push(args);
    return args[0] === 'status' ? ' M data/profile.json' : commit;
  });
  assert.ok(calls.find(args => args[0] === 'add').includes('data/profile.json'));
  assert.ok(calls.some(args => args[0] === 'push'));
});

test('a corrupt published version is rejected without executing git', async t => {
  const directory = await workspace(t);
  await assert.rejects(updateSnapshot({...claim, publishedCommit:'HEAD:other'}, {directory, runImpl:() => assert.fail('must not execute')}), /Invalid published commit/);
});

test('格式切换只采用成功来源和已审核目标均完全匹配的快照', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'data'));
  const original = process.cwd();
  process.chdir(directory);
  try {
    const source = {activities:'旧活动快照', personalBests:'旧成绩快照'};
    const target = {activities, personalBests};
    const hashes = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')]));
    await writeFile('data/snapshot-release.json', JSON.stringify({source:hashes(source), target:hashes(target)}));
    await writeFile('docs/activities.json', activities);
    await writeFile('docs/personal-bests.json', personalBests);
    assert.deepEqual(await publishedSnapshot(source.activities, source.personalBests), target);
    await assert.rejects(publishedSnapshot(source.activities + '变化', source.personalBests), /凭据不匹配/);
    await writeFile('docs/activities.json', activities + '\n');
    await assert.rejects(publishedSnapshot(source.activities, source.personalBests), /凭据不匹配/);
    assert.deepEqual(await publishedSnapshot(activities, personalBests), target, '新格式成功基线不依赖切换凭据');
  } finally { process.chdir(original); }
});

test('real git push conflicts are rejected without overwriting remote changes', async t => {
  const directory = await workspace(t);
  const origin = join(directory, 'origin.git');
  const local = join(directory, 'local');
  const other = join(directory, 'other');
  const git = (cwd, args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']});
  git(directory, ['init', '--bare', origin]);
  git(directory, ['init', '-b', 'main', local]);
  git(local, ['config','user.name','Test']);
  git(local, ['config','user.email','test@example.test']);
  await mkdir(join(local, 'docs'));
  await mkdir(join(local, 'data'));
  for (const name of ['activities.json','personal-bests.json','index.html']) await writeFile(join(local,'docs',name), 'published');
  await writeFile(join(local,'data/profile.json'), profile);
  git(local, ['add','.']);
  git(local, ['commit','-m','initial']);
  git(local, ['remote','add','origin',origin]);
  git(local, ['push','origin','main']);
  git(directory, ['clone','--branch','main',origin,other]);
  git(other, ['config','user.name','Other']);
  git(other, ['config','user.email','other@example.test']);
  await writeFile(join(other,'other.txt'),'concurrent work');
  git(other, ['add','.']);
  git(other, ['commit','-m','concurrent change']);
  git(other, ['push','origin','main']);
  const remoteBefore = git(directory, ['--git-dir',origin,'rev-parse','main']).trim();
  await writeFile(join(local,'docs/activities.json'), 'new snapshot');
  const calls = [];
  assert.throws(() => commitSnapshot(claim, (command,args) => {calls.push(args); return git(local,args);}));
  assert.equal(git(directory, ['--git-dir',origin,'rev-parse','main']).trim(), remoteBefore);
  assert.equal(git(directory, ['--git-dir',origin,'show','main:docs/activities.json']), 'published');
  assert.ok(calls.some(args => args[0] === 'push'));
  assert.ok(calls.every(args => !args.includes('--force') && !args.includes('rebase')));
});

test('worker requests retry lost receipts using the same body and fail closed on authentication', async () => {
  const bodies = [];
  const body = {runId:'1:1', commit};
  const result = await workerRequest('/sync/complete', body, {env, fetchImpl:async (url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) throw new Error('connection lost');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return Response.json({ok:true});
  }});
  assert.deepEqual(result, {ok:true});
  assert.deepEqual(bodies, [JSON.stringify(body), JSON.stringify(body)]);
  let calls = 0;
  await assert.rejects(workerRequest('/sync/status', undefined, {env, fetchImpl:async () => {calls++; return new Response(null,{status:401});}}), /HTTP 401/);
  assert.equal(calls, 1);
  await assert.rejects(workerRequest('/sync/status', undefined, {env:{...env,SYNC_WORKER_URL:'http://worker.test'}}), /HTTPS/);
});

const subscriptionEnv = {STRAVA_CLIENT_ID:'123', STRAVA_CLIENT_SECRET:'private-client-secret', SYNC_WORKER_URL:'https://worker.test', WEBHOOK_PATH_SECRET:'private-path', STRAVA_VERIFY_TOKEN:'verify'};
test('subscription listing does not expose the callback path or credentials and never deletes an existing subscription', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {requests.push(options); return Response.json([{id:2, callback_url:'https://other.test/existing'}]);};
  assert.deepEqual(await manageSubscription({env:subscriptionEnv, fetchImpl}), [{id:2,callbackMatches:false}]);
  await assert.rejects(manageSubscription({create:true, env:subscriptionEnv, fetchImpl}), /already exists/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(options => !options.method));
});

test('subscription creation is form-encoded, idempotent for the same callback, and validates the returned ID', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    if (calls === 1) return Response.json([]);
    assert.equal(options.method, 'POST');
    assert.ok(options.body instanceof URLSearchParams);
    assert.equal(options.body.get('callback_url'), 'https://worker.test/webhook/private-path');
    assert.equal(options.body.get('verify_token'), 'verify');
    return Response.json({id:2});
  };
  assert.deepEqual(await manageSubscription({create:true, env:subscriptionEnv, fetchImpl}), [{id:2,callbackMatches:true}]);
  assert.deepEqual(await manageSubscription({create:true, env:subscriptionEnv, fetchImpl:async () => Response.json([{id:2,callback_url:'https://worker.test/webhook/private-path'}])}), [{id:2,callbackMatches:true}]);
  let invalidCalls = 0;
  await assert.rejects(manageSubscription({create:true, env:subscriptionEnv, fetchImpl:async () => Response.json(++invalidCalls === 1 ? [] : {id:'invalid'})}), /Invalid subscription ID/);
});
