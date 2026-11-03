// Scoring engine. Pure functions, no I/O, no dependencies.
import { EVENTS, SLOTS, SLOT_LABEL, MULTI_MEET_MODE, AA_MIN_EVENTS, AA_SCOPE, MAX_PER_TEAM_PER_LINEUP, MAX_USES_PER_GYMNAST, LINEUP_SCHEMA } from './config.mjs';

const r3 = x => Math.round(x * 1000) / 1000;

/** Collapse a gymnast's scores for one slot in the week into a single value. */
export function slotValue(entries, mode = MULTI_MEET_MODE) {
  const vals = (entries || []).map(e => Number(e.score)).filter(Number.isFinite);
  if (!vals.length) return 0;
  if (mode === 'average') return r3(vals.reduce((a, b) => a + b, 0) / vals.length);
  if (mode === 'best') return Math.max(...vals);
  throw new Error(`Unknown MULTI_MEET_MODE: ${mode}`);
}

/** AA entries for one gymnast, from her per-event scores.
 *  scope 'meet': one entry per meet with at least minEvents events; score = sum of every event she did in that meet.
 *  scope 'week': one entry; score = her best score on each event across the week, added up.
 *  Each entry: {score, meet_id (or meet_ids), date, events:[...]}. */
export function deriveAA(perEvent, { minEvents = AA_MIN_EVENTS, scope = AA_SCOPE } = {}) {
  if (scope === 'week') {
    const ev = EVENTS.filter(e => (perEvent?.[e] || []).some(x => Number.isFinite(Number(x.score))));
    if (!ev.length || ev.length < minEvents) return [];
    const best = e => Math.max(...perEvent[e].map(x => Number(x.score)).filter(Number.isFinite));
    const meet_ids = [...new Set(ev.flatMap(e => perEvent[e].map(x => x.meet_id)))];
    return [{ score: r3(ev.reduce((a, e) => a + best(e), 0)), meet_ids, events: ev }];
  }
  if (scope !== 'meet') throw new Error(`Unknown AA_SCOPE: ${scope}`);
  const byMeet = new Map();
  for (const ev of EVENTS) for (const e of perEvent?.[ev] || []) {
    const sc = Number(e.score); if (!Number.isFinite(sc)) continue;
    const m = byMeet.get(e.meet_id) || { meet_id: e.meet_id, date: e.date, ev: {} };
    m.ev[ev] = Math.max(m.ev[ev] ?? -Infinity, sc);
    byMeet.set(e.meet_id, m);
  }
  return [...byMeet.values()].map(m => ({ m, ev: EVENTS.filter(e => Number.isFinite(m.ev[e])) }))
    .filter(({ ev }) => ev.length >= Math.max(1, minEvents))
    .map(({ m, ev }) => ({ score: r3(ev.reduce((a, e) => a + m.ev[e], 0)), meet_id: m.meet_id, date: m.date, events: ev }));
}

/** Validate a v2 lineup { vault:id, bars:id, beam:id, floor:id, aa:id }. Returns exact error strings.
 *  teamOf: Map/object id -> team name (enables the team limit). */
export function validateLineup(lineup, gymnastIds, teamOf = null, { maxPerTeam = MAX_PER_TEAM_PER_LINEUP, maxUses = MAX_USES_PER_GYMNAST } = {}) {
  const team = id => (teamOf instanceof Map ? teamOf.get(id) : teamOf?.[id]);
  if (!lineup || typeof lineup !== 'object' || Array.isArray(lineup)) return ['Lineup is missing or not an object.'];
  if (EVENTS.some(ev => Array.isArray(lineup[ev])))
    return [`Old format (5 per event, 20 picks). The game is now 5 picks: one each for ${SLOTS.map(s => SLOT_LABEL[s]).join(', ')}. Rebuild it in the builder.`];
  const errs = [];
  for (const s of SLOTS) {
    const id = lineup[s];
    if (id === undefined || id === null || id === '') { errs.push(`${SLOT_LABEL[s]}: empty. Needs one gymnast.`); continue; }
    if (typeof id !== 'string') { errs.push(`${SLOT_LABEL[s]}: ${JSON.stringify(id)} is not a gymnast id.`); continue; }
    if (gymnastIds && !gymnastIds.has(id)) errs.push(`${SLOT_LABEL[s]}: ${id} is not in data/gymnasts.json.`);
  }
  const extra = Object.keys(lineup).filter(k => !SLOTS.includes(k));
  if (extra.length) errs.push(`Unknown keys in lineup: ${extra.join(', ')}.`);
  const filled = SLOTS.filter(s => typeof lineup[s] === 'string' && lineup[s]);
  const uses = new Map();
  for (const s of filled) uses.set(lineup[s], [...(uses.get(lineup[s]) || []), s]);
  for (const [id, slots] of uses) if (slots.length > maxUses)
    errs.push(`${id} is in ${slots.length} slots (${slots.map(s => SLOT_LABEL[s]).join(', ')}). A gymnast can fill ${maxUses === 1 ? 'one slot' : maxUses + ' slots'}.`);
  if (teamOf) {
    const byTeam = new Map();
    for (const s of filled) { const t = team(lineup[s]); if (t) byTeam.set(t, [...(byTeam.get(t) || []), s]); }
    for (const [t, slots] of byTeam) if (slots.length > maxPerTeam)
      errs.push(`${slots.length} picks from ${t} (${slots.map(s => `${SLOT_LABEL[s]}: ${lineup[s]}`).join(', ')}). Max ${maxPerTeam} per team per lineup.`);
  }
  return errs;
}

