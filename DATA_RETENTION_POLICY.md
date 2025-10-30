# 📊 Data Retention Policy - How Long We Keep Your Data

**Quick Answer:** Your completed parlays and validation data are **kept FOREVER** (no automatic deletion) to continuously improve prediction accuracy! 🎯

---

## 🗄️ Current Retention by Data Type

### **1. Saved Parlays (Parlay & ParlayLeg tables)**

**Retention:** ♾️ **PERMANENT** (no automatic cleanup)

```javascript
// Parlay model in prisma/schema.prisma
model Parlay {
  id: "cmgu32f9p05hky2ly15mtx31a"
  status: "pending" | "won" | "lost" | "cancelled"
  generatedAt: DateTime
  expiresAt: DateTime?  // Optional, not enforced
  // ... all data preserved
}
```

**What's Saved:**
- ✅ Complete parlay details (legs, odds, edge)
- ✅ User notes and configuration
- ✅ Status (pending → won/lost)
- ✅ Timestamps (created, updated)

**Why Keep Forever:**
- 📊 Track your betting history
- 📈 Calculate long-term ROI
- 🎯 Analyze which strategies work best
- 🏆 Build confidence in successful patterns

---

### **2. Prop Validation Data (PropValidation table)**

**Retention:** ♾️ **PERMANENT** (no automatic cleanup)

```javascript
// PropValidation model
model PropValidation {
  propId: "prop-AustonMatthews-goals-TOR_at_BOS"
  prediction: "over"
  projectedValue: 0.75
  actualValue: 1  // Filled in after game
  result: "correct"
  status: "pending" → "completed"
  timestamp: DateTime
  // ... kept forever for learning
}
```

**What's Saved:**
- ✅ Every prop prediction you make
- ✅ Your model's projection vs actual result
- ✅ Accuracy tracking (correct/incorrect)
- ✅ Performance by prop type, player, sport

**Why Keep Forever:**
- 🤖 Machine learning needs historical data
- 📊 Long-term accuracy trends
- 🎯 Identify seasonal patterns
- 💡 Continuously improve predictions

**Current Stats:**
```bash
# Example after 3 months:
Total Predictions: 487
Correct: 289 (59.3%)
Incorrect: 178 (36.6%)
Pushes: 20 (4.1%)
ROI: +15.7%

# This data is GOLD for improving your system!
```

---

### **3. Cached Props (PlayerPropCache table)**

**Retention:** ⏰ **2 DAYS** (automatic cleanup)

**File:** `lib/prop-cache-manager.js`

```javascript
export async function cleanupOldProps(daysOld = 2) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 2)
  
  await prisma.playerPropCache.deleteMany({
    where: {
      gameTime: { lt: cutoffDate }  // Delete props older than 2 days
    }
  })
}
```

**What's Saved (Temporarily):**
- 📡 Props fetched from The Odds API
- ⚡ Cache to reduce API calls (30-60 min TTL)
- 🎯 Recent odds and projections

**Why Delete After 2 Days:**
- 💾 Keeps database size manageable
- ⚡ Old odds are outdated/useless
- 🎯 Only cache for current/upcoming games
- 💰 Reduces storage costs

**This is DIFFERENT from PropValidation:**
- `PlayerPropCache` = temporary cache (deleted after 2 days)
- `PropValidation` = permanent tracking (kept forever)

---

### **4. Game Odds Cache (Odds table)**

**Retention:** ⏰ **2-7 DAYS** (manual cleanup, if any)

**File:** `lib/vendors/odds.js`

```javascript
// Check database for recent odds (last 60 minutes)
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
const recentOdds = await prisma.odds.findMany({
  where: { ts: { gte: oneHourAgo } }
})
```

**What's Saved:**
- 📊 Game odds from The Odds API
- 🎲 Moneyline, spread, totals
- 📅 Timestamp for cache validation

**Why Keep Short-Term:**
- 🎯 Cache to reduce API calls (60 min)
- 📊 Historical odds not needed long-term
- 💾 PropValidation already stores relevant data

