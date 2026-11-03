// Player records: data/players/<login>.json = {login, joined_at, updated_at, reminders, email_ciphertext, key_id, issue}.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, readJson } from './io.mjs';

export const playerPath = login => join('data', 'players', `${String(login).toLowerCase()}.json`);
export async function loadPlayer(login) { return readJson(join(DATA, 'players', `${String(login).toLowerCase()}.json`), null); }
export async function loadPlayers() {
  let files = [];
  try { files = (await readdir(join(DATA, 'players'))).filter(f => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files.sort()) { const p = await readJson(join(DATA, 'players', f), null); if (p && !p.test) out.push(p); }
  return out;
}
