# 🎯 Player Props Issues - Root Cause & Solutions

## 📊 Current Status

**Problem:** Player Props page shows "No Player Props Available"

**Terminal Output:**
- ✅ NHL: Fetched 4 games, but **404 errors** on all prop requests
- ✅ NFL: Fetched 28 games of props, but **Saved 0 prop records**  
- ❌ Result: **Zero props in database**

---

## 🔍 Root Causes Identified

### 1. ✅ Prisma Code Migration (FIXED)
**Issue:** `lib/prop-cache-manager.js` was still using Prisma  
**Fix:** ✅ Migrated to Supabase  
**Status:** COMPLETE

### 2. ❌ NHL Event IDs Expired (CRITICAL)
**Issue:** All 4 NHL games have old/expired `oddsApiEventId` values

```
📡 API Call: /v4/sports/icehockey_nhl/events/30fec95005c9a4d5469f1737f9f26163/odds
❌ API Error 404: {"message":"Event not found. The event may have expired..."}
```

**Reason:**
- NHL games were mapped to Odds API events from previous dates
- Those events have expired (games already played or IDs changed)
- The database still has old `oddsApiEventId` values

**Solution:** Re-map NHL games to current Odds API events

### 3. ❌ NFL Game Mapping Failed (CRITICAL)
**Issue:** 15 out of 28 NFL games couldn't be mapped to database games

```
⚠️  No database game found for Odds API event 32ec22bd4ac9e4c40f9f5cbed7e67f837
⚠️  No database game found for Odds API event 265f00188945bb81ec64751571eb724cb
... (13 more)
✅ Saved 0 prop records
```

**Reason:**
- Odds API returns games for Week 11 (Nov 14-18)
- Database only contains games for THIS WEEK (Nov 8-11)
- Week 11 games haven't been fetched from ESPN yet

**Solution:** Fetch NFL games for next week from ESPN

---

## 🔧 Solution Plan

### Phase 1: Fix NFL Game Availability ✅

**Run this to fetch next week's NFL games:**
```bash
node scripts/fetch-fresh-games.js nfl
```

This will:
- Fetch NFL Week 11 games (Nov 14-18) from ESPN
- Add them to database with proper team IDs
- Enable mapping for all 28 NFL games from Odds API

### Phase 2: Re-map NHL Event IDs 🔄

**The Problem:**
- NHL games have `oddsApiEventId` values from old events
- These events have expired (404 errors)
- Need to clear old mappings and re-fetch from current Odds API

**The Fix:**
```bash
# Clear old NHL event IDs
node scripts/clear-nhl-event-ids.js

# Re-fetch odds and props (will map to fresh events)
node scripts/fetch-live-odds.js nhl
```

### Phase 3: Verify Props Saved ✅

```bash
# This should now save props successfully
node scripts/fetch-live-odds.js all

# Expected output:
# ✅ Mapped 28 NFL games
# ✅ Saved 300+ prop records  (NFL props)
# ✅ Mapped 4 NHL games (if fresh events available)
# ✅ Saved 50+ prop records (NHL props)
```

### Phase 4: Check Frontend 🎯

```
http://localhost:3000/props
```

Should now display:
- **NFL Props:** Passing yards, rushing yards, receptions, receiving yards
- **NHL Props:** Points, assists, shots on goal (if available)

---

## 📝 Files Modified

### ✅ Migrated to Supabase:
1. **`lib/prop-cache-manager.js`** - All Prisma → Supabase
   - `getCachedProps()` - Query PlayerPropCache
   - `cacheProps()` - Upsert props
   - `markStaleProps()` - Update stale flags
   - `cleanupOldProps()` - Delete old records
   - `getCacheStats()` - Count queries

### 🔄 Still Uses Prisma (Low Priority):
2. **`lib/parlay-generator.js`** - Uses Prisma
   - Not currently used by the app
   - Can be migrated later when parlays are implemented

