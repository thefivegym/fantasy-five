import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slotValue, deriveAA, scoreLineup, validateLineup, weekResults, seasonLeaderboard, rank } from '../lib/scoring.mjs';
import { SLOTS, MAX_PER_TEAM_PER_LINEUP, MAX_USES_PER_GYMNAST, LINEUP_SCHEMA } from '../lib/config.mjs';
import { extractJson, isLineupIssue, processSubmission } from '../process-lineup.mjs';
import { extractScores, buildIndex, meetsInWindow } from '../fetch-scores-rtn.mjs';

const week = JSON.parse(readFileSync(new URL('./fixtures/week.json', import.meta.url)));
const L = { vault: 'a', bars: 'b', beam: 'c', floor: 'd', aa: 'e' };
const TEAM = { a: 'Oklahoma', b: 'LSU', c: 'Utah', d: 'UCLA', e: 'Florida', f: 'Oklahoma', g: 'Georgia' };
const IDS = new Set(Object.keys(TEAM));

test('constants', () => {
  assert.deepEqual(SLOTS, ['vault', 'bars', 'beam', 'floor', 'aa']);
  assert.equal(MAX_PER_TEAM_PER_LINEUP, 1);
  assert.equal(MAX_USES_PER_GYMNAST, 1);
  assert.equal(LINEUP_SCHEMA, 2);
});

test('best score counts when a gymnast competes twice', () => {
  assert.equal(slotValue(week.scores.a.vault, 'best'), 9.95);
  assert.equal(slotValue(week.scores.c.beam, 'average'), 9.8);
  assert.equal(slotValue([], 'best'), 0);
});

test('AA only from a meet with all four events; best AA total counts', () => {
  // e: meet 1 has all four (9.9+9.85+9.8+9.9 = 39.45); meet 2 has no floor -> not an AA.
  assert.deepEqual(deriveAA(week.scores.e).map(x => [x.meet_id, x.score]), [[1, 39.45]]);
  assert.deepEqual(deriveAA(week.scores.a), []);
  const twoAA = { vault: [{ score: 9.9, meet_id: 1 }, { score: 9.95, meet_id: 2 }], bars: [{ score: 9.9, meet_id: 1 }, { score: 9.9, meet_id: 2 }], beam: [{ score: 9.9, meet_id: 1 }, { score: 9.9, meet_id: 2 }], floor: [{ score: 9.9, meet_id: 1 }, { score: 9.95, meet_id: 2 }] };
  assert.equal(slotValue(deriveAA(twoAA), 'best'), 39.7);
  assert.equal(slotValue(deriveAA(twoAA), 'average'), 39.65);
});

test('lineup total = 4 event scores + 1 AA; DNC = 0', () => {
  const s = scoreLineup(L, week, 'best');
  assert.equal(s.slots.vault.score, 9.95);
  assert.equal(s.slots.bars.score, 9.9);
  assert.equal(s.slots.beam.score, 9.9);
  assert.equal(s.slots.floor.score, 9.75);
  assert.equal(s.slots.aa.score, 39.45);
  assert.equal(s.total, 78.95);
  const dnc = scoreLineup({ ...L, aa: 'a' }, week);      // a never did all four
  assert.equal(dnc.slots.aa.score, 0);
  assert.equal(dnc.slots.aa.competed, false);
  assert.equal(dnc.total, 39.5);
  // a precomputed scores.<id>.aa wins over derivation
  assert.equal(scoreLineup(L, { scores: { ...week.scores, e: { ...week.scores.e, aa: [{ score: 39.5, meet_id: 9 }] } } }).slots.aa.score, 39.5);
});

test('validation: 5 slots, known ids, one slot per gymnast, one per team', () => {
  assert.deepEqual(validateLineup(L, IDS, TEAM), []);
  assert.deepEqual(validateLineup({ ...L, aa: undefined }, IDS, TEAM), ['All-Around: empty. Needs one gymnast.']);
  assert.deepEqual(validateLineup({ ...L, beam: 'zz' }, IDS, TEAM), ['Beam: zz is not in data/gymnasts.json.']);
  assert.deepEqual(validateLineup({ ...L, aa: 'a' }, IDS, TEAM), [
    'a is in 2 slots (Vault, All-Around). A gymnast can fill one slot.',
    '2 picks from Oklahoma (Vault: a, All-Around: a). Max 1 per team per lineup.',
  ]);
  assert.deepEqual(validateLineup({ ...L, floor: 'f' }, IDS, TEAM), ['2 picks from Oklahoma (Vault: a, Floor: f). Max 1 per team per lineup.']);
  assert.deepEqual(validateLineup({ ...L, floor: 'f' }, IDS, TEAM, { maxPerTeam: 2 }), []);   // configurable
  assert.match(validateLineup({ vault: ['a', 'b', 'c', 'd', 'e'], bars: [], beam: [], floor: [] }, IDS, TEAM)[0], /^Old format/);
  assert.deepEqual(validateLineup({ ...L, extra: 'g' }, IDS, TEAM), ['Unknown keys in lineup: extra.']);
});

