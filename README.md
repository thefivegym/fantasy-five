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
- Highest weekly total wins the week. The season leaderboard is the sum of weekly totals.
- Schema 1 (5 per event, 20 slots) is retired; the workflow rejects it with "Old format".

## How a lineup gets in (GitHub sign-in, static site)

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
index.html roster.html build.html leaderboard.html player.html card.html   site (vanilla JS, no build)
assets/style.css assets/common.js                                          shared style + helpers
scripts/lib/{config,scoring,io,names}.mjs                                  game constants + scoring engine
scripts/process-lineup.mjs  scripts/score.mjs  scripts/fetch-scores-rtn.mjs
scripts/seed-demo.mjs                                                       builds the 5 sample DEMO-* lineups, schema 2 (2026 RTN rankings + week schedule only)
scripts/test/scoring.test.mjs                                               node --test scripts/test/*.test.mjs
scripts/roster/                                                             offline roster builder
.github/workflows/{lineup,score,deploy}.yml   .github/ISSUE_TEMPLATE/lineup.md
```

## Local

```sh
node --test scripts/test/*.test.mjs
node scripts/score.mjs
python3 -m http.server 8000   # http://localhost:8000/
```

Data: [Road to Nationals](https://www.roadtonationals.com) and official team sites. Unofficial fan project;
not affiliated with the NCAA, RTN or any school.
