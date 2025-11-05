# 🏒 NHL Games & Data Update Guide

This guide shows you how to update NHL games and game data in your database.

## 📋 Quick Reference

### Option 1: Use API Endpoints (Recommended)
Fast and easy - just visit URLs in your browser or use PowerShell.

### Option 2: Use Node Scripts
More control, can schedule via cron jobs.

---

## 🚀 Option 1: API Endpoints (Easiest)

### 1. Fetch Today's NHL Games

**Browser:**
```
http://localhost:3000/api/nhl/fetch-games
```

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/nhl/fetch-games" -Method GET
```

**What it does:**
- Fetches all NHL teams from ESPN
- Fetches today's NHL games (yesterday, today, tomorrow to handle timezones)
- Stores games in database with ESPN IDs
- Returns: `{ gamesAdded: X, teamsAdded: Y }`

---

### 2. Fetch Games for Specific Date

**Browser:**
```
http://localhost:3000/api/nhl/fetch-date?date=2025-11-04
```

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/nhl/fetch-date?date=2025-11-04" -Method GET
```

**What it does:**
- Fetches NHL games for a specific date
- Updates teams if needed
- Stores games in database

---

### 3. Fetch Odds for NHL Games

**Browser:**
```
http://localhost:3000/api/cron/refresh-slate
```

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/cron/refresh-slate" -Method POST
```

**What it does:**
- Fetches odds for all scheduled games (NFL, NHL, MLB)
- Updates odds in database
- Runs automatically via cron if configured

---

## 🛠️ Option 2: Node Scripts (More Control)

### 1. Fetch Fresh NHL Games

**Command:**
```bash
node scripts/fetch-fresh-games.js nhl
```

**With specific date:**
```bash
node scripts/fetch-fresh-games.js nhl 2025-11-04
```

**What it does:**
- Fetches NHL games from ESPN API
- Creates game IDs in format: `AWAY_at_HOME_YYYY-MM-DD`
- Stores ESPN game IDs for later use
- Saves to Supabase database

**Output:**
```
🔄 Fetching NHL games from ESPN...
✅ Saved 14 NHL games
```

---

### 2. Fetch Odds for NHL Games

**Fetch odds for all games:**
```bash
node scripts/fetch-live-odds.js nhl
```

**Fetch odds for specific date:**
```bash
node scripts/fetch-live-odds.js nhl --date 2025-11-04
```

**Dry run (test without saving):**
```bash
node scripts/fetch-live-odds.js nhl --dry-run
```

**What it does:**
- Fetches odds from The Odds API
- Maps games using team names and dates
- Saves puck line, totals, moneyline odds
- Handles rate limiting automatically

**Output:**
```
📊 Fetching NHL odds for 2025-11-04...
✅ Mapped 12 of 14 games
✅ Saved 45 odds records
```

---

### 3. Fetch Odds for Specific Game

**Command:**
```bash
node scripts/fetch-odds-for-game.js VAN_at_NSH_2025-11-04
```

**What it does:**
- Fetches odds for one specific game
- Useful for debugging or manual updates
- Shows detailed mapping process

---

## 📅 Recommended Daily Workflow

### Morning (Before Games Start)
1. **Fetch today's games:**
   ```
   http://localhost:3000/api/nhl/fetch-games
   ```
   OR
   ```bash
   node scripts/fetch-fresh-games.js nhl
   ```

2. **Fetch odds for today's games:**
   ```
   http://localhost:3000/api/cron/refresh-slate
   ```
   OR
   ```bash
   node scripts/fetch-live-odds.js nhl
   ```

### During Games (If Needed)
- Live scores update automatically via the live scoring system
- No manual action needed

### After Games (If Needed)
- Game data updates automatically when games finish
- Stats are calculated from completed games

---

## 🔍 Troubleshooting

### No games showing up?

1. **Check if games exist in database:**
   ```bash
   node scripts/list-nhl-games.js
   ```

2. **Check if games have ESPN IDs:**
   Look for games with `espnGameId: null` - these won't have stats

3. **Re-fetch games:**
   ```bash
   node scripts/fetch-fresh-games.js nhl
   ```

### Odds not showing?

1. **Check if odds exist:**
   ```bash
   node scripts/check-van-nsh-odds.js
   ```

2. **Re-fetch odds:**
   ```bash
   node scripts/fetch-live-odds.js nhl
   ```

3. **Check API key:**
   Make sure `ODDS_API_KEY` is set in `.env.local`

### Shots per game showing as null?

- This is expected if no completed games exist in database
- The system will try to calculate from ESPN game summaries
- Once games finish and are stored, shots will be calculated

---

## 📊 Scripts Overview

| Script | Purpose | Frequency |
|--------|---------|-----------|
| `fetch-fresh-games.js` | Fetch NHL schedule | Daily (morning) |
| `fetch-live-odds.js` | Fetch betting odds | Daily (morning) |
| `fetch-odds-for-game.js` | Fetch odds for one game | As needed |
| `list-nhl-games.js` | List all NHL games | Debugging |
| `check-van-nsh-odds.js` | Check specific game odds | Debugging |

---

## 🎯 Quick Commands Cheat Sheet

```bash
# Fetch today's NHL games
node scripts/fetch-fresh-games.js nhl

# Fetch odds for all NHL games
node scripts/fetch-live-odds.js nhl

# Fetch games for specific date
node scripts/fetch-fresh-games.js nhl 2025-11-04

# List all NHL games
node scripts/list-nhl-games.js

# Check odds for specific game
node scripts/check-van-nsh-odds.js
```

---

## ⚙️ API Endpoints Cheat Sheet

```
# Fetch today's games
GET http://localhost:3000/api/nhl/fetch-games

# Fetch specific date
GET http://localhost:3000/api/nhl/fetch-date?date=2025-11-04

# Refresh odds (all sports)
POST http://localhost:3000/api/cron/refresh-slate
```

---

## 💡 Pro Tips

1. **Always fetch games first** before fetching odds (odds need games to exist)
2. **Use API endpoints** for quick updates (faster than scripts)
3. **Use scripts** for automation or bulk operations
4. **Check logs** if something doesn't work - scripts show detailed output
5. **Rate limiting**: The Odds API has limits, so don't run too frequently

---

## 🔄 Automated Updates (Future)

You can set up cron jobs to run these automatically:

```bash
# Daily at 9 AM - Fetch games
0 9 * * * cd /path/to/project && node scripts/fetch-fresh-games.js nhl

# Daily at 10 AM - Fetch odds  
0 10 * * * cd /path/to/project && node scripts/fetch-live-odds.js nhl
```

Or use Vercel Cron Jobs (see `vercel.json` for cron configuration).



