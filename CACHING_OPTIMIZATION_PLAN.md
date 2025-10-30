# Caching Optimization Plan - Reduce API Calls

**Date**: October 16, 2025  
**Goal**: Minimize API calls to The Odds API while maintaining data freshness

---

## 🔍 Current State Analysis

### What's Currently Cached ✅

1. **Player Props** (`lib/prop-cache-manager.js`)
   - ✅ Database-backed cache
   - ✅ 30-minute TTL
   - ✅ Expires 60 minutes before game time
   - ✅ Works well!

### What's NOT Cached ❌

1. **Game Odds** (Moneyline, Spreads, Totals)
   - ❌ NO database cache
   - ❌ Only in-memory "opening lines" cache (Map)
   - ❌ Fetched on EVERY data refresh (every 30 seconds!)
   - ❌ **THIS IS THE MAIN PROBLEM**

2. **Game Schedules**
   - ❌ NO cache
   - ❌ Fetched from ESPN/MLB API on every refresh

3. **Live Scores**
   - ❌ NO cache (but this is OK - needs to be fresh)

---

## 📊 API Call Breakdown

### Current API Usage (Per Hour)

| API Call Type | Frequency | Calls/Hour | Can Cache? |
|---------------|-----------|------------|------------|
| **Player Props** | On cache miss | ~2-4 | ✅ Already cached! |
| **Game Odds** | Every 30 sec | **120** ❌ | ✅ YES! |
| **MLB Schedules** | Every 30 sec | 120 | ✅ YES! |
| **NFL Schedules** | Every 30 sec | 120 | ✅ YES! |
| **NHL Schedules** | Every 30 sec | 120 | ✅ YES! |
| **Live Scores** | Every 1-2 min | 30-60 | ⚠️ No (needs fresh) |
| **TOTAL** | - | **~500-600** | - |

### Target API Usage (With Full Caching)

| API Call Type | Frequency | Calls/Hour | Reduction |
|---------------|-----------|------------|-----------|
| **Player Props** | 30-min cache | 2-4 | ✅ Same |
| **Game Odds** | 60-min cache | **1-2** | **98% reduction** ✨ |
| **MLB Schedules** | 60-min cache | 1-2 | **98% reduction** ✨ |
| **NFL Schedules** | 60-min cache | 1-2 | **98% reduction** ✨ |
| **NHL Schedules** | 60-min cache | 1-2 | **98% reduction** ✨ |
| **Live Scores** | 1-2 min | 30-60 | Same |
| **TOTAL** | - | **~40-80** | **90% reduction!** ✨ |

---

## 🎯 Optimization Strategy

### Priority 1: Cache Game Odds (CRITICAL) 🔴

**Problem**: `fetchOdds()` called every 30 seconds, makes 3 API calls (MLB, NFL, NHL)

**Current Code** (`lib/vendors/odds.js`):
```javascript
export async function fetchOdds(sport = 'mlb', date = null) {
  // Rate limiting check
  const usageCheck = await shouldFetchOdds(sport)
  if (!usageCheck.shouldFetch) {
    return [] // ❌ Returns empty, doesn't use cache!
  }
  
  // Fetches from API...
}
```

**Solution**: Add database caching like player props

**New Model** (add to `prisma/schema.prisma`):
```prisma
model GameOddsCache {
  id          String   @id @default(cuid())
  gameId      String
  sport       String
  oddsData    String   // JSON string of odds
  bookmaker   String
  market      String   // h2h, spreads, totals
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  isStale     Boolean  @default(false)
  
  @@index([gameId, sport, market, isStale])
  @@index([expiresAt])
}
```

**New Cache Manager** (`lib/game-odds-cache-manager.js`):
```javascript
const ODDS_CACHE_DURATION = 60 // 60 minutes

export async function getCachedGameOdds(sport) {
  const now = new Date()
  const cached = await prisma.gameOddsCache.findMany({
    where: {
      sport,
      expiresAt: { gt: now },
      isStale: false
    }
  })
  
  if (cached.length > 0) {
    return {
      hasFreshCache: true,
      odds: cached.map(c => JSON.parse(c.oddsData))
    }
  }
  
  return { hasFreshCache: false, odds: [] }
}

export async function cacheGameOdds(odds, sport) {
  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + ODDS_CACHE_DURATION)
  
  for (const odd of odds) {
    await prisma.gameOddsCache.create({
      data: {
        gameId: odd.gameId,
        sport,
        oddsData: JSON.stringify(odd),
        bookmaker: odd.book,
        market: odd.market,
        expiresAt,
        isStale: false
      }
    })
  }
}
```

