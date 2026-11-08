# 🔒 Private Operational Scripts

This directory contains operational scripts that are **NOT** pushed to GitHub. These scripts contain API keys and are used for daily data operations.

## 📅 Updated: Dec 17, 2025

## 📋 What These Scripts Do

- **Data Fetching**: Pull live odds, scores, and team data from APIs
- **Database Updates**: Update Supabase with fresh data for the website
- **Live Operations**: Handle real-time score updates during games
- **Cleanup**: Remove stale data to keep the app functioning properly

## 🚀 Daily Operations (Critical Order!)

### Morning Routine
```bash
# 1. FIRST: Clear stale props (prevents yesterday's data from showing)
# Read-only probe (no deletes): node scripts/clear-stale-props.js --dry-run
node scripts/clear-stale-props.js

# 2. Fetch fresh games from ESPN
# Continue even if cleanup exited 1. Independent slate-refresh must still run.
node scripts/fetch-fresh-games.js all --apply-vanish
# 2b. Reconcile ghost / flipped MLB scheduled games. Dry-run until two clean mornings.
# Never deletes. Absolute cap 5 rows; 30% cap only when a date has 5+ candidates.
# PowerShell: use node scripts/... — npm run … -- --apply drops flags.
node scripts/reconcile-games.js --sport mlb
# After two clean dry-runs, one manual apply outside :05–:15 ET (ideally 9:30–11:00 AM):
# node scripts/reconcile-games.js --sport mlb --apply
# Later, after morning review: node scripts/fetch-fresh-games.js all --reconcile
# Then enable writes: node scripts/fetch-fresh-games.js all --reconcile --apply

# 2c. ESPN injuries + NHL starting goalies (free JSON; zero Odds API credits)
# APPLY 009_injury_report.sql once in the SQL Editor before the first persist.
# Missing tables: WARN and continue. Footer INJURIES_STATUS=ok|partial|failed (exit 0).
# Any value other than ok is WARN in the morning report.
# Writes during :05–:15 ET are allowed (8:09 morning job). Same exemption
# as fetch-fresh-games Game upserts (`ignoreQuietPeriod`). Do not no-op this.
node scripts/fetch-injuries.js

# 3. Fetch odds with proper gameTime mapping
node scripts/fetch-live-odds.js all --cache-fresh
# Footer prints ODDS_BUDGET_STATUS=ok|floor|daily_cap|monthly_cap|probe_failed (exit 0).
# Any value other than ok is WARN in the morning report.

# 4. REQUIRED: refresh team performance BEFORE calculate-game-edges
# Writes present ESPN season fields only. Failed/empty sport fetches leave
# existing Team rows unchanged (never overwrite good stats with 0 or null).
# Per-sport API failures do not abort the other sports.
# Prisma preflight on fetch/edges is warn-only (these scripts do not use
# Prisma and must not exit 1). auto-validate-parlays fails closed.
# Partial ESPN writes (no timestamps) are counted separately from
# timestamped updates.
node scripts/fetch-team-performance-data.js   # Requires SUPABASE_SECRET_KEY
# or: npm run fetch:team-performance
# Combined: npm run ops:morning-edges  (prisma preflight, fetch, then calculate-game-edges)

# 5. REQUIRED: calculate game edges before record-game-lines
# record-game-lines reads EdgeSnapshot. Without this step the sides/totals
# persist is empty even when the public board can still generate live lines.
# NHL/MLB skip when either team's stats are null, all-zero, or stale in-season.
node scripts/calculate-game-edges.js   # Requires SUPABASE_SECRET_KEY

# 6. Record public-track rows (do NOT rely on page visits)
# fetch-live-odds already records Published props; record:published is the backup sweep.
# MLB Published/Featured are NOT recorded here — morning is before lineups.
# They wait for `npm run record:mlb-window` (hourly, :16 ET or later).
npm run record:published
# Required after PR-E: /parlays GET no longer inserts Featured cards.
# NFL only. MLB Featured is recorded by record:mlb-window.
npm run record:featured
# Required after PR-E: homepage / /api/picks no longer insert game-line rows.
# Requires EdgeSnapshot from step 4.
npm run record:game-lines
```

**`record:published` exit 1 is DEGRADED, not a stop.** A full ESPN roster outage for NFL and/or NHL (every guarded prop skipped because the roster could not be fetched) exits `1`. Featured cards and game-lines do not depend on that roster sweep, so `record:featured` and `record:game-lines` must still run. Label the morning **DEGRADED / PARTIAL SUCCESS**, not OK. Parse the `ROSTER_GUARD_STATUS=` line (`ok` or `outage`) plus `unavailable=N` and the per-sport tokens (`nfl=outage`, `nhl=ok`) when present.

**Vercel Build also needs `SUPABASE_SECRET_KEY`.** `sitemap.xml` is
prerendered and reads `Game` through the admin client. Production-only
is not enough — set the secret on the Build environment too.

### Before running 006 (RLS lockdown)

Do not paste `scripts/migrations/006_rls_lockdown.sql` until every item is true:

- [ ] `GET https://oddsondeck.com/api/health` shows `supabaseAdmin.usingSecret: true`
- [ ] Laptop `.env.local` has `SUPABASE_SECRET_KEY` (boolean check):
      `node -e "require('dotenv').config({path:'.env.local'});console.log(!!process.env.SUPABASE_SECRET_KEY)"`
