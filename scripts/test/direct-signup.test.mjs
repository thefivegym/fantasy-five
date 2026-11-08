import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideDirectSignup, DUPLICATE_HANDLE, DUPLICATE_LOGIN, assertNewHandleRecord } from '../lib/direct-signup.mjs';
import { prepareSignup, interpretSignup, UNCONFIGURED } from '../lib/signup-form.mjs';
import { handleSignup } from '../lib/signup-http.mjs';
import { memoryRateStore } from '../lib/signup-rate.mjs';
import { memoryPlayerStore } from '../lib/memory-signup-store.mjs';
import { commitNewPlayer, buildPlayersIndex } from '../lib/github-player-commit.mjs';
import { createFetch } from '../../workers/signup/index.mjs';
import { playersJoinedSince } from '../lib/players.mjs';
import { reminderLogins } from '../remind.mjs';
import { processSignup } from '../process-signup.mjs';
import { processSubmission } from '../process-lineup.mjs';
import { SIGNUP_LIMITS } from '../lib/config.mjs';
import { startSignupDevServer } from '../signup-dev-server.mjs';

const NOW = '2026-11-08T18:00:00.000Z';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => readFileSync(join(ROOT, rel));
const hash = rel => createHash('sha256').update(read(rel)).digest('hex');
const KNOWN_FILES = ['data/players/kelseeey.json', 'data/players/thefivegym.json', 'data/players.json', 'data/lineups/2027/1/kelseeey.json'];
const before = Object.fromEntries(KNOWN_FILES.map(f => [f, hash(f)]));

const disk = rel => JSON.parse(read(rel).toString('utf8'));
const kelseeey = disk('data/players/kelseeey.json');
const owner = disk('data/players/thefivegym.json');
const KNOWN = [kelseeey, owner];

function post(instagram, { ip = '203.0.113.9', origin = 'https://thefivegym.github.io', extra, contentType = 'application/json' } = {}) {
  const payload = extra ? { instagram, ...extra } : { instagram };
  return new Request('https://thefivegym.github.io/api/signup', {
    method: 'POST',
    headers: { 'content-type': contentType, origin },
    body: JSON.stringify(payload),
  });
}

