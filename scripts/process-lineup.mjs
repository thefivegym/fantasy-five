#!/usr/bin/env node
// Validates a lineup submitted as a GitHub issue and stores it.
// Input: the GitHub event payload (GITHUB_EVENT_PATH). Untrusted issue text is only ever parsed as JSON here,
// never interpolated into a shell.
// Output: writes data/lineups/<season>/<week>/<login>.json on success, and writes the comment text to
// $COMMENT_FILE (default ./lineup-comment.md). Sets outputs `accepted`, `path` in $GITHUB_OUTPUT.
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA, readJson, writeJson, loadSeason } from './lib/io.mjs';
import { validateLineup } from './lib/scoring.mjs';
import { EVENTS, LINEUP_TITLE_PREFIX, LINEUP_LABEL } from './lib/config.mjs';

const EVENT_PATH = process.env.GITHUB_EVENT_PATH || process.argv[2];
const COMMENT_FILE = process.env.COMMENT_FILE || 'lineup-comment.md';

export function extractJson(body) {
  if (!body) return null;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(body.slice(a, b + 1));
  for (const c of candidates) { try { return JSON.parse(c); } catch {} }
  return null;
}

export function isLineupIssue(issue) {
  return (issue.labels || []).some(l => (l.name || l) === LINEUP_LABEL) || (issue.title || '').startsWith(LINEUP_TITLE_PREFIX);
}

const fmtCT = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';

/** Core decision. Returns { ok, errors[], record?, path?, week? } */
export async function processSubmission({ issue, action, now }) {
  const submittedAt = action === 'edited' ? (issue.updated_at || now) : (issue.created_at || now);
  const data = extractJson(issue.body);
  if (!data) return { ok: false, errors: ['No lineup JSON found in the issue body. Build the lineup at https://thefivegym.github.io/fantasy-five/build.html and submit from there.'] };
  const errors = [];
  let season;
  try { season = await loadSeason(data.season); } catch { return { ok: false, errors: [`Season ${JSON.stringify(data.season)} does not exist.`] }; }
  const week = season.weeks.find(w => Number(w.week) === Number(data.week));
  if (!week) return { ok: false, errors: [`Week ${JSON.stringify(data.week)} is not in season ${season.season}.`] };
  if (season.demo) errors.push('The DEMO week is closed. Real lineups go to the 2027 season.');
  const t = new Date(submittedAt).getTime();
  if (!(t < new Date(week.lock).getTime())) errors.push(`Week ${week.week} locked at ${fmtCT(week.lock)}. This ${action === 'edited' ? 'edit' : 'submission'} is timestamped ${fmtCT(submittedAt)}.`);
  // The "right week" is the earliest week whose lock is still ahead of the submission time.
  const open = season.weeks.filter(w => new Date(w.lock).getTime() > t).sort((a, b) => new Date(a.lock) - new Date(b.lock))[0];
  if (open && Number(open.week) !== Number(week.week) && !errors.length) errors.push(`Week ${week.week} is not open yet. The open week is ${open.week} (locks ${fmtCT(open.lock)}).`);
  const gym = await readJson(join(DATA, 'gymnasts.json'));
  const ids = new Set(gym.gymnasts.map(g => g.id));
  errors.push(...validateLineup(data.lineup, ids));
  if (errors.length) return { ok: false, errors, week: week.week, season: season.season };
  const login = issue.user.login;
  const record = {
    login, season: season.season, week: week.week, submitted_at: submittedAt,
    issue: issue.number, issue_url: issue.html_url,
    lineup: Object.fromEntries(EVENTS.map(ev => [ev, data.lineup[ev]])),
  };
  const path = join('data', 'lineups', String(season.season), String(week.week), `${login.toLowerCase()}.json`);
  return { ok: true, errors: [], record, path, week: week.week, season: season.season, lock: week.lock, names: Object.fromEntries(gym.gymnasts.map(g => [g.id, `${g.name} (${g.team})`])) };
}

function comment(res, issue) {
  if (!res.ok) {
    return [`Not accepted.`, '', ...res.errors.map(e => `- ${e}`), '', 'Fix it in the builder and submit again (a new issue, or edit this one before the lock). Nothing was saved.'].join('\n');
  }
  const lines = [`Lineup saved for week ${res.week}, ${res.season}. Locks ${fmtCT(res.lock)}.`, ''];
  for (const ev of EVENTS) lines.push(`**${ev[0].toUpperCase() + ev.slice(1)}:** ${res.record.lineup[ev].map(id => res.names[id]).join(' · ')}`);
  lines.push('', 'A later submission before the lock replaces this one. Just the read.');
  return lines.join('\n');
}

async function main() {
  const ev = JSON.parse(await readFile(EVENT_PATH, 'utf8'));
  const issue = ev.issue;
  const out = async (k, v) => process.env.GITHUB_OUTPUT && appendFile(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (!issue || !isLineupIssue(issue)) { console.log('Not a lineup issue; skipping.'); await out('skip', 'true'); return; }
  const res = await processSubmission({ issue, action: ev.action, now: new Date().toISOString() });
  if (res.ok) { await writeJson(join(DATA, '..', res.path), res.record); console.log(`Saved ${res.path}`); }
  else console.log('Rejected:\n' + res.errors.join('\n'));
  await writeFile(COMMENT_FILE, comment(res, issue) + '\n');
  await out('skip', 'false');
  await out('accepted', String(res.ok));
  await out('path', res.path || '');
  await out('week', String(res.week ?? ''));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
