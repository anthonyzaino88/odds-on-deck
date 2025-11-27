# ⚡ Daily Quick Start - Odds on Deck

## 🚀 Copy & Paste Commands

### Morning Setup (Required)
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
node scripts/validate-pending-props.js
node scripts/check-validation-status.js
```

### Find Real Value (Optional)
```bash
node scripts/find-real-value-props.js
```

---

## 📊 Current Performance (Nov 27, 2025)

| Metric | Value |
|--------|-------|
| Overall Win Rate | **44.9%** |
| NHL Blocked Shots | **56.9%** ✅ |
| NFL Pass Yards | **56.8%** ✅ |
| Total Validations | 196 |

---

## 💰 Daily Costs

| Operation | Cost |
|-----------|------|
| Fetch Games (ESPN) | **FREE** |
| Fetch Odds (2x/day) | **~$2-4** |
| Update Scores | **FREE** |
| Validate Props | **FREE** |

**Total Daily Cost:** ~$2-4

---

## 🎯 What Works Best

1. **NHL Blocked Shots** - 56.9% win rate
2. **NFL Pass Yards** - 56.8% win rate
3. **Line Shopping** - Use `find-real-value-props.js`

---

## 🔗 Quick Links

- **Production:** https://odds-on-deck.vercel.app/
- **Validation:** https://odds-on-deck.vercel.app/validation
- **Props:** https://odds-on-deck.vercel.app/props
- **Parlays:** https://odds-on-deck.vercel.app/parlays

---

## ❓ Troubleshooting

**No games showing?**
```bash
node scripts/list-nhl-games.js
```

**Props not validating?**
```bash
node scripts/check-pending-validations.js
```

**Old data cluttering?**
```bash
node scripts/cleanup-old-games.js
```

---

**Full Guide:** See `DAILY_OPERATIONS.md` for detailed instructions

