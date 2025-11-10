# Daily Operations Checklist

Complete guide for running all necessary scripts to keep the Odds on Deck app fully functional.

## 🎯 Quick Reference

**Minimum Daily Run (Morning):**
```bash
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js nfl
node scripts/fetch-live-odds.js nhl
node scripts/calculate-game-edges.js
node scripts/save-top-props-for-validation.js
```

**During Games (Every 15-30 min):**
```bash
node scripts/update-scores-safely.js
```

---

## 📋 Complete Daily Workflow

### Step 1: Morning Setup (Before Games Start)
**Time:** 8-10 AM EST  
**Frequency:** Once per day

#### 1.1 Update Team Performance Data
```bash
node scripts/fetch-team-performance-data.js
```
**What it does:**
- Fetches current team records (W-L)
- Gets home/away splits
- Updates average points for/against
- **Required for:** Edge calculation accuracy

**Expected output:** Team records updated for all active sports

---

#### 1.2 Fetch Live Odds & Player Props
```bash
# NFL (run on Thu-Mon during season)
node scripts/fetch-live-odds.js nfl

# NHL (run daily during season)
node scripts/fetch-live-odds.js nhl

# MLB (run daily during season)
node scripts/fetch-live-odds.js mlb
```

**What it does:**
- Fetches latest moneyline, spread, and totals odds
- Fetches player props (passing, rushing, receiving, goals, assists, etc.)
- Saves to `PlayerPropCache` and `Odds` tables
- Maps odds to games using team name matching

**Expected output:**
- X games mapped with odds
- X player props saved
- Shows which games have odds coverage

**⚠️ Important:** Uses The Odds API (20,000 calls/month on $30 plan)

---

#### 1.3 Calculate Game Edges
```bash
node scripts/calculate-game-edges.js
```

**What it does:**
- Calculates betting edges for moneyline and totals
- Uses team performance data + current odds
- Saves to `EdgeSnapshot` table
- **CRITICAL:** Required for Editor's Picks to show game picks (ML/O-U)

**Expected output:**
```
✅ Processed: X games
Home ML: X% edge | Away ML: X% edge
Over: X% edge | Under: X% edge
```

**⚠️ Without this:** Editor's Picks will only show player props, no game picks!

---

#### 1.4 Save Top Props for Validation
```bash
node scripts/save-top-props-for-validation.js
```

**What it does:**
- Automatically saves top 200 player props to validation system
- Tracks multiple quality tiers (70+, 65-70, 60-65)
- Builds sample size for system improvement

**Expected output:**
- X props saved to PropValidation
- Breakdown by quality tier

**Optional:** Can skip if not actively using validation system

---

### Step 2: During Games (Live Updates)
**Time:** When games are in progress  
**Frequency:** Every 15-30 minutes

```bash
node scripts/update-scores-safely.js
```

**What it does:**
- Updates scores for in-progress games
- Updates game status (scheduled → in_progress → halftime → final)
- Updates NFL quarter/time data
- Updates NHL period data
- **Never creates duplicate games**

**Expected output:**
- X games updated
- Current scores and status for each game

**⚠️ Important:** Only updates games with status: scheduled, in_progress, halftime

---

### Step 3: Post-Game (Optional)
**Time:** After games finish  
**Frequency:** Once after day's games complete

#### 3.1 Validate Completed Props
Check the validation dashboard to see results:
```
http://localhost:3000/validation
```

**Manual actions:**
- Review "needs_review" props if any
- Check win rate by sport
- Monitor system performance

---

## 🔄 Refresh Cycles

### NHL Season (Oct-Apr)
```bash
# Morning (9 AM)
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js nhl
node scripts/calculate-game-edges.js
node scripts/save-top-props-for-validation.js

# During games (every 20 min, 7-11 PM EST)
node scripts/update-scores-safely.js
```

