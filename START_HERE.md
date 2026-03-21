# 🚀 START HERE - Daily Operations

## 📅 Updated: Dec 17, 2025

## ⚡ Quick Daily Commands

### Morning (Before Games) - RUN IN ORDER!
```bash
cd "C:\Users\zaino\Desktop\Odds on Deck"

# Step 1: Clear yesterday's stale props (CRITICAL!)
node scripts/clear-stale-props.js

# Step 2: Fetch fresh games
node scripts/fetch-fresh-games.js all

# Step 3: Fetch odds with proper gameTime
node scripts/fetch-live-odds.js all --cache-fresh
```

### ⚡ One-Liner (PowerShell)
```powershell
cd "C:\Users\zaino\Desktop\Odds on Deck"; node scripts/clear-stale-props.js; node scripts/fetch-fresh-games.js all; node scripts/fetch-live-odds.js all --cache-fresh
```

### During Games (Every 30 min)
```bash
node scripts/update-scores-safely.js all
```

### After Games
```bash
npm run validate:all
node scripts/check-validation-status.js
```

### End of Day
```bash
node scripts/clear-stale-props.js
```

---

## 🔧 If Yesterday's Props Are Still Showing

This is the most common issue. Run:
```bash
node scripts/clear-stale-props.js
```

If NHL props aren't showing on the Picks page:
```bash
node scripts/clear-stale-props.js
node scripts/fetch-live-odds.js nhl --cache-fresh
```

---

## 📊 Your Production Site
https://odds-on-deck.vercel.app/

### Key Pages:
- **Home:** https://odds-on-deck.vercel.app/
- **Editor's Picks:** https://odds-on-deck.vercel.app/picks
- **Player Props:** https://odds-on-deck.vercel.app/props
- **Today's Slate:** https://odds-on-deck.vercel.app/games
- **Parlays:** https://odds-on-deck.vercel.app/parlays
- **Validation:** https://odds-on-deck.vercel.app/validation

---

## 📈 Current Performance
- **Overall Win Rate:** ~45%
- **NHL Blocked Shots:** 56.9% ✅
- **NFL Pass Yards:** 56.8% ✅

---

## 📚 Documentation

| Need | Read |
|------|------|
| Quick commands | `DAILY_QUICK_START.md` |
| Full operations guide | `DAILY_OPERATIONS.md` |
| All available scripts | `OPERATIONS_CHECKLIST.md` |
| Validation details | `VALIDATION_SYSTEM_GUIDE.md` |

---

## ✅ System Status (Dec 17, 2025)

| Component | Status |
|-----------|--------|
| Supabase | ✅ Active (100%) |
| Clear Stale Props | ✅ Daily (Fixed) |
| gameTime Mapping | ✅ Fixed |
| Validation | ✅ Automatic |

---

## 💰 Daily Costs
- **ESPN API (Games/Scores):** FREE
- **Clear Stale Props:** FREE
- **Odds API (1-2x/day):** ~$2-4

---

## 🔑 Required .env.local

```env
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_service_role_key  # Required!
ODDS_API_KEY=your_odds_api_key
```

---

## ⚠️ Important Notes

1. **Clear Stale Props DAILY:** Run `clear-stale-props.js` FIRST every morning
2. **Use --cache-fresh:** Ensures proper gameTime mapping
3. **Order Matters:** Clear → Fetch Games → Fetch Odds
4. **SUPABASE_SECRET_KEY Required:** For write operations

---

**Last Updated:** Dec 17, 2025  
**Key Fix:** Daily clear-stale-props.js and gameTime mapping  
**Status:** ✅ Ready to use!