async function send(store, instagram, opts = {}) {
  const res = await handleSignup(post(instagram, opts), {
    now: () => new Date(NOW),
    ip: opts.ip || '203.0.113.9',
    rate: opts.rate,
    limits: opts.limits,
    tokenConfigured: opts.tokenConfigured,
    origins: opts.origins,
    listPlayers: () => store.list(),
    commit: record => store.commit(record),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('existing players keep their scoring identities', () => {
  assert.equal(kelseeey.login, 'kelseeey');
  assert.equal(kelseeey.instagram, 'kelseytravels');
  assert.equal(kelseeey.reminders, true);
  assert.equal(kelseeey.auth, undefined);
  assert.equal(owner.login, 'thefivegym');
  assert.equal(owner.instagram, 'gymnast_zoerae');
  assert.equal(owner.auth, undefined);
  assert.equal(disk('data/lineups/2027/1/kelseeey.json').login, 'kelseeey');
  assert.equal(SIGNUP_LIMITS.perIp, 15);
  assert.equal(SIGNUP_LIMITS.global, 40);
});

test('handle-only signup is a new id, not the owner, and does not verify ownership', () => {
  const ok = decideDirectSignup({ instagram: 'https://instagram.com/New.Gymnast/', players: KNOWN, now: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.login, 'new.gymnast');
  assert.notEqual(ok.record.login, 'thefivegym');
  assert.equal(ok.record.instagram, 'new.gymnast');
  assert.equal(ok.record.reminders, false);
  assert.equal(ok.record.auth, 'instagram');
  assert.equal(ok.record.joined_at, NOW);
  assert.equal(ok.body.verified, false);
  assert.equal(ok.body.saved, true);
  assert.match(ok.body.message, /does not verify/);
  assert.match(ok.body.message, /No email or password/);
  assert.match(ok.body.message, /no reminder and no email/);
  assert.doesNotMatch(ok.body.message, /ownership verified|GitHub email/i);
  const again = decideDirectSignup({ instagram: '@new.gymnast', players: [...KNOWN, ok.record], now: NOW });
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, DUPLICATE_HANDLE);
  assert.equal(again.record, undefined);
});

test('known handles and the owner login are duplicates, not overwrites', () => {
  for (const raw of ['kelseytravels', '@KelseyTravels', 'https://instagram.com/kelseytravels/', 'gymnast_zoerae']) {
    const d = decideDirectSignup({ instagram: raw, players: KNOWN, now: NOW });
    assert.equal(d.ok, false, raw);
    assert.equal(d.status, 409, raw);
    assert.equal(d.body.error, DUPLICATE_HANDLE, raw);
    assert.equal(d.body.saved, false);
  }
  for (const raw of ['kelseeey', 'thefivegym', '@TheFiveGym']) {
    const d = decideDirectSignup({ instagram: raw, players: KNOWN, now: NOW });
    assert.equal(d.status, 409, raw);
    assert.equal(d.body.error, DUPLICATE_LOGIN, raw);
  }
  const empty = decideDirectSignup({ instagram: 'thefivegym', players: [], now: NOW });
  assert.equal(empty.body.error, DUPLICATE_LOGIN);
  for (const bad of ['', '   ', '...', 'a..b', 'jane doe', 'a'.repeat(31)]) {
    const d = decideDirectSignup({ instagram: bad, players: [], now: NOW });
    assert.equal(d.status, 400, bad);
    assert.match(d.body.error, /Nothing was saved/);
  }
});

test('HTTP: save, duplicate, validation, rate limit, bad origin, no token in the response', async () => {
  const store = memoryPlayerStore(KNOWN);
  const rate = memoryRateStore();
  const limits = { perIp: 2, global: 30, windowSec: 3600 };
  const saved = await send(store, '@New.Gymnast', { rate, limits });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.record.login, 'new.gymnast');
  assert.equal(saved.body.record.auth, 'instagram');
  assert.equal(saved.body.verified, false);
  assert.equal(store.commits.length, 1);
  assert.equal(store.commits[0].login, 'new.gymnast');
  assert.deepEqual(store.players.map(p => p.login).slice(0, 2), ['kelseeey', 'thefivegym']);
  const dup = await send(store, 'new.gymnast', { rate, limits });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.saved, false);
  assert.equal(store.commits.length, 1);
  const taken = await send(store, 'kelseytravels', { rate, limits, ip: '203.0.113.10' });
  assert.equal(taken.status, 409);
  assert.match(taken.body.error, /already signed up/);
  assert.equal(store.commits.length, 1);
  const bad = await send(store, 'not a handle', { rate, limits, ip: '203.0.113.11' });
  assert.equal(bad.status, 400);
  assert.equal(store.commits.length, 1);
  const reminders = await send(store, 'another.handle', { rate, limits, ip: '203.0.113.12', extra: { reminders: true } });
  assert.equal(reminders.status, 400);
  assert.match(reminders.body.error, /no email is sent/);
  const email = await send(store, 'another.handle', { rate, limits, ip: '203.0.113.13', extra: { email: 'a@b.c', password: 'x' } });
  assert.equal(email.status, 400);
  assert.doesNotMatch(email.body.error, /a@b.c/);
  const login = await send(store, 'another.handle', { rate, limits, ip: '203.0.113.14', extra: { login: 'thefivegym' } });
  assert.equal(login.status, 400);
  assert.equal(store.commits.length, 1);
  const third = await send(store, 'third.handle', { rate, limits, ip: '203.0.113.9' });
  assert.equal(third.status, 429);
  assert.equal(store.commits.length, 1);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
  const otherIp = await send(store, 'third.handle', { rate, limits, ip: '198.51.100.8' });
  assert.equal(otherIp.status, 201);
  assert.equal(otherIp.body.record.login, 'third.handle');
  const evil = await handleSignup(post('fourth.handle', { origin: 'https://evil.example' }), {
    now: () => new Date(NOW), ip: '198.51.100.9', rate, limits,
    listPlayers: () => store.list(), commit: r => store.commit(r),
  });
  assert.equal(evil.status, 403);
  const down = await send(memoryPlayerStore(KNOWN), 'fifth.handle', { tokenConfigured: false, rate: memoryRateStore() });
  assert.equal(down.status, 503);
  assert.match(down.body.error, /Nothing was saved/);
  const page = interpretSignup(saved.status, saved.body, 'new.gymnast');
  assert.equal(page.ok, true);
  assert.match(page.message, /Player name: new.gymnast/);
  const forged = interpretSignup(201, { ...saved.body, verified: true, record: { ...saved.body.record, login: 'thefivegym' } }, 'new.gymnast');
  assert.equal(forged.ok, false);
  assert.match(forged.message, /not saved|not confirm/i);
});

test('the page prepares a handle POST and refuses a success that is not a real save', () => {
  assert.deepEqual(prepareSignup('', '@new.gymnast'), { ok: false, kind: 'unconfigured', message: UNCONFIGURED });
  assert.equal(prepareSignup('http://example.com/signup', 'new.gymnast').ok, false);
  const prep = prepareSignup('https://signup.example/api', ' Instagram.com/New.Gymnast/ ');
  assert.deepEqual(prep.body, { instagram: 'new.gymnast' });
  assert.equal(Object.keys(prep.body).join(), 'instagram');
  const html = read('signup.html').toString('utf8');
  assert.match(html, />Submit</);
  assert.match(html, /does not verify that you own the account/);
  assert.match(html, /does not send email/);
  assert.doesNotMatch(html, /issues\/new|localStorage|Open GitHub issue|ghp_|github_pat_|type="password"|type="email"/);
  const worker = read('workers/signup/index.mjs').toString('utf8');
  assert.match(worker, /CF-Connecting-IP/);
  assert.doesNotMatch(worker, /x-forwarded-for|X-Forwarded-For|ghp_|github_pat_/i);
  assert.doesNotMatch(read('workers/signup/wrangler.toml').toString('utf8'), /ghp_|github_pat_|SIGNUP_GITHUB_TOKEN\s*=\s*["'][^"']+/);
  assert.equal(disk('data/signup-api.json').url, '');
});

test('worker graph has no filesystem, browser storage, or token', () => {
  const files = [join(ROOT, 'workers/signup/index.mjs'), join(ROOT, 'scripts/lib/signup-form.mjs')];
  const seen = new Set();
  while (files.length) {
    const file = files.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /node:fs|node:child_process|localStorage/);
    assert.doesNotMatch(src, /ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9]{8,}/);
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      let next = join(dirname(file), m[1]);
      if (!next.endsWith('.mjs')) next += '.mjs';
      files.push(next);
    }
  }
  assert.ok(seen.size >= 4);
});