- [ ] Laptop scripts (including `scripts/calculate-prop-edges.js` and hourly
      `operations/update-scores-safely.js`) resolve
      `SUPABASE_SECRET_KEY` → `SUPABASE_SERVICE_ROLE_KEY` → anon (anon only
      when `SUPABASE_REQUIRE_SECRET_KEY` is unset; they warn on stderr)
- [ ] `006_pre_snapshot.sql` has been run and its output saved


**Cleanup failure is not overall OK.** `clear-stale-props.js` exits `1` when candidate reads or archive writes fail, and it deletes nothing. Later ESPN/odds steps may still succeed. Label that morning run **DEGRADED / PARTIAL SUCCESS**, not OK. Parse the `CLEANUP_STATUS=` footer (`ok`, `partial`, or `fail`) plus `CANDIDATES`, `ARCHIVED`, `DELETED`, `SKIPPED_REFETCH`, `SKIPPED_DELETE`, `REMAINING_EXPIRED`, `REMAINING_STALE`, `REMAINING_PAST_GAME`. `partial` means the live clock entered :05–:15 ET after archive started, so remaining deletes were not run.

There is **no in-repo wrapper** that aggregates morning status. The Grok Bot morning-ops routine (outside this repo) must apply the prompt change below. **This live morning-routine reporting change is pending and has not been applied.** This agent does not modify live automation.

### Stale-prop cleanup reads (timeouts)

Morning ops 2026-09-14 failed during Supabase candidate collection: `cleanup read failed: Gateway Timeout`. Abort-on-failure worked (zero deletes). Candidate reads now:

- select an **explicit column list** (archive mapping + `id`/`fetchedAt` concurrency fields; not `select(*)`)
- use **keyset pagination** (`order id`, `gt(id, cursor)`, conservative default page size 50, configurable via `--page-size` / `CLEANUP_PAGE_SIZE`, max 200)
- retry **bounded** transient failures (504/503/502/429/timeouts/network) with exponential backoff + jitter
- do **not** retry auth/schema errors
- keep the candidate **cutoff fixed** for the whole run
- print diagnostics: filter, cursor, page size, attempt, elapsed ms, HTTP/error code (never credentials or row payloads)

**Why keyset instead of raising offsets:** PostgREST `range(from,to)` still scans skipped rows, gets slower on large caches, and skips/duplicates rows if earlier matches disappear or appear mid-walk. Keyset `WHERE id > cursor` is stable for already-seen ids. Remaining concurrent-update limits: a row whose `id` is already behind the cursor and only later becomes expired/stale is missed until the next run; a row refreshed after capture is not deleted (`id` + exact `fetchedAt` match). This patch does **not** chunk-delete.

Read-only verification:

```
node scripts/clear-stale-props.js --help
node scripts/clear-stale-props.js --dry-run
node scripts/clear-stale-props.js --collect-only --page-size 50
```

`--help` prints usage and exits 0 with no DB/archive activity. Unknown args exit 2 before any side effects. Read failures in `--dry-run` / `--collect-only` exit **1**.

Do **not** treat a drop in expired counts as explained by elapsed time alone. A failed collect deletes nothing; counts can also move because of other writers, expiry, or a later successful cleanup.

### Reconcile ghost / flipped scheduled games (MLB)

`fetch-fresh-games.js` upserts what ESPN still lists, then reports scheduled
games that vanished from a fully covered source date. Detection is always on;
writes (`status=not_needed`) are opt-in with `--apply-vanish`. Never deletes.
Vanish-retire writes use `--apply-vanish` only. `--apply-stale` is a different
sweep (stale ESPN status → final / postponed / not_needed) and never marks
vanished scheduled games.

Failed or malformed fetches never retire. A single ESPN `events:[]` is
trusted only when that ET date is already in the past (or has no pre-start
rows), so a transient empty scoreboard on today cannot wipe a small slate.
If-necessary postseason ghosts (for example TB @ MIL after the World Series)
are the main target. Dual-source MLB flip/ghost reconcile remains available
as an extra dry-run (`--reconcile`, writes with `--reconcile --apply`).

When `--apply-vanish` writes, vanish-retire and vanish-cancel both honor
`ignoreQuietPeriod`. `fetch-fresh-games` sets that flag (`true`) because
the morning job already upserts Game rows in the `:05–:15` ET window;
`--reconcile --apply` and a cancel apply without the exemption still
refuse it. `oddsApiEventId`
is not cleared. Caps: 5 retires per plan, 5 per ET day across sports
(counted via `Game.lastUpdate` on `not_needed` rows), 30% when a date has
5+ candidates, and on smaller dates more than 1 retire or 50% or more
(so 1-of-2 aborts; a lone 1-of-1 is allowed). Past-date retires skip rows
that still have PropValidation, ParlayLeg, or player-prop cache rows and
flag them for review.

```bash
# Dry-run (default, no writes)
node scripts/reconcile-games.js --sport mlb
node scripts/reconcile-games.js --sport mlb --date 2026-10-20 --days 3 --json
# Past dates are reports only unless --include-past.

# Write status=not_needed (oddsApiEventId kept). Refused during :05–:15 ET.
# Never deletes. Both ESPN and StatsAPI must agree the matchup is gone.
node scripts/reconcile-games.js --sport mlb --apply
```

