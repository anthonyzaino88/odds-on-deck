# 🎨 Demo/Portfolio Version Setup Guide

**Create a fully functional demo using FREE APIs**

---

## 📊 Current API Usage

### ✅ **Already FREE:**
1. **MLB Stats API** (`statsapi.mlb.com`)
   - Cost: **FREE** ✅
   - Limits: None (very generous)
   - Data: Schedules, rosters, lineups, live scores, player stats

2. **ESPN API** (`site.api.espn.com`)
   - Cost: **FREE** ✅
   - Limits: Moderate (respectful usage)
   - Data: NFL/NHL schedules, rosters, live scores, player stats

### 💰 **Currently PAID:**
**The Odds API** (`api.the-odds-api.com`)
- Cost: $30/month for 20,000 requests
- **FREE Tier Available:** 500 requests/month ✅
- Data: Game odds, player prop odds

---

## 🎯 Demo Version Strategy

### **Use The Odds API FREE Tier**

**FREE Tier Includes:**
- ✅ 500 API requests/month
- ✅ All sports (MLB, NFL, NHL, NBA, etc.)
- ✅ All markets (moneyline, spreads, totals, props)
- ✅ Perfect for demos and portfolios!

**Monthly Breakdown:**
```
500 requests ÷ 30 days = ~16 requests/day
16 requests/day ÷ 3 sports = ~5 requests per sport/day
```

**More than enough for a demo!** 🎉

---

## 🚀 Quick Setup (5 Minutes)

### **Step 1: Get Free API Key**

1. Go to: https://the-odds-api.com/
2. Click "Sign Up"
3. Select **FREE tier** (500 requests/month)
4. Get your API key

### **Step 2: Configure Environment**

Create `.env.local`:

```bash
# The Odds API (FREE tier - 500 requests/month)
ODDS_API_KEY=your_free_api_key_here

# Enable real odds (required for demo)
USE_REAL_PROP_ODDS=true

# Demo mode configuration (optional)
DEMO_MODE=true
DEMO_API_LIMIT=500
```

### **Step 3: Configure Rate Limiting for FREE Tier**

Update `lib/api-usage-manager.js`:

```javascript
const API_CONFIG = {
  // FREE TIER: 500 requests/month = ~16/day
  MAX_CALLS_PER_HOUR: 2,        // Very conservative
  MIN_INTERVAL_MINUTES: 120,     // 2 hours between fetches
  
  MONTHLY_LIMIT: 500,            // FREE tier limit
  DAILY_LIMIT: 16,               // ~500/30 days
  HOURLY_LIMIT: 2,               // Safe limit
}
```

### **Step 4: Test It!**

```bash
npm run dev
# Visit http://localhost:3000
# Generate a parlay - props will load from free API!
```

---

## 💡 Demo-Optimized Features

### **1. Smart Caching (Already Implemented!)**

Your app already has aggressive caching:
- ✅ Props cached for 30 minutes
- ✅ Uses cache even if "stale"
- ✅ Only fetches when cache is empty

**For demo:** This means 500 requests = **weeks of demo usage**!

### **2. Model-Based Fallback (Already Implemented!)**

When API limit reached, automatically switches to:
- Estimated props based on statistics
- Still functional, just not real-time odds
- Perfect fallback for portfolio demos

### **3. Single-Sport Mode**

Create `DEMO_SINGLE_SPORT_MODE.js`:

```javascript
// Focus demo on one sport to conserve API calls
const DEMO_SPORT = 'mlb' // or 'nfl' or 'nhl'

// Only fetch props for demo sport
if (sport !== DEMO_SPORT && process.env.DEMO_MODE === 'true') {
  console.log(`⏭️ Demo mode: Skipping ${sport}, focusing on ${DEMO_SPORT}`)
  return []
}
```

**Benefits:**
- 3x longer demo lifespan
- 500 requests = 1-2 months of daily demo use
- Can rotate sports seasonally

---

## 🎨 Portfolio Deployment Options

### **Option A: Vercel (Recommended)**

**Cost:** FREE
**Features:**
- Automatic deployments from GitHub
- Environment variables built-in
- Edge network (fast globally)
- Custom domain support

**Setup:**
```bash
# 1. Push to GitHub
git init
git add .
git commit -m "Demo version"
git push origin main

# 2. Deploy to Vercel
npx vercel --prod

# 3. Add environment variables in Vercel dashboard
ODDS_API_KEY=your_free_key
USE_REAL_PROP_ODDS=true
DEMO_MODE=true
```