test('GitHub issue signup cannot take a known handle or overwrite a handle-only player', async () => {
  const issue = (login, payload) => ({ user: { login }, title: 'Signup: x', labels: [], body: `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` });
  const steal = await processSignup({
    issue: issue('someone', { game: 'fantasy-five', type: 'signup', schema: 2, reminders: true, instagram: 'kelseytravels' }),
    now: NOW, existing: null, players: KNOWN,
  });
  assert.equal(steal.ok, false);
  assert.match(steal.errors.join(' '), /already signed up/);
  const locked = { login: 'new.gymnast', instagram: 'new.gymnast', joined_at: NOW, reminders: false, auth: 'instagram' };
  const overwrite = await processSignup({
    issue: issue('new.gymnast', { game: 'fantasy-five', type: 'signup', schema: 2, reminders: true, instagram: 'other.handle' }),
    now: NOW, existing: locked, players: [...KNOWN, locked],
  });
  assert.equal(overwrite.ok, false);
  assert.match(overwrite.errors.join(' '), /cannot be changed from a GitHub issue/);
  const lineup = await processSubmission({
    issue: { body: '```json\n{"schema":2,"season":2027,"week":1,"lineup":{}}\n```', user: { login: 'new.gymnast' }, number: 1, created_at: NOW },
    action: 'opened', now: NOW, readPlayer: async () => locked,
  });
  assert.deepEqual(lineup.errors, ['This GitHub login matches a handle-only signup and cannot file its lineup. Nothing was saved.']);
  const still = await processSubmission({
    issue: { body: 'no json here', user: { login: 'kelseeey' }, number: 2, created_at: NOW },
    action: 'opened', now: NOW, readPlayer: async () => kelseeey,
  });
  assert.match(still.errors[0], /No lineup JSON/);
  const named = await processSubmission({
    issue: { body: '```json\n{"schema":2,"season":2027,"week":1,"lineup":{}}\n```', user: { login: 'kelseeey' }, number: 3, created_at: NOW },
    action: 'opened', now: NOW, readPlayer: async () => kelseeey,
  });
  assert.notEqual(named.errors[0], 'This GitHub login matches a handle-only signup and cannot file its lineup. Nothing was saved.');
});