`--reconcile` on fetch-fresh-games is the same dry-run after the upsert;
`--reconcile --apply` writes. Keep dry-run in the 8:09 job until two clean
mornings, then one manual `--apply` (9:30–11:00 AM ET), then enable
`--reconcile --apply` with caps on. No migration, no downtime (status only).

Rows with pending PropValidation / ParlayLeg are reported as
`protected_has_picks` and left alone. Cap abort: more than 5 retires or more
than 30% of that date's candidates when the date has 5+ candidates
(`--max N` / `--max-pct 30` is a percent 0-100, same flag on both CLIs). Both feeds returning a valid empty
slate (`events:[]` / `dates:[]`) is agreement, not an abort.

### Proposed Grok Bot morning-ops prompt change (pending — do not apply from this cloud agent)

Replace overall-success logic. Exact proposed change:

```
Morning ops status (required):

1. Run `node scripts/clear-stale-props.js` first. Record cleanup_exit (process exit code)
   and parse the CLEANUP_STATUS / CANDIDATES / ARCHIVED / DELETED / SKIPPED_REFETCH /
   SKIPPED_DELETE / REMAINING_EXPIRED / REMAINING_STALE / REMAINING_PAST_GAME footer.
2. Always continue independent slate-refresh steps even when cleanup_exit != 0:
   `node scripts/fetch-fresh-games.js all --apply-vanish`
   `node scripts/fetch-live-odds.js all --cache-fresh`
   `node scripts/fetch-team-performance-data.js`
   optional `node scripts/calculate-game-edges.js`
3. Overall run status:
   - OK only if cleanup_exit == 0 AND every required later step succeeded.
   - DEGRADED / PARTIAL SUCCESS if cleanup_exit != 0 and later required steps succeeded.
   - FAIL if any required slate-refresh step failed.
4. Never label the run OK because later steps succeeded after a cleanup abort.
5. Do not treat "database already clean" or a lower expired count as proof that
   cleanup ran. If CLEANUP_STATUS=fail, candidates/archived/deleted are 0 and
   remaining-expired is the pre-run count (or unavailable).
6. Include those cleanup fields in the morning report every time.
```

### Hourly MLB record + close capture

Do **not** add this to the :09 ET job. `:05–:15` is a no-write window.
A `:00` or `:04` run re-checks the quiet window before each write
and stops at `:05` ET. It does not start a paid event-odds fetch
after `:04:30` ET (so `:05` cannot waste a credit). A run stopped by quiet or that fetch cutoff prints
`CLOSE_CAPTURE_STATUS=partial` and `CLOSE_CAPTURE_SKIPPED_QUIET=<n>`
for remaining jobs. `CLOSE_CAPTURE_SKIPPED_BUDGET` is only
budget/cap exhaustion.

**One task**, record first, then capture. After
`007_published_close_odds.sql`. The **:16/:46 11–22 ET** laptop
task still records MLB window props; close capture should use the
recommended cron below (08:56–22:56) so London 9:30 AM ET NFL is
not missed.

**Recommended cron** (`TZ=America/New_York`):

```
0,4,16,26,36,46,56 8-22 * * *
```

That is `CLOSE_CAPTURE_RECOMMENDED_CRON`. Empty window is a 0-credit
no-op (no `/v4/sports` probe, no event-odds calls), so a generic
08:56 start is cheap on days with no morning games. A day-aware
08:56-only-when-London-plays schedule is optional, not required.

Hours **11–22 ET** regular season (**12–22** postseason) still wrap
`record-mlb-window-props`. After that SQL:

```bash
node scripts/record-mlb-window-props.js
node scripts/capture-published-closes.js --apply
# Footer prints ODDS_BUDGET_STATUS=ok|floor|daily_cap|monthly_cap|probe_failed (exit 0).
# Any value other than ok is WARN in the hourly report — do not treat exit 0 as all-clear.
# postseason (12–22 ET):
node scripts/record-mlb-window-props.js --postseason
node scripts/capture-published-closes.js --apply
```

PowerShell: `npm.ps1` swallows the first `--`, so `--apply` is lost
and `--max-calls 3` leaves a stray `3`. Do not pass flags through
`npm run capture:published-closes`. Prefer the dedicated apply script:

```bash
npm run capture:published-closes:apply
node scripts/capture-published-closes.js --apply
```

PowerShell env form (a leftover `CLV_APPLY` in the session makes later
plain runs apply — clear it after, or prefer the npm apply script):

```powershell
$env:CLV_APPLY=1; node scripts/capture-published-closes.js
```

Kill switch: `CLOSING_CAPTURE=0`. Caps: `--max-calls N` (includes the
`/v4/sports` quota probe; `--max-calls 0` skips it),
`--min-remaining N` (default 50), `ODDS_CLOSE_CAPTURE_DAILY_CAP`
(default **40** paid event-odds captures per ET day). Close capture
is still gated by `lib/odds-api-budget.js`, including
`ODDS_CLOSE_CAPTURE_RESERVE`. Credits = markets × regions
(`ODDS_CLOSE_CAPTURE_REGIONS`, default `us` = 1).

Two passes in the same `capture-published-closes.js` run (pre-start
only):

- **Early:** T−35..T−10 (env `CLOSE_CAPTURE_WINDOW_MINUTES` /
  `CLOSE_CAPTURE_NEAR_START_MINUTES`). First close. Writes
  `closeOdds` only where it is NULL.