### **Option B: Netlify**

**Cost:** FREE
**Setup:** Similar to Vercel

### **Option C: Railway**

**Cost:** FREE tier available
**Better for:** Apps with databases

---

## 📝 Demo-Specific Configuration

### **Create `config/demo.config.js`:**

```javascript
export const DEMO_CONFIG = {
  // API Configuration
  USE_FREE_TIER: true,
  MAX_REQUESTS_PER_DAY: 16,
  
  // Feature flags for demo
  ENABLE_LIVE_REFRESH: false,      // Saves API calls
  ENABLE_VALIDATION: true,         // Show system working
  CACHE_DURATION_HOURS: 2,         // Extended cache
  
  // Sports configuration
  DEMO_SPORTS: ['mlb'],            // Focus on one sport
  
  // UI customization
  SHOW_API_USAGE: true,            // Show remaining calls
  DEMO_BANNER: true,               // "Portfolio Demo" banner
  
  // Limits
  MAX_PARLAYS_PER_DAY: 10,         // Prevent excessive use
  PROPS_PER_SPORT: 50,             // Limit prop count
}
```

### **Add Demo Banner Component:**

```javascript
// components/DemoBanner.js
export default function DemoBanner() {
  if (process.env.DEMO_MODE !== 'true') return null
  
  return (
    <div className="bg-blue-600 text-white py-2 px-4 text-center">
      <p className="text-sm">
        📱 Portfolio Demo • Using FREE API tier (500 req/month) • 
        <a href="https://github.com/yourusername/odds-on-deck" 
           className="underline ml-2">View Source Code</a>
      </p>
    </div>
  )
}
```

---

## 📊 API Usage Dashboard

### **Create Demo Stats Display:**

```javascript
// components/DemoStats.js
import { getCacheStats } from '../lib/prop-cache-manager'

export default function DemoStats() {
  const [stats, setStats] = useState({})
  
  useEffect(() => {
    // Show API usage in demo mode
    if (process.env.DEMO_MODE === 'true') {
      fetchStats()
    }
  }, [])
  
  return (
    <div className="demo-stats">
      <h3>Demo API Usage</h3>
      <p>Requests Today: {stats.today}/16</p>
      <p>Monthly Remaining: {stats.remaining}/500</p>
      <p>Cache Status: {stats.cacheHits} hits</p>
    </div>
  )
}
```

---

## 🎮 Demo User Experience

### **What Works with FREE API:**

✅ **Fully Functional:**
- MLB/NFL/NHL schedules (ESPN/MLB APIs - FREE)
- Live scores and updates (FREE)
- Team rosters and lineups (FREE)
- Player statistics (FREE)
- Game odds (The Odds API FREE tier)
- **Player props** (The Odds API FREE tier)
- Parlay builder
- Validation system
- Performance analytics

❌ **Limitations (None for demo purposes!):**
- Just need to be mindful of 500 req/month limit
- Smart caching means this is plenty!

---

## 💰 Cost Comparison

| Component | Production | Demo/Portfolio |
|-----------|-----------|----------------|
| **MLB Stats API** | FREE | FREE ✅ |
| **ESPN API** | FREE | FREE ✅ |
| **The Odds API** | $30/month | FREE (500 req) ✅ |
| **Hosting (Vercel)** | FREE | FREE ✅ |
| **Database (SQLite)** | FREE | FREE ✅ |
| **Total Cost** | $30/month | **$0/month** ✅ |

---

## 🔧 Optimization for FREE Tier

### **1. Extend Cache Duration**

```javascript
// lib/prop-cache-manager.js
const CACHE_CONFIG = {
  CACHE_DURATION_MINUTES: process.env.DEMO_MODE === 'true' ? 120 : 30,
  EXPIRE_BEFORE_GAME_MINUTES: 60
}
```

**Impact:** 4x fewer API calls

### **2. Disable Auto-Refresh (Demo Mode)**

```javascript
// app/api/cron/auto-refresh/route.js
export async function GET() {
  if (process.env.DEMO_MODE === 'true') {
    return NextResponse.json({ 
      message: 'Auto-refresh disabled in demo mode',
      success: true 
    })
  }
  // ... rest of refresh logic
}
```

**Impact:** Saves 100+ calls/month

### **3. On-Demand Only**

