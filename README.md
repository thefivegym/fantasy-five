# Fantasy Five

Weekly fantasy game for NCAA Division I women's artistic gymnastics, by The Five Gym
([@thefivegym](https://x.com/thefivegym)) · graphics [@thefivethatscore](https://x.com/thefivethatscore). Just the read.

**Play:** https://thefivegym.github.io/fantasy-five/

## Rules (lineup schema 2)

- Each week, pick **5 gymnasts**, one per slot, from anywhere in D1:
  **Vault, Bars, Beam, Floor** (her score on that event) and **All-Around**.
- **All-Around: any gymnast. Her score is every event she competes that meet, added up.** One event, two, three
  or four: a two-event specialist scores her two events added together. No events that week: 0.
- **AA with two meets in a week:** each meet is summed on its own and the best meet sum counts (`MULTI_MEET_MODE`).
  Events are never mixed across meets: VT+FX 19.75 at meet 1 and VT 9.95 at meet 2 scores 19.75, not 9.95+9.85.
  Config: `AA_MIN_EVENTS = 1` (4 restores the old all-four rule), `AA_SCOPE = 'meet'` (`'week'` would mix meets).
- **Five different teams:** `MAX_PER_TEAM_PER_LINEUP = 1`. **One slot per gymnast:** `MAX_USES_PER_GYMNAST = 1`.
  Both in `scripts/lib/config.mjs`.
- Competes more than once: **best** single event score, or best AA meet sum, counts (`MULTI_MEET_MODE`; set to
  `'average'` for the mean). Doesn't compete that slot: **0**.
- **Team total** = the 5 scores added up (4 event scores + 1 AA; about 80 with an all-arounder in the AA slot, less with a specialist).
- **New lineup every week. Nothing carries over; no lineup, no score.** Scoring reads only
  `data/lineups/<season>/<week>/`; a player with no file for a week has no entry that week and adds nothing to
  the season total. The builder starts empty each week (in-progress picks for the open week are kept in
  localStorage, other weeks' are cleared). Submissions are accepted only for the open week.
- A week runs **Friday through Thursday** (America/Chicago dates). Lineups **lock** at the week's `lock`
  timestamp in `data/season.json` (default Friday 5:00 PM CT, before the first meet). Every D1 meet dated in
  the window counts.
- **Highest weekly total wins.** Weekly winner gets a $25 digital Starbucks gift card and a story shoutout on @thefivethatscore. Tied for the top score: the $25 Starbucks gift card is split evenly between the tied players (e.g. two-way tie = $12.50 each), and every tied player gets the story shoutout. The season leaderboard
  is the sum of weekly totals: standings and bragging rights only, no prize. The DEMO week has no prize.
- Schema 1 (5 per event, 20 slots) is retired; the workflow rejects it with "Old format".

## Sign-up: public Instagram handle, on the site

`signup.html` takes a public Instagram handle and submits it on the page. No GitHub account, no GitHub issue,
no Instagram login, no email, no password. The handle is not treated as proof that the person owns that account.

The player id for a new signup is the normalized handle (`auth: "instagram"`). It is not the repo owner's
GitHub login (`thefivegym`). Git still records the commit as whoever owns the save-service token.

Existing players stay on their GitHub logins. Scoring still keys lineups by that login:

| Player id | Instagram | Sign-up |
|---|---|---|
| `kelseeey` | `kelseytravels` | GitHub account |
| `thefivegym` | `gymnast_zoerae` | GitHub account |

Submitting `kelseytravels`, `gymnast_zoerae`, `kelseeey`, or `thefivegym` again does not change those records.
The form cannot update a signup and cannot write a lineup.

1. The handle is normalized by `scripts/lib/instagram.mjs` (the page and the server use the same module): strip a
   leading `@` and any `instagram.com` / `instagr.am` URL, lowercase, then letters, digits, `.` and `_` only,
   1 to 30 characters, at least one letter or digit, no leading or trailing period, no `..`.
2. The page POSTs `{ "instagram": "handle" }` to the URL in `data/signup-api.json`. That file is a public URL
   only. There is no token in the site and nothing is saved in `localStorage`.
3. `workers/signup` checks the handle, refuses a handle or player id already on file, rate-limits, and commits
   `data/players/<handle>.json` (`{login, instagram, joined_at, reminders: false, auth: "instagram"}`) and
   `data/players.json` onto `main`. `reminders` is false because there is no GitHub account to mention and no
   email address to write to. The commit does not touch `data/lineups`.
4. A saved response says the handle was stored and that ownership was not verified. The page shows a success
   line only when the response has that shape. A duplicate, a bad handle, a rate limit, or a down service is an
   error and writes nothing.
5. **Not live until the save service is deployed.** `data/signup-api.json` ships with `"url": ""`. Submit then
   says nothing was saved. GitHub Pages cannot store a signup by itself. Setup is below.

A lineup filed through GitHub is still only accepted from a GitHub login with `data/players/<login>.json` and
no `auth: "instagram"`. Otherwise process-lineup says:
"Sign up first: https://thefivegym.github.io/fantasy-five/signup.html. Then submit the lineup again."
A GitHub issue whose login matches a handle-only player does not file that player's lineup and does not change
the registration.

GitHub-issue signups (`.github/workflows/signup.yml` → `scripts/process-signup.mjs`) still run if someone opens
a `Signup:` issue by hand. The page no longer links there. That path can still update the same GitHub login's
own record and keep `joined_at`. It cannot take a handle another player already has, and it cannot change a
handle-only record. Closed sign-up issues are ignored if edited later.

**Your IG handle is public on the leaderboard. It's how we contact weekly winners.** Nothing private is stored.

Organizer: `node scripts/admin/winner.mjs` prints the latest scored week's winner(s) with total and IG handle +
link (ties: everyone tied for the top score, each with their share of the split gift card, e.g. 2-way = $12.50 each,
3-way = $8.34/$8.33/$8.33). `--week=<n>` for a given week, `--standings` for the season table (no prize),
`--players` for every signed-up player. `--players --since=YYYY-MM-DD` limits that list to `joined_at` on or
after that UTC time. There is no daily signup workflow in this repo. A routine that counted GitHub issues
labeled `signup` will miss handle-only signups; point it at `--players --since=...` instead. Weekly winner
output is unchanged and still reads `data/players/<login>.json`.

### Turn the save service on

This needs a free Cloudflare Workers account and a GitHub fine-grained personal access token. Both are new.
Workers and KV have free quotas. Do not add a credit card or turn on a paid plan. This repo does not create
the account, the token, or the worker, and the live site does not save signups until the steps below are done.

1. Create a free Cloudflare account. Skip paid Workers, KV, and rate-limiting add-ons.
2. From `workers/signup`: `npx wrangler kv namespace create SIGNUP_KV`. Paste the id into
   `workers/signup/wrangler.toml` in place of `REPLACE_WITH_KV_NAMESPACE_ID`.
3. GitHub → Settings → Developer settings → Fine-grained tokens. One repository: `thefivegym/fantasy-five`.
   Permission: Contents Read and write. No other permissions. Set an expiry you are willing to rotate.
4. From `workers/signup`: `npx wrangler secret put SIGNUP_GITHUB_TOKEN` and paste the token when prompted.
   Do not commit it, do not put it in `data/signup-api.json`, and do not put it in the browser.
5. `npx wrangler deploy`. Copy the `*.workers.dev` URL.
6. Set `data/signup-api.json` to `{ "url": "https://<that-host>/" }` and push to `main` so Pages publishes it.
7. The token's pushes to `main` must be allowed to start Actions, so Deploy Pages publishes the new player
   file. A user fine-grained token does that. Do not use the Actions `GITHUB_TOKEN` as this secret: pushes
   made with it do not start other workflows.
8. Confirm with one real handle you control. A saved response is a git commit of
   `data/players/<handle>.json`. The leaderboard shows the handle after Pages redeploys. Until step 6, Submit
   does not save.

Abuse caps live in `SIGNUP_LIMITS` in `scripts/lib/config.mjs`: 15 saves an hour per IP, 40 an hour overall.
Over the cap, or if the KV binding or token is missing, the service says nothing was saved. Cloudflare's free
KV is about 1,000 writes a day. A flood past that fails closed (signups pause) instead of writing without a limit.

### Local signup server

`node scripts/signup-dev-server.mjs` serves the site and a memory-only `POST /api/signup` on 127.0.0.1.
It does not call GitHub and does not write `data/players`. Use it to click through the form. It is not the live save path.

## Weekly reminder

`.github/workflows/remind.yml` runs Wednesdays at 15:00 and 16:00 UTC; `scripts/remind.mjs` only posts on the run
that is **10 AM in Chicago** (16:00 UTC in CST, Nov to mid-March; 15:00 UTC in CDT). If a week locks in the next
7 days it opens one issue, label `reminder`, titled e.g. `Week 3 lineups lock Fri 5 PM CT`, with the lock time,
the builder link and an @mention of every GitHub-account player with `reminders: true` (50 per post; more go in
follow-up comments, since GitHub stops notifying after about 50 mentions in one body). Players with
`auth: "instagram"` are left out, even if `reminders` were true. Mentioning the handle would notify whatever
GitHub account has that name, and there is no email address on the signup. It closes last week's reminder.
No week locking soon (offseason): it does nothing. Same title already open: nothing. Manual run:
`workflow_dispatch` with `dry_run` (default on: prints the post, mentions nobody); locally
`node scripts/remind.mjs --dry-run [--now=2027-01-27T16:00:00Z]`.

**Reminders are GitHub mentions for GitHub-account signups only.** No email server, and handle-only players
are not emailed. The signup page says that. It does not promise a GitHub notification to someone who never
signed in to GitHub. The page also cannot turn an existing reminder off; a GitHub-account player who wants
that changed has to ask @thefivethatscore.

## How a lineup gets in (GitHub sign-in, static site)

0. The player has a GitHub-account sign-up (a `data/players/<login>.json` without `auth: "instagram"`). A handle-only signup does not file this lineup.
1. `build.html` builds the lineup (kept in `localStorage`) and opens a pre-filled
   `github.com/thefivegym/fantasy-five/issues/new?template=lineup.md&title=Lineup:…&body=…` link.
2. The player submits the issue while signed in to GitHub. Their **GitHub login is their username**.
3. `.github/workflows/lineup.yml` runs on `issues: opened, edited` when the issue has the `lineup` label or a
   title starting `Lineup:`. `scripts/process-lineup.mjs` parses the JSON block and checks:
   `schema` is 2; the season and week exist and the week is the open one; all 5 slots filled; every id is in
   `data/gymnasts.json`; no gymnast in two slots; no more than `MAX_PER_TEAM_PER_LINEUP` picks from one team; the issue's `created_at` (or `updated_at` for an edit) is before that week's lock.
4. Valid: writes `data/lineups/<season>/<week>/<login>.json` (a later valid submission replaces it), commits,
   comments a dry confirmation, closes the issue, redeploys Pages. Invalid: comments the exact errors and
   closes the issue as "not planned". Nothing is saved.

Uses the default `GITHUB_TOKEN` (`contents: write`, `issues: write`, `pages: write`, `id-token: write`).
The issue body is untrusted: it is only parsed as JSON inside Node, never interpolated into a shell.
Issues are public, so a submitted lineup is visible to everyone.

## Scoring pipeline

`.github/workflows/score.yml`: `workflow_dispatch` (optional week) plus cron Sat/Sun 05:00 UTC (provisional)
and Sun/Mon 13:00 UTC.

1. `node scripts/fetch-scores-rtn.mjs --auto` (or `--week=N`) reads the Road to Nationals schedule
   (`/api/women/schedule/<year>/1`), takes every meet in the week window with a D1 team, fetches
   `/api/women/meetresults/<meet_id>` for each (≥30 s apart, per RTN's robots.txt crawl-delay), and writes
   `data/scores/<season>/<week>.json`. Gymnasts are matched by RTN gymnast id, then name + team, then unique
   name. Unmatched scores are kept in `unmatched` for review.
2. `node scripts/score.mjs` recomputes `data/results/<season>/<week>.json` and `data/leaderboard/<season>.json`.

**Manual import** (if RTN is unavailable): write `data/scores/<season>/<week>.json` by hand in the format below
and run `node scripts/score.mjs`.

## Data model

| File | Contents |
|---|---|
| `data/gymnasts.json` | `{generated_at, sources, coverage, gymnasts:[…]}`. Gymnast: `id` (stable slug, `first-last`, `-team` on a name clash), `name`, `team`, `team_id`, `class_year`, `hometown`, `rtn_ids` (Road to Nationals gymnast ids), `prev_team` (2026 team), `events` (events she competed in 2026, or null), `proj` (`{vault|bars|beam|floor|aa:{avg,nqs,high,rank}}` from 2026, or null; `aa` = RTN's real AA NQS, only for gymnasts RTN ranks in the AA), `aa_proj` (`{score, events, basis}`: AA slot projection, derived, see below; or null), `projection_status` (`ranked` / `unranked-2026` / `none`), `projection_note`. |
| `data/teams.json` | D1 teams: `id`, `name`, `rtn_tid`, `conference`, `roster_url`, `roster_source` (parser), `roster_status` (`official-2026-27` or `provisional-rtn-2026`), `roster_count`, `note`. |
| `data/season.json` | `season` (2027), `roster`, `week_rule`, `scoring`, `weeks:[{week,label,start,end,lock,status}]`, and a `demo` pointer. |
| `data/scores/<season>/<week>.json` | `{status: partial/final, window, meets:[{meet_id,date,teams,url}], scores:{<gymnast_id>:{vault:[{score,meet_id,date}],bars,beam,floor,aa:[{score,meet_id,date}]}}, unmatched:[…]}`. `aa` has one entry per meet: `{score, meet_id, date, events}`, the sum of every event she did in that meet. The scorer always re-derives it from the event scores (stored `aa` is used only if a gymnast has no event scores). |
| `data/players/<login>.json` | `{login, instagram, joined_at, reminders}` plus `auth: "instagram"` on a handle-only signup. Public. GitHub-account files have no `auth`. |
| `data/players.json` | `{generated_at, players:{<login>:{instagram, auth?}}}`. `auth` is present only for handle-only players. Rebuilt by a signup commit and at deploy. |
| `data/signup-api.json` | `{url}` public address of the save service. `""` until it is deployed. No secret. |
| `data/lineups/<season>/<week>/<login>.json` | `{schema: 2, login, season, week, submitted_at, issue, issue_url, lineup:{vault:id, bars:id, beam:id, floor:id, aa:id}}`. A file with `"test": true`, or any schema other than 2, is ignored by scoring. |
| `data/results/<season>/<week>.json` | `{mode, schema, scores_status, players:[{login,rank,total,slots:{vault:{id,name,team,score,competed,meets},bars,beam,floor,aa:{…,events}}}]}` |
| `data/leaderboard/<season>.json` | `{weeks, players:[{login,rank,total,weeks_played,best_week,weeks:{<n>:{total,rank,of}}}]}` |

Projections are guidance only: 2026 season average (`avg`), 2026 final regular-season RQS used as NQS
(`nqs`), and season high, from the RTN individual rankings
(`/api/women/results/2026/12/1/<event>`, 1–4 = VT/UB/BB/FX, 5 = AA). **AA projection (`aa_proj`)** is derived, not an RTN number: the sum of her 2026 NQS on each event she competed in 2026, falling back to her 2026 season average (`/api/women/rostermain/2026/<team_id>/3`) on an event with no NQS. `events` lists the events it covers and `basis` says nqs or avg per event; the site shows it as e.g. "UB+BB 19.810" or "VT+FX 19.500 (FX avg)", labeled "sum of event NQS", with RTN's own AA NQS beside it where one exists. The AA picker sorts by it. On a 2026 roster with no 2026 scores: "no 2026 scores". Gymnasts with no 2026 NCAA record (freshmen, unmatched newcomers) have
`proj: null` and show as NEW. Gymnasts who competed in 2026 but not often enough to get an RQS are
`unranked-2026`, also `proj: null`. Nothing is estimated.

## Roster build

`scripts/roster/build_roster.py <cache_dir>` (Python 3, stdlib only) joins:
- official 2026-27 roster pages for the 62 RTN D1 teams (`scripts/roster/roster_sites.tsv`; SIDEARM Nuxt,
  SIDEARM classic, WMT, and three one-off parsers in `parsers.py`),
- RTN 2026 team dashboards (`/api/women/dashboard/2026/<tid>`) for RTN ids and 2026 class years,
- RTN final 2026 individual event rankings.

A roster page that still shows 2025-26 (detected when returners' class years match their 2026 class) is not
used; that team falls back to the 2026 RTN roster minus 2026 seniors and grad students, flagged
`provisional-rtn-2026`. Re-run the builder when rosters change.

## DEMO week

One clearly labeled DEMO week (Feb 13–19, 2026) with real 2026 RTN scores and sample `DEMO-*` lineups shows the
leaderboard, player pages and cards working. To remove it: delete `data/demo/`, `data/scores/demo/`,
`data/lineups/demo/`, `data/results/demo/`, `data/leaderboard/demo.json`, and the `demo` key in
`data/season.json`. The site hides DEMO links when the key is gone.

## Files

```
index.html roster.html build.html leaderboard.html player.html card.html signup.html   site (vanilla JS, no build)
assets/style.css assets/common.js                                          shared style + helpers
scripts/lib/{config,scoring,io,names}.mjs                                  game constants + scoring engine
scripts/process-lineup.mjs  scripts/process-signup.mjs  scripts/remind.mjs  scripts/score.mjs  scripts/fetch-scores-rtn.mjs
scripts/lib/players.mjs scripts/lib/instagram.mjs scripts/lib/direct-signup.mjs scripts/lib/signup-http.mjs scripts/lib/github-player-commit.mjs  player records, IG rules, handle-only save
scripts/build-players-index.mjs                                             public index
scripts/signup-dev-server.mjs                                               local memory-only signup (does not write the repo)
workers/signup/                                                             Cloudflare Worker that commits a new player file (not deployed by CI)
scripts/admin/winner.mjs                                                    weekly winner(s) + IG handle, standings, players, --since
scripts/seed-demo.mjs                                                       builds the 5 sample DEMO-* lineups, schema 2 (2026 RTN rankings + week schedule only)
scripts/test/scoring.test.mjs                                               node --test scripts/test/*.test.mjs
scripts/roster/                                                             offline roster builder
.github/workflows/{lineup,signup,remind,score,deploy}.yml   .github/ISSUE_TEMPLATE/lineup.md
```

## Local

```sh
node --test scripts/test/*.test.mjs
node scripts/score.mjs
python3 -m http.server 8000   # http://localhost:8000/
```

Data: [Road to Nationals](https://www.roadtonationals.com) and official team sites. Unofficial fan project;
not affiliated with the NCAA, RTN or any school.
