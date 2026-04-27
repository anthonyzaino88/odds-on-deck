# 🎯 Odds on Deck - Complete Operations Checklist

## 📅 Updated: Apr 13, 2026

## 📋 Table of Contents
1. [Daily Operations Workflow](#daily-operations-workflow)
2. [Core Node Scripts](#core-node-scripts)
3. [Operations Scripts](#operations-scripts-private)
4. [Validation System](#validation-system)
5. [Data Archive Pipeline](#data-archive-pipeline)
6. [API Endpoints](#api-endpoints)
7. [Database & Data Flow](#database--data-flow)
8. [Troubleshooting Scripts](#troubleshooting-scripts)

---

## 🌅 Daily Operations Workflow

### ⚠️ CRITICAL: Run Steps In Order!

### Morning Routine (Before Games)
```bash
# STEP 0: Clear stale props (CRITICAL - Run First!)
# Removes yesterday's props and prevents old data from showing
node scripts/clear-stale-props.js

# STEP 1: Fetch all games from ESPN (FREE API)
node scripts/fetch-fresh-games.js all

node scripts/fetch-fresh-games.js mlb

# STEP 2: Fetch odds and props from The Odds API
# Use --cache-fresh to ensure proper gameTime mapping!
node scripts/fetch-live-odds.js all --cache-fresh

# STEP 3: Calculate betting edges (OPTIONAL - for edge analysis)
node scripts/calculate-game-edges.js
```

### ⚡ One-Liner (PowerShell)
```powershell
node scripts/clear-stale-props.js; node scripts/fetch-fresh-games.js all; node scripts/fetch-live-odds.js all --cache-fresh
```

### ⚡ One-Liner (Bash/CMD)
```bash
node scripts/clear-stale-props.js && node scripts/fetch-fresh-games.js all && node scripts/fetch-live-odds.js all --cache-fresh
```

### Before First Pitch / Puck Drop
```bash
# Capture closing lines for games starting soon (run 30-60 min before)
node scripts/snapshot-closing-lines.js
```

### During Games (Every 15-30 min)
```bash
# Update live scores for all sports
node scripts/update-scores-safely.js all

# OR: Update specific sport
node scripts/update-scores-safely.js nhl
node scripts/refresh-nhl-scores.js  # NHL-specific alternative
```

### After Games Complete
```bash
# Validate completed prop predictions (standalone, no dev server needed)
# Now also archives full box score stats to GameBoxScore table
node scripts/validate-pending-props.js

# Or validate via API (requires dev server on localhost:3000)
npm run validate:all

# Check validation status
node scripts/check-validation-status.js

```

### End of Day / Before Bed
```bash
# Clear stale props to prep for tomorrow
# Now archives props to ArchivedPropLine before deleting
node scripts/clear-stale-props.js

# Clean up old games (optional, run periodically)
# Now archives games/odds to ArchivedGame + ClosingOdds before deleting
node scripts/cleanup-old-games.js
```

---

## 📜 Core Node Scripts

### 🧹 Daily Cleanup (`scripts/`) - RUN FIRST!

| Script | Purpose | Usage |
|--------|---------|-------|
| `clear-stale-props.js` | **CRITICAL:** Clear past/expired props | `node scripts/clear-stale-props.js` |
| `clear-stale-props.js --dry-run` | Preview what will be deleted | `node scripts/clear-stale-props.js --dry-run` |

**What it clears:**
- Props where `gameTime <= now` (past games)
- Props where `expiresAt <= now` (expired)
- Props where `isStale = true`

⚠️ **Requires `SUPABASE_SECRET_KEY` in `.env.local`**

---

### 🎮 Game Fetching (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `fetch-fresh-games.js` | Fetch games from ESPN API | `node scripts/fetch-fresh-games.js [nfl\|nhl\|all]` |
| `fetch-live-odds.js` | Fetch odds/props from Odds API | `node scripts/fetch-live-odds.js [nfl\|nhl\|all] --cache-fresh` |
| `list-nhl-games.js` | List all NHL games in DB | `node scripts/list-nhl-games.js` |

**Important Flags:**
- `--cache-fresh` - Forces fresh fetch, ensures proper `gameTime` mapping from `Game.date`
- `--dry-run` - Preview without saving to database

---

### 📊 Score Updates (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `update-scores-safely.js` | Update live scores (all sports) | `node scripts/update-scores-safely.js [nhl\|nfl\|all]` |
| `refresh-nhl-scores.js` | NHL live score refresh | `node scripts/refresh-nhl-scores.js` |

---

### ✅ Validation Scripts (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `run-validation-check.js` | Run validation checks | `node scripts/run-validation-check.js` |
| `check-validation-status.js` | View validation summary | `node scripts/check-validation-status.js` |
| `check-pending-parlays.js` | List pending parlays | `node scripts/check-pending-parlays.js` |
| `manual-validate-nhl-props.js` | Manually validate NHL props | `node scripts/manual-validate-nhl-props.js` |
| `force-validate-old-props.js` | Force validate old props | `node scripts/force-validate-old-props.js` |
| `backfill-validations.js` | Backfill historical validations | `node scripts/backfill-validations.js` |

**NPM Scripts:**
```bash
npm run validate:all       # Validate everything
npm run validate:parlays   # Validate parlays only
```

---

### 🔧 Data Maintenance (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `clear-stale-props.js` | **DAILY:** Archive + clear expired props | `node scripts/clear-stale-props.js` |
| `cleanup-old-games.js` | Archive + remove old game records | `node scripts/cleanup-old-games.js` |
| `snapshot-closing-lines.js` | Capture closing odds before game time | `node scripts/snapshot-closing-lines.js` |
| `delete-old-games.js` | Delete old games | `node scripts/delete-old-games.js` |
| `remove-duplicate-games-by-espn-id.js` | Remove duplicate games | `node scripts/remove-duplicate-games-by-espn-id.js` |
| `export-all-data.js` | Export all data from DB | `node scripts/export-all-data.js` |
| `backup-data.js` | Backup database data | `node scripts/backup-data.js` |

---

### 📈 Edge Calculation (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `calculate-game-edges.js` | Calculate game betting edges (ML, totals) | `node scripts/calculate-game-edges.js` |
| `calculate-prop-edges.js` | Calculate player prop edges | `node scripts/calculate-prop-edges.js` |
| `clear-edge-snapshots.js` | Clear old edge data | `node scripts/clear-edge-snapshots.js` |
| `find-real-value-props.js` | Line shopping for real edges | `node scripts/find-real-value-props.js` |

⚠️ **Requires `SUPABASE_SECRET_KEY` in `.env.local`**

---

### 🏒 PPP (Power Play Points) Analysis (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `analyze-ppp-performance.js` | Full PPP analysis with ROI calculations | `node scripts/analyze-ppp-performance.js` |
| `deep-ppp-analysis.js` | Detailed risk analysis for PPP | `node scripts/deep-ppp-analysis.js` |
| `test-ppp-monitor.js` | Test PPP health monitoring | `node scripts/test-ppp-monitor.js` |

**PPP Key Metrics (Dec 2025):**
- Win Rate: 95.8%
- ROI: +10.5%
- Breakeven Threshold: 89%
- ⚠️ High variance: 1 loss = 9 wins to recover

**PPP Filters Applied:**
- Parlays: ALL PPP Unders excluded (only Overs allowed)
- Editor's Picks: Under 0.5 PPP and heavily juiced (>85% implied) excluded
- UI: Warning labels shown for PPP props

---

## 🔐 Operations Scripts (Private)

Located in `operations/` - NOT pushed to GitHub (contains API keys)

### Core Operations

| Script | Purpose | Usage |
|--------|---------|-------|
| `fetch-live-odds.js` | Main odds/props fetcher | `node operations/fetch-live-odds.js nhl --cache-fresh` |
| `fetch-team-performance-data.js` | Team stats from ESPN | `node operations/fetch-team-performance-data.js` |
| `update-scores-safely.js` | Live score updates | `node operations/update-scores-safely.js` |
| `sync-today-games.js` | Sync today's games | `node operations/sync-today-games.js` |

---

## ✅ Validation System

### How Validation Works

```
1. User saves prop picks → RecordPropPrediction() → PropValidation table (status: pending)
2. Game completes → Game status changes to "final"
3. Run validation script → Fetches actual stats from ESPN → Updates result
4. Result calculated: correct/incorrect/push based on actual vs threshold
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/validation.js` | Core validation logic (Supabase) |
| `lib/quality-score.js` | Quality scoring algorithm |
| `lib/vendors/nhl-game-stats.js` | NHL stat fetching from ESPN |
| `lib/vendors/nfl-game-stats.js` | NFL stat fetching from ESPN |
| `lib/vendors/mlb-game-stats.js` | MLB stat fetching |

### Validation Statuses

- `pending` - Awaiting game completion
- `completed` - Result determined (correct/incorrect/push)
- `needs_review` - Requires manual review

---

## 📦 Data Archive Pipeline

### Purpose
All cleanup scripts now archive data before deleting. This quietly builds the
training dataset needed for a future predictive model (Path B) without changing
the user-facing product or daily workflow.

### Archive Tables (Supabase)

| Table | What It Stores | Populated By |
|-------|---------------|--------------|
| `ArchivedGame` | Completed games with final scores, weather, pitchers/QBs | `cleanup-old-games.js` |
| `ClosingOdds` | Last known odds per book/market before game time | `cleanup-old-games.js`, `snapshot-closing-lines.js` |
| `ArchivedPropLine` | Full prop cache snapshots (lines, edge, quality) | `clear-stale-props.js`, `snapshot-closing-lines.js` |
| `GameBoxScore` | Full player stats (JSON) from box scores | `validate-pending-props.js` |

### Archive Scripts

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `snapshot-closing-lines.js` | Captures closing odds + prop lines before game time | 30-60 min before first game |
| `clear-stale-props.js` | Archives props → `ArchivedPropLine`, then deletes | Morning + end of day |
| `cleanup-old-games.js` | Archives games/odds → `ArchivedGame` + `ClosingOdds`, then deletes | Periodically |
| `validate-pending-props.js` | Archives box scores → `GameBoxScore` after validating | After games complete |

### Setup (One-Time)
```bash
# Run the migration SQL in Supabase SQL Editor:
# File: scripts/migrations/001_archive_tables.sql
```

### Data Growth Estimates
- ~15 games/day × 365 = ~5,500 archived games/year
- ~50 odds lines/game = ~275,000 closing odds/year
- ~200 props/day = ~73,000 archived prop lines/year
- ~15 games × ~30 players = ~164,000 box score rows/year

After 3-6 months: 10,000+ labeled predictions with full context (market lines,
closing odds, box scores, weather, pitchers) — enough to train a real model.

---

## 💾 Database & Data Flow

### Data Pipeline

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   ESPN API      │────▶│  fetch-fresh-    │────▶│   Game Table    │
│   (Free)        │     │  games.js        │     │   Team Table    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐             │
│  The Odds API   │────▶│  fetch-live-     │◀────────────┘
│  (20k/month)    │     │  odds.js         │
└─────────────────┘     └──────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
           ┌──────────────┐        ┌──────────────────┐
           │  Odds Table  │        │ PlayerPropCache  │
           │  (h2h/spread │        │ (Player props)   │
           │   /totals)   │        │ gameTime from    │
           └──────────────┘        │ Game.date!       │
                                   └──────────────────┘
```

### Key Database Tables

| Table | Purpose | Lifecycle |
|-------|---------|-----------|
| `Game` | All games (NFL, NHL, MLB) | Rotated daily → archived |
| `Team` | Team information | Persistent |
| `Odds` | Game odds (moneyline, spreads, totals) | Rotated with games → archived |
| `PlayerPropCache` | Cached player props | Rotated daily → archived |
| `PropValidation` | Prop prediction tracking | Persistent |
| `Parlay` | Saved parlays | Persistent |
| `EdgeSnapshot` | Calculated betting edges | Rotated with games |
| `ArchivedGame` | Completed game results | **Permanent** |
| `ClosingOdds` | Final odds before game time | **Permanent** |
| `ArchivedPropLine` | Historical prop line snapshots | **Permanent** |
| `GameBoxScore` | Full player box score stats (JSON) | **Permanent** |

### Important PlayerPropCache Fields

| Field | Purpose |
|-------|---------|
| `gameId` | Links to Game.id |
| `gameTime` | **CRITICAL:** Used for filtering future props |
| `expiresAt` | When the cache expires |
| `isStale` | Manually marked as stale |

---

## 🔍 Troubleshooting

### Yesterday's Props Still Showing?
```bash
# This is the most common issue - run this first!
node scripts/clear-stale-props.js

# Check what's still in cache with past gameTime
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
async function check() {
  const now = new Date().toISOString();
  const { data } = await supabase.from('PlayerPropCache').select('playerName, gameTime, sport').lt('gameTime', now).limit(5);
  console.log('Props with past gameTime:', data?.length || 0);
  data?.forEach(p => console.log('-', p.playerName, p.sport, p.gameTime));
}
check();
"
```

### NHL Props Not Showing on Picks Page?
```bash
# Clear and re-fetch with --cache-fresh
node scripts/clear-stale-props.js
node scripts/fetch-live-odds.js nhl --cache-fresh
```

### Props Have Wrong gameTime?
The `gameTime` is set from `Game.date` when props are fetched. If it's wrong:
1. Check that `Game.date` is correct in the database
2. Re-fetch with `--cache-fresh` flag

### No Games Showing?
```bash
node scripts/list-nhl-games.js
node scripts/fetch-fresh-games.js all
```

---

## 🔑 Environment Variables Required

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_service_role_key  # REQUIRED for write operations!

# The Odds API
ODDS_API_KEY=your_odds_api_key
ODDS_API_QUOTA=20000  # Monthly quota
```

---

## 📝 Important Notes

1. **Order Matters**: Clear stale → Fetch games → Fetch odds
2. **Clear Stale Props DAILY**: Run before fetching new odds
3. **Use --cache-fresh in Morning**: Ensures proper gameTime mapping
4. **SUPABASE_SECRET_KEY Required**: For clear-stale-props, fetch-live-odds, calculate-game-edges
5. **Rate Limiting**: Odds API has limits - don't run too frequently
6. **Timezone**: All times stored in UTC, displayed in EST

---

## 🚀 Quick Reference Commands

### Start Development
```bash
npm run dev  # Start Next.js dev server
```

### Full Daily Refresh (Copy & Paste)
```bash
# Morning - before games (RUN IN ORDER!)
node scripts/clear-stale-props.js           # Step 0: Archive + clear stale
node scripts/fetch-fresh-games.js all       # Step 1: Fetch games
node scripts/fetch-live-odds.js all --cache-fresh  # Step 2: Fetch odds
node scripts/calculate-game-edges.js        # Step 3: Calculate edges

# Before first game (30-60 min before)
node scripts/snapshot-closing-lines.js      # Capture closing lines

# During games (run every 15-30 min)
node scripts/update-scores-safely.js all

# After games complete (archives box scores automatically)
node scripts/validate-pending-props.js

# End of day
node scripts/clear-stale-props.js           # Archive + clear stale
```

---

*Last Updated: April 13, 2026*
*Added data archive pipeline for Path B model training*
