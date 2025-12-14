# 🎯 Daily Operations Guide - Odds on Deck

## 📅 Updated: Nov 27, 2025

This guide reflects the **honest edge calculation system** with line-shopping and removal of fake edges.

---

## 🌅 Morning Routine (Before Games Start)

### Step 1: Fetch Fresh Games (ESPN - FREE)
```bash
# Fetch all sports
node scripts/fetch-fresh-games.js all

# Or individual sports
node scripts/fetch-fresh-games.js nfl
node scripts/fetch-fresh-games.js nhl
```

**What it does:**
- Fetches game schedules from ESPN API
- Updates game times, statuses, scores
- Creates new games in database
- **100% FREE** - No API costs

---

### Step 2: Fetch Live Odds & Props (The Odds API - PAID)
```bash
# Fetch all sports (costs ~$0.50-2.00 per run depending on games)
node scripts/fetch-live-odds.js all

# Or individual sports
node scripts/fetch-live-odds.js nfl
node scripts/fetch-live-odds.js nhl

# Force fresh cache (ignores rate limits)
node scripts/fetch-live-odds.js all --cache-fresh
```

**What it does:**
- Fetches odds from The Odds API (h2h, totals, spreads)
- Fetches player props (points, assists, etc.)
- Saves to `PlayerPropCache` table
- **COSTS MONEY** - ~$0.25 per API call, ~2-8 calls per sport

**Cost Control:**
- Built-in rate limiting (5 seconds between calls)
- Caches data for 30 minutes
- Use `--cache-fresh` only when needed

---

### Step 3: Find Real Value Props (Line Shopping - OPTIONAL)
```bash
# Find props with real edges via line shopping
node scripts/find-real-value-props.js

# Specify minimum edge threshold
node scripts/find-real-value-props.js --min-edge 0.10
```

**What it does:**
- Compares odds across multiple bookmakers
- Finds **real value** by line shopping
- Identifies props where one book is significantly off
- Saves props with genuine +EV opportunities

**Example Output:**
```
🎯 REAL VALUE FOUND:
Connor McDavid Over 1.5 Points
  Best: +150 (DraftKings)
  Avg: +120 (Market)
  Edge: +8.5% (Real edge via line shopping)
```

---

### ⚡ Quick One-Liner (All Morning Steps)
```bash
node scripts/fetch-fresh-games.js all && node scripts/fetch-live-odds.js all
```

---

## 🏒 During Games (Live Updates)

### Update Live Scores (Every 15-30 minutes)
```bash
# Update all sports
node scripts/update-scores-safely.js all

# Update specific sport
node scripts/update-scores-safely.js nhl
node scripts/update-scores-safely.js nfl

# NHL-specific alternative
node scripts/refresh-nhl-scores.js
```

**What it does:**
- Fetches live scores from ESPN
- Updates game status (scheduled → live → final)
- Updates period/quarter information
- **100% FREE** - Uses ESPN API

---

## ✅ After Games Complete (Validation)

### Step 1: Validate Parlays (Run 2-3 hours after games end)
```bash
# Validate ALL pending parlays (moneylines, totals, player props)
npm run validate:all

# Or just parlays (moneylines + game totals)
npm run validate:parlays

# Or just individual props (player stats)
node scripts/run-validation-check.js
```

**What it does:**
- ✅ **Moneyline validation** - Checks if teams won/lost via ESPN API
- ✅ **Game total validation** - Compares total scores to over/under lines
- ✅ **Player prop validation** - Fetches actual player stats
- ✅ **Updates parlay status** - Marks parlays as WON or LOST

### Step 2: Check Validation Status
```bash
# Check validation system status
node scripts/check-validation-status.js

# Check pending parlays
node scripts/check-pending-parlays.js
```

**What it does:**
- Shows validation system statistics
- Displays win rates by prop type
- Lists pending and completed validations

### ⚡ Quick Evening Validation (After ALL games finish)
```bash
npm run validate:all
```

