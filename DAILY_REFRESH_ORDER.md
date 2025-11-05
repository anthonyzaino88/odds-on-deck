# 📅 Daily Data Refresh - Complete Order

## For Today (11/5/2025) at 11:35 AM

### ✅ **STEP 1: Fetch All Games (NFL & NHL)**

**Option A: Fetch All Sports at Once**
```bash
node scripts/fetch-fresh-games.js all
```

**Option B: Fetch Each Sport Separately**
```bash
# Fetch NFL games
node scripts/fetch-fresh-games.js nfl

# Fetch NHL games  
node scripts/fetch-fresh-games.js nhl
```

**What it does:**
- Fetches today's games from ESPN API
- Saves teams and games to database
- Creates game IDs in format: `AWAY_at_HOME_YYYY-MM-DD`
- Stores `espnGameId` for later use

**Wait for this to complete before moving to Step 2!**

---

### ✅ **STEP 2: Fetch Odds for All Games**

**Option A: Fetch All Sports at Once**
```bash
node scripts/fetch-live-odds.js all
```

**Option B: Fetch Each Sport Separately**
```bash
# Fetch NFL odds
node scripts/fetch-live-odds.js nfl

# Fetch NHL odds
node scripts/fetch-live-odds.js nhl
```

**What it does:**
- Maps games to Odds API events
- Fetches moneyline, spreads, totals
- Fetches player props
- Saves odds to database

**Wait for this to complete!**

---

### ✅ **STEP 3: Refresh Live Scores (Optional - Only if games are active)**

**Only run this if games are currently in progress:**

```bash
node scripts/refresh-nhl-scores.js
```

**What it does:**
- Updates scores for active NHL games
- Updates game status
- Stores period info

**Note:** This runs automatically every 15 seconds via the live scoring system, so you only need to run it manually if you want an immediate update.

---

## 🚀 Quick One-Liner (All Sports)

If you want to refresh everything at once:

```bash
# Fetch all games, then all odds
node scripts/fetch-fresh-games.js all && node scripts/fetch-live-odds.js all
```

---

## 📋 Complete Daily Workflow (Copy & Paste)

**For today (11/5):**

```bash
# 1. Fetch all games
node scripts/fetch-fresh-games.js all

# 2. Wait for completion, then fetch odds
node scripts/fetch-live-odds.js all

# 3. (Optional) Refresh live scores if games are active
node scripts/refresh-nhl-scores.js
```

---

## ⚡ Alternative: Use API Endpoints (Faster)

If your dev server is running, you can use API endpoints instead:

```powershell
# 1. Fetch NHL games
Invoke-WebRequest -Uri "http://localhost:3000/api/nhl/fetch-games" -Method GET

# 2. Fetch NFL games (if you have an endpoint)
# Or use the script for NFL

# 3. Fetch odds (all sports)
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/refresh-slate" -Method POST
```

---

## 🔍 Verify Everything Worked

After running the scripts, verify:

```bash
# List all NHL games
node scripts/list-nhl-games.js

# Check NFL games (if you have a script)
# Or check database directly
```

---

## ⚠️ Important Notes

1. **Order matters!** Always fetch games BEFORE odds
2. **Wait for completion** - Don't run odds script until games script finishes
3. **Date handling** - Scripts use today's date by default (11/5)
4. **Rate limiting** - Odds API has limits, so don't run too frequently

---

## 📊 Expected Output

**Step 1 (Games):**
```
✅ Saved 10 NFL games
✅ Saved 14 NHL games
```

**Step 2 (Odds):**
```
✅ Mapped 10 NFL games
✅ Saved 30 odds records
✅ Mapped 14 NHL games
✅ Saved 42 odds records
```

---

## 🎯 TL;DR - Quick Reference

```bash
# Morning routine (before games start):
1. node scripts/fetch-fresh-games.js all
2. node scripts/fetch-live-odds.js all

# During games (optional):
3. node scripts/refresh-nhl-scores.js
```