test('reminders skip handle-only players; daily list can filter by joined_at', () => {
  const logins = reminderLogins([
    kelseeey,
    owner,
    { login: 'new.gymnast', instagram: 'new.gymnast', reminders: true, auth: 'instagram' },
    { login: 'quiet', instagram: 'quiet', reminders: false },
  ]);
  assert.deepEqual(logins, ['kelseeey', 'thefivegym']);
  const since = playersJoinedSince(KNOWN, '2026-11-08');
  assert.deepEqual(since.map(p => p.login), ['thefivegym']);
  assert.equal(playersJoinedSince(KNOWN).length, 2);
  const run = args => execFileSync('node', [join(ROOT, 'scripts/admin/winner.mjs'), ...args], { encoding: 'utf8' });
  const all = run(['--players']);
  assert.match(all, /kelseeey\t@kelseytravels\s/);
  assert.match(all, /thefivegym\t@gymnast_zoerae\s/);
  assert.doesNotMatch(run(['--players', '--since=2099-01-01']), /kelseeey|thefivegym/);
  assert.match(run(['--players', '--since=2099-01-01']), /No signed-up players/);
  const day = run(['--players', '--since=2026-11-08']);
  assert.match(day, /thefivegym\t@gymnast_zoerae/);
  assert.doesNotMatch(day, /kelseeey/);
  assert.throws(() => run(['--players', '--since=nope']));
});

