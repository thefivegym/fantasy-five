// Scoring engine. Pure functions, no I/O, no dependencies.
import { EVENTS, SLOTS_PER_EVENT, MULTI_MEET_MODE, MAX_PER_TEAM_PER_EVENT } from './config.mjs';

const r3 = x => Math.round(x * 1000) / 1000;

/** Collapse a gymnast's scores on one event for the week into a single slot value. */
export function slotValue(entries, mode = MULTI_MEET_MODE) {
  const vals = (entries || []).map(e => Number(e.score)).filter(Number.isFinite);
  if (!vals.length) return 0;
  if (mode === 'average') return r3(vals.reduce((a, b) => a + b, 0) / vals.length);
  if (mode === 'best') return Math.max(...vals);
  throw new Error(`Unknown MULTI_MEET_MODE: ${mode}`);
}

const EV_LABEL = { vault: 'Vault', bars: 'Bars', beam: 'Beam', floor: 'Floor' };

/** Validation of a lineup object { vault:[ids], bars:[...], beam:[...], floor:[...] }. Returns error strings.
 *  teamOf: optional Map/object id -> team name; enables the per-team-per-event limit. */
export function validateLineup(lineup, gymnastIds, teamOf = null, maxPerTeam = MAX_PER_TEAM_PER_EVENT) {
  const team = id => (teamOf instanceof Map ? teamOf.get(id) : teamOf?.[id]);
  const errs = [];
  if (!lineup || typeof lineup !== 'object') return ['Lineup is missing or not an object.'];
  for (const ev of EVENTS) {
    const ids = lineup[ev];
    if (!Array.isArray(ids)) { errs.push(`${ev}: missing (need ${SLOTS_PER_EVENT} gymnast ids).`); continue; }
    if (ids.length !== SLOTS_PER_EVENT) errs.push(`${ev}: has ${ids.length} picks, needs exactly ${SLOTS_PER_EVENT}.`);
    const seen = new Set();
    for (const id of ids) {
      if (typeof id !== 'string' || !id) { errs.push(`${ev}: pick ${JSON.stringify(id)} is not a gymnast id.`); continue; }
      if (seen.has(id)) errs.push(`${ev}: ${id} is picked twice.`);
      seen.add(id);
      if (gymnastIds && !gymnastIds.has(id)) errs.push(`${ev}: ${id} is not in data/gymnasts.json.`);
    }
    if (teamOf) {
      const byTeam = new Map();
      for (const id of new Set(ids.filter(x => typeof x === 'string'))) { const t = team(id); if (t) byTeam.set(t, [...(byTeam.get(t) || []), id]); }
      for (const [t, list] of byTeam) if (list.length > maxPerTeam)
        errs.push(`${EV_LABEL[ev]}: ${list.length} picks from ${t} (${list.join(', ')}). Max ${maxPerTeam} per team per event.`);
    }
  }
  const extra = Object.keys(lineup).filter(k => !EVENTS.includes(k));
  if (extra.length) errs.push(`Unknown keys in lineup: ${extra.join(', ')}.`);
  return errs;
}

/** Score one lineup against a week's scores file. */
export function scoreLineup(lineup, weekScores, mode = MULTI_MEET_MODE) {
  const per = weekScores?.scores || {};
  const events = {};
  let total = 0;
  for (const ev of EVENTS) {
    const slots = (lineup[ev] || []).map(id => {
      const entries = per[id]?.[ev] || [];
      const score = slotValue(entries, mode);
      return { id, score, meets: entries.map(e => e.meet_id), competed: entries.length > 0 };
    });
    const sub = r3(slots.reduce((a, s) => a + s.score, 0));
    events[ev] = { total: sub, slots };
    total += sub;
  }
  return { total: r3(total), events };
}

/** Rank an array of {login,total}. Ties share a rank (1,2,2,4). */
export function rank(rows, key = 'total') {
  const sorted = [...rows].sort((a, b) => b[key] - a[key] || a.login.localeCompare(b.login));
  let prev = null, prevRank = 0;
  sorted.forEach((r, i) => { r.rank = r[key] === prev ? prevRank : i + 1; prev = r[key]; prevRank = r.rank; });
  return sorted;
}

/** Build the week results object. lineups: { login: lineupFile } */
export function weekResults({ season, week, weekScores, lineups, mode = MULTI_MEET_MODE }) {
  const rows = Object.entries(lineups).map(([login, lf]) => {
    const s = scoreLineup(lf.lineup, weekScores, mode);
    return { login, total: s.total, events: s.events, submitted_at: lf.submitted_at || null };
  });
  return {
    season, week, mode,
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
