import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateData} from '../docs/journal.mjs';
import {validatePersonalBests} from '../docs/personal-bests.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');

// 格式切换只接受已审核文件的精确摘要，不解析旧字段或使用任意 main 快照。
export async function publishedSnapshot(activities, personalBests) {
  try {
    validateData(JSON.parse(activities));
    validatePersonalBests(JSON.parse(personalBests));
    return {activities, personalBests};
  } catch {
    const release = JSON.parse(await readFile('data/snapshot-release.json', 'utf8'));
    const current = {
      activities:await readFile('docs/activities.json', 'utf8'),
      personalBests:await readFile('docs/personal-bests.json', 'utf8'),
    };
    if (release.source.activities !== digest(activities) || release.source.personalBests !== digest(personalBests) ||
        release.target.activities !== digest(current.activities) || release.target.personalBests !== digest(current.personalBests)) {
      throw new Error('快照格式切换凭据不匹配，保留已发布数据，请重新核对成功基线与目标快照');
    }
    validateData(JSON.parse(current.activities));
    validatePersonalBests(JSON.parse(current.personalBests));
    return current;
  }
}

export function run(command, args) {
  try {
    return execFileSync(command, args, {encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']});
  } catch (error) {
    error.syncStep = args[0];
    throw error;
  }
}

export async function workerRequest(path, body, {fetchImpl = fetch, env = process.env} = {}) {
  const url = new URL(env.SYNC_WORKER_URL);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.username || url.password || !env.SYNC_TOKEN) throw new Error('Configure SYNC_WORKER_URL (HTTPS origin) and SYNC_TOKEN');
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetchImpl(new URL(path, url), {
        method:body === undefined ? 'GET' : 'POST', redirect:'error', signal:AbortSignal.timeout(15_000),
        headers:{Authorization:'Bearer ' + env.SYNC_TOKEN, 'Content-Type':'application/json'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}),
      });
      if (response.ok) return response.json();
      if (response.status < 500) break;
    } catch { /* Retry a lost receipt using the same run ID. */ }
  }
  throw new Error('Sync coordinator request failed' + (response ? ' (HTTP ' + response.status + ')' : ''));
}

export async function updateSnapshot(claim, {runImpl = run, directory = process.env.RUNNER_TEMP, full = false} = {}) {
  const args = ['scripts/fetch-site-data.mjs'];
  if (claim.publishedCommit) {
    if (!/^[a-f0-9]{40}$/.test(claim.publishedCommit)) throw new Error('Invalid published commit');
    const snapshot = await publishedSnapshot(
      runImpl('git', ['show', claim.publishedCommit + ':docs/activities.json']),
      runImpl('git', ['show', claim.publishedCommit + ':docs/personal-bests.json']),
    );
    const baseline = snapshot.activities;
    if (claim.mode === 'publish') {
      const profile = runImpl('git', ['show', claim.publishedCommit + ':data/profile.json']);
      await writeFile('docs/activities.json', baseline);
      await writeFile('docs/personal-bests.json', snapshot.personalBests);
      await writeFile('data/profile.json', profile);
    } else {
      const baselinePath = join(directory, 'site-sync-baseline.json');
      await writeFile(baselinePath, baseline);
      args.push('--baseline', baselinePath);
      if (claim.cursor) args.push('--since', claim.cursor);
    }
  }
  if (claim.mode === 'sync') {
    const eventsPath = join(directory, 'site-sync-events.json');
    await writeFile(eventsPath, JSON.stringify(claim.events.map(event => event.activityId)));
    args.push('--events', eventsPath);
    args.push('--report', join(directory, 'history-correction.json'));
    if (full) args.push('--full');
    runImpl(process.execPath, args);
    runImpl(process.execPath, ['scripts/update-personal-bests.mjs']);
  }
  runImpl(process.execPath, ['scripts/build.mjs']);
}

export function commitSnapshot(claim, runImpl = run) {
  if (claim.mode === 'sync') {
    const files = ['docs/activities.json', 'docs/personal-bests.json', 'data/profile.json', 'docs/index.html'];
    if (runImpl('git', ['status', '--porcelain', '--', ...files]).trim()) {
      runImpl('git', ['config', 'user.name', 'github-actions[bot]']);
      runImpl('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
      runImpl('git', ['add', '--', ...files]);
      runImpl('git', ['commit', '-m', 'chore: update activity journal']);
      // Ordinary push rejects concurrent edits; never rebase generated data.
      runImpl('git', ['push', 'origin', 'HEAD:main']);
    }
  }
  return runImpl('git', ['rev-parse', 'HEAD']).trim();
}

export async function main(command, env = process.env) {
  const runId = env.GITHUB_RUN_ID + ':' + env.GITHUB_RUN_ATTEMPT;
  const claimPath = join(env.RUNNER_TEMP, 'site-sync-claim.json');
  if (command === 'start') {
    const mode = env.GITHUB_EVENT_NAME === 'push' ? 'publish' : 'sync';
    const claim = await workerRequest('/sync/start', {runId, mode, force:env.GITHUB_EVENT_NAME === 'workflow_dispatch'}, {env});
    await writeFile(claimPath, JSON.stringify(claim));
    await writeFile(env.GITHUB_OUTPUT, 'skip=' + Boolean(claim.skip) + '\n', {flag:'a'});
    return;
  }
  const claim = JSON.parse(await readFile(claimPath, 'utf8'));
  if (claim.skip) return;
  if (command === 'update') return updateSnapshot(claim, {directory:env.RUNNER_TEMP, full:env.SYNC_FULL === 'true'});
  if (command === 'commit') {
    const commit = commitSnapshot(claim);
    await writeFile(claimPath, JSON.stringify({...claim, commit}));
    await writeFile(env.GITHUB_OUTPUT, 'commit=' + commit + '\n', {flag:'a'});
    return;
  }
  if (command === 'complete') {
    const deployedAt = new Date().toISOString();
    await workerRequest('/sync/complete', {runId, commit:claim.commit, deployedAt}, {env});
    await writeFile(env.GITHUB_STEP_SUMMARY, `网站发布成功：${deployedAt}\n\n数据同步起点：${claim.mode === 'sync' ? claim.startedAt : claim.cursor ?? '尚未同步'}\n\n版本：${claim.commit}\n`, {flag:'a'});
    return;
  }
  if (command === 'fail') {
    await workerRequest('/sync/fail', {runId}, {env});
    await writeFile(env.GITHUB_STEP_SUMMARY, '网站更新失败；保留原数据游标和待处理事件，请查看失败步骤。\n', {flag:'a'});
    return;
  }
  throw new Error('Unknown site-sync command');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv[2]); }
  catch (error) {
    // Report controlled sync errors and Git failures, redacting all server
    // credentials before emitting child process output.
    let message = error.status ? `Site sync step ${error.syncStep} failed (${error.status}).\n${error.stderr ?? ''}` : error.message;
    for (const key of ['SYNC_TOKEN', 'INTERVALS_ICU_API_KEY', 'GITHUB_TOKEN', 'STRAVA_ACCESS_TOKEN', 'STRAVA_CLIENT_SECRET', 'STRAVA_REFRESH_TOKEN']) {
      const secret = process.env[key];
      if (secret) {
        message = message.replaceAll(secret, '[redacted]');
        message = message.replaceAll(Buffer.from('API_KEY:' + secret).toString('base64'), '[redacted]');
      }
    }
    console.error(message);
    process.exitCode = 1;
  }
}