**Note:** There's currently NO automatic cleanup for Odds table. May want to add this!

---

### **5. Live Data (Game, Player, Lineup tables)**

**Retention:** ⏰ **7-30 DAYS** (no automatic cleanup currently)

**What's Saved:**
- ⚾ Game results and live scores
- 👤 Player stats and lineups
- 📊 Real-time updates during games

**Why Keep 7-30 Days:**
- 📊 Current season reference
- 🎯 Recent performance analysis
- 📈 Trend tracking

**Recommended Cleanup:**
```javascript
// Clean up games older than 30 days
await prisma.game.deleteMany({
  where: {
    gameTime: { lt: thirtyDaysAgo },
    status: { in: ['final', 'completed'] }
  }
})
```

---

## 📊 Storage Impact Over Time

### **Small Database (1-3 months):**
```
Parlays: 100 records × 2KB = 200KB
PropValidation: 300 records × 1KB = 300KB
PlayerPropCache: ~100 records (auto-cleaned)
Odds: ~500 records × 0.5KB = 250KB
Games/Players: ~1000 records = 2MB

Total: ~3MB (negligible)
```

### **Medium Database (6-12 months):**
```
Parlays: 1,000 records = 2MB
PropValidation: 3,000 records = 3MB
PlayerPropCache: ~100 records = 100KB
Odds: ~1,000 records = 500KB
Games/Players: ~3,000 records = 6MB

Total: ~12MB (still tiny)
```

### **Large Database (2-3 years):**
```
Parlays: 5,000 records = 10MB
PropValidation: 15,000 records = 15MB
PlayerPropCache: ~100 records = 100KB
Odds: ~2,000 records = 1MB
Games/Players: ~10,000 records = 20MB

Total: ~46MB (very manageable)
```

**Bottom Line:** SQLite can handle **100GB+**. Your data will likely never exceed 100MB even after years of use! 🎉

---

## 🎯 Recommended Retention Policies

### **Keep Forever:**
✅ **Parlay** - Your betting history  
✅ **PropValidation** - Machine learning data  
✅ **ParlayLeg** - Detailed tracking  

**Why:**
- More data = better predictions
- Long-term ROI tracking
- Historical pattern analysis
- Confidence calibration

### **Clean Up Regularly:**
⏰ **PlayerPropCache** - After 2 days (already implemented)  
⏰ **Odds** - After 7 days (needs implementation)  
⏰ **Game/Player** - After 30 days for completed games  

**Why:**
- Outdated cache is useless
- Reduces database size
- Keeps queries fast

---

## 🔧 Implementing Cleanup (Optional)

### **1. Clean Old Odds (Recommended)**

**File:** `lib/prop-cache-manager.js` (add new function)

```javascript
export async function cleanupOldOdds(daysOld = 7) {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)
    
    const result = await prisma.odds.deleteMany({
      where: {
        ts: { lt: cutoffDate }
      }
    })
    
    console.log(`🗑️ Deleted ${result.count} old odds (older than ${daysOld} days)`)
    return result.count
  } catch (error) {
    console.error('❌ Error cleaning up old odds:', error)
    return 0
  }
}
```

### **2. Clean Old Completed Games**

```javascript
export async function cleanupOldGames(daysOld = 30) {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)
    
    const result = await prisma.game.deleteMany({
      where: {
        gameTime: { lt: cutoffDate },
        status: { in: ['final', 'completed', 'cancelled'] }
      }
    })
    
    console.log(`🗑️ Deleted ${result.count} old games (older than ${daysOld} days)`)
    return result.count
  } catch (error) {
    console.error('❌ Error cleaning up old games:', error)
    return 0
  }
}
```

### **3. Add Cron Job for Auto-Cleanup**

**File:** `app/api/cron/cleanup/route.js` (new file)

