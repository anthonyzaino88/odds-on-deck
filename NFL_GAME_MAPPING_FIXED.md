# ✅ NFL Game Mapping Issue - FIXED

## 🎯 The Problem

When running `fetch-live-odds.js`, the script was fetching NFL odds and props from The Odds API successfully, but **0 props were being saved** to the database. The logs showed:

```
✅ Fetched props for 28 games
⚠️  Missing 15 game mappings
⚠️  No database game found for Odds API event...
✅ Saved 0 prop records
```

## 🔍 Root Cause

**The Odds API returns games 1-2 weeks in advance, but ESPN only returns the current week by default.**

- **The Odds API** had 28 games (Week 10 + Week 11):
  - 13 games for Nov 9-11 (Week 10) ✅
  - 15 games for Nov 14-18 (Week 11) ❌ Not in database

- **ESPN API** only returned Week 10 games by default
- Without Week 11 games in the database, the props couldn't be saved

## ✅ The Solution (3 Steps)

### Step 1: Fetch Next Week's Games
```bash
node scripts/map-nfl-week-11-to-odds-api.js
```

ESPN's NFL API requires fetching by week number:
- Uses `?week=11&seasontype=2&year=2025` parameter
- Fetched all 15 Week 11 games
- Added correct team ID format (`NFL_` prefix)

### Step 2: Map to Odds API Event IDs
```bash
node scripts/map-nfl-week-11-to-odds-api.js
```

Matched ESPN games to Odds API games by team names:
- All 15 games successfully mapped ✅
- Each game now has an `oddsApiEventId`

### Step 3: Verify Mapping
```bash
# Check all games are mapped
# Result: 28/28 games mapped ✅
```

## 📊 Results

### Before Fix
```
Total NFL games: 13
Mapped to Odds API: 13
Props saved: 0 (15 games missing)
```

### After Fix
```
Total NFL games: 28
Mapped to Odds API: 28
Props can now be saved: YES ✅
```

## 🔧 Files Created

### Production Scripts (Keep)
- `scripts/map-nfl-week-11-to-odds-api.js` - Maps any week's games to Odds API

### How to Use for Future Weeks

**When The Odds API starts returning next week's games:**

```bash
# Step 1: Check what weeks Odds API has
node scripts/fetch-live-odds.js nfl --dry-run

# Step 2: If you see "Missing X game mappings", fetch that week
# Modify the script to fetch the needed week (e.g., week 12)

# Step 3: Map the new games
node scripts/map-nfl-week-11-to-odds-api.js
# (Update script to match the week you fetched)

# Step 4: Verify all games are mapped
# Run a query to check all games have oddsApiEventId
```

## 💡 Key Learnings

### Why This Happened
1. **The Odds API is proactive** - Returns games 1-2 weeks out
2. **ESPN API is week-based** - NFL returns one week at a time
3. **Mapping requires both** - Games must exist before props can be saved

### Best Practice
- **Run game fetch weekly** on Mondays/Tuesdays
- **Check for unmapped games** before fetching props
- **Odds API dates** can be ahead of ESPN dates

## 🚀 Next Steps

1. ✅ NHL time issues resolved
2. ✅ NFL game mapping resolved
3. 🎯 **Ready for props and validation!**

### Run This Weekly
```bash
# Monday/Tuesday: Fetch next week's games
# Check ESPN week number and fetch

# Then fetch odds/props
node scripts/fetch-live-odds.js nfl --cache-fresh
```

## 📝 Summary

**Problem:** 15 NFL games couldn't save props (not in database)
**Solution:** Fetched Week 11 games from ESPN, mapped to Odds API
**Result:** All 28 games mapped, props can now be saved ✅

---

**Status: RESOLVED ✅**
**Date: November 8, 2025**

