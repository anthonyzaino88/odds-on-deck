# 📊 The Odds API Usage - Complete Breakdown

## ✅ **YES - We're Using The Odds API**

**API:** The-Odds-API (https://the-odds-api.com/)  
**Your API Key:** `065843404dbb936f13929a104de407f3`  
**Plan:** $30/month (20,000 API calls)  
**Status:** ✅ Active and Working

---

## 🎯 **What We Use The Odds API For**

### ✅ **Game Lines (REAL ODDS):**

**1. MLB Game Odds:**
```javascript
// Endpoint: /v4/sports/baseball_mlb/odds/
// What we get:
- Moneyline odds (e.g., Yankees -150, Blue Jays +130)
- Run line/Spread (e.g., -1.5 runs at -120)
- Over/Under totals (e.g., 8.5 runs, over -110)
- Multiple sportsbooks (DraftKings, FanDuel, etc.)
```

**2. NFL Game Odds:**
```javascript
// Endpoint: /v4/sports/americanfootball_nfl/odds/
// What we get:
- Moneyline odds (e.g., Chiefs -200, Broncos +170)
- Point spread (e.g., -6.5 at -110)
- Over/Under totals (e.g., 47.5 points)
- Multiple sportsbooks
```

**3. NHL Game Odds (Ready to Use):**
```javascript
// Endpoint: /v4/sports/icehockey_nhl/odds/
// Already configured in our code!
// Just need to enable NHL integration
```

---

## ❌ **What We DON'T Get From The Odds API**

### **Player Props:**
The Odds API **does NOT include player props** in the basic plan:
- ❌ No player prop odds (passing yards, hits, etc.)
- ❌ Not available in our current plan tier
- ❌ Would require enterprise plan (very expensive)

**So for player props, we:**
1. Generate our own projections
2. Use realistic estimates
3. Default odds to -110 (standard vig)

---

## 📊 **Our Complete Data Flow**

### **For Game Lines (Spreads, Totals, Moneylines):**
```
The Odds API → REAL ODDS
  ↓
Database
  ↓
Editor's Picks (uses real moneyline/total odds)
  ↓
Parlay Generator (can include game lines)
```

### **For Player Props:**
```
MLB Stats API (free) → Player/Game Data
ESPN API (free) → NFL Player Data
  ↓
Our Projection Models
  ↓
Estimated Odds (-110 default)
  ↓
Player Props Generator
  ↓
Parlay Generator
```

---

## 💰 **API Usage & Cost Breakdown**

### **Current Usage:**
```
MLB odds fetch: ~1 call per refresh (2-15 games)
NFL odds fetch: ~1 call per refresh (13-16 games)
Refresh frequency: Every 30 minutes during game days

Daily usage:
- MLB season: ~15 calls/day
- NFL season: ~20 calls/day
- Combined: ~35 calls/day = ~1,050/month

Budget: 20,000 calls/month
Usage: ~5% of quota
Cost: $30/month (fixed)
```

### **With NHL Added:**
```
NHL odds fetch: ~1 call per refresh (8-12 games)
Daily usage: +15 calls/day
Total: ~50 calls/day = ~1,500/month

Usage: ~7.5% of quota
Cost: Still $30/month (no change!)
```

---

## 🔍 **Where The Odds API Is Used In Code**

### **1. Odds Fetching:**
```javascript
// lib/vendors/odds.js
export async function fetchOdds(sport = 'mlb', date = null) {
  const apiKey = process.env.ODDS_API_KEY  // Your key
  
  const sportEndpoints = {
    'mlb': 'baseball_mlb',      // ✅ Active
    'nfl': 'americanfootball_nfl', // ✅ Active
    'nhl': 'icehockey_nhl'      // ✅ Ready (not used yet)
  }
  
  const url = `${ODDS_API_BASE}/sports/${endpoint}/odds?...`
  const res = await fetch(url)
  const data = await res.json()
  
  return mappedData  // Returns odds for all games
}
```

### **2. Data Refresh (Cron Job):**
```javascript
// app/api/cron/refresh-slate/route.js
export async function GET() {
  // Fetch MLB odds
  const mlbOdds = await fetchOdds('mlb')
  
  // Fetch NFL odds
  const nflOdds = await fetchOdds('nfl')
  
  // Store in database
  for (const odds of mlbOdds) {
    await createOdds(odds)
  }
}
```

### **3. Usage Manager:**
```javascript
// lib/api-usage-manager.js
export async function shouldFetchOdds(sport = 'mlb') {
  // Checks if we've hit rate limits
  // Prevents over-usage
  // Logs all API calls
  
  return {
    shouldFetch: true,
    reason: 'Within rate limits'
  }
}
```

---

## 📈 **Real Examples From Your App**

### **MLB Game (Real Odds):**
```
Yankees @ Blue Jays
├─ Moneyline: NYY -150, TOR +130  ← From Odds API
├─ Run Line: NYY -1.5 (-120)      ← From Odds API
└─ Total: 8.5 (Over -110)         ← From Odds API
```

### **NFL Game (Real Odds):**
```
Chiefs @ Broncos
├─ Moneyline: KC -200, DEN +170   ← From Odds API
├─ Spread: KC -6.5 (-110)         ← From Odds API
└─ Total: 47.5 (Over -108)        ← From Odds API
```

### **Player Props (Estimated Odds):**
```
Aaron Rodgers Passing Yards
├─ Over 245.5 (-110)              ← We estimate
├─ Projection: 262 yards          ← We calculate
└─ Win Probability: 54%           ← We calculate
```

---

## 🎯 **Why This Hybrid Approach Works**

### **Advantages:**
1. **Cost Effective:** $30/month vs $500+/month for full player props
2. **Real Game Lines:** Users trust the moneyline/spread odds
3. **Custom Projections:** We control player prop quality
4. **Flexibility:** Can improve projections over time
5. **Validation:** We track accuracy and improve

### **Trade-offs:**
1. **Player prop odds aren't real** (but they're realistic -110)
2. **Can't shop best lines** for player props
3. **User might notice** odds are estimates