- **Near-start:** T−10..T−1 (min lead 1 minute). Overwrites the
  Published close and upserts `clvclose:` `ClosingOdds` rows on
  `id` (`ClosingOdds` TEXT PK, `onConflict: id`). SQL 008's partial
  unique index is extra protection, not required for that upsert.
  Skip the overwrite when Odds API `commence_time` is missing or
  unparseable, within 60s of now, or the quote `last_update` is
  at/after `commence_time`, so a live in-play price cannot replace
  a good close.

Only Published (and shadow-published) picks' markets are requested
unless `--nfl-all`. One Odds API call per `oddsApiEventId`. Requires
`SUPABASE_SECRET_KEY` (`SUPABASE_REQUIRE_SECRET_KEY=1`; anon refused).

The laptop task at **:16 and :46 ET (11:16–22:46)** covers the
early pass (35 minutes, interval 30 < window 35). It **misses most
T−10..T−1 kickoffs** — with min lead 1, only start minutes :18–:26
and :48–:56 fall in the near-start window at those run times. Quiet
`:05–:15` ET cannot host a run. A **:04** run covers **:06–:14
kickoffs** and stops writing at `:05`. **:05** kickoffs are covered
by **:56 / :00**. Remaining near-start gaps are **:15–:17** and
**:27 / :37 / :47 / :57** — those still get their close from the
**early pass** (~T−15 or later, e.g. `:00` for `:15–:17`, `:16`
for `:27`). An 11:00 start also misses morning games (London NFL
9:30 AM ET); 08:56 is T−34 (early pass) and 09:26 is near-start.

**Recommended cron** (still skip quiet `:05–:15`; empty window costs
0 credits): `TZ=America/New_York` + `0,4,16,26,36,46,56 8-22 * * *`.

Footer (always **exit 0**):

```
CLOSE_CAPTURE_STATUS=ok|partial|failed
CLOSE_CAPTURE_CAPTURED=<n> CLOSE_CAPTURE_SKIPPED_BUDGET=<n> CLOSE_CAPTURE_SKIPPED_QUIET=<n> CLOSE_CAPTURE_SKIPPED_WINDOW=<n> CLOSE_CAPTURE_CREDITS=<n>
```

Any status other than `ok` is WARN in the hourly report.

### Close-capture monthly credit estimate

Cap is 40 event-odds **captures**/ET day (not the morning 10-market
slate). Credits = markets × regions (typically 2–4 Published markets,
`regions=us` → 1).

| Assumption | Credits / day | Credits / 30-day month |
| --- | --- | --- |
| Typical MLB (8–12 games, one pass) | ~20–40 | ~600–1,200 |
| Hit the 40-capture cap at 3 markets | 120 | 3,600 |
| Plus NFL Sunday (second near-start pass on some games) | +20–40 | +80–160 / month |

`ODDS_CLOSE_CAPTURE_RESERVE` default 200 still holds morning fetch
below the daily cap so this job is not starved. 40 captures × 5
markets = 200 credits, inside that reserve. CLV math and grading
are unchanged.

### Published odds snapshots (informational)

Path from the morning post to the close for **Published picks only**.
Never shadow-published, never unpublished pending archive. CLV stays
entry vs consensus close — these rows are not used in `clvProb`.

```bash
node scripts/snapshot-published-odds.js
node scripts/snapshot-published-odds.js --apply
npm run snapshot:published-odds:apply
```

PowerShell: do not pass flags through `npm run snapshot:published-odds`.
`--apply` or `SNAPSHOT_APPLY=1`. Kill switch: `ODDS_SNAPSHOT=0`.
`ODDS_SNAPSHOT_MAX_CREDITS_PER_PASS=0` also disables snapshots
(logged clearly; no setup fetches).
Requires 011 SQL (`OddsSnapshot`). The script warns and does not crash
on `42P01` / `PGRST204` / `42703` if 011 is not applied.

One event-odds call per `oddsApiEventId`, only the markets those
Published picks need, `regions=us`. Kickoff must be after T−35
(games inside the close-capture window, or ≤60s from start, are
skipped). Skips events whose saved quotes are fresher than 90
minutes (`ODDS_SNAPSHOT_FRESH_MINUTES`). Refuses to start
`:04:30–:15` ET so setup SELECTs cannot run in the window; re-checks
quiet immediately before insert.

Caps: max **2** passes / ET day (`ODDS_SNAPSHOT_DAILY_PASSES`),
max **8** event calls / pass (`ODDS_SNAPSHOT_MAX_EVENT_CALLS`), and
max **24** credits / pass (`ODDS_SNAPSHOT_MAX_CREDITS_PER_PASS`).
Still gated by `lib/odds-api-budget.js` (daily / monthly / remaining
floor 3,000). Purpose is `snapshot`, so the close-capture reserve
still holds. Overlapping applies share a lockfile on the pass
counter. Does not change morning fetch, `--apply-stale`, or close
capture.

Footer:

```
SNAPSHOT_STATUS=ok|partial|failed
SNAPSHOT_EVENTS=<n>
CALLS_USED=<n>
CREDITS=<n>
```

| Assumption | Credits / pass | Credits / month |
| --- | --- | --- |
| Typical NFL Sunday (8 events, 2 markets) | ~16 | ~32 / Sunday × 4 ≈ 128 |
| Typical NHL night (4–6 events, 1–2 markets) | ~6–12 | ~20 NHL days × 2 passes × 10 ≈ 400 |
| Both passes hit the 8-event × 3-market cap | 24 | ≤1,440 if every day |

