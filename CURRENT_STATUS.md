# Current Status - Odds on Deck (Oct 31, 2025)

## 🎯 What Should Be Showing Today (Oct 31, 2025)

Based on user confirmation:
- ⚾ **MLB: 1 game tonight** (World Series Game 5 or similar)
- 🏈 **NFL: 0 games** (Thursday night game was yesterday)
- 🏒 **NHL: 3 games today** (scheduled for Oct 31)

## ❌ Current Problem

Homepage is showing:
- ❌ MLB: 0 games (should be 1)
- ❌ NFL: 1-14 games (showing wrong games)
- ❌ NHL: 14+ games (should be 3)

## 🔍 Root Cause Identified

1. **Database has stale/incorrect data**
   - NHL games from Oct 29-30 (yesterday's finished games)
   - MLB game from Oct 29 (already final)
   - Games stored with UTC dates causing timezone confusion

2. **Query logic was filtering incorrectly**
   - Date range was too wide (36 hours)
   - Timezone calculations using server time (UTC) not Eastern Time
   - Not filtering out finished games from yesterday

## ✅ Fixes Implemented

### 1. **Timezone Utilities** (`lib/date-utils.js`)
- Created centralized date handling
- All dates now use `America/New_York` timezone
- `getTodaysGamesRange()` - consistent "today" definition
- `getTodayRange()` - midnight to 11:59 PM ET

### 2. **Data Manager Updates** (`lib/data-manager.js`)
- Updated `getTodaysMLBGames()` to use ET dates
- Updated `getThisWeeksNFLGames()` to use ET dates
- Updated `getTodaysNHLGames()` to:
  - Use ET dates
  - Filter out finished games from yesterday
  - Keep live games even if from yesterday
  - Only show games scheduled for today

### 3. **Frontend Updates**
- `app/page.js` - Force dynamic rendering
- `app/games/page.js` - Force dynamic rendering
- Both pages: `export const dynamic = 'force-dynamic'`
- Both pages: `export const revalidate = 0`

### 4. **Debug Endpoints Created**
- `/api/debug/check-game-dates` - Shows what's in database with ET times
- `/api/debug/today-games` - Checks ESPN APIs for today's games
- `/api/nhl/diagnose` - NHL-specific database check
- `/api/nhl/refresh-today` - Deletes old NHL games, fetches fresh
- `/api/live/todays-games-direct` - **NO DATABASE** - Direct ESPN fetch

## 🚧 Current Deployment Issue

**Problem:** Vercel deployment failing with "resource provisioning failed"

**Likely Causes:**
1. Prisma free tier limits reached (too many database operations during testing)
2. Too many rapid deployments (rate limiting)
3. Build timeout or memory issues

**Solutions:**
1. Wait 10-15 minutes for Vercel to reset
2. Check Vercel dashboard for specific error
3. May need to upgrade Prisma plan or reset database
4. Consider using the direct ESPN endpoint (no database) as workaround

## 📝 Next Steps

### Immediate (Once Deployment Works):

1. **Test Direct ESPN Endpoint:**
   ```
   https://odds-on-deck.vercel.app/api/live/todays-games-direct
   ```
   This will show what ESPN says are today's games (no database)

2. **Verify Date Logic:**
   Check that our ET timezone handling is working correctly

3. **Refresh NHL Data:**
   ```
   https://odds-on-deck.vercel.app/api/nhl/refresh-today
   ```
   This will clear old NHL games and fetch fresh

### Long-term:

1. **Database Management:**
   - Add cleanup job to delete old games
   - Reduce database queries
   - Consider caching strategy

2. **Monitoring:**
   - Add logging for date calculations
   - Track which games are being filtered out and why

3. **Testing:**
   - Verify games show correctly for Oct 31
   - Test with different timezones
   - Ensure filtering logic works across sport types

## 🔑 Key Files Modified

```
lib/
  date-utils.js          ← NEW: Timezone utilities
  data-manager.js        ← UPDATED: ET-aware queries
  
app/
  page.js               ← UPDATED: Force dynamic
  games/page.js         ← UPDATED: Force dynamic
  
  api/
    debug/
      check-game-dates/route.js    ← NEW: DB diagnostics
      today-games/route.js         ← NEW: ESPN check
    nhl/
      diagnose/route.js            ← NEW: NHL diagnostics  
      refresh-today/route.js       ← NEW: Fresh NHL data
      fix-and-fetch/route.js       ← EXISTING: Nuclear option
    live/
      todays-games-direct/route.js ← NEW: No DB, direct ESPN
```

## 💾 Database Schema (Prisma)

**Current Provider:** PostgreSQL (for Vercel)

**Key Tables:**
- `Team` - 32 NHL teams, NFL teams, MLB teams
- `Game` - All games with dates, scores, status
- `PlayerPropCache` - Cached prop data
- `PropValidation` - Tracking predictions

**Issue:** May have hit connection limits or query limits

## 🎯 Expected Final Behavior

When working correctly:
1. Homepage loads with `force-dynamic` (always fresh data)
2. Queries use `getTodaysGamesRange()` (ET-based)
3. Filters show only:
   - Games scheduled for TODAY (Oct 31)
   - Games currently LIVE (even if from yesterday)
4. Does NOT show:
   - Finished games from yesterday
   - Games from tomorrow (unless starting late tonight)

## 📊 Testing Commands

```bash
# Check what's in database
curl https://odds-on-deck.vercel.app/api/debug/check-game-dates

# Check what ESPN says (no DB)
curl https://odds-on-deck.vercel.app/api/live/todays-games-direct

# Refresh NHL games
curl -X POST https://odds-on-deck.vercel.app/api/nhl/refresh-today
```

---

**Created:** October 31, 2025  
**Status:** Awaiting successful Vercel deployment  
**Issue:** Resource provisioning failure on Vercel