### 🕐 When to Run Validation
- **NFL**: Run at 11pm ET (after Sunday Night Football)
- **NHL**: Run at 11pm ET (after west coast games)
- **MLB**: Run at 1am ET (after west coast games)

### ⚠️ Known Limitations
- Some player stats may not be available via ESPN API
- Power play points, blocked shots may need manual review
- Game totals require knowing which game to validate

### 🛠️ Manual Cleanup for Stuck Validations
- Inspect what’s stuck: `node scripts/list-pending-validations.js`  
  - Filters via env: `STATUSES` (e.g., `pending,needs_review`), `AFTER_DATE`, `BEFORE_DATE`, `LIMIT`, `SPORT`
- Requeue final games stuck in `needs_review`:  
  - `ACTION=requeue node scripts/requeue-or-close-validations.js`  
  - Optional env: `SPORT`, `AFTER_DATE`, `BEFORE_DATE`, `STATUSES`, `LIMIT` (default 200)
- Close rows whose game record is missing (e.g., deleted backfill game):  
  - `ACTION=close_missing node scripts/requeue-or-close-validations.js`
- Backfill/retry stats & auto-close repeat failures (final games):  
  - `node scripts/backfill-validations.js`  
  - Env: `STATUSES` (default `pending,needs_review`), `LIMIT` (default 300), `MAX_FAILS` (default 3), `GRACE_HOURS` (default 72), `BEFORE_DATE/AFTER_DATE`, `SPORT`

---

## 🧹 Weekly Maintenance (Sunday Night)

### Cleanup Old Data
```bash
# Remove games older than 7 days
node scripts/cleanup-old-games.js

# Clear expired props cache
node scripts/clear-stale-props.js

# Clear old edge snapshots
node scripts/clear-edge-snapshots.js

# Remove duplicate games
node scripts/remove-duplicate-games-by-espn-id.js
```

---

## 📊 Edge Calculation System (POST-CHANGES)

### ⚠️ IMPORTANT CHANGES (Nov 27, 2025)

**What Changed:**
- ✅ Removed fake random edge generation
- ✅ `calculate-prop-edges.js` now sets `edge = 0` (honest, no model)
- ✅ `find-real-value-props.js` finds **real value** via line shopping
- ✅ Removed random probability generators from all scripts

### Current Edge Scripts

#### 1. Game Edges (ML, Totals, Spreads)
```bash
node scripts/calculate-game-edges.js
```
**Status:** Sets `edge = 0` (no projection model)
**Use:** Database structure only, not for actual betting

#### 2. Player Prop Edges
```bash
node scripts/calculate-prop-edges.js
```
**Status:** Sets `edge = 0` (no projection model)
**Use:** Database structure only, not for actual betting

#### 3. Real Value Props (LINE SHOPPING)
```bash
node scripts/find-real-value-props.js
```
**Status:** ✅ **THIS IS THE REAL ONE**
**Use:** Finds actual +EV by comparing bookmakers

---

## 🎯 What To Use for Betting

### ✅ DO USE:
1. **Line Shopping Results** (`find-real-value-props.js`)
   - Real edges found by comparing bookmakers
   - Actual value opportunities

2. **Win Rate Analysis** (Validation Dashboard)
   - Historical performance by prop type
   - 44.9% overall accuracy (as of Nov 27)
   - NHL blocked shots: 56.9% win rate
   - NFL pass yards: 56.8% win rate

3. **Manual Analysis**
   - Player matchups
   - Team trends
   - Injury reports

### ❌ DON'T USE:
1. **Calculated Edges** (`EdgeSnapshot` table)
   - Set to 0 (no real model)
   - Database structure only

2. **Player Prop Edges** (`PlayerPropCache.edge` field)
   - Not from real projections
   - Display purposes only

---

## 📈 Recommended Daily Workflow

### Morning (9:00 AM EST)
```bash
# 1. Fetch games and odds
node scripts/fetch-fresh-games.js all
node scripts/fetch-live-odds.js all

# 2. Find real value (optional)
node scripts/find-real-value-props.js
```