Typical month: **~500–900**. Worst case at the caps: **≤1,440**. Still
well under the 16.5k plan budget with morning + close capture.

### Published NFL alt lines (informational)

Shop alternate lines for **Published NFL picks only** so the public
board can show best line+price combos (Over 64.5 −110 vs Over 62.5
−135), not only juice at the posted number. Never shadow-published,
never unpublished pending archive. CLV stays entry vs consensus close
at the **same line** — alt lines are not used in `clvProb` or grading.

Separate script. Morning fetch runs before the Published slate exists
and already bills 5 NFL main markets per event; piggybacking would
either miss Published-only targeting or multiply morning credits.
Snapshot / close-capture routines stay unchanged.

```bash
node scripts/fetch-published-nfl-alt-lines.js
node scripts/fetch-published-nfl-alt-lines.js --apply
npm run fetch:nfl-alt-lines:apply
```

PowerShell: do not pass flags through `npm run fetch:nfl-alt-lines`.
`--apply` or `NFL_ALT_APPLY=1`. Kill switch: `ODDS_NFL_ALT=0`.
`ODDS_NFL_ALT_DAILY_CREDITS=0` also disables.
Requires 012 SQL (`altQuotes` / `altQuoteUpdatedAt` on
`PlayerPropCache`). The script warns and does not crash on `PGRST204`
/ `42703` if 012 is not applied. A Published prop with no cache row
gets a non-playable placeholder (`isStale: true`, `confidence: 'low'`,
`category: alt-placeholder`, edge and quality 0). Public prop queries
already require `isStale = false`, so the placeholder is not a board
play. Morning cleanup keeps that category until kickoff, then
`past_game` archives and deletes it. No parseable kickoff: the
exemption ends at `fetchedAt` + 7 days. `clear-stale-props` does not
read or delete during the :05–:15 ET quiet window. Public boards hide
a price whose `fetchedAt` is older than 24 hours even when `expiresAt`
is still in the future.

One event-odds call per `oddsApiEventId`, only the official NFL
`*_alternate` markets those Published picks need, `regions=us`.
Kickoff must be after T−35. Skips events whose `altQuotes` are fresher
than 90 minutes (`ODDS_NFL_ALT_FRESH_MINUTES`). Refuses to start
`:04:30–:15` ET; re-checks quiet immediately before write.

Hard cap: max **48** credits / ET day (`ODDS_NFL_ALT_DAILY_CREDITS`),
enforced at job selection (soonest kickoff first) against today's
persisted spend (`.local/odds-nfl-alt.json`). Overlapping applies
share the #87 exclusive lockfile (owner token, stale after 15 min,
re-read before delete). Re-selects under the lock against freshly
read spend and records spend per call. Still gated by
`lib/odds-api-budget.js` (daily / monthly / remaining floor 3,000).
Purpose is `nfl-alt`, so the close-capture reserve still holds.
Re-checks quiet before each cache write and holds remaining rows
as JSONL. Does not change morning fetch, `--apply-stale`, close
capture, or snapshots.

Footer:

```
NFL_ALT_STATUS=ok|partial|failed
NFL_ALT_EVENTS=<n>
CALLS_USED=<n>
CREDITS=<n>
```

| Assumption | Credits | Notes |
| --- | --- | --- |
| Typical NFL Sunday (8 events × 2 matching alt markets) | ~16 | Published slate only |
| Typical month (4 Sundays) | ~64 | Quiet weekdays skip |
| Daily cap (hard) | 48 | `ODDS_NFL_ALT_DAILY_CREDITS` |
| Worst month, NFL days only (~8) | ≤384 | Cap × NFL days |
| Worst month if run every day | ≤1,488 | Cap × 31; still under 16.5k with existing 6–10.5k |

Uncapped Published-only Sundays stay small (matching markets only).
The 48/day cap is the hard stop so a busy slate cannot surprise the
budget. Combined worst case stays under the 16.5k plan.

`--nfl-all` is opt-in. With it, every pending NFL prop in the window
that still has no close is targeted (Published bar ignored), and each
NFL game's existing event-odds request also asks for `h2h`, `spreads`,
and `totals`. Prop closes still write `closeOdds` / `closeLine` /
`closeCapturedAt`. Game-line closes write one `ClosingOdds` row per
book + market. A row counts as already captured only if `id` starts
with `clvclose:`. `snapshot_at` is ignored — `snapshot-closing-lines`
stamps insert time, so a T−30 snapshot must not block the true close.
`ClosingOdds.id` is TEXT (Prisma `String`, SQL `TEXT PRIMARY KEY`).
Deterministic `clvclose:` ids are the primary key; `onConflict: id`
upserts on that PK. Overlapping applies hit `23505` on
`ClosingOdds_pkey` (or `ClosingOdds_close_capture_uniq` / SQL 008 as
extra protection). A batch unique violation is retried row-by-row so
only the duplicate is treated as already captured and the other rows
still insert. Message-only "duplicate" strings are not treated as
captured.

Close capture is idempotent via the `clvclose:` primary key. T−30
snapshot rows are outside SQL 008's partial unique index. If a fetch
returns no book for a market, one
`book=attempted` `clvclose:` row records the miss. That sentinel does
not count as a captured market, so a later pass in the window can
write a real close. A real `clvclose:` row still counts, and the
deterministic id keeps that real row from being inserted twice.