```javascript
import { NextResponse } from 'next/server'
import { cleanupOldProps, cleanupOldOdds, cleanupOldGames } from '../../../../lib/prop-cache-manager.js'

export async function GET(request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🧹 Running scheduled cleanup...')

    // Clean up old data
    const propsDeleted = await cleanupOldProps(2)  // 2 days
    const oddsDeleted = await cleanupOldOdds(7)    // 7 days
    const gamesDeleted = await cleanupOldGames(30) // 30 days

    return NextResponse.json({
      success: true,
      cleaned: {
        props: propsDeleted,
        odds: oddsDeleted,
        games: gamesDeleted
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Error in cleanup cron:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
```

**Vercel Cron Configuration:** (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 3 * * *"  // 3 AM daily
    }
  ]
}
```

---

## 🎯 Manual Cleanup (If Needed)

### **View Database Size:**

```bash
# Check SQLite file size
ls -lh prisma/dev.db

# Or in Prisma Studio:
npx prisma studio
# Check row counts in each table
```

### **Manual Cleanup Commands:**

```javascript
// Clean props older than X days
await prisma.playerPropCache.deleteMany({
  where: {
    gameTime: { lt: new Date('2024-10-01') }
  }
})

// Clean old odds
await prisma.odds.deleteMany({
  where: {
    ts: { lt: new Date('2024-10-01') }
  }
})

// Clean completed games from old season
await prisma.game.deleteMany({
  where: {
    gameTime: { lt: new Date('2024-09-01') },
    status: { in: ['final', 'completed'] }
  }
})

// ⚠️ NEVER delete Parlay or PropValidation!
// This is your learning data!
```

---

## 📊 Summary Table

| Data Type | Retention | Auto-Cleanup | Why |
|-----------|-----------|--------------|-----|
| **Parlay** | ♾️ Forever | ❌ No | Betting history, ROI tracking |
| **PropValidation** | ♾️ Forever | ❌ No | Machine learning, accuracy |
| **ParlayLeg** | ♾️ Forever | ❌ No | Detailed prop tracking |
| **PlayerPropCache** | ⏰ 2 days | ✅ Yes | Temporary API cache |
| **Odds** | ⏰ 7 days | ⚠️ Manual | Cache for recent games |
| **Game** | ⏰ 30 days | ⚠️ Manual | Current season reference |
| **Player** | ♾️ Forever | ❌ No | Reference data |
| **Team** | ♾️ Forever | ❌ No | Reference data |

---

## 🎯 Best Practices

### **DO Keep Forever:**
- ✅ All **Parlay** records (your history!)
- ✅ All **PropValidation** records (learning data!)
- ✅ Reference data (Teams, Players)

### **DO Clean Up:**
- ✅ **PlayerPropCache** after 2 days (already happening)
- ✅ **Odds** after 7 days (add cleanup)
- ✅ **Completed Games** after 30 days (add cleanup)

### **DON'T Delete:**
- ❌ PropValidation (needed for ML)
- ❌ Parlay history (needed for ROI)
- ❌ Active/recent game data

---

## ✅ Current Status

**Your App:**
- ✅ Keeps parlays forever (good for learning!)
- ✅ Auto-cleans prop cache after 2 days (good for performance!)
- ⚠️ No cleanup for old odds/games (minor - database still small)

**Recommendations:**
1. **Keep current setup** - working great! ✅
2. **Optional:** Add odds cleanup (7 days) for optimization
3. **Optional:** Add game cleanup (30 days) for very long-term use
4. **Never delete:** Parlay or PropValidation data!

---

## 🎉 Bottom Line

**Your completed parlays are saved FOREVER** to enable:
- 📊 Long-term accuracy tracking
- 🤖 Machine learning improvements
- 💰 ROI analysis
- 🎯 Pattern recognition

**This is a GOOD thing!** More data = better predictions. Your database will stay small (< 50MB even after years), so there's no need to delete anything. The system is designed to learn from your complete betting history! 🚀

---

**Want to see your data?**
```bash
# Open Prisma Studio
npx prisma studio

# Check your parlays:
# → Browse to "Parlay" table
# → See all your saved parlays
# → Filter by status, date, sport

# Check validation data:
# → Browse to "PropValidation" table
# → See prediction accuracy
# → Analyze patterns
```

**Your data = Your edge!** 🎯





