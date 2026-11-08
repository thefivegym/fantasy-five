#!/usr/bin/env node
// Weekly winner(s) and their Instagram handles, for the organizer to send the prize and the story shoutout.
// Prize: top weekly total wins the $25 gift card + story shoutout. Ties for the top score: the gift card is split
// evenly to the cent (e.g. 2-way = $12.50 each, 3-way = $8.34/$8.33/$8.33); every tied player gets the shoutout.
// Usage:
//   node scripts/admin/winner.mjs                     latest scored week's winner(s) (same as --winner)
//   node scripts/admin/winner.mjs --week=3            week 3's winner(s)
//   node scripts/admin/winner.mjs --season=demo       pick the season (default: data/season.json season)
//   node scripts/admin/winner.mjs --standings         season standings (bragging rights, no prize)
//   node scripts/admin/winner.mjs --players           every signed-up player: login, IG, reminders
//   node scripts/admin/winner.mjs --players --since=YYYY-MM-DD   only players who joined at or after that UTC time
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, readJson, parseArgs } from '../lib/io.mjs';
import { loadPlayers, loadPlayer, playersJoinedSince } from '../lib/players.mjs';
import { WEEKLY_PRIZE_CENTS } from '../lib/config.mjs';
import { splitPrize, usd } from '../lib/scoring.mjs';

const a = parseArgs();
const ig = h => (h ? `@${h}  https://instagram.com/${h}` : '(no IG on file)');
const main = await readJson(join(DATA, 'season.json'));
const sid = String(a.season && a.season !== true ? a.season : main.season);

export async function scoredWeeks(sid) {
  try { return (await readdir(join(DATA, 'results', sid))).filter(f => /^\d+\.json$/.test(f)).map(f => Number(f.slice(0, -5))).sort((x, y) => x - y); }
  catch { return []; }
}

if (a.players) {
  let ps;
  try { ps = playersJoinedSince(await loadPlayers(), a.since); }
  catch (e) { console.error(e.message); process.exit(1); }
  if (!ps.length) console.log('No signed-up players.');
  for (const p of ps) console.log(`${p.login}\t${ig(p.instagram)}\treminders=${p.reminders}`);
} else if (a.standings) {
  const lb = await readJson(join(DATA, 'leaderboard', `${sid}.json`), null);
  if (!lb?.players?.length) { console.log(`No standings for ${sid} yet.`); process.exit(0); }
  console.log(`${sid} season standings (bragging rights, no prize), ${lb.weeks.length} scored week(s):`);
  for (const p of lb.players) console.log(`${p.rank}\t${p.login}\t${p.total}\t${ig((await loadPlayer(p.login))?.instagram)}`);
} else {
  const weeks = await scoredWeeks(sid);
  const wk = a.week && a.week !== true ? Number(a.week) : weeks.at(-1);
  if (wk == null) { console.log(`No scored weeks in ${sid} yet.`); process.exit(0); }
  const r = await readJson(join(DATA, 'results', sid, `${wk}.json`), null);
  if (!r) { console.log(`Week ${wk} of ${sid} is not scored. Scored weeks: ${weeks.join(', ') || 'none'}.`); process.exit(1); }
  const top = r.players.filter(p => p.rank === 1);
  if (!top.length) { console.log(`${sid} week ${wk}: no lineups.`); process.exit(0); }
  const label = (main.season === Number(sid) ? main : await readJson(join(DATA, 'demo', 'season.json'), main)).weeks?.find(w => w.week === wk)?.label;
  console.log(`${sid} week ${wk}${label ? ` (${label})` : ''}, scores ${r.scores_status}: ${top.length > 1 ? `${top.length}-way tie, ${usd(WEEKLY_PRIZE_CENTS)} gift card split evenly, every tied player gets the shoutout` : 'winner'}`);
  const shares = splitPrize(WEEKLY_PRIZE_CENTS, top.length);
  for (const [i, p] of top.entries()) console.log(`${p.login}\t${p.total}\t${ig((await loadPlayer(p.login))?.instagram)}\tgift card ${usd(shares[i])} + shoutout`);
  if (sid === 'demo') console.log('DEMO season: no real prize. Shares shown for illustration.');
  if (r.scores_status !== 'final') console.log('Scores are not final yet. Check again before sending the prize.');
}
