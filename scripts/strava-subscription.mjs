import {pathToFileURL} from 'node:url';

export async function manageSubscription({create = false, env = process.env, fetchImpl = fetch} = {}) {
  const {STRAVA_CLIENT_ID:clientId, STRAVA_CLIENT_SECRET:clientSecret} = env;
  if (!/^\d+$/.test(clientId ?? '') || !clientSecret) throw new Error('Configure STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET');
  const endpoint = 'https://www.strava.com/api/v3/push_subscriptions';
  const response = await fetchImpl(endpoint + '?' + new URLSearchParams({client_id:clientId, client_secret:clientSecret}), {redirect:'error', signal:AbortSignal.timeout(15_000)});
  if (!response.ok) throw new Error('Subscription lookup failed (HTTP ' + response.status + ')');
  const existing = await response.json();
  if (!Array.isArray(existing)) throw new Error('Invalid subscription response');
  const callback = env.SYNC_WORKER_URL && env.WEBHOOK_PATH_SECRET ? new URL('/webhook/' + env.WEBHOOK_PATH_SECRET, env.SYNC_WORKER_URL).href : null;
  if (existing.length) {
    if (create && existing.some(subscription => subscription.callback_url !== callback)) throw new Error('A different subscription already exists; it was not changed');
    return existing.map(subscription => ({id:subscription.id, callbackMatches:callback ? subscription.callback_url === callback : null}));
  }
  if (!create) return [];
  if (!callback || !callback.startsWith('https://') || !env.STRAVA_VERIFY_TOKEN) throw new Error('Configure HTTPS SYNC_WORKER_URL, WEBHOOK_PATH_SECRET and STRAVA_VERIFY_TOKEN');
  const result = await fetchImpl(endpoint, {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(15_000),
    body:new URLSearchParams({client_id:clientId, client_secret:clientSecret, callback_url:callback, verify_token:env.STRAVA_VERIFY_TOKEN}),
  });
  if (!result.ok) throw new Error('Subscription creation failed (HTTP ' + result.status + ')');
  const subscription = await result.json();
  if (!Number.isSafeInteger(subscription.id) || subscription.id <= 0) throw new Error('Invalid subscription ID');
  return [{id:subscription.id, callbackMatches:true}];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--create')) throw new Error('Usage: node scripts/strava-subscription.mjs [--create]');
    console.log(JSON.stringify(await manageSubscription({create:process.argv.includes('--create')})));
  } catch (error) {
    console.error(error instanceof TypeError ? 'Subscription network/configuration error' : error.message);
    process.exitCode = 1;
  }
}
