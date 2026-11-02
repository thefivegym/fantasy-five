// Scoring engine. Pure functions, no I/O, no dependencies.
import { EVENTS, SLOTS, SLOT_LABEL, MULTI_MEET_MODE, MAX_PER_TEAM_PER_LINEUP, MAX_USES_PER_GYMNAST, LINEUP_SCHEMA } from './config.mjs';

const r3 = x => Math.round(x * 1000) / 1000;

/** Collapse a gymnast's scores for one slot in the week into a single value. */
export function slotValue(entries, mode = MULTI_MEET_MODE) {
  const vals = (entries || []).map(e => Number(e.score)).filter(Number.isFinite);
  if (!vals.length) return 0;
  if (mode === 'average') return r3(vals.reduce((a, b) => a + b, 0) / vals.length);
  if (mode === 'best') return Math.max(...vals);
  throw new Error(`Unknown MULTI_MEET_MODE: ${mode}`);
}

/** AA entries for one gymnast: one per meet where she has all four event scores; total = sum of the four. */
export function deriveAA(perEvent) {
  const byMeet = new Map();
  for (const ev of EVENTS) for (const e of perEvent?.[ev] || []) {
    const m = byMeet.get(e.meet_id) || { meet_id: e.meet_id, date: e.date, ev: {} };
    m.ev[ev] = Math.max(m.ev[ev] ?? -Infinity, Number(e.score));
    byMeet.set(e.meet_id, m);
  }
  return [...byMeet.values()].filter(m => EVENTS.every(ev => Number.isFinite(m.ev[ev])))
    .map(m => ({ score: r3(EVENTS.reduce((a, ev) => a + m.ev[ev], 0)), meet_id: m.meet_id, date: m.date }));
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

/** Score one v2 lineup against a week's scores file. AA uses weekScores.scores[id].aa if present, else derives it. */
export function scoreLineup(lineup, weekScores, mode = MULTI_MEET_MODE) {
  const per = weekScores?.scores || {};
  const slots = {};
  let total = 0;
  for (const s of SLOTS) {
    const id = lineup[s];
    const entries = s === 'aa' ? (per[id]?.aa || deriveAA(per[id])) : (per[id]?.[s] || []);
    const score = slotValue(entries, mode);
    slots[s] = { id, score, meets: entries.map(e => e.meet_id), competed: entries.length > 0 };
    total += score;
  }
  return { total: r3(total), slots };
}

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
