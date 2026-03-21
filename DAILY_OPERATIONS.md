# 🎯 Daily Operations Guide - Odds on Deck

## 📅 Updated: Dec 17, 2025

This guide reflects the **honest edge calculation system** with proper stale data cleanup.

---

## 🌅 Morning Routine (Before Games Start)

### Step 1: Clear Stale Props (CRITICAL - Run First!)
```bash
# Clear yesterday's props and any with past game times
node scripts/clear-stale-props.js
```

**What it does:**
- Removes props where `gameTime` has passed (yesterday's games)
- Removes expired props and stale data
- **REQUIRED** before fetching new odds to prevent old data from persisting
- Uses `SUPABASE_SECRET_KEY` from `.env.local` for database writes

⚠️ **Without this step, yesterday's props will continue showing on the Props and Picks pages!**

---

### Step 2: Fetch Fresh Games (ESPN - FREE)
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

### Step 3: Fetch Live Odds & Props (The Odds API - PAID)
```bash
# IMPORTANT: Use --cache-fresh for proper game time mapping!
node scripts/fetch-live-odds.js all --cache-fresh

# Or individual sports
node scripts/fetch-live-odds.js nfl --cache-fresh
node scripts/fetch-live-odds.js nhl --cache-fresh

# Without --cache-fresh (uses cached odds if recent)
node scripts/fetch-live-odds.js all
```

**What it does:**
- Fetches odds from The Odds API (h2h, totals, spreads)
- Fetches player props (points, assists, etc.)
- Saves to `PlayerPropCache` table
- Sets `gameTime` from `Game.date` (ensures future filtering works)
- **COSTS MONEY** - ~$0.25 per API call, ~2-8 calls per sport

**Cost Control:**
- Built-in rate limiting (1 second between calls)
- Caches data for 24 hours for props
- Use `--cache-fresh` in the morning to ensure proper game mapping

---

### Step 4: Find Real Value Props (Line Shopping - OPTIONAL)
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

---

### ⚡ Quick Morning One-Liner (All Steps)
```bash
node scripts/clear-stale-props.js && node scripts/fetch-fresh-games.js all && node scripts/fetch-live-odds.js all --cache-fresh
```

**PowerShell version:**
```powershell
node scripts/clear-stale-props.js; node scripts/fetch-fresh-games.js all; node scripts/fetch-live-odds.js all --cache-fresh
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

### 🕐 When to Run Validation
- **NFL**: Run at 11pm ET (after Sunday Night Football)
- **NHL**: Run at 11pm ET (after west coast games)
- **MLB**: Run at 1am ET (after west coast games)

### ⚠️ Known Limitations
- Some player stats may not be available via ESPN API
- Power play points (PPP) can require play-by-play (NHL API) to validate exactly; if play-by-play fetch fails, it may need manual review
- Game totals require knowing which game to validate

---

## 🧹 Daily Cleanup (End of Day or Before Morning)

### Clear Stale Props (REQUIRED DAILY)
```bash
# Remove props with past game times, expired, or marked stale
node scripts/clear-stale-props.js

# Preview what will be deleted (dry run)
node scripts/clear-stale-props.js --dry-run
```

**What it does:**
- Removes props where `gameTime <= now` (past games)
- Removes props where `expiresAt <= now` (expired)
- Removes props where `isStale = true`
- Prevents yesterday's picks from showing on Props/Picks pages

⚠️ **This is now a DAILY requirement, not just weekly!**

---

## 📅 Weekly Maintenance (Sunday Night)

### Cleanup Old Data
```bash
# Remove games older than 7 days
node scripts/cleanup-old-games.js

# Clear old edge snapshots
node scripts/clear-edge-snapshots.js

# Remove duplicate games
node scripts/remove-duplicate-games-by-espn-id.js
```

---

## 📈 Recommended Daily Workflow

### Morning (9:00 AM EST) - CRITICAL ORDER
```bash
# 1. FIRST: Clear stale props (prevents yesterday's data from showing)
node scripts/clear-stale-props.js

# 2. Fetch fresh games from ESPN
node scripts/fetch-fresh-games.js all

# 3. Fetch odds with --cache-fresh for proper gameTime mapping
node scripts/fetch-live-odds.js all --cache-fresh

# 4. (Optional) Find real value
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
# Validate results
npm run validate:all

# Check validation results
node scripts/check-validation-status.js
```

### Before Bed / End of Day
```bash
# Clear stale props for tomorrow
node scripts/clear-stale-props.js
```

---

## 🔧 Required Environment Variables

Your `.env.local` file must have:

```env
# Required for all operations
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Required for write operations (clear-stale-props, fetch-live-odds, etc.)
SUPABASE_SECRET_KEY=your_service_role_key

# Required for odds fetching
ODDS_API_KEY=your_odds_api_key
```

---

## 💰 API Cost Management

### The Odds API Usage (PAID)
- **Sport Odds:** ~$0.25 per call
- **Player Props:** ~$0.25 per call
- **Average Daily Cost:** $2-5 (depending on sports fetched)

### Cost Optimization Tips:
1. **Use caching:** Built-in cache system
2. **Fetch selectively:** Use `nfl` or `nhl` instead of `all`
3. **Time it right:** Fetch once in morning with `--cache-fresh`, once pre-game without
4. **Avoid over-fetching:** Don't run every 5 minutes

### ESPN API (FREE)
- Games: `fetch-fresh-games.js` - **FREE**
- Scores: `update-scores-safely.js` - **FREE**
- Run as often as needed

---

## 🔍 Troubleshooting

### Yesterday's Props Still Showing?
```bash
# Clear stale props (most common fix)
node scripts/clear-stale-props.js

# If still showing, check what's in cache
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

### NHL Props Not Showing on Editor's Picks?
This usually means `gameTime` wasn't set correctly. Run:
```bash
# Re-fetch with --cache-fresh to fix gameTime
node scripts/clear-stale-props.js
node scripts/fetch-live-odds.js nhl --cache-fresh
```

### No Games Showing?
```bash
node scripts/list-nhl-games.js
node scripts/fetch-fresh-games.js all
```

### Props Not Validating?
```bash
node scripts/check-pending-parlays.js
npm run validate:all
```

---

## ✅ Daily Checklist

### Morning ☀️ (CRITICAL ORDER)
- [ ] Run `clear-stale-props.js` **FIRST**
- [ ] Run `fetch-fresh-games.js all`
- [ ] Run `fetch-live-odds.js all --cache-fresh`
- [ ] (Optional) Run `find-real-value-props.js`
- [ ] Verify Props page shows today's games only

### During Games 🏒
- [ ] Update scores every 30 min
- [ ] Monitor live games on frontend

### After Games 🌙
- [ ] Run `npm run validate:all`
- [ ] Run `check-validation-status.js` for summary
- [ ] Run `clear-stale-props.js` to prep for tomorrow

### Weekly 📅
- [ ] Cleanup old games
- [ ] Clear edge snapshots
- [ ] Review validation performance

---

## 🚨 Important Notes

1. **Clear Stale Props DAILY:** Run before fetching new odds to prevent yesterday's data
2. **Use --cache-fresh in Morning:** Ensures proper gameTime mapping from Game.date
3. **SUPABASE_SECRET_KEY Required:** For `clear-stale-props.js` and `fetch-live-odds.js`
4. **Order Matters:** Clear → Fetch Games → Fetch Odds
5. **ESPN is Free:** Use it liberally for games and scores

---

## 📞 Support

For issues:
1. Check this guide's Troubleshooting section
2. Review `OPERATIONS_CHECKLIST.md` for detailed script info
3. See `VALIDATION_SYSTEM_GUIDE.md` for validation details

---

**Last Updated:** Dec 17, 2025  
**System Status:** ✅ Proper stale data cleanup, correct gameTime mapping  
**Key Fix:** Added daily `clear-stale-props.js` and fixed `gameTime` in fetch script