/** Score one v2 lineup against a week's scores file. AA is always derived from her per-event scores (deriveAA);
 *  a stored scores[id].aa is only used when there are no per-event scores for her. */
export function scoreLineup(lineup, weekScores, mode = MULTI_MEET_MODE) {
  const per = weekScores?.scores || {};
  const slots = {};
  let total = 0;
  for (const s of SLOTS) {
    const id = lineup[s];
    const hasEv = EVENTS.some(e => per[id]?.[e]?.length);
    const entries = s === 'aa' ? (hasEv ? deriveAA(per[id]) : (per[id]?.aa || [])) : (per[id]?.[s] || []);
    const score = slotValue(entries, mode);
    slots[s] = { id, score, meets: entries.flatMap(e => e.meet_ids || [e.meet_id]), competed: entries.length > 0 };
    if (s === 'aa' && entries.length) {   // which events made up the counted AA sum
      const top = mode === 'best' ? entries.reduce((a, b) => (b.score > a.score ? b : a)) : null;
      slots[s].events = top ? top.events : [...new Set(entries.flatMap(e => e.events))];
    }
    total += score;
  }
  return { total: r3(total), slots };
}

/** Split a prize of `cents` evenly across n tied winners, to the cent. Leftover cents go to the first shares:
 *  splitPrize(2500, 3) -> [834, 833, 833]. */
export function splitPrize(cents, n) {
  if (!Number.isInteger(cents) || cents < 0 || !Number.isInteger(n) || n < 1) throw new Error('splitPrize: bad input');
  const base = Math.floor(cents / n), extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
export const usd = cents => `$${(cents / 100).toFixed(2)}`;

/** Rank an array of {login,total}. Ties share a rank (1,2,2,4). */
export function rank(rows, key = 'total') {
  const sorted = [...rows].sort((a, b) => b[key] - a[key] || a.login.localeCompare(b.login));
  let prev = null, prevRank = 0;
  sorted.forEach((r, i) => { r.rank = r[key] === prev ? prevRank : i + 1; prev = r[key]; prevRank = r.rank; });
  return sorted;
}

/** Build the week results object. lineups: { login: lineupFile } (v2 files only; others are skipped). */
export function weekResults({ season, week, weekScores, lineups, mode = MULTI_MEET_MODE }) {
  const rows = Object.entries(lineups).filter(([, lf]) => (lf.schema ?? 1) === LINEUP_SCHEMA).map(([login, lf]) => {
    const s = scoreLineup(lf.lineup, weekScores, mode);
    return { login, total: s.total, slots: s.slots, submitted_at: lf.submitted_at || null };
  });
  return {
    season, week, mode, schema: LINEUP_SCHEMA,
    scores_status: weekScores?.status || 'missing',
    scores_generated_at: weekScores?.generated_at || null,
    players: rank(rows),
  };
}

/** Season leaderboard from an array of week results. */
export function seasonLeaderboard(season, weekResultsList) {
  const by = new Map();
  for (const wr of weekResultsList) {
    for (const p of wr.players) {
      const row = by.get(p.login) || { login: p.login, total: 0, weeks_played: 0, best_week: null, weeks: {} };
      row.total = r3(row.total + p.total);
      row.weeks_played++;
      row.weeks[wr.week] = { total: p.total, rank: p.rank, of: wr.players.length };
      if (!row.best_week || p.total > row.best_week.total) row.best_week = { week: wr.week, total: p.total };
      by.set(p.login, row);
    }
  }
  return { season, weeks: weekResultsList.map(w => w.week), players: rank([...by.values()]) };
}
