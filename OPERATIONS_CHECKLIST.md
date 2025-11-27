# 🎯 Odds on Deck - Complete Operations Checklist

## 📋 Table of Contents
1. [Daily Operations Workflow](#daily-operations-workflow)
2. [Core Node Scripts](#core-node-scripts)
3. [Operations Scripts](#operations-scripts-private)
4. [Validation System](#validation-system)
5. [API Endpoints](#api-endpoints)
6. [Database & Data Flow](#database--data-flow)
7. [Troubleshooting Scripts](#troubleshooting-scripts)

---

## 🌅 Daily Operations Workflow

### Morning Routine (Before Games)
```bash
# STEP 1: Fetch all games from ESPN (FREE API)
node scripts/fetch-fresh-games.js all

# STEP 2: Fetch odds and props from The Odds API
node scripts/fetch-live-odds.js all

# STEP 3: Calculate betting edges (OPTIONAL - for edge analysis)
node scripts/calculate-game-edges.js

# OR: One-liner (all 3 steps)
node scripts/fetch-fresh-games.js all && node scripts/fetch-live-odds.js all && node scripts/calculate-game-edges.js
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
# Validate completed prop predictions
node scripts/validate-pending-props.js

# Check validation status
node scripts/check-validation-status.js
```

---

## 📜 Core Node Scripts

### 🎮 Game Fetching (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `fetch-fresh-games.js` | Fetch games from ESPN API | `node scripts/fetch-fresh-games.js [nfl\|nhl\|all]` |
| `fetch-live-odds.js` | Fetch odds/props from Odds API | `node scripts/fetch-live-odds.js [nfl\|nhl\|all] --cache-fresh` |
| `list-nhl-games.js` | List all NHL games in DB | `node scripts/list-nhl-games.js` |

### 📊 Score Updates (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `update-scores-safely.js` | Update live scores (all sports) | `node scripts/update-scores-safely.js [nhl\|nfl\|all]` |
| `refresh-nhl-scores.js` | NHL live score refresh | `node scripts/refresh-nhl-scores.js` |

### ✅ Validation Scripts (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `validate-pending-props.js` | Auto-validate completed props | `node scripts/validate-pending-props.js` |
| `check-validation-status.js` | View validation summary | `node scripts/check-validation-status.js` |
| `check-pending-validations.js` | List pending validations | `node scripts/check-pending-validations.js` |
| `check-completed-validations.js` | List completed validations | `node scripts/check-completed-validations.js` |
| `manual-validate-nhl-props.js` | Manually validate NHL props | `node scripts/manual-validate-nhl-props.js` |
| `force-validate-old-props.js` | Force validate old props | `node scripts/force-validate-old-props.js` |
| `backfill-old-validations.js` | Backfill historical validations | `node scripts/backfill-old-validations.js` |

### 🔧 Data Maintenance (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `cleanup-old-games.js` | Remove old game records | `node scripts/cleanup-old-games.js` |
| `cleanup-stale-props.js` | Clear expired props cache | `node scripts/clear-stale-props.js` |
| `delete-old-games.js` | Delete old games | `node scripts/delete-old-games.js` |
| `remove-duplicate-games-by-espn-id.js` | Remove duplicate games | `node scripts/remove-duplicate-games-by-espn-id.js` |
| `export-all-data.js` | Export all data from DB | `node scripts/export-all-data.js` |
| `backup-data.js` | Backup database data | `node scripts/backup-data.js` |

### 📈 Edge Calculation (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `calculate-game-edges.js` | Calculate game betting edges (ML, totals) | `node scripts/calculate-game-edges.js` |
| `calculate-prop-edges.js` | Calculate player prop edges | `node scripts/calculate-prop-edges.js` |
| `clear-edge-snapshots.js` | Clear old edge data | `node scripts/clear-edge-snapshots.js` |

#### 🧮 Edge Calculation System Details

**What `calculate-game-edges.js` Does:**
1. Fetches today's scheduled games from database
2. Gets latest odds for each game (h2h, spreads, totals)
3. Calculates edges using sport-specific models:
   - **MLB**: Uses pitcher stats, park factors, team offense/defense
   - **NFL/NHL**: Uses team records, recent form, home/away splits
4. Saves results to `EdgeSnapshot` table

**Edge Types Calculated:**
- `edgeMlHome` - Home team moneyline edge
- `edgeMlAway` - Away team moneyline edge
- `edgeTotalO` - Over total edge
- `edgeTotalU` - Under total edge

**Threshold:** Edges below 2% (ML) or 1% (totals) are not saved

**Key Libraries:**
- `lib/edge.js` - MLB edge model (uses Pythagorean expectation, park factors)
- `lib/edge-nfl-nhl.js` - NFL/NHL model (team strength, recent form, venue)
- `lib/implied.js` - Odds conversion utilities

**When to Run:**
```bash
# After fetching odds in the morning
node scripts/fetch-fresh-games.js all
node scripts/fetch-live-odds.js all
node scripts/calculate-game-edges.js   # <-- After odds are fetched
```

### 🏈 NFL-Specific (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `populate-nfl-rosters.js` | Fetch NFL rosters | `node scripts/populate-nfl-rosters.js` |
| `populate-nfl-rosters-now.js` | Immediate roster fetch | `node scripts/populate-nfl-rosters-now.js` |
| `map-nfl-week-11-to-odds-api.js` | Map NFL games to Odds API | `node scripts/map-nfl-week-11-to-odds-api.js` |

### 🏒 NHL-Specific (`scripts/`)

| Script | Purpose | Usage |
|--------|---------|-------|
| `fix-nhl-game-times-from-espn.js` | Fix NHL times from ESPN | `node scripts/fix-nhl-game-times-from-espn.js` |
| `fix-nhl-dates-and-cleanup.js` | Fix dates and cleanup | `node scripts/fix-nhl-dates-and-cleanup.js` |
| `nhl-time-fix-master.js` | Master NHL time fixer | `node scripts/nhl-time-fix-master.js` |
| `quick-nhl-status.js` | Quick NHL status check | `node scripts/quick-nhl-status.js` |
| `revalidate-nhl-props.js` | Revalidate NHL props | `node scripts/revalidate-nhl-props.js` |

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

### Weekly NFL Operations

| Script | Purpose | Usage |
|--------|---------|-------|
| `fetch-nfl-week-12.js` | Fetch NFL week games | `node operations/fetch-nfl-week-12.js` |
| `map-nfl-week-12-to-odds-api.js` | Map NFL to Odds API | `node operations/map-nfl-week-12-to-odds-api.js` |

### NHL Operations

| Script | Purpose | Usage |
|--------|---------|-------|
| `run-nhl-fetch.js` | NHL fetch wrapper | `node operations/run-nhl-fetch.js` |
| `run-nhl-remap.js` | NHL remap wrapper | `node operations/run-nhl-remap.js` |
| `remap-nhl-event-ids.js` | Remap NHL event IDs | `node operations/remap-nhl-event-ids.js` |
| `fix-det-nyr-time.js` | Fix specific game time | `node operations/fix-det-nyr-time.js` |
| `fix-nhl-games-11-17.js` | Fix Nov 17 NHL games | `node operations/fix-nhl-games-11-17.js` |
| `fix-today-nhl-times.js` | Fix today's NHL times | `node operations/fix-today-nhl-times.js` |

### Verification & Debugging

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-all-mismatches.js` | Check for data mismatches | `node operations/check-all-mismatches.js` |
| `check-validation-status.js` | Validation status check | `node operations/check-validation-status.js` |
| `check-game-data.js` | Check game data | `node operations/check-game-data.js` |
| `check-team-data.js` | Check team data | `node operations/check-team-data.js` |
| `investigate-odds-api.js` | Debug Odds API issues | `node operations/investigate-odds-api.js` |

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

### Validation API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/validation` | GET | Get validation records |
| `/api/validation/check` | GET | Check validation status |
| `/api/validation/update-result` | POST | Update validation result |
| `/api/training/validate` | POST | Validate training props |

### Validation Statuses

- `pending` - Awaiting game completion
- `completed` - Result determined (correct/incorrect/push)
- `needs_review` - Requires manual review

---

## 🌐 API Endpoints

### Game Data

| Endpoint | Purpose |
|----------|---------|
| `/api/games/today` | Get today's games |
| `/api/games/[id]` | Get specific game details |
| `/api/games/live-scores` | Get live scores |
| `/api/live-scoring` | WebSocket-style live updates |

### NHL

| Endpoint | Purpose |
|----------|---------|
| `/api/nhl/fetch-games` | Fetch NHL games |
| `/api/nhl/matchups` | Get NHL matchups |
| `/api/nhl/diagnose` | Debug NHL data issues |
| `/api/nhl/fix-and-fetch` | Fix and refetch NHL data |

### NFL

| Endpoint | Purpose |
|----------|---------|
| `/api/nfl/games` | Get NFL games |
| `/api/nfl/matchups` | Get NFL matchups |
| `/api/nfl/roster` | Get NFL rosters |
| `/api/nfl/props-advanced` | Advanced NFL props |
| `/api/nfl/refresh-current-week` | Refresh current week |

### Props & Parlays

| Endpoint | Purpose |
|----------|---------|
| `/api/props` | Get player props |
| `/api/props/save` | Save prop picks |
| `/api/parlays/generate` | Generate parlays |
| `/api/parlays/save` | Save parlay |
| `/api/parlays/history` | Get parlay history |
| `/api/parlays/validate` | Validate parlay |

### Data Management

| Endpoint | Purpose |
|----------|---------|
| `/api/data/refresh` | Refresh all data |
| `/api/data/background-refresh` | Background data refresh |
| `/api/cron/refresh-slate` | Cron job: refresh slate |
| `/api/cron/live-refresh` | Cron job: live updates |

### Export/Import

| Endpoint | Purpose |
|----------|---------|
| `/api/export/parlays` | Export parlays |
| `/api/export/stats` | Export stats |
| `/api/import/all-data` | Import all data |
| `/api/import/validation-data` | Import validation data |

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
           │   /totals)   │        └──────────────────┘
           └──────────────┘
```

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `Game` | All games (NFL, NHL, MLB) |
| `Team` | Team information |
| `Odds` | Game odds (moneyline, spreads, totals) |
| `PlayerPropCache` | Cached player props |
| `PropValidation` | Prop prediction tracking |
| `Parlay` | Saved parlays |

### Important ID Fields

| Field | Purpose |
|-------|---------|
| `id` | Our internal game ID (format: `AWAY_at_HOME_YYYY-MM-DD`) |
| `espnGameId` | ESPN's game identifier |
| `oddsApiEventId` | The Odds API event identifier |
| `mlbGameId` | MLB-specific game ID |

---

## 🔍 Troubleshooting Scripts

### Root Directory Check Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-games.js` | Check game data | `node check-games.js` |
| `check-props-db.js` | Check props in DB | `node check-props-db.js` |
| `check-props-count.js` | Count props | `node check-props-count.js` |
| `check-odds-api-today.js` | Check today's odds API data | `node check-odds-api-today.js` |
| `check-today-mapping.js` | Check today's game mapping | `node check-today-mapping.js` |
| `check-espn-nhl.js` | Check ESPN NHL data | `node check-espn-nhl.js` |
| `check-nhl-18-games.js` | Check NHL games for 18th | `node check-nhl-18-games.js` |
| `check-validation-discrepancy.js` | Check validation issues | `node check-validation-discrepancy.js` |
| `check-production-parlays.js` | Check production parlays | `node check-production-parlays.js` |
| `check-remaining-parlays.js` | Check remaining parlays | `node check-remaining-parlays.js` |

### Debug Scripts

| Script | Purpose |
|--------|---------|
| `debug-fetch-query.js` | Debug fetch queries |
| `debug-parlay-validation.js` | Debug parlay validation |

---

## 🚀 Quick Reference Commands

### Start Development
```bash
npm run dev  # Start Next.js dev server
```

### Full Daily Refresh (Copy & Paste)
```bash
# Morning - before games
node scripts/fetch-fresh-games.js all
node scripts/fetch-live-odds.js all
node scripts/calculate-game-edges.js    # Calculate betting edges

# During games (run every 15-30 min)
node scripts/update-scores-safely.js all

# After games complete
node scripts/validate-pending-props.js
```

### Check System Status
```bash
# Check games
node scripts/list-nhl-games.js

# Check validation
node scripts/check-validation-status.js

# Check props
node check-props-count.js
```

### Fix Common Issues
```bash
# Fix NHL times
node scripts/fix-nhl-game-times-from-espn.js

# Remove duplicates
node scripts/remove-duplicate-games-by-espn-id.js

# Force fresh odds fetch
node scripts/fetch-live-odds.js nhl --cache-fresh
```

---

## 📝 Important Notes

1. **Order Matters**: Always fetch games BEFORE odds
2. **Wait Between Steps**: Don't run odds script until games script finishes
3. **Rate Limiting**: Odds API has limits - don't run too frequently
4. **Cache**: Props cache for 24h, odds cache for 1h
5. **Duplicates**: Scripts handle duplicates automatically
6. **Timezone**: All times stored in UTC, displayed in EST

---

## 🔑 Environment Variables Required

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# The Odds API
ODDS_API_KEY=your_odds_api_key
ODDS_API_QUOTA=20000  # Monthly quota

# Optional
DATABASE_URL=your_database_url
```

---

*Last Updated: November 2025*

