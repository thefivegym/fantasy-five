#!/usr/bin/env node
// Weekly lineup reminder. Opens one GitHub issue per week before the lock that @mentions every player with
// reminders: true (GitHub then emails them per their notification settings), and closes last week's reminder.
// Usage:
//   node scripts/remind.mjs --dry-run            print what would be posted (mentions shown as @\u200blogin, nobody notified)
//   node scripts/remind.mjs                      post (needs GH_TOKEN, GITHUB_REPOSITORY); only acts at 10 AM CT Wednesday
//   node scripts/remind.mjs --force              post regardless of the local-time check (manual dispatch)
import { writeFile } from 'node:fs/promises';
import { DATA, readJson, parseArgs } from './lib/io.mjs';
import { join } from 'node:path';
import { REMINDER_LABEL, REMINDER_LOCAL, MENTIONS_PER_COMMENT, SITE, REPO } from './lib/config.mjs';
import { loadPlayers } from './lib/players.mjs';

const TZ = REMINDER_LOCAL.tz;
const ct = (iso, o) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...o });
export const lockShort = iso => `${ct(iso, { weekday: 'short' })} ${ct(iso, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')} CT`;

/** The week to remind for: the earliest week whose lock is ahead of now, if that lock is within `withinDays`. */
export function reminderWeek(season, now = Date.now(), withinDays = 7) {
  const w = [...season.weeks].sort((a, b) => new Date(a.lock) - new Date(b.lock)).find(x => new Date(x.lock).getTime() > now);
  if (!w) return null;
  return new Date(w.lock).getTime() - now <= withinDays * 864e5 ? w : null;
}
/** True when `now` is Wednesday 10:xx in Chicago (the two UTC crons cover CST and CDT; this picks the right one). */
export function isReminderHour(now = Date.now()) {
  return ct(now, { weekday: 'long' }) === REMINDER_LOCAL.weekday && Number(ct(now, { hour: 'numeric', hour12: false })) === REMINDER_LOCAL.hour;
}
export const reminderTitle = (season, w) => `Week ${w.week} lineups lock ${lockShort(w.lock)}`;

/** Issue body + follow-up comments, each with at most MENTIONS_PER_COMMENT mentions. */
export function reminderBodies(season, w, logins, { dryRun = false, per = MENTIONS_PER_COMMENT } = {}) {
  const at = l => (dryRun ? `@\u200b${l}` : `@${l}`);
  const lock = `${ct(w.lock, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT`;
  const head = [
    `**${w.label || 'Week ' + w.week}, ${season.season}.** New lineup every week; nothing carries over. No lineup, no score.`,
    '',
    `Locks ${lock}. Build it: ${SITE}/build.html`,
    '',
    `You get this because you signed up with reminders on. Turn them off: ${SITE}/signup.html`,
  ].join('\n');
  const batches = [];
  for (let i = 0; i < logins.length; i += per) batches.push(logins.slice(i, i + per));
  if (!batches.length) return { body: head + '\n\nNo players with reminders on yet.', comments: [] };
  return { body: `${head}\n\n${batches[0].map(at).join(' ')}`, comments: batches.slice(1).map(b => b.map(at).join(' ')) };
}

async function gh(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || REPO}${path}`, {
    method, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function main() {
  const args = parseArgs();
  const dry = !!args['dry-run'], force = !!args.force;
  const season = await readJson(join(DATA, "season.json"));
  const now = args.now ? new Date(args.now).getTime() : Date.now();
  if (!dry && !force && !isReminderHour(now)) { console.log(`Not ${REMINDER_LOCAL.weekday} ${REMINDER_LOCAL.hour}:00 CT (this is the other DST cron). Skipping.`); return; }
  const w = reminderWeek(season, now);
  if (!w) { console.log('No week locks in the next 7 days (offseason or between seasons). Nothing to send.'); return; }
  const players = (await loadPlayers()).filter(p => p.reminders === true).map(p => p.login).sort((a, b) => a.localeCompare(b));
  const title = reminderTitle(season, w);
  const { body, comments } = reminderBodies(season, w, players, { dryRun: dry });
  if (dry) {
    console.log(`DRY RUN. Would open: "${title}" with ${players.length} mention(s) in ${1 + comments.length} post(s).\n\n${body}`);
    comments.forEach((c, i) => console.log(`\n--- comment ${i + 1} ---\n${c}`));
    await writeFile('reminder-preview.md', `# ${title}\n\n${body}\n${comments.map(c => '\n---\n' + c).join('\n')}\n`);
    return;
  }
  const open = await gh('GET', `/issues?state=open&labels=${REMINDER_LABEL}&per_page=100`);
  if (open.some(i => i.title === title)) { console.log(`"${title}" already open. Nothing to do.`); return; }
  const issue = await gh('POST', '/issues', { title, body, labels: [REMINDER_LABEL] });
  for (const c of comments) await gh('POST', `/issues/${issue.number}/comments`, { body: c });
  for (const old of open) {
    await gh('POST', `/issues/${old.number}/comments`, { body: `Superseded by #${issue.number}. This week is closed.` });
    await gh('PATCH', `/issues/${old.number}`, { state: 'closed', state_reason: 'completed' });
  }
  console.log(`Opened #${issue.number} "${title}" (${players.length} mention(s)); closed ${open.length} old reminder(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
