# ⚡ Daily Quick Start - Odds on Deck

## 📅 Updated: Dec 17, 2025

## 🚀 Copy & Paste Commands

### Morning Setup (Required - Run In Order!)
```bash
cd "C:\Users\zaino\Desktop\Odds on Deck"

# Step 1: Clear yesterday's stale props (CRITICAL!)
node scripts/clear-stale-props.js

# Step 2: Fetch fresh games from ESPN
node scripts/fetch-fresh-games.js all

# Step 3: Fetch odds with proper gameTime mapping
node scripts/fetch-live-odds.js all --cache-fresh
```

### ⚡ One-Liner (PowerShell)
```powershell
cd "C:\Users\zaino\Desktop\Odds on Deck"; node scripts/clear-stale-props.js; node scripts/fetch-fresh-games.js all; node scripts/fetch-live-odds.js all --cache-fresh
```

---

### During Games (Every 30 min)
```bash
node scripts/update-scores-safely.js all
```

---

### After Games
```bash
npm run validate:all
node scripts/check-validation-status.js
```

---

### End of Day / Before Bed
```bash
# Clear stale props to prep for tomorrow
node scripts/clear-stale-props.js
```

---

### Find Real Value (Optional)
```bash
node scripts/find-real-value-props.js
```

---

## ⚠️ Common Issues & Fixes

### Yesterday's Props Still Showing?
```bash
# Run this first - clears props with past game times
node scripts/clear-stale-props.js
```

### NHL Props Not Showing on Picks Page?
```bash
# Re-fetch with cache-fresh to fix gameTime
node scripts/clear-stale-props.js
node scripts/fetch-live-odds.js nhl --cache-fresh
```

### No Games Appearing?
```bash
node scripts/fetch-fresh-games.js all
```

---

## 📊 Current Performance

| Metric | Value |
|--------|-------|
| Overall Win Rate | **~45%** |
| NHL Blocked Shots | **56.9%** ✅ |
| NFL Pass Yards | **56.8%** ✅ |

---

## 💰 Daily Costs

| Operation | Cost |
|-----------|------|
| Clear Stale Props | **FREE** |
| Fetch Games (ESPN) | **FREE** |
| Fetch Odds (1-2x/day) | **~$2-4** |
| Update Scores | **FREE** |
| Validate Props | **FREE** |

**Total Daily Cost:** ~$2-4

---

## 🔑 Required .env.local

```env
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_service_role_key  # Required!
ODDS_API_KEY=your_odds_api_key
```

---

## ✅ Daily Checklist

### Morning ☀️
- [ ] `clear-stale-props.js` **FIRST**
- [ ] `fetch-fresh-games.js all`
- [ ] `fetch-live-odds.js all --cache-fresh`
- [ ] Check Props page shows only today's games

### During Games 🏒
- [ ] `update-scores-safely.js all` every 30 min

### After Games 🌙
- [ ] `npm run validate:all`
- [ ] `clear-stale-props.js` to prep for tomorrow

---

## 🔗 Quick Links

- **Local Dev:** http://localhost:3000
- **Production:** https://odds-on-deck.vercel.app/
- **Props:** https://odds-on-deck.vercel.app/props
- **Picks:** https://odds-on-deck.vercel.app/picks
- **Parlays:** https://odds-on-deck.vercel.app/parlays

---

**Full Guide:** See `DAILY_OPERATIONS.md` for detailed instructions