```javascript
// Only fetch props when user explicitly requests
if (process.env.DEMO_MODE === 'true') {
  // Don't pre-generate props
  // Only fetch when user clicks "Generate Parlay"
}
```

---

## 📱 Portfolio Presentation

### **README for GitHub:**

```markdown
# 🎲 Odds on Deck - Sports Betting Analytics

**Live Demo:** https://odds-on-deck-demo.vercel.app

A full-stack sports analytics platform for MLB, NFL, and NHL:
- ⚡ Real-time odds from The Odds API
- 📊 Advanced parlay builder with edge detection
- 🎯 ML-powered prop validation system
- 📈 Performance tracking and analytics

## Tech Stack
- Next.js 14 (App Router)
- Prisma + SQLite
- TailwindCSS
- The Odds API (real-time sports data)

## Features
✅ Multi-sport support (MLB, NFL, NHL)
✅ Real-time odds and player props
✅ Smart prop validation with ESPN/MLB APIs
✅ Parlay optimization algorithms
✅ Edge calculation and confidence scoring

## Demo Limitations
This demo uses The Odds API's free tier (500 req/month).
For production, upgrade to paid tier for unlimited access.

## Setup
\`\`\`bash
npm install
# Add ODDS_API_KEY to .env.local
npm run dev
\`\`\`
```

---

## 🎯 Recommended Demo Flow

### **For Recruiters/Viewers:**

1. **Landing Page:**
   - Demo banner explaining it's a portfolio piece
   - Link to GitHub repo
   - Tech stack highlights

2. **Feature Showcase:**
   - Generate an MLB parlay (uses free API)
   - Show real-time odds
   - Display validation system
   - Show analytics dashboard

3. **About Section:**
   - "Built with The Odds API free tier"
   - "Production-ready with paid API upgrade"
   - Architecture diagram
   - API usage optimization strategies

---

## 🚀 Quick Deploy Script

Create `deploy-demo.sh`:

```bash
#!/bin/bash

echo "🎨 Deploying Portfolio Demo..."

# 1. Set demo mode
export DEMO_MODE=true
export DEMO_API_LIMIT=500

# 2. Build optimized version
npm run build

# 3. Deploy to Vercel
vercel --prod

# 4. Set environment variables
vercel env add ODDS_API_KEY
vercel env add DEMO_MODE
vercel env add USE_REAL_PROP_ODDS

echo "✅ Demo deployed!"
echo "🔗 Visit: https://odds-on-deck-demo.vercel.app"
```

---

## 📊 Monitoring API Usage

### **Add Usage Tracker:**

```javascript
// lib/demo-usage-tracker.js
export async function trackAPIUsage(endpoint, success = true) {
  if (process.env.DEMO_MODE !== 'true') return
  
  const today = new Date().toISOString().split('T')[0]
  
  // Log to console
  console.log(`📊 API Call: ${endpoint} (${success ? 'success' : 'failed'})`)
  
  // Could also log to database for dashboard
  await prisma.apiUsageLog.create({
    data: {
      endpoint,
      success,
      timestamp: new Date(),
      demo: true
    }
  })
}
```

---

## ✅ Demo Checklist

Before deploying your portfolio demo:

- [ ] Get The Odds API free key (500 req/month)
- [ ] Set DEMO_MODE=true in environment
- [ ] Extend cache duration (30min → 2hr)
- [ ] Disable auto-refresh cron job
- [ ] Add demo banner to UI
- [ ] Add "View on GitHub" link
- [ ] Add tech stack description
- [ ] Test with single sport (MLB recommended)
- [ ] Deploy to Vercel/Netlify
- [ ] Add to portfolio website
- [ ] Test live demo works
- [ ] Monitor API usage (should last weeks!)

---

## 🎉 Summary

### **Your Demo Will Have:**
✅ **100% real, live data** from free APIs  
✅ **Real betting odds** from The Odds API free tier  
✅ **Player props with real odds**  
✅ **Live scores and updates**  
✅ **Full validation system**  
✅ **$0/month cost**  
✅ **Production-quality code**  
✅ **Perfect for portfolio**  

### **Free API Budget:**
- 500 API requests/month
- Smart caching = weeks of demo usage
- Can rotate sports seasonally
- Automatic fallback to model-based props

### **Deployment:**
- Free on Vercel/Netlify
- Custom domain support
- Auto-deploys from GitHub
- Environment variables built-in

---

**🚀 You can have a fully functional demo with $0 cost!**

Want me to implement these demo configurations now?

