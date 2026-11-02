import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slotValue, scoreLineup, validateLineup, weekResults, seasonLeaderboard, rank } from '../lib/scoring.mjs';
import { extractJson, isLineupIssue } from '../process-lineup.mjs';
import { extractScores, buildIndex, meetsInWindow } from '../fetch-scores-rtn.mjs';

const week = JSON.parse(readFileSync(new URL('./fixtures/week.json', import.meta.url)));
const L = { vault: ['a', 'b', 'd', 'e', 'f'], bars: ['a', 'b', 'c', 'd', 'e'], beam: ['a', 'b', 'c', 'd', 'e'], floor: ['a', 'b', 'c', 'd', 'e'] };

test('best score counts when a gymnast competes twice', () => {
  assert.equal(slotValue(week.scores.a.vault, 'best'), 9.95);
  assert.equal(slotValue(week.scores.c.beam, 'average'), 9.8);
  assert.equal(slotValue([], 'best'), 0);
});

test('lineup total = sum of 20 slots, DNC = 0, no drops', () => {
  const s = scoreLineup(L, week, 'best');
  assert.equal(s.events.vault.total, 39.2);   // 9.95 + 9.8 + 9.75 + 9.7 + 0 (f did not compete)
  assert.equal(s.events.bars.total, 9.9);
  assert.equal(s.events.beam.total, 9.9);
  assert.equal(s.events.floor.total, 9.85);
  assert.equal(s.total, 68.85);
  assert.equal(s.events.vault.slots[4].competed, false);
});

test('validation: 5 unique known ids per event', () => {
  const ids = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(validateLineup(L, ids), []);
  const bad = { ...L, vault: ['a', 'a', 'b', 'c'], floor: ['a', 'b', 'c', 'd', 'zz'] };
  const errs = validateLineup(bad, ids);
  assert.ok(errs.some(e => /vault: has 4 picks/.test(e)));
  assert.ok(errs.some(e => /vault: a is picked twice/.test(e)));
  assert.ok(errs.some(e => /floor: zz is not in/.test(e)));
  assert.ok(validateLineup({ vault: [] }, ids).some(e => /bars: missing/.test(e)));
});

test('weekly ranks and season leaderboard', () => {
  const w1 = weekResults({ season: 't', week: 1, weekScores: week, lineups: { x: { lineup: L }, y: { lineup: { ...L, vault: ['b', 'd', 'e', 'f', 'g'] } } } });
  assert.equal(w1.players[0].login, 'x');
  assert.equal(w1.players[0].rank, 1);
  const lb = seasonLeaderboard('t', [w1, { ...w1, week: 2 }]);
  assert.equal(lb.players[0].total, Math.round(2 * w1.players[0].total * 1000) / 1000);
  assert.equal(lb.players[0].weeks_played, 2);
  assert.deepEqual(rank([{ login: 'p', total: 1 }, { login: 'q', total: 1 }, { login: 'r', total: 0 }]).map(r => r.rank), [1, 1, 3]);
});

test('issue body parsing', () => {
  assert.deepEqual(extractJson('hi\n```json\n{"week":1}\n```\n'), { week: 1 });
  assert.equal(extractJson('no json here'), null);
  assert.ok(isLineupIssue({ title: 'Lineup: 2027 week 1', labels: [] }));
  assert.ok(isLineupIssue({ title: 'x', labels: [{ name: 'lineup' }] }));
  assert.ok(!isLineupIssue({ title: 'Bug report', labels: [] }));
});

