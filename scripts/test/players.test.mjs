import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processSignup, signupComment, isSignupIssue } from '../process-signup.mjs';
import { processSubmission } from '../process-lineup.mjs';
import { normalizeInstagram, checkInstagram } from '../lib/instagram.mjs';
import { reminderWeek, isReminderHour, reminderBodies, reminderTitle } from '../remind.mjs';

const issue = payload => ({ number: 7, user: { login: 'TestPlayer' }, title: 'Signup: Fantasy Five player', labels: [], body: `\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` });
const NOW = '2026-11-03T14:00:00Z';
const S = (instagram, reminders = true) => ({ game: 'fantasy-five', type: 'signup', schema: 2, reminders, instagram });

test('Instagram handle: normalize and validate', () => {
  for (const raw of ['@TheFiveThatScore', 'thefivethatscore', ' https://www.instagram.com/TheFiveThatScore/?hl=en ', 'instagram.com/thefivethatscore', 'http://m.instagram.com/thefivethatscore#x', '@@thefivethatscore'])
    assert.equal(normalizeInstagram(raw), 'thefivethatscore', raw);
  assert.deepEqual(checkInstagram('@Jane.Doe_99'), { ok: true, handle: 'jane.doe_99' });
  assert.deepEqual(checkInstagram(''), { ok: false, error: 'Instagram handle is required.' });
  assert.deepEqual(checkInstagram('@'), { ok: false, error: 'Instagram handle is required.' });
  assert.deepEqual(checkInstagram('a'.repeat(31)), { ok: false, error: 'Instagram handle is 31 characters. Max 30.' });
  assert.equal(checkInstagram('a'.repeat(30)).ok, true);
  for (const bad of ['jane doe', 'jane-doe', 'jané', 'jane!']) assert.deepEqual(checkInstagram(bad), { ok: false, error: 'Instagram handles use only letters, digits, . and _.' }, bad);
});

test('sign-up: record {login, instagram, joined_at, reminders}; update; reminders only', async () => {
  const ok = await processSignup({ issue: issue(S('@Jane.Doe')), now: NOW, existing: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.path, 'data/players/testplayer.json');
  assert.deepEqual(ok.record, { login: 'TestPlayer', instagram: 'jane.doe', joined_at: NOW, reminders: true });
  assert.match(signupComment(ok), /^Signed up: @TestPlayer\. IG: @jane\.doe\. Weekly reminders: on\./);
  assert.ok(isSignupIssue({ title: 'Signup: x', labels: [] }) && isSignupIssue({ title: 'x', labels: [{ name: 'signup' }] }));
  const again = await processSignup({ issue: issue(S('instagram.com/jane_2', false)), now: '2026-12-01T00:00:00Z', existing: ok.record });
  assert.deepEqual(again.record, { login: 'TestPlayer', instagram: 'jane_2', joined_at: NOW, reminders: false });
  assert.match(signupComment(again), /^Sign-up updated: @TestPlayer\. IG: @jane_2\. Weekly reminders: off\./);
  const off = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'reminders', schema: 2, reminders: false }), now: NOW, existing: ok.record });
  assert.deepEqual(off.record, { ...ok.record, reminders: false });
  assert.equal(signupComment(off), 'Reminders off for @TestPlayer. Nothing else changed.');
  const offNew = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'reminders', schema: 2, reminders: false }), now: NOW, existing: null });
  assert.match(offNew.errors[0], /^No sign-up on file for @TestPlayer\. Sign up first: /);
});

test('sign-up: rejects bad handles, old email schema, unknown keys', async () => {
  const bad = await processSignup({ issue: issue(S('jane doe')), now: NOW, existing: null });
  assert.deepEqual(bad.errors, ['Instagram handles use only letters, digits, . and _.']);
  const none = await processSignup({ issue: issue(S(undefined)), now: NOW, existing: null });
  assert.deepEqual(none.errors, ['Instagram handle is required.']);
  const v1 = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'signup', schema: 1, reminders: true, email_ciphertext: 'x' }), now: NOW, existing: null });
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join(' '), /Not a current Fantasy Five sign-up/);
  assert.match(v1.errors.join(' '), /Unknown keys: email_ciphertext/);
});

