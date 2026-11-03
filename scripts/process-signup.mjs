#!/usr/bin/env node
// Processes a sign-up (or reminders on/off) submitted as a GitHub issue from signup.html.
// Issue body JSON:
//   sign up / update: {"game":"fantasy-five","type":"signup","schema":2,"reminders":true,"instagram":"handle"}
//   reminders only:   {"game":"fantasy-five","type":"reminders","schema":2,"reminders":false}
// Stores data/players/<login>.json = {login, instagram, joined_at, reminders} and refreshes data/players.json.
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, writeJson } from './lib/io.mjs';
import { SIGNUP_LABEL, SIGNUP_TITLE_PREFIX, SIGNUP_URL, SITE } from './lib/config.mjs';
import { loadPlayer, playerPath, writePlayersIndex } from './lib/players.mjs';
import { checkInstagram } from './lib/instagram.mjs';
import { extractJson } from './process-lineup.mjs';

const EVENT_PATH = process.env.GITHUB_EVENT_PATH || process.argv[2];
const COMMENT_FILE = process.env.COMMENT_FILE || 'signup-comment.md';
export const SIGNUP_SCHEMA = 2;

export function isSignupIssue(issue) {
  return (issue.labels || []).some(l => (l.name || l) === SIGNUP_LABEL) || (issue.title || '').startsWith(SIGNUP_TITLE_PREFIX);
}

export async function processSignup({ issue, now, existing }) {
  const login = issue.user.login;
  const data = extractJson(issue.body);
  if (!data) return { ok: false, login, errors: [`No sign-up JSON found. Use ${SIGNUP_URL}.`] };
  const errors = [];
  if (data.game !== 'fantasy-five' || Number(data.schema) !== SIGNUP_SCHEMA) errors.push(`Not a current Fantasy Five sign-up (game/schema). Use ${SIGNUP_URL}.`);
  if (typeof data.reminders !== 'boolean') errors.push('reminders must be true or false.');
  const extra = Object.keys(data).filter(k => !['game', 'type', 'schema', 'reminders', 'instagram'].includes(k));
  if (extra.length) errors.push(`Unknown keys: ${extra.join(', ')}.`);
  let rec;
  if (data.type === 'signup') {
    const ig = checkInstagram(data.instagram);
    if (!ig.ok) errors.push(ig.error);
    if (errors.length) return { ok: false, login, errors };
    rec = { login, instagram: ig.handle, joined_at: existing?.joined_at || now, reminders: data.reminders };
  } else if (data.type === 'reminders') {
    if (!existing) errors.push(`No sign-up on file for @${login}. Sign up first: ${SIGNUP_URL}.`);
    if (data.instagram !== undefined) errors.push('A reminders change takes no handle. Sign up again to change it.');
    if (errors.length) return { ok: false, login, errors };
    rec = { login, instagram: existing.instagram, joined_at: existing.joined_at, reminders: data.reminders };
  } else return { ok: false, login, errors: [...errors, 'type must be "signup" or "reminders".'] };
  return { ok: true, login, errors: [], record: rec, path: playerPath(login), updated: !!existing, type: data.type };
}

export function signupComment(res) {
  if (!res.ok) return ['Not accepted.', '', ...res.errors.map(e => `- ${e}`), '', 'Nothing was saved.'].join('\n');
  const r = res.record;
  if (res.type === 'reminders') return `Reminders ${r.reminders ? 'on' : 'off'} for @${r.login}. Nothing else changed.`;
  return [
    `${res.updated ? 'Sign-up updated' : 'Signed up'}: @${r.login}. IG: @${r.instagram}. Weekly reminders: ${r.reminders ? 'on' : 'off'}.`,
    'Your IG handle is public on the leaderboard. It\'s how we contact weekly winners.',
    r.reminders ? 'Reminders arrive as a GitHub mention on Wednesdays before the Friday lock. Check your GitHub email notifications are on.' : null,
    `Build a lineup: ${SITE}/build.html. Just the read.`,
  ].filter(x => x !== null).join('\n\n');
}

async function main() {
  const ev = JSON.parse(await readFile(EVENT_PATH, 'utf8'));
  const issue = ev.issue;
  const out = async (k, v) => process.env.GITHUB_OUTPUT && appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (!issue || !isSignupIssue(issue)) { console.log('Not a sign-up issue; skipping.'); await out('skip', 'true'); return; }
  console.log(`Event: ${ev.action}; issue ${issue.state}; changed: ${Object.keys(ev.changes || {}).join(',') || 'none'}`);
  // A closed sign-up issue is done. Signing up again is a new issue from signup.html.
  if (issue.state === 'closed') { console.log('Issue is closed; skipping.'); await out('skip', 'true'); return; }
  const existing = await loadPlayer(issue.user.login);
  const res = await processSignup({ issue, now: new Date().toISOString(), existing });
  if (res.ok) { await writeJson(join(DATA, '..', res.path), res.record); await writePlayersIndex(); console.log(`Saved ${res.path}`); }
  else console.log('Rejected:\n' + res.errors.join('\n'));
  await writeFile(COMMENT_FILE, signupComment(res) + '\n');
  await out('skip', 'false');
  await out('accepted', String(res.ok));
  await out('path', res.path || '');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
