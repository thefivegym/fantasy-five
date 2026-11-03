import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto, createPrivateKey } from 'node:crypto';
import { processSignup, signupComment, isSignupIssue } from '../process-signup.mjs';
import { processSubmission } from '../process-lineup.mjs';
import { decryptEmail, KEY_PATH } from '../admin/decrypt-emails.mjs';
import { reminderWeek, isReminderHour, reminderBodies, reminderTitle } from '../remind.mjs';

const KEY = JSON.parse(readFileSync(new URL('../../assets/email-public-key.json', import.meta.url)));
const EMAIL = 'ff5-test-player@example.com';
async function encrypt(email) {   // exactly what signup.html does in the browser
  const pub = await webcrypto.subtle.importKey('jwk', KEY.jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  return Buffer.from(await webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, new TextEncoder().encode(JSON.stringify({ v: 1, email })))).toString('base64');
}
const issue = (payload, extra = '') => ({ number: 7, user: { login: 'TestPlayer' }, title: 'Signup: Fantasy Five player', labels: [], body: `${extra}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`` });
const NOW = '2026-11-03T14:00:00Z';

test('sign-up: shape checks, record, comment never echoes the email', async () => {
  const ct = await encrypt(EMAIL);
  assert.equal(Buffer.from(ct, 'base64').length, 384);
  const ok = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'signup', schema: 1, reminders: true, key_id: KEY.key_id, email_ciphertext: ct }), now: NOW, existing: null, keyId: KEY.key_id });
  assert.equal(ok.ok, true);
  assert.equal(ok.path, 'data/players/testplayer.json');
  assert.deepEqual(Object.keys(ok.record).sort(), ['email_ciphertext', 'issue', 'joined_at', 'key_id', 'login', 'reminders', 'updated_at']);
  assert.ok(!JSON.stringify(ok.record).includes(EMAIL));
  const c = signupComment(ok);
  assert.match(c, /^Signed up: @TestPlayer\. Weekly reminders: on\./);
  assert.ok(!c.includes(EMAIL) && !c.includes(ct.slice(0, 20)));
  assert.ok(isSignupIssue({ title: 'Signup: x', labels: [] }) && isSignupIssue({ title: 'x', labels: [{ name: 'signup' }] }));
  // re-sign-up keeps joined_at
  const again = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'signup', schema: 1, reminders: false, key_id: KEY.key_id, email_ciphertext: ct }), now: '2026-12-01T00:00:00Z', existing: ok.record, keyId: KEY.key_id });
  assert.equal(again.record.joined_at, NOW); assert.equal(again.record.reminders, false); assert.match(signupComment(again), /^Sign-up updated/);
  // opt-out without email
  const off = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'reminders', schema: 1, reminders: false }), now: NOW, existing: ok.record, keyId: KEY.key_id });
  assert.equal(off.record.reminders, false); assert.equal(off.record.email_ciphertext, ct); assert.equal(signupComment(off), 'Reminders off for @TestPlayer. Nothing else changed.');
  const offNew = await processSignup({ issue: issue({ game: 'fantasy-five', type: 'reminders', schema: 1, reminders: false }), now: NOW, existing: null, keyId: KEY.key_id });
  assert.match(offNew.errors[0], /^No sign-up on file for @TestPlayer\. Sign up first: /);
});

test('sign-up: rejects plaintext email, wrong key, bad ciphertext', async () => {
  const ct = await encrypt(EMAIL);
  const base = { game: 'fantasy-five', type: 'signup', schema: 1, reminders: true, key_id: KEY.key_id, email_ciphertext: ct };
  const plain = await processSignup({ issue: issue(base, `my email is ${EMAIL}`), now: NOW, existing: null, keyId: KEY.key_id });
  assert.equal(plain.ok, false); assert.match(plain.errors[0], /looks like a plain email/);
  assert.ok(!signupComment(plain).includes(EMAIL));
  const raw = await processSignup({ issue: issue({ ...base, email_ciphertext: EMAIL }), now: NOW, existing: null, keyId: KEY.key_id });
  assert.equal(raw.ok, false);
  const short = await processSignup({ issue: issue({ ...base, email_ciphertext: 'AAAA' }), now: NOW, existing: null, keyId: KEY.key_id });
  assert.deepEqual(short.errors, ['Encrypted email is missing or the wrong size. Use the sign-up page; it encrypts the email for you.']);
  const old = await processSignup({ issue: issue({ ...base, key_id: 'ff5-email-old' }), now: NOW, existing: null, keyId: KEY.key_id });
  assert.match(old.errors[0], /old or unknown key/);
});

test('organizer decrypt script reads a browser-encrypted sign-up', { skip: !existsSync(KEY_PATH) && 'private key not on this machine' }, async () => {
  const rec = { login: 'TestPlayer', email_ciphertext: await encrypt(EMAIL) };
  assert.equal(decryptEmail(rec, createPrivateKey(readFileSync(KEY_PATH))), EMAIL);
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