test('weekly ranks, v1 files skipped, season leaderboard', () => {
  const w1 = weekResults({ season: 't', week: 1, weekScores: week, lineups: {
    x: { schema: 2, lineup: L }, y: { schema: 2, lineup: { ...L, aa: 'a' } }, old: { lineup: { vault: ['a'] } } } });
  assert.deepEqual(w1.players.map(p => [p.login, p.rank]), [['x', 1], ['y', 2]]);
  const lb = seasonLeaderboard('t', [w1, { ...w1, week: 2 }]);
  assert.equal(lb.players[0].total, 157.9);
  assert.deepEqual(rank([{ login: 'p', total: 1 }, { login: 'q', total: 1 }, { login: 'r', total: 0 }]).map(r => r.rank), [1, 1, 3]);
});

test('issue body parsing', () => {
  assert.deepEqual(extractJson('hi\n```json\n{"week":1}\n```\n'), { week: 1 });
  assert.equal(extractJson('no json here'), null);
  assert.ok(isLineupIssue({ title: 'Lineup: 2027 week 1', labels: [] }));
  assert.ok(isLineupIssue({ title: 'x', labels: [{ name: 'lineup' }] }));
  assert.ok(!isLineupIssue({ title: 'Bug report', labels: [] }));
});

test('lineup processor: exact errors against the real roster', async () => {
  const gym = JSON.parse(readFileSync(new URL('../../data/gymnasts.json', import.meta.url))).gymnasts;
  const season = JSON.parse(readFileSync(new URL('../../data/season.json', import.meta.url)));
  const open = season.weeks.find(w => new Date(w.lock) > new Date()) || season.weeks.at(-1);
  const byTeam = {}; for (const g of gym) (byTeam[g.team] ||= []).push(g.id);
  const teams = Object.keys(byTeam).filter(t => byTeam[t].length >= 2).slice(0, 6);
  const good = Object.fromEntries(SLOTS.map((s, i) => [s, byTeam[teams[i]][0]]));
  const ts = new Date(new Date(open.lock).getTime() - 864e5).toISOString();
  const submit = (lineup, schema = 2) => processSubmission({ issue: { body: '```json\n' + JSON.stringify({ schema, season: season.season, week: open.week, lineup }) + '\n```', user: { login: 't' }, number: 1, created_at: ts }, action: 'opened', now: ts });
  const ok = await submit(good);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.record.schema, 2);
  const mate = byTeam[teams[0]][1];
  const bad = await submit({ ...good, aa: mate });
  assert.deepEqual(bad.errors, [`2 picks from ${teams[0]} (Vault: ${good.vault}, All-Around: ${mate}). Max 1 per team per lineup.`]);
  const twice = await submit({ ...good, aa: good.vault });
  assert.equal(twice.errors[0], `${good.vault} is in 2 slots (Vault, All-Around). A gymnast can fill one slot.`);
  const v1 = await submit({ vault: [good.vault], bars: [], beam: [], floor: [] }, undefined);
  assert.match(v1.errors.join(' '), /^Old format/);
  const wrongSchema = await submit(good, 3);
  assert.deepEqual(wrongSchema.errors, ['Lineup schema 3 is not supported. Current schema is 2. Rebuild it in the builder.']);
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

test('DEMO lineups comply and are scored on the new format', () => {
  const r = JSON.parse(readFileSync(new URL('../../data/results/demo/1.json', import.meta.url)));
  assert.equal(r.players.length, 5);
  for (const p of r.players) {
    assert.deepEqual(Object.keys(p.slots), SLOTS);
    const teams = Object.values(p.slots).map(s => s.team);
    assert.equal(new Set(teams).size, 5, `${p.login} repeats a team`);
    assert.equal(new Set(Object.values(p.slots).map(s => s.id)).size, 5);
  }
  assert.ok(r.players.some(p => Object.values(p.slots).some(s => !s.competed)), 'bye-week example has a DNC');
});
