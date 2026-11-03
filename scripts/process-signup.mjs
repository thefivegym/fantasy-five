#!/usr/bin/env node
// Processes a sign-up (or reminder opt-in/opt-out) submitted as a GitHub issue from signup.html.
// The email arrives already encrypted in the browser (RSA-OAEP-256, assets/email-public-key.json). This script never
// sees the plaintext and cannot decrypt it: the private key is not in the repo or in Actions. It checks the shape,
// stores data/players/<login>.json, and writes a comment that never contains the email or the ciphertext.
// Issue body JSON:
//   sign up / update: {"game":"fantasy-five","type":"signup","schema":1,"reminders":true,"key_id":"…","email_ciphertext":"<base64>"}
//   reminders only:   {"game":"fantasy-five","type":"reminders","schema":1,"reminders":false}
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, readJson, writeJson } from './lib/io.mjs';
import { SIGNUP_LABEL, SIGNUP_TITLE_PREFIX, SIGNUP_URL, EMAIL_CIPHERTEXT_BYTES, SITE } from './lib/config.mjs';
import { loadPlayer, playerPath } from './lib/players.mjs';
import { extractJson } from './process-lineup.mjs';

const EVENT_PATH = process.env.GITHUB_EVENT_PATH || process.argv[2];
const COMMENT_FILE = process.env.COMMENT_FILE || 'signup-comment.md';

export function isSignupIssue(issue) {
  return (issue.labels || []).some(l => (l.name || l) === SIGNUP_LABEL) || (issue.title || '').startsWith(SIGNUP_TITLE_PREFIX);
}

/** Never let something that looks like a plaintext email through, anywhere in the body. */
const looksLikeEmail = s => /[^\s@<>()"'`]+@[^\s@<>()"'`]+\.[a-z]{2,}/i.test(s || '');

export async function processSignup({ issue, now, existing, keyId }) {
  const login = issue.user.login;
  const data = extractJson(issue.body);
  const errors = [];
  if (looksLikeEmail(issue.body) || looksLikeEmail(issue.title))
    errors.push('The issue contains what looks like a plain email address. Close this issue, then sign up from the sign-up page, which encrypts it.');
  if (!data) return { ok: false, login, errors: [...errors, `No sign-up JSON found. Use ${SIGNUP_URL}.`] };
  if (data.game !== 'fantasy-five' || Number(data.schema) !== 1) errors.push('Not a Fantasy Five sign-up (game/schema). Use the sign-up page.');
  if (typeof data.reminders !== 'boolean') errors.push('reminders must be true or false.');
  const extra = Object.keys(data).filter(k => !['game', 'type', 'schema', 'reminders', 'key_id', 'email_ciphertext'].includes(k));
  if (extra.length) errors.push(`Unknown keys: ${extra.join(', ')}.`);
  let rec;
  if (data.type === 'signup') {
    if (data.key_id !== keyId) errors.push(`Encrypted with an old or unknown key (${JSON.stringify(data.key_id)}). Reload the sign-up page and submit again.`);
    const ct = typeof data.email_ciphertext === 'string' ? data.email_ciphertext : '';
    let bytes = 0;
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(ct)) bytes = Buffer.from(ct, 'base64').length;
    if (bytes !== EMAIL_CIPHERTEXT_BYTES) errors.push('Encrypted email is missing or the wrong size. Use the sign-up page; it encrypts the email for you.');
    if (errors.length) return { ok: false, login, errors };
    rec = { login, joined_at: existing?.joined_at || now, updated_at: now, reminders: data.reminders, key_id: data.key_id, email_ciphertext: ct, issue: issue.number };
  } else if (data.type === 'reminders') {
    if (!existing) errors.push(`No sign-up on file for @${login}. Sign up first: ${SIGNUP_URL}.`);
    if (data.email_ciphertext !== undefined) errors.push('A reminders change takes no email.');
    if (errors.length) return { ok: false, login, errors };
    rec = { ...existing, updated_at: now, reminders: data.reminders, issue: issue.number };
  } else return { ok: false, login, errors: [...errors, 'type must be "signup" or "reminders".'] };
  return { ok: true, login, errors: [], record: rec, path: playerPath(login), updated: !!existing, type: data.type };
}

export function signupComment(res) {
  if (!res.ok) return ['Not accepted.', '', ...res.errors.map(e => `- ${e}`), '', 'Nothing was saved.'].join('\n');
  const r = res.record;
  if (res.type === 'reminders') return `Reminders ${r.reminders ? 'on' : 'off'} for @${r.login}. Nothing else changed.`;
  return [
    `${res.updated ? 'Sign-up updated' : 'Signed up'}: @${r.login}. Weekly reminders: ${r.reminders ? 'on' : 'off'}.`,
    'Your email is stored encrypted. Only the organizer can read it, and only to reach the season winner.',
    r.reminders ? 'Reminders arrive as a GitHub mention on Wednesdays before the Friday lock. Check your GitHub email notifications are on.' : null,
    `Build a lineup: ${SITE}/build.html. Just the read.`,
  ].filter(x => x !== null).join('\n\n');
}

async function main() {
  const ev = JSON.parse(await readFile(EVENT_PATH, 'utf8'));
  const issue = ev.issue;
  const out = async (k, v) => process.env.GITHUB_OUTPUT && appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (!issue || !isSignupIssue(issue)) { console.log('Not a sign-up issue; skipping.'); await out('skip', 'true'); return; }
  const key = await readJson(join(DATA, '..', 'assets', 'email-public-key.json'));
  const existing = await loadPlayer(issue.user.login);
  const res = await processSignup({ issue, now: new Date().toISOString(), existing, keyId: key.key_id });
  if (res.ok) { await writeJson(join(DATA, '..', res.path), res.record); console.log(`Saved ${res.path} (reminders: ${res.record.reminders})`); }
  else console.log(`Rejected (${res.errors.length} error(s)).`);   // errors are in the comment; never log the body
  await writeFile(COMMENT_FILE, signupComment(res) + '\n');
  await out('skip', 'false');
  await out('accepted', String(res.ok));
  await out('path', res.path || '');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
