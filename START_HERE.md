# 🚀 START HERE - Daily Operations

## ⚡ Quick Daily Commands

### Morning (Before Games)
```bash
cd "C:\Users\zaino\Desktop\Odds on Deck"
node scripts/fetch-fresh-games.js all
node scripts/fetch-live-odds.js all
```

### During Games (Every 30 min)
```bash
node scripts/update-scores-safely.js all
```

### After Games
```bash
node scripts/check-validation-status.js
```

---

## 📊 Your Production Site
https://odds-on-deck.vercel.app/

### Key Pages:
- **Home:** https://odds-on-deck.vercel.app/
- **Games Slate:** https://odds-on-deck.vercel.app/games
- **Player Props:** https://odds-on-deck.vercel.app/props
- **Parlays:** https://odds-on-deck.vercel.app/parlays
- **Validation:** https://odds-on-deck.vercel.app/validation

---

## 📈 Current Performance
- **Overall Win Rate:** 44.9%
- **NHL Blocked Shots:** 56.9% ✅
- **NFL Pass Yards:** 56.8% ✅

---

## 📚 Documentation

| Need | Read |
|------|------|
| Quick commands | `DAILY_QUICK_START.md` |
| Full operations guide | `DAILY_OPERATIONS.md` |
| All available scripts | `OPERATIONS_CHECKLIST.md` |
| What changed today | `CLEANUP_SUMMARY_NOV27.md` |
| System architecture | `SYSTEM_UPDATE_NOV27.md` |

---

## ✅ System Status (Nov 27, 2025)

| Component | Status |
|-----------|--------|
| Prisma | ✅ Removed (100%) |
| Supabase | ✅ Active (100%) |
| Fake Edges | ✅ Removed |
| Line Shopping | ✅ Active |
| Validation | ✅ Automatic |
| Documentation | ✅ Cleaned |

---

## 💰 Daily Costs
- **ESPN API (Games/Scores):** FREE
- **Odds API (2x/day):** ~$2-4

---

## 🎯 What Works Best
1. **NHL Blocked Shots:** 56.9% win rate
2. **NFL Pass Yards:** 56.8% win rate
3. **Line Shopping:** Real value detection

---

## ⚠️ Important Notes
1. **No Prisma:** System is 100% Supabase
2. **No Fake Edges:** All edges are honest (0% or line shopping)
3. **Automatic Validation:** No manual scripts needed
4. **Cost Control:** Fetch odds 2x/day max

---

**Last Updated:** Nov 27, 2025  
**System Version:** v2.0 (Honest System)  
**Status:** ✅ Ready to use!