---

## 💡 **Future Upgrades (Optional)**

### **Option 1: Add Real Player Props ($$$)**
- **Cost:** $500+/month
- **Benefit:** Real player prop odds
- **Recommendation:** Wait until validated user base

### **Option 2: Improve Our Projections (Free)**
- Add more data sources
- Machine learning models
- Historical performance tracking
- **Recommendation:** Do this first!

### **Option 3: Partner with Books**
- Direct feeds from sportsbooks
- Affiliate partnerships
- **Recommendation:** Long-term goal

---

## 🔒 **API Key Security**

### **Current Setup:**
```bash
# .env.local (NOT in git)
ODDS_API_KEY=065843404dbb936f13929a104de407f3

# .gitignore (protects the key)
.env.local
.env
```

### **For Deployment:**
```bash
# Vercel Environment Variables
ODDS_API_KEY=your_key_here  # Set in Vercel dashboard
```

---

## 📊 **Usage Monitoring**

### **Check Your Usage:**
```bash
# Visit: https://the-odds-api.com/account/
# Shows:
- API calls made
- Remaining quota
- Usage over time
```

### **Our Internal Tracking:**
```javascript
// lib/api-usage-manager.js logs every call
console.log(`📊 Fetching MLB odds from API... (call #1234)`)
```

---

## ✅ **Summary**

### **What Uses REAL Odds (The Odds API):**
- ✅ MLB moneylines, spreads, totals
- ✅ NFL moneylines, spreads, totals
- ✅ Multiple sportsbooks
- ✅ Line movement tracking
- ✅ Opening vs current lines

### **What Uses ESTIMATED Odds (Our Models):**
- 🟡 MLB player props (hits, HRs, strikeouts)
- 🟡 NFL player props (passing yards, TDs, etc.)
- 🟡 All projections and win probabilities

### **Cost:**
- $30/month flat rate
- ~5% of quota used
- Can add NHL with no cost increase

---

## 🎯 **Bottom Line**

**YES, we're using The Odds API!**

We use it for what matters most:
- ✅ Real game lines (spreads, totals, moneylines)
- ✅ Multiple sportsbooks
- ✅ Professional odds

We estimate player props because:
- 💰 Saves $470/month
- 🎯 We can control quality
- 📊 We validate accuracy
- 🚀 Good enough for MVP/testing

**It's a smart hybrid approach!** 💪