test('lineup from a login with no sign-up is rejected', async () => {
  const res = await processSubmission({ issue: { body: '```json\n{"schema":2,"season":2027,"week":1,"lineup":{}}\n```', user: { login: 'nobody' }, number: 1, created_at: NOW }, action: 'opened', now: NOW, hasPlayer: async () => false });
  assert.deepEqual(res.errors, ['Sign up first: https://thefivegym.github.io/fantasy-five/signup.html. Then submit the lineup again.']);
});

test('reminder: Wednesday 10 AM CT across DST, open week only, batched mentions', () => {
  assert.equal(isReminderHour(Date.parse('2027-01-27T16:00:00Z')), true);    // CST: 16:00 UTC = 10 AM
  assert.equal(isReminderHour(Date.parse('2027-01-27T15:00:00Z')), false);
  assert.equal(isReminderHour(Date.parse('2027-03-17T15:00:00Z')), true);    // CDT: 15:00 UTC = 10 AM
  assert.equal(isReminderHour(Date.parse('2027-03-17T16:00:00Z')), false);
  const season = JSON.parse(readFileSync(new URL('../../data/season.json', import.meta.url)));
  assert.equal(reminderWeek(season, Date.parse('2026-11-04T16:00:00Z')), null);       // offseason
  const w1 = reminderWeek(season, Date.parse('2026-12-30T16:00:00Z'));
  assert.equal(w1.week, 1);
  assert.equal(reminderTitle(season, w1), 'Week 1 lineups lock Fri 5 PM CT');
  assert.equal(reminderWeek(season, Date.parse(season.weeks.at(-1).lock) + 1), null);   // season over
  const logins = Array.from({ length: 120 }, (_, i) => `p${i}`);
  const live = reminderBodies(season, w1, logins);
  assert.equal(live.comments.length, 2);
  assert.equal((live.body.match(/@p\d+/g) || []).length, 50);
  assert.match(live.body, /build\.html/); assert.match(live.body, /Locks Friday, Jan 1, 5:00 PM CT/);
  const dry = reminderBodies(season, w1, logins, { dryRun: true });
  assert.equal((dry.body.match(/@p\d+/g) || []).length, 0);                          // dry run mentions nobody
});

test('winner.mjs: latest scored week, weekly winner with total', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (...a) => execFileSync('node', [new URL('../admin/winner.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' });
  assert.match(run('--season=demo'), /^demo week 1 \(Feb 13–19, 2026\), scores final: winner\nDEMO-chalk\t79\.375\t.*\tgift card \$25\.00 \+ shoutout\n/);
  assert.equal(run('--season=demo', '--week=1'), run('--season=demo', '--winner'));
  assert.match(run('--season=demo', '--standings'), /bragging rights, no prize/);
});

test('weekly prize: ties split the gift card to the cent', async () => {
  const { splitPrize, usd } = await import('../lib/scoring.mjs');
  const { WEEKLY_PRIZE_CENTS } = await import('../lib/config.mjs');
  assert.equal(WEEKLY_PRIZE_CENTS, 2500);
  assert.deepEqual(splitPrize(2500, 1).map(usd), ['$25.00']);
  assert.deepEqual(splitPrize(2500, 2).map(usd), ['$12.50', '$12.50']);
  assert.deepEqual(splitPrize(2500, 3).map(usd), ['$8.34', '$8.33', '$8.33']);
  assert.deepEqual(splitPrize(2500, 4).map(usd), ['$6.25', '$6.25', '$6.25', '$6.25']);
  for (let n = 1; n <= 12; n++) assert.equal(splitPrize(2500, n).reduce((a, b) => a + b), 2500);
  assert.throws(() => splitPrize(2500, 0));
});
