#!/usr/bin/env node
// Recomputes data/results/<season>/<week>.json and data/leaderboard/<season>.json from
// data/scores/<season>/<week>.json and data/lineups/<season>/<week>/*.json.
// Usage: node scripts/score.mjs [--season=2027]   (also: --season=demo)
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, readJson, writeJson, parseArgs, loadSeason } from './lib/io.mjs';
import { weekResults, seasonLeaderboard } from './lib/scoring.mjs';
import { MULTI_MEET_MODE } from './lib/config.mjs';

const args = parseArgs();

export async function loadLineups(season, week) {
  const dir = join(DATA, 'lineups', String(season), String(week));
  let files = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.json')); } catch { return {}; }
  const out = {};
  for (const f of files) {
    const lf = await readJson(join(dir, f));
    if (lf.test) continue;               // test submissions are kept out of results
    out[lf.login] = lf;
  }
  return out;
}

export async function scoreSeason(seasonId) {
  const season = await loadSeason(seasonId);
  const sid = String(season.season);
  const list = [];
  const roster = await readJson(join(DATA, '..', season.roster || 'data/gymnasts.json'));
  const byId = Object.fromEntries(roster.gymnasts.map(g => [g.id, g]));
  for (const w of season.weeks) {
    const weekScores = await readJson(join(DATA, 'scores', sid, `${w.week}.json`), null);
    if (!weekScores) continue;                       // week not played / not imported yet
    const lineups = await loadLineups(sid, w.week);
    const res = weekResults({ season: season.season, week: w.week, weekScores, lineups, mode: MULTI_MEET_MODE });
    for (const p of res.players) for (const sl of Object.values(p.slots)) {
      const g = byId[sl.id]; sl.name = g?.name || sl.id; sl.team = g?.team || null;
    }
    res.demo = season.demo === true;
    res.label = w.label || `Week ${w.week}`;
    res.generated_at = new Date().toISOString();
    await writeJson(join(DATA, 'results', sid, `${w.week}.json`), res);
    console.log(`${sid} week ${w.week}: ${res.players.length} lineups, scores ${res.scores_status}`);
    list.push(res);
  }
  const lb = seasonLeaderboard(season.season, list);
  lb.demo = season.demo === true;
  lb.generated_at = new Date().toISOString();
  await writeJson(join(DATA, 'leaderboard', `${sid}.json`), lb);
  console.log(`${sid} leaderboard: ${lb.players.length} players over ${lb.weeks.length} scored week(s)`);
  return lb;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const main = await readJson(join(DATA, 'season.json'));
  const seasons = args.season ? [args.season] : [main.season, ...(main.demo ? [main.demo.season] : [])];
  for (const s of seasons) await scoreSeason(s);
}