**Integration** (`lib/vendors/odds.js`):
```javascript
import { getCachedGameOdds, cacheGameOdds } from '../game-odds-cache-manager.js'

export async function fetchOdds(sport = 'mlb', date = null) {
  // 1. Check cache FIRST
  const cached = await getCachedGameOdds(sport)
  if (cached.hasFreshCache) {
    console.log(`✅ Using cached ${sport} odds (${cached.odds.length} odds)`)
    return cached.odds
  }
  
  // 2. Check rate limiting
  const usageCheck = await shouldFetchOdds(sport)
  if (!usageCheck.shouldFetch) {
    console.log(`⏭️ No cache, but rate limited. Returning empty.`)
    return []
  }
  
  // 3. Fetch from API
  console.log(`📊 Fetching ${sport} odds from API...`)
  const res = await fetch(url)
  const data = await res.json()
  const mappedData = mapOddsData(data, new Date())
  
  // 4. Cache the results
  await cacheGameOdds(mappedData, sport)
  
  return mappedData
}
```

**Impact**:
- ✅ 98% reduction in game odds API calls (120/hour → 1-2/hour)
- ✅ Faster page loads (cache hit = instant)
- ✅ Odds stay fresh (60-min TTL is perfect for odds)

---

### Priority 2: Cache Game Schedules (HIGH) 🟡

**Problem**: ESPN/MLB APIs called every 30 seconds to get game schedules

**Current Code** (`lib/data-manager.js`):
```javascript
async function refreshSchedulesAndTeams() {
  // Fetches teams every time
  const mlbTeams = await fetchTeams(true) // force = true!
  
  // Fetches games every time
  const mlbGames = await fetchSchedule({ useLocalDate: true, noCache: true })
}
```

**Solution**: Cache schedules in database

**New Model**:
```prisma
model ScheduleCache {
  id          String   @id @default(cuid())
  sport       String
  date        DateTime
  scheduleData String  // JSON of games
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  
  @@unique([sport, date])
  @@index([sport, expiresAt])
}
```

**Cache Logic**:
```javascript
const SCHEDULE_CACHE_DURATION = 60 // 60 minutes

async function getCachedSchedule(sport, date) {
  const cached = await prisma.scheduleCache.findUnique({
    where: {
      sport_date: { sport, date }
    }
  })
  
  if (cached && cached.expiresAt > new Date()) {
    return JSON.parse(cached.scheduleData)
  }
  
  return null
}
```

**Impact**:
- ✅ 98% reduction in schedule API calls
- ✅ Faster data refresh
- ✅ Less load on free APIs (ESPN, MLB)

---

### Priority 3: Optimize Data Refresh Logic (MEDIUM) 🟢

**Problem**: `refreshAllData()` runs every 30 seconds even if nothing changed

**Current Code** (`lib/data-manager.js`):
```javascript
const dataCache = {
  lastRefresh: null,
  refreshInterval: 30000, // 30 seconds ❌ TOO FREQUENT!
  isRefreshing: false
}

function shouldRefreshData() {
  if (!dataCache.lastRefresh) return true
  
  const timeSinceRefresh = Date.now() - dataCache.lastRefresh.getTime()
  return timeSinceRefresh > dataCache.refreshInterval // Every 30 sec!
}
```

**Solution**: Smart refresh intervals based on data type

```javascript
const REFRESH_INTERVALS = {
  ODDS: 60 * 60 * 1000,       // 60 minutes (odds don't change much)
  PROPS: 30 * 60 * 1000,      // 30 minutes (already cached)
  SCHEDULES: 60 * 60 * 1000,  // 60 minutes (schedules don't change)
  LIVE_SCORES: 2 * 60 * 1000, // 2 minutes (during games)
  GENERAL: 5 * 60 * 1000      // 5 minutes (default)
}

const dataCache = {
  lastRefresh: {
    odds: null,
    props: null,
    schedules: null,
    liveScores: null
  },
  isRefreshing: false
}

function shouldRefreshData(type = 'general') {
  const lastRefresh = dataCache.lastRefresh[type]
  if (!lastRefresh) return true
  
  const timeSinceRefresh = Date.now() - lastRefresh.getTime()
  const interval = REFRESH_INTERVALS[type.toUpperCase()] || REFRESH_INTERVALS.GENERAL
  
  return timeSinceRefresh > interval
}
```

**Impact**:
- ✅ Fewer unnecessary refreshes
- ✅ More intelligent data management
- ✅ Better performance

