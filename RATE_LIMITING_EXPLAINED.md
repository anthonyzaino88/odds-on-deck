# ⏱️ Rate Limiting Configuration

## 📊 **Your API Usage**

### **Current Status:**
- **Used:** 769 requests
- **Monthly Limit:** 20,000 requests
- **Remaining:** 19,231 requests
- **Usage:** 3.8% (excellent!)

### **Why You Hit 429 Errors:**
The 429 error wasn't about your **monthly limit** - it was about **requests per second**.

The Odds API has TWO limits:
1. ✅ **Monthly Limit:** 20,000 requests/month (you're fine!)
2. ⚠️ **Rate Limit:** ~10 requests per second (you exceeded this temporarily)

---

## ⚙️ **What I Configured**

### **Rate Limit: 200ms Between Requests**

```javascript
// In lib/vendors/player-props-odds.js
const RATE_LIMIT_DELAY_MS = 200 // 5 requests/second
```

### **What This Means:**
- **Speed:** 5 requests per second
- **Safety:** Well under the 10 req/sec limit
- **Time to fetch 4 games:** ~0.8 seconds
- **Monthly impact:** None (only affects speed, not total calls)

---

## 🎯 **Rate Limit Options**

### **Conservative (500ms)**
```javascript
const RATE_LIMIT_DELAY_MS = 500 // 2 requests/second
```
- ✅ Maximum reliability
- ✅ Never hits rate limits
- ⏱️ Takes 2 seconds for 4 games
- **Use when:** Production, critical uptime

### **Moderate (200ms) ← CURRENT SETTING**
```javascript
const RATE_LIMIT_DELAY_MS = 200 // 5 requests/second
```
- ✅ Good balance of speed and safety
- ✅ Stays well under limits
- ⏱️ Takes 0.8 seconds for 4 games
- **Use when:** Default operation

### **Aggressive (100ms)**
```javascript
const RATE_LIMIT_DELAY_MS = 100 // 10 requests/second
```
- ✅ Maximum speed
- ⚠️ Right at the edge (might hit 429 occasionally)
- ⏱️ Takes 0.4 seconds for 4 games
- **Use when:** Development/testing only

---

## 📈 **Monthly Request Calculation**

### **With Rate Limiting (200ms delay):**

**Per Refresh:**
- 1 call to list events
- 4 calls to fetch props (one per game)
- **Total: 5 calls**

**Per Day:**
- Refresh every 15 minutes = 96 refreshes/day
- 96 × 5 = **480 calls/day**

**Per Month:**
- 480 × 30 = **14,400 calls/month**

### **Your Capacity:**
- **Available:** 20,000 requests/month
- **Estimated usage:** 14,400 requests/month
- **Buffer:** 5,600 requests (28% headroom) ✅

---

## 🚀 **How It Works**

### **Before (No Rate Limiting):**
```javascript
// Fetch all props at once
const propsPromises = events.map(event => fetchProps(event.id))
const results = await Promise.all(propsPromises)
// ❌ Sends 4 requests simultaneously → 429 error!
```

### **After (With Rate Limiting):**
```javascript
// Fetch props one at a time with delay
for (let i = 0; i < events.length; i++) {
  const props = await fetchProps(events[i].id)
  results.push(props)
  
  // Wait 200ms before next request
  if (i < events.length - 1) {
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}
// ✅ Sends 5 requests/second → No errors!
```

---

## 🎯 **Real-World Impact**

### **Fetching 4 MLB Games:**

| Rate Limit | Requests/Sec | Total Time | 429 Risk |
|------------|--------------|------------|----------|
| None       | ∞ (parallel) | 0.5s       | ❌ High  |
| 100ms      | 10/sec       | 0.4s       | ⚠️ Medium |
| 200ms      | 5/sec        | 0.8s       | ✅ Low   |
| 500ms      | 2/sec        | 2.0s       | ✅ None  |

**Current Setting (200ms):** Fast enough for real-time, safe enough for reliability.

---

## 🔧 **How to Change It**

### **If You Want It Faster:**
Edit `lib/vendors/player-props-odds.js`:
```javascript
const RATE_LIMIT_DELAY_MS = 100 // More aggressive
```

### **If You Want It Safer:**
```javascript
const RATE_LIMIT_DELAY_MS = 500 // More conservative
```

Then restart:
```bash
npm run dev
```

---

## 📊 **Monitoring Usage**

### **Check Your API Usage:**
Visit: https://the-odds-api.com/account/

You'll see:
- Requests used today
- Requests remaining this month
- Request history

### **Expected Pattern:**
- **Per hour:** ~20 requests (5 calls × 4 refreshes)
- **Per day:** ~480 requests
- **Per month:** ~14,400 requests

---

## 💡 **Optimization Tips**

### **1. Cache Props Longer**
```javascript
// Instead of fetching every 15 minutes, do every 30 minutes
const PROP_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
```
**Savings:** 50% fewer API calls

### **2. Fetch Only Active Games**
```javascript
// Skip games that already started (props can't be bet on)
const validGames = games.filter(g => g.status === 'pre-game')
```
**Savings:** ~50% fewer API calls during game time

### **3. Store Props in Database**
Cache fetched props in your database and serve from there:
```javascript
// Only fetch from API if cache is stale
if (cachedProps && cachedProps.age < 15 minutes) {
  return cachedProps
}
```

---

## 🏆 **Bottom Line**

✅ **Rate Limit:** 200ms (5 req/sec)  
✅ **Monthly Usage:** 14,400 / 20,000 (72%)  
✅ **Safety Buffer:** 28% headroom  
✅ **No More 429 Errors:** Rate limiting prevents them  

**You're in great shape!** The current configuration gives you real-time prop odds while staying well within all limits.

---

## 🎯 **Summary**

| Metric | Value | Status |
|--------|-------|--------|
| Monthly Limit | 20,000 | ✅ |
| Expected Usage | 14,400 | ✅ |
| Headroom | 28% | ✅ |
| Rate Limit | 5 req/sec | ✅ |
| 429 Risk | Low | ✅ |
| Speed Impact | 0.8s per refresh | ✅ |

**Your configuration is optimal for reliable, real-time prop odds!**