function githubFixture() {
  const state = {
    sha: '1111111111111111111111111111111111111111',
    tree: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    index: disk('data/players.json'),
    files: {},
    blobs: {},
    failRefOnce: false,
  };
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method, path: u.pathname, body });
    const json = (status, obj) => new Response(JSON.stringify(obj), { status });
    const repo = '/repos/thefivegym/fantasy-five';
    if (opts.method === 'GET' && u.pathname === `${repo}/git/ref/heads/main`) return json(200, { object: { sha: state.sha } });
    if (opts.method === 'GET' && u.pathname === `${repo}/git/commits/${state.sha}`) return json(200, { sha: state.sha, tree: { sha: state.tree } });
    if (opts.method === 'GET' && u.pathname === `${repo}/contents/data/players.json`) {
      return json(200, { content: Buffer.from(JSON.stringify(state.index, null, 1) + '\n').toString('base64') });
    }
    if (opts.method === 'GET' && u.pathname.startsWith(`${repo}/contents/data/players/`)) {
      const path = u.pathname.slice(`${repo}/contents/`.length);
      assert.equal(path.includes('..'), false);
      assert.equal(path.startsWith('data/lineups'), false);
      if (!state.files[path]) return json(404, { message: 'Not Found' });
      return json(200, { content: Buffer.from(state.files[path]).toString('base64') });
    }
    if (opts.method === 'POST' && u.pathname === `${repo}/git/blobs`) {
      n += 1;
      const sha = String(n).padStart(40, 'b');
      state.blobs[sha] = body.content;
      assert.equal(body.content.includes('test-token-value'), false);
      return json(201, { sha });
    }
    if (opts.method === 'POST' && u.pathname === `${repo}/git/trees`) {
      state.lastTree = body;
      assert.deepEqual(body.tree.map(t => t.path).sort(), body.tree.map(t => t.path).filter(p => p === 'data/players.json' || /^data\/players\/[a-z0-9._]+\.json$/.test(p)).sort());
      assert.equal(body.tree.some(t => t.path.startsWith('data/lineups')), false);
      return json(201, { sha: 'cccccccccccccccccccccccccccccccccccccccc' });
    }
    if (opts.method === 'POST' && u.pathname === `${repo}/git/commits`) {
      assert.match(body.message, /^Player: [a-z0-9._]+ \(instagram signup\)$/);
      assert.doesNotMatch(body.message, /thefivegym/);
      const sha = String(3 + calls.length).padStart(40, 'd');
      state.pendingSha = sha;
      return json(201, { sha });
    }
    if (opts.method === 'PATCH' && u.pathname === `${repo}/git/refs/heads/main`) {
      assert.equal(body.force, false);
      if (state.failRefOnce) { state.failRefOnce = false; return json(422, { message: 'not fast forward' }); }
      for (const item of state.lastTree.tree) {
        if (item.path === 'data/players.json') state.index = JSON.parse(state.blobs[item.sha]);
        else state.files[item.path] = state.blobs[item.sha];
      }
      state.sha = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(500, { message: `unexpected ${opts.method} ${u.pathname}`, token: 'test-token-value' });
  };
  return { state, calls, fetchImpl };
}

test('commit writes only a new player file and keeps kelseeey and thefivegym', async () => {
  const fx = githubFixture();
  const record = decideDirectSignup({ instagram: '@brand.new.handle', players: KNOWN, now: NOW }).record;
  fx.state.failRefOnce = true;
  const saved = await commitNewPlayer({ token: 'test-token-value', record, fetch: fx.fetchImpl });
  assert.equal(saved.ok, true);
  assert.match(saved.commit, /^[0-9a-f]{40}$/);
  assert.equal(JSON.stringify(saved).includes('test-token-value'), false);
  const file = JSON.parse(fx.state.files['data/players/brand.new.handle.json']);
  assert.equal(file.login, 'brand.new.handle');
  assert.equal(file.reminders, false);
  assert.equal(file.auth, 'instagram');
  assert.equal(fx.state.index.players.kelseeey.instagram, 'kelseytravels');
  assert.equal(fx.state.index.players.thefivegym.instagram, 'gymnast_zoerae');
  assert.equal(fx.state.index.players['brand.new.handle'].auth, 'instagram');
  assert.equal(fx.state.index.players.kelseeey.auth, undefined);
  const dup = await commitNewPlayer({ token: 'test-token-value', record, fetch: fx.fetchImpl });
  assert.deepEqual(dup, { ok: false, code: 'duplicate' });
  const posts = fx.calls.filter(c => c.method === 'POST' && c.path.endsWith('/git/blobs')).length;
  const beforePosts = posts;
  const stolen = await commitNewPlayer({
    token: 'test-token-value',
    record: { ...record, login: 'kelseytravels', instagram: 'kelseytravels' },
    fetch: fx.fetchImpl,
  });
  assert.equal(stolen.code, 'duplicate');
  assert.equal(fx.calls.filter(c => c.method === 'POST' && c.path.endsWith('/git/blobs')).length, beforePosts);
  const unsafe = await commitNewPlayer({ token: 'test-token-value', record: { login: '../x', instagram: '../x', joined_at: NOW, reminders: false, auth: 'instagram' }, fetch: () => { throw new Error('network'); } });
  assert.deepEqual(unsafe, { ok: false, code: 'unavailable' });
  assert.throws(() => assertNewHandleRecord({ login: 'thefivegym', instagram: 'thefivegym', joined_at: NOW, reminders: false, auth: 'instagram' }));
  const next = buildPlayersIndex(disk('data/players.json'), record, NOW);
  assert.equal(next.players.kelseeey.instagram, 'kelseytravels');
  assert.equal(next.players['brand.new.handle'].instagram, 'brand.new.handle');
});