test('RTN meet results map to gymnast ids', () => {
  const idx = buildIndex([{ id: 'jane-doe', name: 'Jane Doe', team: 'Utah', rtn_ids: [123] }, { id: 'amy-roe', name: 'Amy Roe', team: 'LSU', rtn_ids: [] }]);
  const r = { teams: [{ tid: 69, tname: 'Utah' }, { tid: 34, tname: 'LSU' }], scores: [[{ team_id: 69, gid: 123, first_name: 'Jane', last_name: 'Doe', vault: '9.900', bars: '0.000' }], [{ team_id: 34, first_name: 'Amy', last_name: 'Roe', beam: '9.850' }, { team_id: 34, first_name: 'Not', last_name: 'Listed', floor: '9.5' }]] };
  const into = {}, un = [];
  extractScores(r, { meet_id: 7, date: '2026-02-13' }, idx, into, un);
  assert.deepEqual(into['jane-doe'], { vault: [{ score: 9.9, meet_id: 7, date: '2026-02-13' }] });
  assert.equal(into['amy-roe'].beam[0].score, 9.85);
  assert.equal(un.length, 1);
  const sched = { '2026-02-13': { meets: [{ meet_id: 1, home_teams: 'Utah', away_teams: 'BYU', time: '21:00:00' }, { meet_id: 2, home_teams: 'Cortland State', away_teams: 'Ithaca College' }] } };
  assert.deepEqual(meetsInWindow(sched, '2026-02-13', '2026-02-19', new Set(['Utah'])).map(m => m.meet_id), [1]);
});

test('max one gymnast per team per event; same team fine across events', async () => {
  const { MAX_PER_TEAM_PER_EVENT } = await import('../lib/config.mjs');
  assert.equal(MAX_PER_TEAM_PER_EVENT, 1);
  const team = { a: 'Oklahoma', b: 'Oklahoma', c: 'LSU', d: 'Utah', e: 'UCLA', f: 'Florida', g: 'Georgia' };
  const ids = new Set(Object.keys(team));
  const ok = { vault: ['a', 'c', 'd', 'e', 'f'], bars: ['b', 'c', 'd', 'e', 'f'], beam: ['a', 'c', 'd', 'e', 'g'], floor: ['b', 'c', 'd', 'f', 'g'] };
  assert.deepEqual(validateLineup(ok, ids, team), []);
  const bad = { ...ok, beam: ['a', 'b', 'c', 'd', 'e'] };
  assert.deepEqual(validateLineup(bad, ids, team), ['Beam: 2 picks from Oklahoma (a, b). Max 1 per team per event.']);
  assert.deepEqual(validateLineup(bad, ids, new Map(Object.entries(team))), ['Beam: 2 picks from Oklahoma (a, b). Max 1 per team per event.']);
  assert.deepEqual(validateLineup(bad, ids, team, 2), []);          // constant is configurable
  assert.deepEqual(validateLineup(bad, ids), []);                    // no team map -> rule not applied
});

test('lineup processor rejects a same-team event with the exact error', async () => {
  const { processSubmission } = await import('../process-lineup.mjs');
  const { readFileSync } = await import('node:fs');
  const gym = JSON.parse(readFileSync(new URL('../../data/gymnasts.json', import.meta.url))).gymnasts;
  const season = JSON.parse(readFileSync(new URL('../../data/season.json', import.meta.url)));
  const open = season.weeks.find(w => new Date(w.lock) > new Date()) || season.weeks.at(-1);
  // 5 teams with >= 2 gymnasts; take the first gymnast of each, plus a second from team 0
  const byTeam = {}; for (const g of gym) (byTeam[g.team] ||= []).push(g.id);
  const teams = Object.keys(byTeam).filter(t => byTeam[t].length >= 2).slice(0, 5);
  const five = teams.map(t => byTeam[t][0]);
  const lineup = { vault: five, bars: five, beam: five, floor: [...five.slice(0, 4), byTeam[teams[0]][1]] };
  const body = '```json\n' + JSON.stringify({ season: season.season, week: open.week, lineup }) + '\n```';
  const ts = new Date(new Date(open.lock).getTime() - 864e5).toISOString();
  const res = await processSubmission({ issue: { body, user: { login: 't' }, number: 1, created_at: ts }, action: 'opened', now: ts });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors, [`Floor: 2 picks from ${teams[0]} (${byTeam[teams[0]][0]}, ${byTeam[teams[0]][1]}). Max 1 per team per event.`]);
  const sixth = Object.keys(byTeam).find(t => !teams.includes(t));
  const okLineup = { ...lineup, floor: [...five.slice(0, 4), byTeam[sixth][0]] };
  const okBody = '```json\n' + JSON.stringify({ season: season.season, week: open.week, lineup: okLineup }) + '\n```';
  const good = await processSubmission({ issue: { body: okBody, user: { login: 't' }, number: 1, created_at: ts }, action: 'opened', now: ts });
  assert.deepEqual(good.errors, []);
  assert.equal(good.ok, true);
});