### NFL Season (Sep-Feb)
```bash
# Thursday Morning
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js nfl
node scripts/calculate-game-edges.js
node scripts/save-top-props-for-validation.js

# Sunday Morning (before 1 PM games)
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js nfl
node scripts/calculate-game-edges.js

# Monday Morning (before MNF)
node scripts/fetch-live-odds.js nfl
node scripts/calculate-game-edges.js

# During games (every 30 min)
node scripts/update-scores-safely.js
```

### MLB Season (Apr-Oct)
```bash
# Morning (10 AM)
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js mlb
node scripts/calculate-game-edges.js
node scripts/save-top-props-for-validation.js

# During games (every 20 min, 1-11 PM EST)
node scripts/update-scores-safely.js
```

---

## 📊 What Each Page Needs

### Game Slate (`/games`)
**Required scripts:**
- ✅ `fetch-live-odds.js` - For odds display
- ✅ `update-scores-safely.js` - For live scores

### Player Props (`/props`)
**Required scripts:**
- ✅ `fetch-live-odds.js` - Populates PlayerPropCache
- ✅ `fetch-team-performance-data.js` - For prop enrichment (team context)

### Editor's Picks (`/picks`)
**Required scripts:**
- ✅ `fetch-live-odds.js` - For player props and odds
- ✅ `fetch-team-performance-data.js` - For edge calculation
- ✅ `calculate-game-edges.js` - **CRITICAL** for game picks (ML/O-U)

### Parlay Generator (`/parlays`)
**Required scripts:**
- ✅ `fetch-live-odds.js` - For player props
- ✅ `fetch-team-performance-data.js` - For prop enrichment

### Validation Dashboard (`/validation`)
**Required scripts:**
- ✅ `save-top-props-for-validation.js` - Auto-saves props to validate
- Manual: Save props from `/props` page

---

## 🚨 Troubleshooting

### No game picks in Editor's Picks (only props)
**Problem:** EdgeSnapshot table is empty  
**Solution:** Run `node scripts/calculate-game-edges.js`

### Props are from old/finished games
**Problem:** PlayerPropCache not filtered by game status  
**Solution:** App now auto-filters, but fetch fresh props: `node scripts/fetch-live-odds.js [sport]`

### Odds showing as 0% edge on props
**Problem:** Expected - player props use bookmaker probability directly  
**Note:** Edge calculation for player props is based on quality score, not custom model

### Live games not updating
**Problem:** update-scores-safely.js not running  
**Solution:** Run it manually or set up cron job

### Monday Night Football not showing
**Problem:** NFL week calculation issue  
**Solution:** Already fixed - refresh app at `/games`

### Props won't save (duplicate error)
**Problem:** Using Date.now() in propId  
**Solution:** Already fixed - now uses stable propId

---

## ⚙️ Automation Options

### Option 1: Cron Jobs (Linux/Mac)

Add to crontab (`crontab -e`):

```bash
# NHL Season - Morning refresh (9 AM EST)
0 14 * * * cd /path/to/project && node scripts/fetch-team-performance-data.js
5 14 * * * cd /path/to/project && node scripts/fetch-live-odds.js nhl
10 14 * * * cd /path/to/project && node scripts/calculate-game-edges.js
15 14 * * * cd /path/to/project && node scripts/save-top-props-for-validation.js

# NHL Season - Score updates during games (7-11 PM EST, every 20 min)
*/20 0-4 * * * cd /path/to/project && node scripts/update-scores-safely.js

# NFL Season - Thursday morning (9 AM EST)
0 14 * * 4 cd /path/to/project && node scripts/fetch-team-performance-data.js
5 14 * * 4 cd /path/to/project && node scripts/fetch-live-odds.js nfl
10 14 * * 4 cd /path/to/project && node scripts/calculate-game-edges.js

# NFL Season - Sunday morning (9 AM EST)
0 14 * * 0 cd /path/to/project && node scripts/fetch-team-performance-data.js
5 14 * * 0 cd /path/to/project && node scripts/fetch-live-odds.js nfl
10 14 * * 0 cd /path/to/project && node scripts/calculate-game-edges.js

# NFL Season - Monday morning (9 AM EST)
0 14 * * 1 cd /path/to/project && node scripts/fetch-live-odds.js nfl
5 14 * * 1 cd /path/to/project && node scripts/calculate-game-edges.js
```