test('worker save uses the handle as the player id and ignores a forged forwarding header', async () => {
  const fx = githubFixture();
  const kv = { data: new Map(), async get(k) { return this.data.has(k) ? this.data.get(k) : null; }, async put(k, v) { this.data.set(k, v); } };
  const fetchSignup = createFetch({ token: 'test-token-value', kv, fetchImpl: fx.fetchImpl, now: () => new Date(NOW) });
  const sendWorker = (instagram, ip, forwarded) => fetchSignup(new Request('https://signup.example/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://thefivegym.github.io', 'cf-connecting-ip': ip, 'x-forwarded-for': forwarded },
    body: JSON.stringify({ instagram }),
  }));
  const res = await sendWorker('@fresh.signup', '9.9.9.9', '1.2.3.4');
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.record.login, 'fresh.signup');
  assert.notEqual(body.record.login, 'thefivegym');
  assert.equal(body.verified, false);
  assert.equal(JSON.stringify(body).includes('test-token-value'), false);
  const again = await sendWorker('fresh.signup', '9.9.9.9', '8.8.8.8');
  assert.equal(again.status, 409);
  const known = await sendWorker('gymnast_zoerae', '8.8.8.8', '1.1.1.1');
  assert.equal(known.status, 409);
  assert.equal(fx.state.index.players.kelseeey.instagram, 'kelseytravels');
  const keys = [...kv.data.keys()].join(' ');
  assert.match(keys, /9\.9\.9\.9/);
  assert.doesNotMatch(keys, /1\.2\.3\.4|1\.1\.1\.1/);
  const missing = createFetch({ token: '', kv: null, fetchImpl: fx.fetchImpl });
  const off = await missing(new Request('https://signup.example/', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://thefivegym.github.io' }, body: '{"instagram":"nope.handle"}',
  }));
  assert.equal(off.status, 503);
});

test('dev server saves in memory and does not touch player or lineup files', async () => {
  const srv = await startSignupDevServer();
  try {
    const page = await fetch(`${srv.url}/signup.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), />Submit</);
    const cfg = await (await fetch(`${srv.url}/data/signup-api.json`)).json();
    assert.equal(cfg.url, `${srv.url}/api/signup`);
    const headers = { 'content-type': 'application/json', origin: srv.url };
    const ok = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ instagram: '@dev.server.user' }) });
    const okBody = await ok.json();
    assert.equal(ok.status, 201);
    assert.equal(interpretSignup(ok.status, okBody, 'dev.server.user').ok, true);
    const dup = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ instagram: 'dev.server.user' }) });
    assert.equal(dup.status, 409);
    const known = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ instagram: 'kelseytravels' }) });
    assert.equal(known.status, 409);
    const bad = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ instagram: 'has space' }) });
    assert.equal(bad.status, 400);
    assert.equal(srv.store.commits.length, 1);
    assert.equal(srv.store.players.some(p => p.login === 'kelseeey' && p.instagram === 'kelseytravels'), true);
  } finally {
    await srv.close();
  }
  for (const f of KNOWN_FILES) assert.equal(hash(f), before[f], f);
});
