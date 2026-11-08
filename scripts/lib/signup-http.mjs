// HTTP signup handler. The worker and the local dev server both call this.
// Writes only through the injected commit function. Never reads a token from the request.
import { SIGNUP_LIMITS, SIGNUP_ORIGINS } from './config.mjs';
import { decideDirectSignup, RATE_LIMIT, UNAVAILABLE, BAD_BODY, NO_REMINDERS } from './direct-signup.mjs';
import { rateKeys } from './signup-rate.mjs';

const MAX_BODY = 1024;

function cors(request, origins) {
  const origin = request.headers.get('origin');
  if (!origin) return { blocked: false, headers: {} };
  if (!origins.includes(origin)) return { blocked: true, headers: {} };
  return {
    blocked: false,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'origin',
    },
  };
}

function reply(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function unavailable(headers) {
  return reply(503, { ok: false, saved: false, verified: false, error: UNAVAILABLE }, headers);
}

function bodyError(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return BAD_BODY;
  const extra = Object.keys(data).filter(k => k !== 'instagram');
  if (extra.some(k => /^(email|password|token|authorization|secret)$/i.test(k))) return BAD_BODY;
  if (extra.includes('reminders')) return NO_REMINDERS;
  if (extra.includes('login')) return 'The player name is the Instagram handle. It cannot be set separately. Nothing was saved.';
  if (extra.length) return BAD_BODY;
  return null;
}

export async function handleSignup(request, deps = {}) {
  const origins = deps.origins || SIGNUP_ORIGINS;
  const limits = deps.limits || SIGNUP_LIMITS;
  const { headers, blocked } = cors(request, origins);
  if (blocked) return reply(403, { ok: false, saved: false, verified: false, error: 'This site cannot submit signups from that page. Nothing was saved.' }, headers);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { ok: false, saved: false, verified: false, error: 'Use the signup form. Nothing was saved.' }, { ...headers, allow: 'POST' });

  const now = deps.now ? deps.now() : new Date();
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const nowIso = new Date(nowMs).toISOString();
  let text = '';
  try { text = await request.text(); } catch { return unavailable(headers); }
  if (text.length > MAX_BODY) return reply(413, { ok: false, saved: false, verified: false, error: 'That signup was too large. Nothing was saved.' }, headers);
  if (deps.tokenConfigured === false || !deps.rate || typeof deps.listPlayers !== 'function' || typeof deps.commit !== 'function') return unavailable(headers);

  try {
    const keys = rateKeys(deps.ip, nowMs, limits.windowSec);
    const ipCount = await deps.rate.incr(keys.ip, limits.windowSec);
    const globalCount = await deps.rate.incr(keys.global, limits.windowSec);
    if (ipCount > limits.perIp || globalCount > limits.global) {
      return reply(429, { ok: false, saved: false, verified: false, error: RATE_LIMIT }, { ...headers, 'retry-after': String(keys.retryAfter) });
    }
    const type = request.headers.get('content-type') || '';
    if (!type.includes('application/json')) return reply(400, { ok: false, saved: false, verified: false, error: BAD_BODY }, headers);
    let data;
    try { data = JSON.parse(text); } catch { return reply(400, { ok: false, saved: false, verified: false, error: BAD_BODY }, headers); }
    const bad = bodyError(data);
    if (bad) return reply(400, { ok: false, saved: false, verified: false, error: bad }, headers);
    const players = await deps.listPlayers();
    const decision = decideDirectSignup({ instagram: data.instagram, players, now: nowIso, owner: deps.owner });
    if (!decision.ok) return reply(decision.status, decision.body, headers);
    const result = await deps.commit(decision.record);
    if (result?.ok === true && result.code !== 'duplicate') {
      const body = { ...decision.body };
      if (typeof result.commit === 'string' && /^[0-9a-f]{40}$/.test(result.commit)) body.commit = result.commit;
      return reply(201, body, headers);
    }
    if (result?.code === 'duplicate') {
      return reply(409, { ok: false, saved: false, verified: false, error: "That Instagram handle is already signed up. This form can't change an existing registration. Nothing was changed." }, headers);
    }
    return unavailable(headers);
  } catch (err) {
    console.error('signup failed', err && err.code || err && err.name || 'error');
    return unavailable(headers);
  }
}