---

## 🚀 Implementation Steps

### Step 1: Add Odds Caching (30 minutes)

1. **Add database model**:
```bash
# Add to prisma/schema.prisma
npx prisma migrate dev --name add-game-odds-cache
```

2. **Create cache manager**:
```javascript
// lib/game-odds-cache-manager.js
// (Copy from Priority 1 above)
```

3. **Update odds.js**:
```javascript
// lib/vendors/odds.js
// Add cache checks before API calls
```

4. **Test**:
```bash
npm run dev
# Check console logs for cache hits
```

### Step 2: Add Schedule Caching (20 minutes)

1. **Add database model**
2. **Create cache functions**
3. **Update schedule fetchers**
4. **Test**

### Step 3: Optimize Refresh Intervals (10 minutes)

1. **Update `data-manager.js`**
2. **Test different scenarios**
3. **Monitor API usage**

---

## 📊 Expected Results

### Before Optimization

| Metric | Value |
|--------|-------|
| API calls per hour | 500-600 |
| Page load time | 2-3 seconds |
| Cache hit rate | ~20% (props only) |
| Data freshness | 30 seconds |

### After Optimization

| Metric | Value | Improvement |
|--------|-------|-------------|
| API calls per hour | 40-80 | **90% reduction** ✨ |
| Page load time | 0.5-1 second | **2-3x faster** ✨ |
| Cache hit rate | ~80-90% | **4-5x better** ✨ |
| Data freshness | 2-60 minutes | Acceptable |

---

## 🔧 Quick Wins (Do Now!)

### 1. Increase Refresh Interval (5 minutes)

**File**: `lib/data-manager.js`

**Change**:
```javascript
// OLD
refreshInterval: 30000, // 30 seconds ❌

// NEW
refreshInterval: 5 * 60 * 1000, // 5 minutes ✅
```

**Impact**: **90% reduction** in all API calls immediately!

### 2. Add Odds Cache Check (10 minutes)

**File**: `lib/vendors/odds.js`

**Add before API call**:
```javascript
// Check if we already stored odds in database recently
const recentOdds = await prisma.odds.findMany({
  where: {
    sport: sport,
    ts: { gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
  },
  include: { game: true }
})

if (recentOdds.length > 0) {
  console.log(`✅ Using recent ${sport} odds from database`)
  return recentOdds // Transform as needed
}
```

**Impact**: **90% reduction** in odds API calls!

---

## 🎯 Recommended Implementation Order

1. **Quick Win 1**: Increase refresh interval (5 min, huge impact)
2. **Quick Win 2**: Use existing database odds (10 min)
3. **Priority 1**: Full odds caching (30 min)
4. **Priority 2**: Schedule caching (20 min)
5. **Priority 3**: Smart refresh logic (10 min)

**Total Time**: ~1-2 hours for complete optimization
**Total Benefit**: 90% reduction in API calls!

---

## 📝 Monitoring & Validation

### Check API Usage

```javascript
// Add to lib/vendors/odds.js
let apiCallCount = 0

export async function fetchOdds() {
  apiCallCount++
  console.log(`📊 API Call #${apiCallCount} (this session)`)
  // ... rest of function
}

// Log every hour
setInterval(() => {
  console.log(`📊 Total API calls this hour: ${apiCallCount}`)
  apiCallCount = 0
}, 60 * 60 * 1000)
```

### Check Cache Hit Rate

```javascript
let cacheHits = 0
let cacheMisses = 0

export async function getCachedGameOdds(sport) {
  const cached = // ... check cache
  
  if (cached.hasFreshCache) {
    cacheHits++
    console.log(`✅ Cache HIT (${cacheHits}/${cacheHits + cacheMisses} = ${(cacheHits/(cacheHits+cacheMisses)*100).toFixed(1)}%)`)
  } else {
    cacheMisses++
    console.log(`❌ Cache MISS (${cacheHits}/${cacheHits + cacheMisses} = ${(cacheHits/(cacheHits+cacheMisses)*100).toFixed(1)}%)`)
  }
  
  return cached
}
```

---

## ✅ Success Criteria

- [ ] API calls reduced by 80%+
- [ ] Page load time under 1 second
- [ ] Cache hit rate above 70%
- [ ] Data freshness acceptable (under 60 min for odds)
- [ ] No "rate limit exceeded" errors
- [ ] Console logs show cache hits

---

**Next Step**: Let's implement Quick Win 1 first - it takes 5 minutes and gives huge results!

Want me to do that now?






