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
node scripts/fetch-fresh-games.js all

# 3. Fetch odds with proper gameTime mapping
node scripts/fetch-live-odds.js all --cache-fresh

# 4. (Optional) Calculate game edges
node scripts/calculate-game-edges.js   # Requires SUPABASE_SECRET_KEY
```

**Cleanup failure is not overall OK.** `clear-stale-props.js` exits `1` when candidate reads or archive writes fail, and it deletes nothing. Later ESPN/odds steps may still succeed. Label that morning run **DEGRADED / PARTIAL SUCCESS**, not OK. Parse the `CLEANUP_STATUS=` footer (`ok` or `fail`) plus `CANDIDATES`, `ARCHIVED`, `DELETED`, `SKIPPED_REFETCH`, `SKIPPED_DELETE`, `REMAINING_EXPIRED`, `REMAINING_STALE`, `REMAINING_PAST_GAME`.

There is **no in-repo wrapper** that aggregates morning status. The Grok Bot morning-ops routine (outside this repo) must apply the prompt change below. This agent does not modify live automation.

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

### Proposed Grok Bot morning-ops prompt change (do not apply from this cloud agent)

Replace overall-success logic. Exact proposed change:

```
Morning ops status (required):

1. Run `node scripts/clear-stale-props.js` first. Record cleanup_exit (process exit code)
   and parse the CLEANUP_STATUS / CANDIDATES / ARCHIVED / DELETED / SKIPPED_REFETCH /
   SKIPPED_DELETE / REMAINING_EXPIRED / REMAINING_STALE / REMAINING_PAST_GAME footer.
2. Always continue independent slate-refresh steps even when cleanup_exit != 0:
   `node scripts/fetch-fresh-games.js all`
   `node scripts/fetch-live-odds.js all --cache-fresh`
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

### During Games (Every 15-30 min)
```bash
node scripts/update-scores-safely.js all
```

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

## ⚠️ Key Points

1. **Run `clear-stale-props.js` FIRST every day** - prevents yesterday's props from showing
2. **Use `--cache-fresh` flag** - ensures proper gameTime mapping from Game.date
3. **SUPABASE_SECRET_KEY is required** - for `clear-stale-props.js`, `fetch-live-odds.js`, `calculate-game-edges.js`

## 🔐 Security

- These scripts contain real API keys
- Never commit this directory to version control
- Keep local only for operational use

## 📁 Key Scripts

```
scripts/
├── clear-stale-props.js        # Archive then delete past/expired props (RUN DAILY!)
├── archive-nfl-box-scores.js   # Independent NFL box-score archive / coverage audit
├── fetch-fresh-games.js        # Fetch games from ESPN (FREE)
├── fetch-live-odds.js          # Fetch odds/props from Odds API (PAID)
├── update-scores-safely.js     # Live score updates (FREE)
├── calculate-game-edges.js     # Calculate edges (requires secret key)
├── check-validation-status.js  # Check validation results
└── find-real-value-props.js    # Line shopping for real edges
```

## 🔗 Related Docs

- `DAILY_OPERATIONS.md` - Full daily workflow guide
- `DAILY_QUICK_START.md` - Quick copy-paste commands
- `VALIDATION_SYSTEM_GUIDE.md` - Validation details
