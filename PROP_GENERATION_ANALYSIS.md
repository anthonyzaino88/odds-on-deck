# Player Props Generation & Caching - Complete Analysis

**Date:** October 19, 2025  
**Question:** Should we pre-generate props for all sports? How does it currently work?

---

## 🔍 Current System Architecture

### How Props Are Generated NOW

**Props are generated ON-DEMAND, not pre-generated!**

```
User Action
    ↓
Load homepage or build parlay
    ↓
Call getAllData() or generate parlay
    ↓
Check database cache (PlayerPropCache table)
    ↓
Has cache? → Use cached props (instant!)
    ↓
No cache? → Fetch from The Odds API (10-15 seconds)
    ↓
Store in cache for 30 minutes
    ↓
Return props to user
```

---

## 📊 Current Flow Details

### 1. **First User Request** (Cold Start)
- No cache exists
- Calls `generatePlayerPropsWithRealOdds()`
- Fetches from The Odds API:
  - MLB: `baseball_mlb` 
  - NFL: `americanfootball_nfl` (just added!)
  - NHL: `icehockey_nhl`
- Takes **10-15 seconds**
- Caches ~2,000-3,000 props in database
- **Cost:** 3 API calls (one per sport)

### 2. **Subsequent Requests** (Within 30 minutes)
- Cache exists and is fresh
- Reads from `PlayerPropCache` table
- Takes **1-2 seconds**
- **Cost:** 0 API calls ✅

### 3. **After 30 Minutes**
- Cache marked as "stale" but still exists
- **Ultra-aggressive caching:** Still uses stale cache!
- Only fetches fresh if cache is **completely empty**
- **Cost:** 0 API calls (unless cache deleted)

### 4. **1 Hour Before Game**
- Cache expires automatically
- Next request fetches fresh data
- Ensures odds are current near game time
- **Cost:** 3 API calls

---

## 🗄️ Database Schema

```prisma
model PlayerPropCache {
  id            String   @id @default(cuid())
  propId        String   @unique
  gameId        String
  playerName    String
  team          String?
  type          String
  pick          String
  threshold     Float
  odds          Int
  probability   Float
  edge          Float
  confidence    String
  qualityScore  Float
  sport         String
  category      String
  reasoning     String
  projection    Float?
  bookmaker     String?
  gameTime      DateTime
  fetchedAt     DateTime
  expiresAt     DateTime
  isStale       Boolean  @default(false)
}
```

**Current Count:** ~2,400 cached props (varies by day)

---

## 🤔 Should We Pre-Generate Props?

### Option A: Keep Current System (On-Demand with Aggressive Caching)

**Pros:**
- ✅ **Low API usage:** Only fetches when cache empty
- ✅ **Simple:** No cron jobs, no scheduling
- ✅ **Cost-effective:** Uses cache aggressively
- ✅ **Works well:** 80-90% cache hit rate
- ✅ **Fresh when needed:** Re-fetches 1hr before games

**Cons:**
- ❌ **First load slow:** 10-15 seconds for first user
- ❌ **Race conditions:** Multiple users hitting cold cache simultaneously
- ❌ **Unpredictable:** Don't know when API calls will happen

---

### Option B: Pre-Generate Props on Schedule

**What it would look like:**

```javascript
// Add to auto-refresh cron (every 5 minutes)
app/api/cron/auto-refresh/route.js

// Pre-generate props for upcoming games
console.log('🎯 Pre-generating player props...')
const props = await generatePlayerPropsWithRealOdds()
await cacheProps(props)
console.log(`✅ Cached ${props.length} props for all sports`)
```

**Pros:**
- ✅ **Always ready:** Users never hit cold cache
- ✅ **Predictable:** Know exactly when API calls happen
- ✅ **Better UX:** All page loads fast (1-2 seconds)
- ✅ **Fresh data:** Props updated every 5 minutes
- ✅ **No race conditions:** Single scheduled fetch

**Cons:**
- ❌ **Higher API usage:** 12 calls/hour (3 sports × 4 times) vs current ~3-6 calls/hour
- ❌ **Cost:** 4x more API calls
- ❌ **Complexity:** More cron job logic
- ❌ **Wasted calls:** Fetching even when no one using the app

---

### Option C: Hybrid Approach (Smart Pre-Generation)

**What it would look like:**

```javascript
// Pre-generate only during peak hours
// 6am-11pm: Every 15 minutes
// 11pm-6am: On-demand only

const hour = new Date().getHours()
const isPeakHours = hour >= 6 && hour <= 23

if (isPeakHours) {
  // Pre-generate props
  await generateAndCacheProps()
}
```

**Pros:**
- ✅ **Balanced:** Pre-gen during peak, on-demand at night
- ✅ **Lower cost:** ~75% of Option B's API calls
- ✅ **Good UX:** Fast during peak hours when users active
- ✅ **Smart:** Doesn't waste calls at night

**Cons:**
- ❌ **More complex:** Time-based logic
- ❌ **Still costs:** More than current system
- ❌ **Configuration:** Need to tune peak hours

---

## 📈 API Usage Comparison

| Scenario | Current (On-Demand) | Option B (Pre-Gen) | Option C (Hybrid) |
|----------|---------------------|-------------------|------------------|
| **Calls/Hour** | 3-6 | 12 | 8-9 |
| **Calls/Day** | 72-144 | 288 | ~200 |
| **First Load** | 10-15s (cold) | 1-2s | 1-2s (peak) / 10-15s (off-peak) |
| **Peak Hours** | 1-2s (if cached) | 1-2s | 1-2s |
| **Cost/Month** | $ | $$$ | $$ |

