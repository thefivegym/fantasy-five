// Commit one new handle-only player onto main. The token is an argument, never part of the record.
// One git commit updates data/players/<handle>.json and data/players.json. It does not write lineups,
// and the ref update is not forced, so a concurrent commit is retried instead of overwritten.
import { REPO, REPO_OWNER } from './config.mjs';
import { playerIndexEntry } from './player-index.mjs';
import { assertNewHandleRecord, playerFilePath } from './direct-signup.mjs';

const API = 'https://api.github.com';

export function summariesFromIndex(index) {
  return Object.entries(index?.players || {}).map(([login, v]) => ({
    login,
    instagram: v?.instagram || null,
    ...(v?.auth === 'instagram' ? { auth: 'instagram' } : {}),
  }));
}

export function buildPlayersIndex(prev, record, generatedAt) {
  assertNewHandleRecord(record);
  const players = { ...(prev?.players || {}) };
  for (const [k, v] of Object.entries(players)) {
    if (String(k).toLowerCase() === record.login || String(v?.instagram || '').toLowerCase() === record.instagram) {
      const err = new Error('duplicate');
      err.code = 'duplicate';
      throw err;
    }
  }
  players[record.login] = playerIndexEntry(record);
  return { generated_at: generatedAt || record.joined_at, players };
}

function decode64(s) {
  const bin = atob(String(s || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function gh(fetchImpl, token, method, path, body) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'fantasy-five-signup',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

function unavailable() { return { ok: false, code: 'unavailable' }; }
function duplicate() { return { ok: false, code: 'duplicate' }; }

function repoOk(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

async function readIndex(fetchImpl, token, repo, sha) {
  const res = await gh(fetchImpl, token, 'GET', `/repos/${repo}/contents/data/players.json?ref=${sha}`);
  if (res.status !== 200 || !res.json?.content) return null;
  try { return JSON.parse(decode64(res.json.content)); } catch { return null; }
}

/** Latest public index on main, as {login, instagram, auth?} rows. */
export async function fetchPlayerSummaries({ token, repo = REPO, fetch: fetchImpl = fetch } = {}) {
  if (!token || !repoOk(repo)) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
  const ref = await gh(fetchImpl, token, 'GET', `/repos/${repo}/git/ref/heads/main`);
  if (ref.status !== 200 || !ref.json?.object?.sha) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
  const index = await readIndex(fetchImpl, token, repo, ref.json.object.sha);
  if (!index) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
  return summariesFromIndex(index);
}

/**
 * Fast-forward one new player onto main. Retries when the ref moved.
 * Returns {ok:true, commit} or {ok:false, code:'duplicate'|'unavailable'}. Never includes the token.
 */
export async function commitNewPlayer({ token, repo = REPO, record, fetch: fetchImpl = fetch, owner = REPO_OWNER } = {}) {
  if (!token || !repoOk(repo)) return unavailable();
  let path;
  try { path = playerFilePath(assertNewHandleRecord(record, owner).login); }
  catch (e) { return e?.code === 'duplicate' ? duplicate() : unavailable(); }
  if (!path.startsWith('data/players/') || path.includes('..') || path.startsWith('data/lineups')) return unavailable();

  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await gh(fetchImpl, token, 'GET', `/repos/${repo}/git/ref/heads/main`);
    if (ref.status !== 200 || !/^[0-9a-f]{40}$/.test(ref.json?.object?.sha || '')) return unavailable();
    const parent = ref.json.object.sha;
    const commit = await gh(fetchImpl, token, 'GET', `/repos/${repo}/git/commits/${parent}`);
    if (commit.status !== 200 || !commit.json?.tree?.sha) return unavailable();
    const existing = await gh(fetchImpl, token, 'GET', `/repos/${repo}/contents/${path}?ref=${parent}`);
    if (existing.status === 200) return duplicate();
    if (existing.status !== 404) return unavailable();
    const index = await readIndex(fetchImpl, token, repo, parent);
    if (!index) return unavailable();
    let next;
    let fileText;
    try {
      next = buildPlayersIndex(index, record, record.joined_at);
      fileText = JSON.stringify(record, null, 1) + '\n';
    } catch (e) {
      return e?.code === 'duplicate' ? duplicate() : unavailable();
    }
    const indexText = JSON.stringify(next, null, 1) + '\n';
    if (indexText.includes('data/lineups') || fileText.includes(token) || indexText.includes(token)) return unavailable();
    const fileBlob = await gh(fetchImpl, token, 'POST', `/repos/${repo}/git/blobs`, { content: fileText, encoding: 'utf-8' });
    const indexBlob = await gh(fetchImpl, token, 'POST', `/repos/${repo}/git/blobs`, { content: indexText, encoding: 'utf-8' });
    if (fileBlob.status !== 201 || indexBlob.status !== 201) return unavailable();
    const tree = await gh(fetchImpl, token, 'POST', `/repos/${repo}/git/trees`, {
      base_tree: commit.json.tree.sha,
      tree: [
        { path, mode: '100644', type: 'blob', sha: fileBlob.json.sha },
        { path: 'data/players.json', mode: '100644', type: 'blob', sha: indexBlob.json.sha },
      ],
    });
    if (tree.status !== 201 || !tree.json?.sha) return unavailable();
    const made = await gh(fetchImpl, token, 'POST', `/repos/${repo}/git/commits`, {
      message: `Player: ${record.login} (instagram signup)`,
      tree: tree.json.sha,
      parents: [parent],
    });
    if (made.status !== 201 || !/^[0-9a-f]{40}$/.test(made.json?.sha || '')) return unavailable();
    const updated = await gh(fetchImpl, token, 'PATCH', `/repos/${repo}/git/refs/heads/main`, { sha: made.json.sha, force: false });
    if (updated.status === 200) return { ok: true, commit: made.json.sha };
    if (updated.status !== 422) return unavailable();
  }
  return unavailable();
}
