#!/usr/bin/env node
// ORGANIZER ONLY. Decrypts player emails from data/players/*.json with the private key, which lives only on the
// organizer's machine (default /home/box/.secrets/fantasy-five/email-private-key, or $FF_EMAIL_KEY). Prints to stdout;
// writes nothing. Never run this in GitHub Actions.
// Usage:
//   node scripts/admin/decrypt-emails.mjs                     every player: login, reminders, email
//   node scripts/admin/decrypt-emails.mjs --login=<login>      one player (e.g. the season winner)
//   node scripts/admin/decrypt-emails.mjs --winner[=2027]      the #1 player on data/leaderboard/<season>.json
//   node scripts/admin/decrypt-emails.mjs --file=<path.json>   one record file (testing)
import { readFileSync } from 'node:fs';
import { privateDecrypt, createPrivateKey, constants } from 'node:crypto';
import { join } from 'node:path';
import { DATA, readJson, parseArgs } from '../lib/io.mjs';
import { loadPlayers, loadPlayer } from '../lib/players.mjs';

export const KEY_PATH = process.env.FF_EMAIL_KEY || '/home/box/.secrets/fantasy-five/email-private-key';

export function decryptEmail(rec, key) {
  const pt = privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(rec.email_ciphertext, 'base64'));
  const o = JSON.parse(pt.toString('utf8'));
  if (o.v !== 1 || typeof o.email !== 'string') throw new Error('unexpected plaintext shape');
  return o.email;
}

async function main() {
  const a = parseArgs();
  if (process.env.GITHUB_ACTIONS) { console.error('Refusing to run in GitHub Actions.'); process.exit(1); }
  const key = createPrivateKey(readFileSync(KEY_PATH));
  let recs;
  if (a.file) recs = [JSON.parse(readFileSync(a.file, 'utf8'))];
  else if (a.login) recs = [await loadPlayer(a.login)].filter(Boolean);
  else if (a.winner) {
    const main = await readJson(join(DATA, 'season.json'));
    const sid = a.winner === true ? main.season : a.winner;
    const lb = await readJson(join(DATA, 'leaderboard', `${sid}.json`));
    const top = lb.players.filter(p => p.rank === 1);
    if (!top.length) { console.error(`No players on the ${sid} leaderboard yet.`); process.exit(1); }
    console.log(`${sid} winner${top.length > 1 ? 's (tied)' : ''}: ${top.map(p => `${p.login} ${p.total}`).join(', ')}`);
    recs = (await Promise.all(top.map(p => loadPlayer(p.login)))).filter(Boolean);
  } else recs = await loadPlayers();
  if (!recs.length) { console.error('No matching player record.'); process.exit(1); }
  for (const r of recs) {
    let email;
    try { email = decryptEmail(r, key); } catch (e) { email = `(could not decrypt: ${e.message})`; }
    console.log(`${r.login}\t${email}\treminders=${r.reminders}`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
