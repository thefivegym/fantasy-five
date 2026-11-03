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

test('AA = sum of every event she did in one meet: 1, 2 or 4 events; best meet counts; no mixing across meets', () => {
  // d: one event (FX 9.75) -> AA 9.75
  assert.deepEqual(deriveAA(week.scores.d).map(x => [x.meet_id, x.score, x.events]), [[1, 9.75, ['floor']]]);
  // b: two events in one meet (VT 9.8 + UB 9.9) -> 19.7
  assert.deepEqual(deriveAA(week.scores.b).map(x => [x.meet_id, x.score, x.events]), [[1, 19.7, ['vault', 'bars']]]);
  // e: meet 1 all four (9.9+9.85+9.8+9.9 = 39.45); meet 2 three events (9.85+9.9+9.95 = 29.7)
  assert.deepEqual(deriveAA(week.scores.e).map(x => [x.meet_id, x.score]), [[1, 39.45], [2, 29.7]]);
  assert.equal(slotValue(deriveAA(week.scores.e), 'best'), 39.45);
  assert.equal(slotValue(deriveAA(week.scores.e), 'average'), 34.575);
  // a: meet 1 VT 9.9 + FX 9.85 = 19.75; meet 2 VT 9.95 alone. Best meet = 19.75, NOT 9.95 + 9.85 = 19.8 (mixed).
  assert.deepEqual(deriveAA(week.scores.a).map(x => [x.meet_id, x.score]), [[1, 19.75], [2, 9.95]]);
  assert.equal(slotValue(deriveAA(week.scores.a), 'best'), 19.75);
  // config options: AA_MIN_EVENTS = 4 restores the all-four rule; AA_SCOPE = 'week' mixes meets
  assert.deepEqual(deriveAA(week.scores.e, { minEvents: 4 }).map(x => x.score), [39.45]);
  assert.deepEqual(deriveAA(week.scores.a, { minEvents: 4 }), []);
  assert.deepEqual(deriveAA(week.scores.a, { scope: 'week' }).map(x => x.score), [19.8]);
  assert.deepEqual(deriveAA({}), []);
});

test('lineup total = 4 event scores + 1 AA meet sum; DNC = 0', () => {
  const s = scoreLineup(L, week, 'best');
  assert.equal(s.slots.vault.score, 9.95);
  assert.equal(s.slots.bars.score, 9.9);
  assert.equal(s.slots.beam.score, 9.9);
  assert.equal(s.slots.floor.score, 9.75);
  assert.equal(s.slots.aa.score, 39.45);
  assert.deepEqual(s.slots.aa.events, ['vault', 'bars', 'beam', 'floor']);
  assert.equal(s.total, 78.95);
  const spec = scoreLineup({ ...L, aa: 'a' }, week);     // two-event specialist: VT + FX in meet 1
  assert.equal(spec.slots.aa.score, 19.75);
  assert.deepEqual(spec.slots.aa.events, ['vault', 'floor']);
  assert.equal(spec.total, 59.25);
  const dnc = scoreLineup({ ...L, aa: 'zz' }, week);     // didn't compete
  assert.equal(dnc.slots.aa.score, 0);
  assert.equal(dnc.slots.aa.competed, false);
  assert.equal(dnc.total, 39.5);
  // per-event scores win over a stale stored aa; stored aa is used only when there are no event scores
  assert.equal(scoreLineup(L, { scores: { ...week.scores, e: { ...week.scores.e, aa: [{ score: 39.5, meet_id: 9 }] } } }).slots.aa.score, 39.45);
  assert.equal(scoreLineup(L, { scores: { ...week.scores, e: { aa: [{ score: 39.5, meet_id: 9 }] } } }).slots.aa.score, 39.5);
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

test('roster AA projection = sum of her 2026 event NQS (avg where no NQS), never invented', () => {
  for (const f of ['../../data/gymnasts.json', '../../data/demo/gymnasts-2026.json']) {
    const gym = JSON.parse(readFileSync(new URL(f, import.meta.url))).gymnasts;
    let n = 0;
    for (const g of gym) {
      if (!g.rtn_ids?.length) { assert.equal(g.aa_proj ?? null, null, `${g.id}: NEW gymnast has an AA projection`); continue; }
      if (!g.aa_proj) continue;
      n++;
      let sum = 0;
      for (const e of g.aa_proj.events) {
        if (g.aa_proj.basis[e] === 'nqs') { assert.ok(g.proj?.[e]?.nqs != null, `${g.id} ${e}`); sum += g.proj[e].nqs; }
        else assert.equal(g.proj?.[e]?.nqs ?? null, null, `${g.id} ${e}: used avg though an NQS exists`);
      }
      if (Object.values(g.aa_proj.basis).every(b => b === 'nqs')) assert.equal(Math.round(sum * 1000) / 1000, g.aa_proj.score, g.id);
    }
    assert.ok(n > 600, `${f}: only ${n} AA projections`);
  }
});

test('new lineup every week: nothing carries over, no lineup = no entry', async () => {
  const { loadLineups } = await import('../score.mjs');
  assert.equal(Object.keys(await loadLineups('demo', 1)).length, 5);
  assert.deepEqual(await loadLineups('demo', 2), {});          // DEMO week 1 lineups never count for week 2
  // x plays weeks 1 and 2, y only week 1: y has no week-2 entry and her season total is week 1 alone.
  const w1 = weekResults({ season: 't', week: 1, weekScores: week, lineups: { x: { schema: 2, lineup: L }, y: { schema: 2, lineup: L } } });
  const w2 = weekResults({ season: 't', week: 2, weekScores: week, lineups: { x: { schema: 2, lineup: L } } });
  assert.deepEqual(w2.players.map(p => p.login), ['x']);
  const lb = seasonLeaderboard('t', [w1, w2]);
  const y = lb.players.find(p => p.login === 'y'), x = lb.players.find(p => p.login === 'x');
  assert.equal(y.total, 78.95); assert.equal(y.weeks_played, 1); assert.deepEqual(Object.keys(y.weeks), ['1']);
  assert.equal(x.total, 157.9);
});

test('submissions only for the open week', async () => {
  const gym = JSON.parse(readFileSync(new URL('../../data/gymnasts.json', import.meta.url))).gymnasts;
  const season = JSON.parse(readFileSync(new URL('../../data/season.json', import.meta.url)));
  const byTeam = {}; for (const g of gym) (byTeam[g.team] ||= []).push(g.id);
  const lineup = Object.fromEntries(SLOTS.map((s, i) => [s, byTeam[Object.keys(byTeam)[i]][0]]));
  const [w1, w2, w3] = season.weeks;
  const at = new Date(new Date(w2.lock).getTime() - 864e5).toISOString();   // week 2 is open
  const submit = wk => processSubmission({ issue: { body: '```json\n' + JSON.stringify({ schema: 2, season: season.season, week: wk, lineup }) + '\n```', user: { login: 't' }, number: 1, created_at: at }, action: 'opened', now: at });
  assert.deepEqual((await submit(w2.week)).errors, []);
  assert.match((await submit(w1.week)).errors[0], new RegExp(`^Week ${w1.week} locked at `));
  assert.match((await submit(w3.week)).errors[0], new RegExp(`^Week ${w3.week} is not open yet. The open week is ${w2.week} `));
});