### ✅ Already Using Supabase:
3. **`app/api/props/route.js`** - ✅ Already Supabase
4. **`scripts/fetch-live-odds.js`** - ✅ Already Supabase

---

## 🎯 Expected Workflow (After Fix)

### Daily Prop Refresh:
```bash
# 1. Fetch fresh games (NFL updates weekly, NHL daily)
node scripts/fetch-fresh-games.js all

# 2. Map games to Odds API events and fetch props
node scripts/fetch-live-odds.js all

# Output should be:
# ✅ Mapped X NFL games
# ✅ Saved 300+ NFL prop records
# ✅ Mapped X NHL games  
# ✅ Saved 50+ NHL prop records
```

### Verify Props:
```bash
# Check API endpoint
curl http://localhost:3000/api/props?sport=nfl

# Should return JSON with props array
```

### Frontend Display:
- Go to http://localhost:3000/props
- Should see props grouped by sport
- Filter by sport (All Sports, MLB, NFL, NHL)
- Filter by strategy (Safe, Balanced, Value, Home Run)

---

## 🚨 Why Props Weren't Saving

### The Flow:
1. ✅ `fetch-live-odds.js` fetches props from Odds API
2. ❌ **Tries to map Odds API event ID → Database game ID**
3. ❌ **Mapping fails** (old NHL IDs, missing NFL games)
4. ❌ **Props not saved** (can't save without game ID)
5. ❌ **API returns empty** (no props in database)
6. ❌ **Frontend shows "No Props Available"**

### After Fix:
1. ✅ Fresh games in database (NFL Week 11 added)
2. ✅ Fresh NHL event IDs (old ones cleared)
3. ✅ Mapping succeeds (all games found)
4. ✅ Props saved to PlayerPropCache
5. ✅ API returns props
6. ✅ Frontend displays props

---

## 📊 Monitoring

### Check PlayerPropCache Table:
```sql
-- Count total props
SELECT COUNT(*) FROM "PlayerPropCache";

-- Count by sport
SELECT sport, COUNT(*) FROM "PlayerPropCache" 
GROUP BY sport;

-- Check fresh vs stale
SELECT isStale, COUNT(*) FROM "PlayerPropCache"
GROUP BY isStale;

-- Recent props
SELECT * FROM "PlayerPropCache" 
ORDER BY "fetchedAt" DESC 
LIMIT 10;
```

### Check Game Mappings:
```sql
-- NFL games with odds mapped
SELECT COUNT(*) FROM "Game" 
WHERE sport = 'nfl' 
AND "oddsApiEventId" IS NOT NULL;

-- NHL games with odds mapped
SELECT COUNT(*) FROM "Game" 
WHERE sport = 'nhl' 
AND "oddsApiEventId" IS NOT NULL;
```

---

## ✅ Success Criteria

After running the fixes, you should see:

1. **NFL:**
   - ✅ 28 games mapped to Odds API events
   - ✅ 300+ prop records saved
   - ✅ Props display on frontend

2. **NHL:**
   - ✅ 4+ games mapped to current Odds API events
   - ✅ 50+ prop records saved (if props available)
   - ✅ Props display on frontend

3. **Frontend:**
   - ✅ Player Props page shows props
   - ✅ Can filter by sport (NFL, NHL, MLB)
   - ✅ Can filter by strategy (Safe, Balanced, Value)
   - ✅ Props show player name, type, odds, edge, confidence

---

## 🔄 Next Steps

1. ✅ Run `node scripts/fetch-fresh-games.js nfl` - Get Week 11 games
2. 🔄 Create `scripts/clear-nhl-event-ids.js` - Clear old NHL mappings
3. 🔄 Run `node scripts/fetch-live-odds.js all` - Map and fetch props
4. ✅ Verify props on frontend
5. 🔄 Migrate `lib/parlay-generator.js` to Supabase (lower priority)

---

**Status:** Ready to implement fixes  
**Priority:** HIGH (blocks player props feature)  
**Estimated Time:** 15-20 minutes to implement and test


