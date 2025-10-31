# 🏒 NHL Games Missing - Quick Fix

## Problem
NHL games are not showing on the homepage, live scoring, or Today's Slate page.

## Root Cause
NHL games haven't been fetched from the ESPN API and stored in the database yet.

## Solution
Call the new NHL fetch endpoint to populate the database with today's NHL games.

---

## 🚀 How to Fetch NHL Games (2 Options)

### Option 1: Using Your Browser
1. Open this URL in your browser after deployment finishes (2-3 minutes):
   ```
   https://odds-on-deck.vercel.app/api/nhl/fetch-games
   ```

2. You'll see a JSON response like:
   ```json
   {
     "success": true,
     "gamesAdded": 12,
     "teamsAdded": 32,
     "message": "Fetched 12 NHL games and 32 teams"
   }
   ```

3. Refresh your homepage - NHL games will now appear!

### Option 2: Using PowerShell/Terminal
Run this command:
```powershell
Invoke-WebRequest -Uri "https://odds-on-deck.vercel.app/api/nhl/fetch-games" -Method GET
```

Or using curl (if installed):
```bash
curl https://odds-on-deck.vercel.app/api/nhl/fetch-games
```

---

## ✅ What This Endpoint Does

1. **Fetches NHL Teams** from ESPN API (all 32 teams)
   - Stores team names, abbreviations, IDs
   - Prevents duplicate entries

2. **Fetches Today's NHL Games** from ESPN API
   - Gets all games scheduled for today
   - Includes: game times, teams, scores, status
   - Stores in your database

3. **Returns Summary**
   - How many games were added
   - How many teams were added
   - Success/error status

---

## 🎮 Expected Results

After calling the endpoint, you should see NHL games in:

### 1. **Homepage** (`/`)
- NHL game section with live scores
- Quick navigation to NHL games

### 2. **Today's Slate** (`/games`)
- Table with NHL games
- Puck line, total, ML odds
- View details button for each game

### 3. **Live Scores Section**
- Real-time NHL game updates
- Period, score, time remaining

### 4. **Player Props** (`/props`)
- NHL props filter
- NHL player propositions

### 5. **Parlay Generator** (`/parlay-generator`)
- Option to include NHL in parlays
- "🏒 Hockey Only" filter

---

## 🔄 When to Re-fetch

You should re-fetch NHL games:
- ✅ **Daily** - to get new games scheduled for today
- ✅ **After midnight** - to get the next day's slate
- ✅ **When games are missing** - if you notice no NHL games showing

---

## 🤖 Automatic Fetching

The NHL fetch is also included in:
- `/api/cron/refresh-slate` - Full slate refresh (MLB + NFL + NHL)
- `/api/cron/auto-refresh` - Automatic hourly refresh
- `/api/data` with `force=true` - Manual refresh button

But those are rate-limited to protect your Odds API quota!

---

## 🏒 Today's NHL Games (Oct 31, 2025)

Check ESPN to see which games are scheduled tonight:
https://www.espn.com/nhl/scoreboard

Typical Thursday night slate: **8-12 games**

---

## 🐛 Troubleshooting

### Still no NHL games after fetching?

1. **Check the API response** - Did it say `"gamesAdded": 0`?
   - Might mean no NHL games are scheduled today
   - Check ESPN scoreboard to verify

2. **Check team IDs** - NHL teams use `NHL_` prefix
   - Teams: `NHL_1`, `NHL_2`, etc.
   - Games reference these team IDs

3. **Check game status**
   - Games must be `scheduled`, `pre_game`, `in_progress`, or `final`
   - Old/canceled games are filtered out

4. **Clear cache** - Refresh your browser with Ctrl+Shift+R

### Games showing but no odds?

That's expected right now - your Odds API is at its free tier limit until Nov 1st.
The games will show, but odds might be missing until the API resets.

---

## 📊 Database Storage

NHL games are stored in the `Game` table with:
- `sport`: `'nhl'`
- `espnGameId`: ESPN's game ID
- `homeId`: `NHL_X` format
- `awayId`: `NHL_X` format
- `date`: Game date/time
- `status`: `'scheduled'`, `'in_progress'`, `'final'`
- `homeScore`: Current home score
- `awayScore`: Current away score

NHL teams are stored in the `Team` table with:
- `id`: `NHL_X` format (e.g., `NHL_23`)
- `name`: Full name (e.g., "Boston Bruins")
- `abbr`: Abbreviation (e.g., "BOS")
- `sport`: `'nhl'`
- `league`: Eastern/Western
- `division`: Atlantic, Metropolitan, etc.

---

## ✨ Summary

**To fix NHL games not showing:**

1. Wait 2-3 minutes for deployment
2. Visit: `https://odds-on-deck.vercel.app/api/nhl/fetch-games`
3. See success message
4. Refresh homepage
5. Enjoy NHL games! 🏒

**This endpoint is now live and can be called anytime to refresh NHL data!**

---

*Created: October 31, 2025*  
*Deploy status: Pushing to Vercel now...*

