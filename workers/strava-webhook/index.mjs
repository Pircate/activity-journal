const minute = 60_000;
const retryDelays = [5 * minute, 15 * minute, 60 * minute];
const leaseDuration = 30 * minute;
const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const commitId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const eventKey = event => [event.owner_id, event.object_type, event.object_id, event.aspect_type, event.event_time].join(':');

// This is a single account coordinator. All requests and alarms pass through
// blockConcurrencyWhile, including storage and outbound dispatch awaits.
export class SyncCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.now = () => Date.now();
    this.fetchImpl = fetch;
  }

  async load() {
    return await this.ctx.storage.get('state') ?? {
      pending:[], seen:{}, active:null, dispatchUntil:null, nextAt:null,
      attempts:0, lastError:null, lastCompleted:null,
      lastSuccessfulAt:null, cursor:null, publishedCommit:null,
    };
  }

  async save(state) {
    // Arm before persisting: a failed write never returns a successful receipt.
    if (state.nextAt) await this.ctx.storage.setAlarm(state.nextAt);
    else await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.put('state', state);
  }

  retry(state, reason) {
    state.active = null;
    state.dispatchUntil = null;
    state.lastError = reason;
    state.nextAt = state.attempts < retryDelays.length ? this.now() + retryDelays[state.attempts++] : null;
  }

  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const webhook = this.env.WEBHOOK_PATH_SECRET && url.pathname === '/webhook/' + this.env.WEBHOOK_PATH_SECRET;
      if (webhook && request.method === 'GET') {
        if (!this.env.STRAVA_VERIFY_TOKEN || url.searchParams.get('hub.mode') !== 'subscribe' ||
            url.searchParams.get('hub.verify_token') !== this.env.STRAVA_VERIFY_TOKEN || !url.searchParams.get('hub.challenge')) return json({error:'Invalid verification'}, 403);
        return json({'hub.challenge':url.searchParams.get('hub.challenge')});
      }
      if (!webhook && (!this.env.SYNC_TOKEN || request.headers.get('Authorization') !== 'Bearer ' + this.env.SYNC_TOKEN)) return json({error:'Unauthorized'}, 401);
      const state = await this.load();
      if (webhook && request.method === 'POST') {
        if (!this.env.STRAVA_SUBSCRIPTION_ID) return json({error:'Subscription not configured'}, 503);
        if (Number(request.headers.get('Content-Length') ?? 0) > 8192) return json({error:'Payload too large'}, 413);
        const raw = await request.text();
        if (raw.length > 8192) return json({error:'Payload too large'}, 413);
        let event;
        try { event = JSON.parse(raw); } catch { return json({error:'Invalid JSON'}, 400); }
        if (!event || !Number.isSafeInteger(event.object_id) || event.object_id <= 0 || !Number.isSafeInteger(event.event_time) || event.event_time <= 0 ||
            !Number.isSafeInteger(event.owner_id) || !Number.isSafeInteger(event.subscription_id)) return json({error:'Invalid event'}, 400);
        if (String(event.owner_id) !== this.env.STRAVA_ATHLETE_ID || String(event.subscription_id) !== this.env.STRAVA_SUBSCRIPTION_ID ||
            event.object_type !== 'activity' || event.aspect_type !== 'create') return json({ignored:true});
        const key = eventKey(event);
        if (!Object.hasOwn(state.seen, key)) {
          state.pending.push({key, activityId:String(event.object_id)});
          state.seen[key] = this.now();
          // A genuinely new event reactivates exhausted retries.
          if (!state.active && !state.dispatchUntil && !state.nextAt) {
            state.attempts = 0;
            state.nextAt = this.now() + 2 * minute;
          }
        }
        await this.save(state);
        return json({accepted:true});
      }
      if (url.pathname === '/sync/status' && request.method === 'GET') {
        return json({lastSuccessfulAt:state.lastSuccessfulAt, cursor:state.cursor, publishedCommit:state.publishedCommit,
          pending:state.pending.length, active:state.active?.runId ?? null, attempts:state.attempts, nextAt:state.nextAt, lastError:state.lastError});
      }
      if (request.method !== 'POST') return json({error:'Not found'}, 404);
      let body;
      try { body = await request.json(); } catch { return json({error:'Invalid JSON'}, 400); }
      if (!body || typeof body.runId !== 'string' || !/^\d+:\d+$/.test(body.runId)) return json({error:'Invalid run ID'}, 400);
      if (url.pathname === '/sync/start') {
        if (state.active) return state.active.runId === body.runId ? json(state.active) : json({error:'Run already active'}, 409);
        if (!['sync', 'publish'].includes(body.mode)) return json({error:'Invalid mode'}, 400);
        if (body.mode === 'sync' && !body.force && !state.pending.length) return json({skip:true});
        if (body.force) state.attempts = 0;
        const startedAt = new Date(this.now()).toISOString();
        state.active = {runId:body.runId, mode:body.mode, startedAt, cursor:state.cursor,
          publishedCommit:state.publishedCommit, events:body.mode === 'sync' ? [...state.pending] : []};
        state.dispatchUntil = null;
        state.nextAt = this.now() + leaseDuration;
        await this.save(state);
        return json(state.active);
      }
      // A complete response may be lost after the transaction committed.
      if (url.pathname === '/sync/complete' && state.lastCompleted?.runId === body.runId) {
        return state.lastCompleted.commit === body.commit ? json({ok:true}) : json({error:'Commit mismatch'}, 409);
      }
      if (!state.active || state.active.runId !== body.runId) return json({error:'Stale run'}, 409);
      if (url.pathname === '/sync/complete') {
        if (!commitId(body.commit) || !instant(body.deployedAt) || Date.parse(body.deployedAt) < Date.parse(state.active.startedAt) || Date.parse(body.deployedAt) > this.now() + minute) return json({error:'Invalid deployment receipt'}, 400);
        if (state.active.mode === 'sync') {
          const completed = new Set(state.active.events.map(event => event.key));
          state.pending = state.pending.filter(event => !completed.has(event.key));
          state.cursor = state.active.startedAt;
          state.publishedCommit = body.commit;
        }
        // Code-only publication must not bless a failed sync's snapshot on main.
        state.lastSuccessfulAt = body.deployedAt;
        state.lastCompleted = {runId:body.runId, commit:body.commit};
        state.active = null;
        state.attempts = 0;
        state.lastError = null;
        state.nextAt = state.pending.length ? this.now() + 2 * minute : null;
        for (const [key, at] of Object.entries(state.seen)) {
          if (at < this.now() - 90 * 86400_000 && !state.pending.some(event => event.key === key)) delete state.seen[key];
        }
      } else if (url.pathname === '/sync/fail') {
        this.retry(state, 'Workflow failed; inspect GitHub Actions run ' + body.runId);
      } else return json({error:'Not found'}, 404);
      await this.save(state);
      return json({ok:true});
    });
  }

  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.load();
      if (!state.nextAt) return;
      if (state.nextAt > this.now()) { await this.save(state); return; }
      if (state.active) {
        this.retry(state, 'Workflow lease expired; inspect GitHub Actions');
      } else if (state.dispatchUntil) {
        this.retry(state, 'Workflow did not claim the dispatched batch');
      } else if (!state.pending.length) {
        state.nextAt = null;
      } else {
        try {
          if (!/^[\w.-]+\/[\w.-]+$/.test(this.env.GITHUB_REPOSITORY) || !this.env.GITHUB_DISPATCH_TOKEN) throw new Error('Missing configuration');
          const response = await this.fetchImpl('https://api.github.com/repos/' + this.env.GITHUB_REPOSITORY + '/dispatches', {
            method:'POST', redirect:'error', signal:AbortSignal.timeout(10_000),
            headers:{Authorization:'Bearer ' + this.env.GITHUB_DISPATCH_TOKEN, Accept:'application/vnd.github+json', 'Content-Type':'application/json', 'User-Agent':'activity-journal-webhook'},
            body:JSON.stringify({event_type:'strava-activity-created'}),
          });
          if (!response.ok) throw new Error('Dispatch failed');
          // If Actions never claims the batch (disabled or dropped pending run),
          // dispatch again rather than leaving acknowledged events stranded.
          state.dispatchUntil = this.now() + 10 * minute;
          state.nextAt = state.dispatchUntil;
          state.lastError = null;
        } catch {
          this.retry(state, 'GitHub dispatch failed');
        }
      }
      await this.save(state);
    });
  }
}

export default {
  async fetch(request, env) {
    try {
      return await env.SYNC.get(env.SYNC.idFromName('activity-journal')).fetch(request);
    } catch {
      // URLs contain the webhook path secret; never log raw requests/errors.
      return json({error:'Temporary failure'}, 503);
    }
  },
};
