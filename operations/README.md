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


**Cleanup failure is not overall OK.** `clear-stale-props.js` exits `1` when candidate reads or archive writes fail, and it deletes nothing. Later ESPN/odds steps may still succeed. Label that morning run **DEGRADED / PARTIAL SUCCESS**, not OK. Parse the `CLEANUP_STATUS=` footer (`ok` or `fail`) plus `CANDIDATES`, `ARCHIVED`, `DELETED`, `SKIPPED_REFETCH`, `SKIPPED_DELETE`, `REMAINING_EXPIRED`, `REMAINING_STALE`, `REMAINING_PAST_GAME`.

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

When `--apply-vanish` writes, vanish-retire ignores the `:05–:15` ET quiet
window (`ignoreQuietPeriod: true`) because this script already upserts Game
rows in that window; `--reconcile --apply` still refuses it. `oddsApiEventId`
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

### Hourly MLB record + close capture (:16 and :46 ET)

Do **not** add this to the :09 ET job. `:05–:15` is a no-write window.

**One task**, record first, then capture. Hours **11–22 ET** regular
season (**12–22** postseason). After `007_published_close_odds.sql`:

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
`--min-remaining N` (default 50). Close window is **35 minutes**
(T−35..T−1, pre-start games only). One Odds API call per
`oddsApiEventId`. Writes only where `closeOdds IS NULL`. Requires
`SUPABASE_SECRET_KEY` (`SUPABASE_REQUIRE_SECRET_KEY=1`; anon refused).
London NFL 9:30 AM ET games are missed on this 11–22 clock.

`--nfl-all` is opt-in. With it, every pending NFL prop in the window
that still has no close is targeted (Published bar ignored), and each
NFL game's existing event-odds request also asks for `h2h`, `spreads`,
and `totals`. Prop closes still write `closeOdds` / `closeLine` /
`closeCapturedAt`. Game-line closes write one `ClosingOdds` row per
book + market. A row counts as already captured only if `id` starts
with `clvclose:`. `snapshot_at` is ignored — `snapshot-closing-lines`
stamps insert time, so a T−30 snapshot must not block the true close.
`ClosingOdds.id` is TEXT (Prisma `String`, SQL `TEXT PRIMARY KEY`).
Deterministic `clvclose:` ids are the primary key; overlapping applies
hit `23505` on `ClosingOdds_pkey` or `ClosingOdds_close_capture_uniq`
(SQL 008). A batch unique violation is retried row-by-row so only
the duplicate is treated as already captured and the other rows still
insert. Message-only "duplicate" strings are not treated as captured.

Close capture is idempotent after SQL 008. T−30 snapshot rows are
outside the partial unique index. If a fetch returns no book for a market, one
`book=attempted` `clvclose:` row marks that market so the game is not
refetched every run.

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
ODDS_BUDGET_STATUS=ok|floor|daily_cap|monthly_cap|probe_failed
ODDS_CREDITS_USED=<n>
ODDS_CREDITS_REMAINING=<n|unknown>
```

If status is not `ok`, a second line is printed:

```
⚠️ ODDS_BUDGET_STATUS=<value> — treat as WARN in routine reports (exit 0)
```

Close capture still uses its existing `--max-calls` / `--max-credits` /
`--min-remaining` (default 50) HTTP/credit flags. The budget guard is an
extra layer and does not change those values. Morning fetch subtracts
`ODDS_CLOSE_CAPTURE_RESERVE` from the daily cap so a heavy slate cannot
spend the last ~200 credits before hourly close capture.

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
├── fetch-team-performance-data.js # ESPN team records / PPG (run before edges)
├── update-scores-safely.js     # Live score updates (FREE)
├── calculate-game-edges.js     # Calculate edges (requires secret key)
├── check-validation-status.js  # Check validation results
└── find-real-value-props.js    # Line shopping for real edges
```

## 🔗 Related Docs

- `DAILY_OPERATIONS.md` - Full daily workflow guide
- `DAILY_QUICK_START.md` - Quick copy-paste commands
- `VALIDATION_SYSTEM_GUIDE.md` - Validation details