### Pre-Game (30 min before first game)
```bash
# Refresh odds one more time
node scripts/fetch-live-odds.js all
```

### During Games (Every 30 minutes)
```bash
# Update scores
node scripts/update-scores-safely.js all
```

### After Games (11:00 PM EST)
```bash
# Check validation results (validation happens automatically)
node scripts/check-validation-status.js
```

### Weekly (Sunday Night)
```bash
# Cleanup old data
node scripts/cleanup-old-games.js
node scripts/clear-stale-props.js
node scripts/clear-edge-snapshots.js
```

---

## 💰 API Cost Management

### The Odds API Usage (PAID)
- **Sport Odds:** ~$0.25 per call
- **Player Props:** ~$0.25 per call
- **Average Daily Cost:** $2-5 (depending on sports fetched)

### Cost Optimization Tips:
1. **Use caching:** Built-in 30-minute cache
2. **Fetch selectively:** Use `nfl` or `nhl` instead of `all`
3. **Time it right:** Fetch once in morning, once pre-game
4. **Avoid over-fetching:** Don't run every 5 minutes

### ESPN API (FREE)
- Games: `fetch-fresh-games.js` - **FREE**
- Scores: `update-scores-safely.js` - **FREE**
- Run as often as needed

---

## 🔍 Troubleshooting Scripts

### Check What's in Database
```bash
# List all NHL games
node scripts/list-nhl-games.js

# List games with odds
node scripts/list-games-with-odds.js

# Quick NHL status
node scripts/quick-nhl-status.js
```

### Validation Issues
```bash
# Check validation system status
node scripts/check-validation-status.js

# Analyze NHL-specific issues
node scripts/analyze-nhl-validation-issues.js

# Force validate old props
node scripts/force-validate-old-props.js
```

**Note:** Validation is automatic. Manual scripts are only for troubleshooting.

### Data Backup
```bash
# Backup database (if needed)
node scripts/backup-data.js
```

**Note:** Supabase has automatic backups. Manual exports are rarely needed.

---

## 🎮 Frontend URLs

### Production (Vercel)
- **Home:** https://odds-on-deck.vercel.app/
- **Game Slate:** https://odds-on-deck.vercel.app/games
- **Player Props:** https://odds-on-deck.vercel.app/props
- **Parlays:** https://odds-on-deck.vercel.app/parlays
- **Validation:** https://odds-on-deck.vercel.app/validation

### API Endpoints
- **Today's Games:** `/api/games/today`
- **Refresh Scores:** `/api/scores/refresh`
- **Generate Parlays:** `/api/parlays/generate`

---

## ✅ Daily Checklist

### Morning ☀️
- [ ] Run `fetch-fresh-games.js all`
- [ ] Run `fetch-live-odds.js all`
- [ ] (Optional) Run `find-real-value-props.js`
- [ ] Check validation dashboard for win rates

### During Games 🏒
- [ ] Update scores every 30 min
- [ ] Monitor live games on frontend

### After Games 🌙
- [ ] Check validation dashboard (auto-updated)
- [ ] Run `check-validation-status.js` for summary
- [ ] Review performance insights

### Weekly 📅
- [ ] Cleanup old games
- [ ] Clear stale props
- [ ] Export/backup data

---

## 🚨 Important Notes

1. **No Fake Edges:** All random edge generation has been removed
2. **Line Shopping Only:** Real value comes from comparing bookmakers
3. **Validation is Truth:** Use win rate data, not calculated edges
4. **Cost Awareness:** Monitor API usage to control costs
5. **ESPN is Free:** Use it liberally for games and scores

---

## 📞 Support

For issues:
1. Check `OPERATIONS_CHECKLIST.md` for detailed script info
2. Review `HONEST_SYSTEM_ANALYSIS.md` for edge calculation changes
3. See `VALIDATION_SYSTEM_GUIDE.md` for validation details

---

**Last Updated:** Nov 27, 2025  
**System Status:** ✅ Honest edges, no fake generation  
**Win Rate:** 44.9% overall, 56.9% NHL blocked shots, 56.8% NFL pass yds

