# ⚡ Odds Data Pipeline - Quick Reference

## 🎯 Core Concept

```
The Odds API → Local Script (1x daily) → Supabase Cache → Frontend Queries
  (500 calls)    (fetch-live-odds.js)   (never stale)      (zero API cost)
```

---

## 📊 Database Tables

| Table | Purpose | Updated | Records |
|-------|---------|---------|---------|
| **Odds** | Moneyline, spreads, totals | 1x/day | 100s |
| **PlayerPropCache** | Player props (all sports) | 1x/day | 1000s |
| **PropValidation** | Track prop results | After game | 10s |
| **MockPropValidation** | Training/testing props | On demand | 10s |

---

## 🔧 Common Commands

```bash
# Daily run (recommended)
node scripts/fetch-live-odds.js all

# Specific sport
node scripts/fetch-live-odds.js nfl --date 2025-11-02

# Test mode (no DB saves)
node scripts/fetch-live-odds.js mlb --dry-run

# Force fresh (ignore cache)
node scripts/fetch-live-odds.js nhl --cache-fresh
```

---

## 💰 API Budget

| Period | Quota | Per Day | Per Hour |
|--------|-------|---------|----------|
| Monthly | 500 calls | 16-17 | ~1 |
| **Recommended** | **120/month** | **4/day** | **0.17** |
| **Remaining** | **380/month** | **12-13/day** | **~0.5** |

**Daily Schedule (4 calls):**
```
6:00 AM  ← Fetch all odds (1 call)
9:00 AM  ← Fetch props (1 call)  
3:00 PM  ← Update lines (1 call)
8:00 PM  ← Final snapshot (1 call)
```

---

## 📦 What Gets Stored

### Odds Table
```javascript
{
  gameId,      // "NFL_CHI_at_CIN_2025-11-02"
  book,        // "DraftKings"
  market,      // "h2h" | "spreads" | "totals"
  priceHome,   // -110 (American odds)
  priceAway,   // -110
  spread,      // -1.5
  total,       // 47.5
  ts           // When fetched
}
```

### PlayerPropCache Table
```javascript
{
  propId,        // Unique identifier
  gameId,        // "NFL_CHI_at_CIN_2025-11-02"
  playerName,    // "Justin Fields"
  type,          // "player_pass_yds"
  pick,          // "over" | "under"
  threshold,     // 249.5
  odds,          // -110
  probability,   // 0.52
  edge,          // 2.1 (%)
  confidence,    // "high" | "medium" | "low"
  sport,         // "nfl" | "mlb" | "nhl"
  bookmaker,     // "DraftKings"
  expiresAt      // Refresh date
}
```

---

## 🔄 Caching Strategy

| Data Type | Expires | Example |
|-----------|---------|---------|
| **h2h odds** | 1 hour | Moneyline changes quickly |
| **Spreads** | 1 hour | Bet action moves lines |
| **Totals** | 1 hour | Sharp money adjusts |
| **Props** | 24 hours | Less volatile |

**Check Cache → Use Cache ✅ or Fetch Fresh 🔄**

---

## 📈 Available Props by Sport

### NFL
```
player_pass_yds, player_pass_tds, player_interceptions
player_rush_yds, player_receptions, player_reception_yds
```

### MLB
```
batter_hits, batter_home_runs, batter_rbi
pitcher_strikeouts, pitcher_walks, batter_singles, batter_doubles
```

### NHL (Coming Soon)
```
player_points, player_goals, player_assists, player_shots_on_goal
```

---

## 🚨 Troubleshooting

| Problem | Solution |
|---------|----------|
| API Key error | Add `ODDS_API_KEY` to `.env.local` |
| DB connection | Check `NEXT_PUBLIC_SUPABASE_*` variables |
| Quota exceeded | Reduce call frequency or wait for month reset |
| Props not showing | Run `--cache-fresh` to refresh |
| Script hangs | Run single sport instead of `all` |

---

## ✅ Frontend Integration Pattern

```javascript
// ✅ CORRECT - Query database
const { data: odds } = await supabase
  .from('Odds')
  .select('*')
  .eq('market', 'h2h')

// ❌ WRONG - Call API directly (wasteful)
const response = await fetch('https://api.the-odds-api.com/...')
```

---

## 📝 Daily Checklist

- [ ] Run `node scripts/fetch-live-odds.js all` in morning
- [ ] Check console output for API call count
- [ ] Verify data in Supabase dashboard
- [ ] Confirm props appear on frontend
- [ ] Monitor remaining quota (~500 - calls used)

---

## 🎓 Key Principles

1. **Fetch Once, Cache Forever** → Local script runs daily, saves to DB
2. **Frontend Never Calls API** → Always queries database instead
3. **Rate Limit Safely** → 1 second delay between API calls
4. **Monitor Quota** → Track API calls, stay within 500/month
5. **Use Cache Aggressively** → Don't force fresh unless needed

---

## 📚 Full Documentation

- **Architecture**: See `ODDS_DATA_PIPELINE.md`
- **Usage Guide**: See `ODDS_FETCHER_README.md`
- **Database Schema**: See `prisma/schema.prisma`