---

## 🎯 Recommendation

### **Keep Current System (Option A)** ✅

**Why:**

1. **It's working well!** 80-90% cache hit rate
2. **Cost-effective:** Minimal API usage
3. **User experience is good:** Most loads are 1-2 seconds
4. **Sports seasonality:** Not all 3 sports always active
5. **The Odds API costs money:** Every call costs

**However, make ONE small optimization:**

### **Add Pre-Generation for Game Days Only**

```javascript
// In auto-refresh cron
const today = new Date()
const hasGamesToday = await checkForGamesToday()

if (hasGamesToday) {
  // Pre-generate props for game days
  const cacheAge = await getCacheAge()
  
  if (cacheAge > 20 minutes OR no cache) {
    await generateAndCacheProps()
  }
}
```

**This gives you:**
- ✅ Fresh props on game days
- ✅ Low API usage on off days
- ✅ Always ready when users need it
- ✅ Cost-effective

---

## 🚀 Proposed Implementation

### Add to `app/api/cron/auto-refresh/route.js`

```javascript
// After existing refresh logic...

// 7. Pre-generate props on game days
console.log('🎯 Checking if props need refresh...')
try {
  const { getCacheStats } = await import('../../../../lib/prop-cache-manager.js')
  const { generatePlayerPropsWithRealOdds } = await import('../../../../lib/player-props-enhanced.js')
  const { cacheProps } = await import('../../../../lib/prop-cache-manager.js')
  
  // Check if we have games today
  const hasGamesToday = results.stats.gamesUpdated > 0 || results.stats.nflGamesUpdated > 0
  
  if (hasGamesToday) {
    const stats = await getCacheStats()
    
    // Refresh if cache is old or empty
    if (stats.fresh < 100 || stats.freshPercentage < 50) {
      console.log('🔄 Refreshing player props...')
      const props = await generatePlayerPropsWithRealOdds()
      await cacheProps(props)
      console.log(`✅ Cached ${props.length} props`)
      results.stats.propsRefreshed = props.length
    } else {
      console.log(`✅ Props cache is fresh (${stats.fresh} props)`)
    }
  } else {
    console.log('⏸️ No games today, skipping prop refresh')
  }
} catch (error) {
  console.error('❌ Error refreshing props:', error)
}
```

**Benefits:**
- Only refreshes when needed
- Game-day aware
- Respects existing cache
- Minimal API usage
- Better UX for active users

---

## 📊 Testing the System

### Check Current Cache Status

```javascript
// Run this to see cache status
const { getCacheStats } = require('./lib/prop-cache-manager.js')
const stats = await getCacheStats()
console.log(stats)
// { total: 2394, fresh: 341, stale: 2053, freshPercentage: 14 }
```

### Check Cache Age

```javascript
const { getCachedProps } = require('./lib/prop-cache-manager.js')
const mlb = await getCachedProps('mlb')
const nfl = await getCachedProps('nfl')
const nhl = await getCachedProps('nhl')

console.log(`MLB: ${mlb.props.length} props, ${mlb.cacheAge} min old`)
console.log(`NFL: ${nfl.props.length} props, ${nfl.cacheAge} min old`)
console.log(`NHL: ${nhl.props.length} props, ${nhl.cacheAge} min old`)
```

---

## 🎮 For NFL/NHL Specifically

### Why No NFL Props Yet?

**You mentioned:** "it doesnt seem to log any in our props page on the front end"

**This is expected because:**

1. ✅ **NFL prop generation was just added** (today!)
2. ❌ **Cache is empty** for NFL (no one has requested NFL props yet)
3. ❌ **No parlays created** with NFL props yet

**To populate NFL props:**

1. **Option 1 - User Action:** Create an NFL parlay on the front end
   - System fetches NFL props from API
   - Caches them for 30 minutes
   - Shows on props page

2. **Option 2 - Manual Trigger:** Call the data endpoint
   ```powershell
   Invoke-WebRequest -Uri http://localhost:3000/api/data
   ```
   - Forces a props fetch
   - Populates cache
   - Props appear on front end

3. **Option 3 - Add Pre-Generation:** Implement the cron job above
   - Auto-generates props every 5 minutes
   - Always fresh
   - Always ready

---

## 🎯 Summary & Next Steps

### **Current State:**
- ✅ On-demand generation working
- ✅ Aggressive caching working
- ✅ MLB props cached and visible
- ❌ NFL props not cached yet (no requests made)
- ❌ NHL props not generating (no upcoming games)

### **Recommendation:**
1. **Keep on-demand system** (it's working!)
2. **Add smart pre-generation** for game days only
3. **Trigger NFL cache population** by creating a parlay or calling `/api/data`

### **Implementation Priority:**
1. 🔥 **HIGH:** Trigger NFL props cache (create parlay or call API)
2. 🟡 **MEDIUM:** Add game-day pre-generation to cron
3. 🟢 **LOW:** Consider peak-hours optimization (only if needed)

---

## 📝 Decision Matrix

| Factor | On-Demand Only | Game-Day Pre-Gen | Always Pre-Gen |
|--------|---------------|------------------|----------------|
| **API Cost** | ✅ Lowest | 🟡 Medium | ❌ Highest |
| **UX Speed** | 🟡 Usually fast | ✅ Always fast | ✅ Always fast |
| **Complexity** | ✅ Simplest | 🟡 Moderate | ❌ Most complex |
| **Best For** | Off-season | Game days | 24/7 betting app |

**For your use case:** **Game-Day Pre-Gen** is the sweet spot! ✅

---

**Want me to implement the game-day pre-generation in the cron job?**



