#!/usr/bin/env node
// Season winner(s) and their Instagram handles, for the organizer to DM.
// Usage:
//   node scripts/admin/winner.mjs --winner[=2027]   #1 on data/leaderboard/<season>.json (ties: all of them)
//   node scripts/admin/winner.mjs                   every signed-up player: login, IG, reminders
import { join } from 'node:path';
import { DATA, readJson, parseArgs } from '../lib/io.mjs';
import { loadPlayers, loadPlayer } from '../lib/players.mjs';

const a = parseArgs();
const ig = h => (h ? `@${h}  https://instagram.com/${h}` : '(no IG on file)');
if (a.winner) {
  const season = await readJson(join(DATA, 'season.json'));
  const sid = a.winner === true ? season.season : a.winner;
  const lb = await readJson(join(DATA, 'leaderboard', `${sid}.json`), null);
  const top = (lb?.players || []).filter(p => p.rank === 1);
  if (!top.length) { console.log(`No players on the ${sid} leaderboard yet.`); process.exit(0); }
  console.log(`${sid} winner${top.length > 1 ? 's (tied)' : ''}:`);
  for (const p of top) console.log(`${p.login}\t${p.total}\t${ig((await loadPlayer(p.login))?.instagram)}`);
} else {
  const ps = await loadPlayers();
  if (!ps.length) console.log('No signed-up players.');
  for (const p of ps) console.log(`${p.login}\t${ig(p.instagram)}\treminders=${p.reminders}`);
}