`--max-credits N` stops before the next game would exceed markets ×
regions (us=1), soonest kickoff first. Dry-run prints planned HTTP
calls (quota included; unmapped games excluded) and planned credits,
and ends with `CREDITS_USED` / `CALLS_USED`. Absent the flag, behavior
is unchanged. NHL visibility is unchanged. Prefer the dedicated npm
scripts — do not pass flags through `npm run capture:published-closes`.

```bash
node scripts/capture-published-closes.js --nfl-all --dry-run
node scripts/capture-published-closes.js --nfl-all --apply
npm run capture:published-closes:nfl-all
npm run capture:published-closes:nfl-all:apply
```

### Windows Task Scheduler

The ops laptop runs close capture from Task Scheduler, not a bot routine.
Set the laptop clock to Eastern Time. Triggers use local time. The
wrapper still checks the Eastern minute itself and skips 05–15.

Register once from an interactive PowerShell window, as the user who
will stay logged on. The task is created **disabled**. It stores no
password (`LogonType Interactive`), so it runs only while that user is
logged on. A second start is ignored. Re-run with `-Enable` when the
schedule should fire.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/register-close-capture-task.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ops/register-close-capture-task.ps1 -Enable
```

Task name: `OddsOnDeck Close Capture`. Minutes `:04`, `:16`, `:26`,
`:36`, `:46`, `:56`. Sunday hours 09–23, Saturday 12–23, Monday–Friday
18–23.

Each run is `scripts/ops/scheduled-close-capture.ps1`. It `cd`s to the
repo root, takes an exclusive lock under `.local/clv-capture-calls/`,
and never retries.

1. Dry-run: `node scripts/capture-published-closes.js --nfl-all --game-lines --dry-run`
2. If that plan is 0 HTTP calls, exit.
3. Otherwise apply once: `--apply --max-calls` the minimum of 10 and the calls still left today, `--max-credits 150`.

The per-ET-day usage file is `.local/clv-capture-calls/YYYY-MM-DD.txt`.
Line 1 is calls used. Optional line 2 is `cap=N`. A missing file means
0 used and cap 20. If remaining is 0 and the dry run still plans calls,
the cap increases by 20 and that raise is logged. `CALLS_USED` from the
apply is added to line 1. If that line is missing, the dry-run plan is
added instead. A present `CALLS_USED=0` stays 0.

`-DryRunOnly` stops after the dry run. It does not apply, raise the
cap, or change the usage file.

A one-line summary is appended to
`.local/logs/close-capture-YYYY-MM-DD.log`: ET time,
`CLOSE_CAPTURE_STATUS`, `CAPTURED`, game-line proposed/inserted/skipped/failed,
nonzero `SKIPPED_*`, calls, credits, cap raises, `close_cap` or
`ledger_unreadable`, and an error count. The wrapper does not print
environment values or secret material. Both `.local` paths are
gitignored by `/.local/`.

Same-day doubleheaders are skipped when StatsAPI `doubleHeader` is
`Y` or `S` (fetch-fresh-games keeps one row / first gamePk). Safe to
run when there are no MLB games — record prints "No MLB games in the
recording window" and exits 0.

Preview (no Odds API, no writes):

```bash
node scripts/capture-published-closes.js --dry-run
```

Read-only CLV (same-line only; line-moved rows are excluded):
`node scripts/report-published-clv.js`

Line-moved NFL closes (closeLine != recorded threshold) can be listed
with `node scripts/clear-bad-nfl-closes.js --date YYYY-MM-DD` (dry-run
default). `--apply` writes a JSONL backup then nulls the close fields.
Do **not** run `--apply` against production. Refused in CI / hosted prod.

Capture now requests each prop's matching `*_alternate` market on the
same event-odds call (credits = markets × regions) and matches only the
exact recorded line. Missing exact-line quotes stay empty for a later
retry. Consensus close is the median book on that line, not max juice.

### During Games (Every 15-30 min)
```bash
node scripts/update-scores-safely.js all
```
MLB: `lib/mlb-live-status.js` maps Live/In Progress (including 9th inning) to
`in_progress` and only marks `final` on true Final/F/Game Over. If MLB returns
`final` but ESPN is still in progress — or the MLB payload still looks live
without an explicit Final — the updater keeps `in_progress`. Recently finalized
MLB rows (last 4 hours) are re-checked so a sticky false final can self-heal.

### After Games
```bash
# Props first (box-score actuals), then parlays/Featured.
# Do not reverse this — parlays read PropValidation.actualValue.
npm run validate:all
node scripts/check-validation-status.js

# Independent NFL outcome archive (ESPN public endpoints, no Odds API).
# Recurring postgame/correction routine — a one-time backfill is not a substitute.
# --from/--to are inclusive UTC days. 8:15 PM ET on an Eastern date is the next UTC day.
# Safe to re-run later the same week for stat corrections (identical hashes are no-ops).
npm run archive:nfl
# or: node scripts/archive-nfl-box-scores.js --season 2026 --week <n>
# Coverage only (file-level, exits 2 on integrity failure): npm run archive:nfl:audit

