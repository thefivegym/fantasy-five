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
