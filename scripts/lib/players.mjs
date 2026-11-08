// Player records: data/players/<login>.json = {login, instagram, joined_at, reminders, auth?}.
// data/players.json = {generated_at, players:{<login>: {instagram, auth?}}}: the public index the site reads.
// auth "instagram" is a handle-only signup. Missing auth is a GitHub-account signup.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, readJson, writeJson } from './io.mjs';
import { playerIndexEntry } from './player-index.mjs';

export { playerIndexEntry };

export const playerPath = login => join('data', 'players', `${String(login).toLowerCase()}.json`);
export async function loadPlayer(login) { return readJson(join(DATA, 'players', `${String(login).toLowerCase()}.json`), null); }
export async function loadPlayers() {
  let files = [];
  try { files = (await readdir(join(DATA, 'players'))).filter(f => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files.sort()) { const p = await readJson(join(DATA, 'players', f), null); if (p && !p.test) out.push(p); }
  return out;
}
/** Players whose joined_at is on or after `since` (date or ISO time). No `since`: the same list. */
export function playersJoinedSince(players, since) {
  if (since == null || since === '' ) return players;
  if (since === true) {
    const err = new Error('--since must be a date or time (YYYY-MM-DD).');
    err.code = 'bad-since';
    throw err;
  }
  const t = Date.parse(since);
  if (Number.isNaN(t)) {
    const err = new Error(`--since must be a date or time (YYYY-MM-DD). Got ${since}.`);
    err.code = 'bad-since';
    throw err;
  }
  return players.filter(p => { const j = Date.parse(p.joined_at); return !Number.isNaN(j) && j >= t; });
}
export async function writePlayersIndex(path = join(DATA, 'players.json')) {
  const ps = await loadPlayers();
  const idx = { generated_at: new Date().toISOString(), players: Object.fromEntries(ps.map(p => [p.login, playerIndexEntry(p)])) };
  await writeJson(path, idx);
  return idx;
}