# Local only: rewrite Featured pending/wrong cards from current PropValidation
npm run regrade:featured
```

### End of Day
```bash
node scripts/clear-stale-props.js  # Prep for tomorrow
```

## 🔑 Required Environment Variables

Your `.env.local` must have:
```env
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_service_role_key  # Required for write operations!
ODDS_API_KEY=your_odds_api_key
```

### ESPN injuries + NHL starting goalies

`scripts/fetch-injuries.js` pulls ESPN public injuries for NFL and NHL
(`site.api.espn.com/.../injuries`) and NHL probable/confirmed starters
from the ESPN scoreboard / game summary. If ESPN has no (or incomplete)
goalie data, it falls back to NHL's free `api-web.nhle.com`
(`/v1/score/{date}` and `/v1/gamecenter/{id}/landing`,
`matchup.goalieComparison`). Zero Odds API credits. Timeouts and retries;
no new npm dependencies.

Apply `scripts/migrations/009_injury_report.sql` once in the SQL Editor
(creates `InjuryReport` and `NhlStartingGoalie`, RLS on, no anon policies).
Do not run it from CI. If the tables are missing, the script logs WARN
and continues; persist/auto-save skip the filter the same way.

Footer (always exit 0):

```
INJURIES_STATUS=ok|partial|failed
INJURIES_NFL=<n> INJURIES_NHL=<n> STARTERS_NHL=<n>
```

Any status other than `ok` is WARN in the morning report.

Writes during `:05–:15` ET are allowed — this is the 8:09 morning
snapshot, same exemption class as `fetch-fresh-games` Game upserts
(`ignoreQuietPeriod`). Do not add a quiet-period no-op here.

A league is replaced only when it parsed **>0** rows (goalies: rows
covering the scoreboard / slate teams). Empty or malformed ESPN JSON
keeps existing rows and sets `INJURIES_STATUS=partial` — it does not
wipe. Upsert stamps `fetchedAt` with a run timestamp, then deletes
older rows for that date+sport whose `teamAbbr` is in the new set
(`fetchedAt < runStamp`). A team ESPN omitted keeps its earlier rows.
An upsert failure skips prune. `INJURIES_STATUS=partial` when the NHL
goalie fallback fails or a league parse is empty.

Cache insert, Published persist, and auto-save skip Out / IR / Doubtful
and NHL **confirmed**-starter backups. Name matches are scoped to the
prop `gameId` home/away teams (PlayerPropCache has no team). Unresolved
teams or two injury hits FLAG (`injury:questionable` / `injury:ambiguous`)
instead of skip. Questionable players and unconfirmed starters are
flagged on `PropValidation.notes`. If today's snapshot is empty the
filter logs `injury filter skipped (no rows today)`. NHL sides/totals
are not published today; the same unconfirmed-starter flag applies if a
game-line row is passed in. Grading and CLV math are unchanged.

### Odds API credit budget

`fetch-live-odds.js` and `capture-published-closes.js` share `lib/odds-api-budget.js`.
Every Odds API response is read for `x-requests-remaining`, `x-requests-used`,
and `x-requests-last`. Each run logs credits used and remaining. The API key
is never logged.

Daily usage is persisted at `.local/odds-api-budget.json` (gitignored). The
Odds API only reports month-to-date remaining/used; there is no daily header,
so a small local ledger is the right place — same class of laptop-only file
as the research JSONL archives. Override the path with `ODDS_BUDGET_PATH`.
This is not a production DB write.

| Env | Default | Meaning |
| --- | --- | --- |
| `ODDS_DAILY_CREDIT_CAP` | `1500` | Stop before the next call would exceed today's ET credits |
| `ODDS_MONTHLY_CREDIT_CAP` | `17000` (or `ODDS_API_QUOTA` if set) | Stop before month-to-date `x-requests-used` would exceed |
| `ODDS_REMAINING_FLOOR` | `3000` | Stop when remaining would fall under this |
| `ODDS_CLOSE_CAPTURE_RESERVE` | `200` | Credits `fetch-live-odds` holds back each ET day so close capture is not starved |
| `ODDS_CLOSE_CAPTURE_DAILY_CAP` | `40` | Paid close-capture event-odds fetches allowed per ET day (both passes) |
| `ODDS_SNAPSHOT_DAILY_PASSES` | `2` | Max published-odds snapshot passes per ET day |
| `ODDS_SNAPSHOT_MAX_EVENT_CALLS` | `8` | Max event-odds calls per snapshot pass |
| `ODDS_SNAPSHOT_MAX_CREDITS_PER_PASS` | `24` | Max markets × regions credits per snapshot pass. `0` disables snapshots |
| `ODDS_SNAPSHOT_FRESH_MINUTES` | `90` | Skip an event when saved quotes are newer than this |
| `ODDS_NFL_ALT` | (unset) | `0` / `false` / `off` disables the NFL alt-line shop |
| `ODDS_NFL_ALT_DAILY_CREDITS` | `48` | Max markets × regions credits per ET day for alt lines. `0` disables |
| `ODDS_NFL_ALT_FRESH_MINUTES` | `90` | Skip an event when saved altQuotes are newer than this |
| `ODDS_PROBE_FAIL_CREDIT_CAP` | `100` | If `/v4/sports` fails and there are no quota headers from today, cap this run at this many credits |
| `ODDS_NFL_ADJACENT_PROPS_TTL_HOURS` | `48` | Skip refetching NFL props for games not on today's ET date when cache is this fresh |
| `ODDS_BUDGET_PATH` | `.local/odds-api-budget.json` | Ledger path, resolved from the repo root (not the working directory) |

When a cap or the floor would be crossed, further Odds API calls are skipped
and the process exits **0**. Treat any `ODDS_BUDGET_STATUS` other than `ok` as
**WARN** in routine morning and hourly reports — exit 0 is not an all-clear.
Each run starts with a free `/v4/sports` probe so leftover remaining/used
from a previous ET day cannot block today. If that probe fails and the
ledger has no headers from today, `fetch-live-odds` fail-closes: status
`probe_failed`, WARN line, and spend is capped at
`ODDS_PROBE_FAIL_CREDIT_CAP` (default 100). Today's headers still gate
as usual.

Footer lines:

```
ODDS_BUDGET_STATUS=ok|floor|daily_cap|monthly_cap|probe_failed|close_cap|game_line_cap|ledger_unreadable
ODDS_CREDITS_USED=<n>
ODDS_CREDITS_REMAINING=<n|unknown>
```

If status is not `ok`, a second line is printed:

```
⚠️ ODDS_BUDGET_STATUS=<value> — treat as WARN in routine reports (exit 0)
```

Close capture still uses its existing `--max-calls` / `--max-credits` /
`--min-remaining` (default 50) HTTP/credit flags plus
`ODDS_CLOSE_CAPTURE_DAILY_CAP` (default 40 captures). The budget guard is an
extra layer. Morning fetch subtracts
`ODDS_CLOSE_CAPTURE_RESERVE` from the daily cap so a heavy slate cannot
spend the last ~200 credits before hourly close capture. Hitting the
40-capture cap sets `ODDS_BUDGET_STATUS=close_cap`.
Game-line closes persist `gameLineCredits` on that same ET day
(`ODDS_GAME_LINE_CLOSE_DAILY_CAP`, default 12) and stay out of the prop
headroom (`ODDS_CLOSE_CAPTURE_PROP_HEADROOM`, default 28 of the 40 slots).
A paid call reserves its credits under a ledger lock before the request
and reconciles to `x-requests-last` after the response. A dropped
response keeps the reservation.

Today's NFL props still use the midnight-ET cache clamp. Adjacent-day NFL
games in the fetch window reuse a fresh PlayerPropCache row for that game
instead of burning another 5-market event-odds call.

## ⚠️ Key Points

1. **Run `clear-stale-props.js` FIRST every day** - prevents yesterday's props from showing
2. **Use `--cache-fresh` flag** - ensures proper gameTime mapping from Game.date
3. **SUPABASE_SECRET_KEY is required** - for `clear-stale-props.js`, `fetch-live-odds.js`, `fetch-team-performance-data.js`, `calculate-game-edges.js`
4. **Windows PowerShell** - `npm run <script> -- --flag` can drop the flags. Run `node scripts/<file>.js --flag`, or `npm run x --% -- --flag`.

## Prisma client + git worktrees

Morning ops and Prisma-backed scripts (`auto-validate-parlays.js`, etc.) need a generated client at `node_modules/.prisma/client/index.js`. `npm ci` / `npm install` run `prisma generate` via the `postinstall` script (`prisma` is a runtime dependency, not a devDependency). Fetch/edge preflight is **warn-only** and never exits 1 — those scripts do not import Prisma. `scripts/auto-validate-parlays.js` calls `ensurePrismaClient()` and fails closed. Repair prefers `node require.resolve('prisma/build/index.js') generate`; `npx prisma generate` is a secondary fallback only — a missing `node_modules/.bin/prisma.cmd` makes `npx` fail with `'prisma' is not recognized`.

- **Never junction `node_modules` into a git worktree.** A junction reuses another checkout's generated client and breaks `@prisma/client`.
- Run `npm ci` in **each** worktree so it gets its own `node_modules`.
- If a junction already exists, remove it with `cmd /c rmdir <link>` (**no `/s`** — `/s` would delete the junction target's files). Then run `npm ci` in the worktree.

## 🔐 Security

- These scripts contain real API keys
- Never commit this directory to version control
- Keep local only for operational use

## 📁 Key Scripts

```
scripts/
├── clear-stale-props.js        # Archive then delete past/expired props (RUN DAILY!)
├── archive-nfl-box-scores.js   # Independent NFL box-score archive / coverage audit
├── fetch-fresh-games.js        # ESPN slate; vanish writes with --apply-vanish (never --apply-stale)
├── reconcile-games.js          # Retire ghost / flipped MLB games (dry-run default; --apply writes)
├── fetch-live-odds.js          # Fetch odds/props from Odds API (PAID)
├── fetch-published-nfl-alt-lines.js # Published NFL alt lines (PAID, dry-run default)
├── fetch-team-performance-data.js # ESPN team records / PPG (run before edges)
├── update-scores-safely.js     # Live score updates (FREE)
├── calculate-game-edges.js     # Calculate edges (requires secret key)
├── check-validation-status.js  # Check validation results
├── report-final-score-mismatch.js # Read-only stored vs ESPN/StatsAPI finals (200/sport; all=600)
└── report-mlb-legacy-abbr.js   # Read-only OAK/CWS leftover counts (no writes)

operations/
└── backfill-nfl-game-season.mjs # Null NFL Game.season backfill (dry-run default; --apply)
```

## 🔗 Related Docs

- `DAILY_OPERATIONS.md` - Full daily workflow guide
- `DAILY_QUICK_START.md` - Quick copy-paste commands
- `VALIDATION_SYSTEM_GUIDE.md` - Validation details
- `docs/mlb-ath-chw-backfill.md` - OAK/CWS leftover report + Anthony-only SQL
