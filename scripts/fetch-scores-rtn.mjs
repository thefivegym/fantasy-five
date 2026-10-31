#!/usr/bin/env node
// Weekly score fetcher: Road to Nationals -> data/scores/<season>/<week>.json
//
// Usage: node scripts/fetch-scores-rtn.mjs --season=2027 --week=3
//        node scripts/fetch-scores-rtn.mjs --season=2027 --auto      (every week whose window has started
//                                                                    and whose scores are not final yet)
// Sources (public JSON behind roadtonationals.com):
//   GET /api/women/schedule/<year>/1      season schedule (meet ids, dates, teams)
//   GET /api/women/meetresults/<meet_id>  per-gymnast event scores
// RTN robots.txt asks for Crawl-delay: 30, so requests are spaced >= 30 s (RTN_DELAY_MS to override locally).
import { join } from 'node:path';
import { DATA, readJson, writeJson, parseArgs, loadSeason } from './lib/io.mjs';
import { EVENTS } from './lib/config.mjs';
import { norm } from './lib/names.mjs';

const RTN = 'https://www.roadtonationals.com/api/women';
const UA = 'Mozilla/5.0 (compatible; TheFiveThatScore-FantasyFive/1.0; +https://x.com/thefivethatscore)';
const DELAY = Number(process.env.RTN_DELAY_MS ?? 30000);
const args = parseArgs();
let last = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function rtn(path) {
  const wait = last + DELAY - Date.now();
  if (last && wait > 0) await sleep(wait);
  last = Date.now();
  const url = RTN + path;
  console.log('GET', url);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}
const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
const splitTeams = s => decode(s).split(',').map(t => t.trim()).filter(Boolean);
const num = v => (v === null || v === undefined || v === '' || Number(v) === 0 ? null : Number(v));

export function meetsInWindow(sched, start, end, d1Names) {
  const out = [];
  for (const [date, day] of Object.entries(sched || {})) {
    for (const m of day.meets || []) {
      const d = m.d || date;
      if (d < start || d > end) continue;
      const teams = [...splitTeams(m.home_teams), ...splitTeams(m.away_teams)];
      if (!teams.some(t => d1Names.has(t))) continue;
      out.push({ meet_id: m.meet_id, date: d, time_et: m.time || null, teams, desc: decode(m.meet_desc || m.newdesc) || null,
        url: `https://www.roadtonationals.com/results/schedule/women/meet/${m.meet_id}` });
    }
  }
  return out.sort((a, b) => (a.date + a.time_et).localeCompare(b.date + b.time_et));
}

/** Map one RTN meetresults payload into score entries keyed by our gymnast id. */
export function extractScores(r, meet, index, into, unmatched) {
  const teamName = tid => decode((r.teams || []).find(t => Number(t.tid) === Number(tid))?.tname);
  for (const roster of r.scores || []) {
    for (const g of roster || []) {
      const name = decode(`${g.first_name} ${g.last_name}`);
      const team = teamName(g.team_id) || null;
      const id = index.byRtn.get(String(g.gid ?? g.gymnast_id ?? '')) || index.byNameTeam.get(norm(name) + '|' + norm(team)) || index.byName.get(norm(name));
      for (const ev of EVENTS) {
        const s = num(g[ev]);
        if (s === null) continue;
        if (!id) { unmatched.push({ name, team, event: ev, score: s, meet_id: meet.meet_id }); continue; }
        ((into[id] ||= {})[ev] ||= []).push({ score: s, meet_id: meet.meet_id, date: meet.date });
      }
    }
  }
}

export function buildIndex(gymnasts) {
  const byRtn = new Map(), byNameTeam = new Map(), nameCount = new Map(), byName = new Map();
  for (const g of gymnasts) {
    for (const rid of g.rtn_ids || []) byRtn.set(String(rid), g.id);
    byNameTeam.set(norm(g.name) + '|' + norm(g.team), g.id);
    nameCount.set(norm(g.name), (nameCount.get(norm(g.name)) || 0) + 1);
  }
  for (const g of gymnasts) if (nameCount.get(norm(g.name)) === 1) byName.set(norm(g.name), g.id);
  return { byRtn, byNameTeam, byName };
}

async function fetchWeek(season, week, ctx) {
  const meets = meetsInWindow(ctx.sched, week.start, week.end, ctx.d1);
  const scores = {}, unmatched = [], missing = [];
  let anyLive = false;
  for (const m of meets) {
    try {
      const r = await rtn(`/meetresults/${m.meet_id}`);
      if (!r?.scores?.length) { missing.push(m.meet_id); continue; }
      if (r.info?.live) anyLive = true;
      extractScores(r, m, ctx.index, scores, unmatched);
    } catch (e) { console.log('  ', e.message); missing.push(m.meet_id); }
  }
  const ended = new Date(`${week.end}T23:59:59-06:00`).getTime() < Date.now();
  const out = {
    season: season.season, week: week.week, demo: !!season.demo,
    source: 'Road to Nationals (roadtonationals.com) /api/women/meetresults',
    generated_at: new Date().toISOString(),
    status: ended && !anyLive && !missing.length ? 'final' : 'partial',
    window: { start: week.start, end: week.end },
    meets, meets_without_results: missing,
    scores,
    unmatched,
  };
  await writeJson(join(DATA, 'scores', String(season.season), `${week.week}.json`), out);
  console.log(`week ${week.week}: ${meets.length} meets, ${Object.keys(scores).length} gymnasts scored, ${unmatched.length} unmatched entries, status ${out.status}`);
}

async function main() {
  const season = await loadSeason(args.season || (await readJson(join(DATA, 'season.json'))).season);
  const rtnYear = season.rtn_season || season.season;
  const teams = (await readJson(join(DATA, 'teams.json'))).teams;
  const gymnasts = (await readJson(join(DATA, '..', season.roster || 'data/gymnasts.json'))).gymnasts;
  let weeks;
  if (args.week) weeks = season.weeks.filter(w => String(w.week) === String(args.week));
  else if (args.auto) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    weeks = [];
    for (const w of season.weeks) {
      if (w.start > today) continue;
      const existing = await readJson(join(DATA, 'scores', String(season.season), `${w.week}.json`), null);
      if (existing?.status !== 'final') weeks.push(w);
    }
  } else throw new Error('Pass --week=N or --auto');
  if (!weeks.length) { console.log('Nothing to fetch.'); return; }
  const sched = await rtn(`/schedule/${rtnYear}/1`);
  const keys = Object.keys(sched || {}).filter(k => /^\d{4}-/.test(k));
  if (!keys.some(k => k.startsWith(String(rtnYear)))) { console.log(`RTN has not published the ${rtnYear} schedule yet.`); return; }
  const ctx = { sched, d1: new Set(teams.map(t => t.rtn_name || t.name)), index: buildIndex(gymnasts) };
  for (const w of weeks) await fetchWeek(season, w, ctx);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