### Option 2: Windows Task Scheduler

Create batch file `daily-refresh.bat`:
```batch
@echo off
cd "C:\Users\zaino\Desktop\Odds on Deck"
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js nhl
node scripts/fetch-live-odds.js nfl
node scripts/calculate-game-edges.js
node scripts/save-top-props-for-validation.js
```

Then schedule in Task Scheduler to run daily at 9 AM.

### Option 3: Vercel Cron (Production)

Already configured in `vercel.json` for score updates. Can add more cron jobs:

```json
{
  "crons": [
    {
      "path": "/api/live-scores/refresh",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/refresh-odds",
      "schedule": "0 9 * * *"
    }
  ]
}
```

---

## 📝 Script Summary Table

| Script | Frequency | When | Required For | API Calls |
|--------|-----------|------|-------------|-----------|
| `fetch-team-performance-data.js` | Daily | Morning | Edge calculation, prop enrichment | ESPN (free) |
| `fetch-live-odds.js [sport]` | Daily | Morning | All odds/props | The Odds API (~500/run) |
| `calculate-game-edges.js` | Daily | After odds | Editor's Picks game picks | None (uses DB) |
| `update-scores-safely.js` | Every 15-30m | During games | Live scores | ESPN (free) |
| `save-top-props-for-validation.js` | Daily | Morning | Validation system | None (uses DB) |

---

## 💰 API Usage Tracking

**The Odds API** ($30/month = 20,000 calls)

Approximate usage per run:
- `fetch-live-odds.js nfl`: ~500 calls (12 games × ~40 calls)
- `fetch-live-odds.js nhl`: ~600 calls (15 games × ~40 calls)
- `fetch-live-odds.js mlb`: ~900 calls (15 games × ~60 calls)

**Daily totals** (during season):
- NHL only: ~600 calls/day = 18,000/month ✅
- NFL only: ~1,500 calls/week (Thu/Sun/Mon) = 6,000/month ✅
- NHL + NFL: ~20,000/month (tight but OK) ⚠️
- Add MLB: Would exceed limit ❌

**Recommendation:** Run NHL + NFL during overlap season, skip MLB or use different API key.

---

## ✅ Daily Checklist

**Every Morning:**
- [ ] Run fetch-team-performance-data.js
- [ ] Run fetch-live-odds.js for active sports
- [ ] Run calculate-game-edges.js
- [ ] Run save-top-props-for-validation.js
- [ ] Check app: Are games showing? Do props load? Are picks displaying?

**During Games:**
- [ ] update-scores-safely.js running every 15-30 minutes
- [ ] Check live scores are updating
- [ ] Check game status changes (scheduled → live → final)

**After Games:**
- [ ] Check validation dashboard for results
- [ ] Review any "needs_review" props

---

## 🎓 Training New Team Members

Show them this checklist and have them run:

```bash
# 1. Morning setup (takes ~2 minutes)
node scripts/fetch-team-performance-data.js
node scripts/fetch-live-odds.js nhl
node scripts/calculate-game-edges.js

# 2. Check the app
# - Visit http://localhost:3000/games - Should see games
# - Visit http://localhost:3000/props - Should see props
# - Visit http://localhost:3000/picks - Should see ML/O-U + props
# - Visit http://localhost:3000/parlays - Should generate parlays

# 3. During a live game
node scripts/update-scores-safely.js
# Check /games page - should see live scores
```

---

## 📞 Support

If you encounter issues:
1. Check the script output for errors
2. Verify API keys are set in `.env.local`
3. Check database connectivity
4. Review recent code changes
5. Check API rate limits (The Odds API dashboard)

---

**Last Updated:** November 10, 2025  
**Version:** 2.0

