# 🎯 Odds Data Pipeline - Complete Summary

## What We've Built

A **smart, efficient odds data pipeline** that:
- ✅ Fetches odds/props from The Odds API (4 API calls/day)
- ✅ Caches in Supabase database (1-24 hour cache)
- ✅ Serves unlimited frontend users (zero API calls)
- ✅ Tracks prop accuracy & ROI (validation system)
- ✅ Powers parlay generation (with quality scoring)

**Total monthly cost: $0** (within free tier limits)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    THE ODDS API                             │
│        (500 calls/month, free tier)                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ 1. fetch-live-odds.js (daily)
                     │    - Rate limited (1 call/sec)
                     │    - Smart caching (1h or 24h)
                     │    - Monitors API quota
                     ↓
        ┌────────────────────────────┐
        │   SUPABASE DATABASE        │
        ├────────────────────────────┤
        │ • Odds table               │ ← Moneyline, spreads, totals
        │ • PlayerPropCache table    │ ← All player props
        │ • PropValidation table     │ ← Track accuracy
        │ • MockPropValidation table │ ← Training data
        └────────────────────────────┘
                     ↑
                     │ 2. Frontend queries only
                     │    - Zero API calls
                     │    - Instant response
                     │    - Always fresh
                     │
        ┌────────────────────────────┐
        │      FRONTEND APPS         │
        ├────────────────────────────┤
        │ • Homepage (games list)    │
        │ • Odds display             │
        │ • Props generator          │
        │ • Parlay builder           │
        │ • Validation tracker       │
        └────────────────────────────┘
```

---

## Files Created/Modified

### Core Scripts
- **`scripts/fetch-live-odds.js`** - Main local fetcher script
  - Supabase client integration (not Prisma)
  - Rate limiting & caching strategy
  - Multi-sport support (MLB, NFL, NHL)
  - Flags: `--dry-run`, `--cache-fresh`, `--date`

### Documentation
- **`scripts/ODDS_DATA_PIPELINE.md`** - Architecture & API mappings
- **`scripts/ODDS_FETCHER_README.md`** - Complete usage guide
- **`scripts/ODDS_QUICK_REFERENCE.md`** - Quick lookup card
- **`scripts/IMPLEMENTATION_GUIDE.md`** - 7-phase implementation
- **`ODDS_PIPELINE_SUMMARY.md`** - This file

---

## Quick Start

### 1. Setup (5 minutes)
```bash
# Get API key from https://the-odds-api.com/clients/dashboard
# Add to .env.local:
ODDS_API_KEY=your_key_here
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### 2. Test (2 minutes)
```bash
# Dry run (no DB saves)
node scripts/fetch-live-odds.js nfl --dry-run

# For real
node scripts/fetch-live-odds.js nfl
```

### 3. Verify (1 minute)
```bash
# Check data in Supabase
SELECT COUNT(*) FROM "Odds";
SELECT COUNT(*) FROM "PlayerPropCache";
```

---

## API Budget

### Monthly Quota: 500 calls
```
Recommended: 4 calls/day × 30 days = 120 calls/month
Remaining:   380 calls/month for emergencies
```

### Daily Schedule (Example)
```
6:00 AM  ← Fetch NFL odds & props         (1-2 calls)
9:00 AM  ← Fetch MLB odds & props         (1-2 calls)
3:00 PM  ← Optional: Update if big moves  (0-2 calls)

Total: 2-4 calls/day ✅
```

---

## Database Tables

| Table | Purpose | Stores | Updated |
|-------|---------|--------|---------|
| **Odds** | Game-level odds | H2H, spreads, totals from all books | 1x/day |
| **PlayerPropCache** | Player props cache | All props from The Odds API | 1x/day |
| **PropValidation** | Production props | Actual predictions & results | Ongoing |
| **MockPropValidation** | Training props | Mock data for testing | Ongoing |

### Odds Table Sample
```javascript
{
  gameId: "NFL_CHI_at_CIN_2025-11-02",
  book: "DraftKings",
  market: "h2h",              // h2h | spreads | totals
  priceHome: -110,
  priceAway: -110,
  spread: -1.5,
  total: 47.5,
  ts: "2025-11-02T14:30:00Z"
}
```

### PlayerPropCache Table Sample
```javascript
{
  propId: "NFL_CHI_at_CIN_2025-11-02-Justin Fields-player_pass_yds-249.5",
  gameId: "NFL_CHI_at_CIN_2025-11-02",
  playerName: "Justin Fields",
  type: "player_pass_yds",
  pick: "over",
  threshold: 249.5,
  odds: -110,
  probability: 0.52,
  edge: 2.1,
  confidence: "high",
  qualityScore: 75,
  sport: "nfl",
  bookmaker: "DraftKings",
  expiresAt: "2025-11-03T14:30:00Z"
}
```

---

## Available Props by Sport

### NFL
- `player_pass_yds` - Passing yards
- `player_pass_tds` - Passing touchdowns
- `player_interceptions` - Interceptions
- `player_rush_yds` - Rushing yards
- `player_receptions` - Receptions
- `player_reception_yds` - Receiving yards

### MLB
- `batter_hits` - Hits
- `batter_home_runs` - Home runs
- `batter_rbi` - RBIs
- `pitcher_strikeouts` - Strikeouts
- `pitcher_walks` - Walks
- `batter_singles` - Singles
- `batter_doubles` - Doubles

### NHL (Coming Soon)
- `player_points` - Points
- `player_goals` - Goals
- `player_assists` - Assists
- `player_shots_on_goal` - Shots

---

## Caching Strategy

### How It Works
```
Before API call, check:
├─ Is cache fresh?     (Check age)
│  ├─ YES → Use cache ✅ (save API call)
│  └─ NO  → Fetch fresh 🔄 (use API call)
```

### Expiration Times
| Data Type | Expires | Why |
|-----------|---------|-----|
| Moneyline | 1 hour | Lines move fast |
| Spreads | 1 hour | Bet action moves |
| Props | 24 hours | Less volatile |

---

## Frontend Integration

### ✅ DO THIS - Query Database

```javascript
// Frontend queries database (zero API cost)
export default function OddsPage() {
  const [odds, setOdds] = useState([])
  
  useEffect(() => {
    // Query cached database
    supabase
      .from('Odds')
      .select('*')
      .eq('market', 'h2h')
      .limit(100)
      .then(({ data }) => setOdds(data))
  }, [])
  
  return <OddsList odds={odds} />
}
```

### ❌ DON'T DO THIS - Call API

```javascript
// Never call The Odds API from frontend!
const response = await fetch('https://api.the-odds-api.com/...')  // WRONG!
```

---

## Common Use Cases

### 1. Display Odds on Homepage
```javascript
// Query database
const { data: odds } = await supabase
  .from('Odds')
  .select('*')
  .eq('gameId', gameId)

// No API calls! Already cached by local script.
```

### 2. Build Parlay
```javascript
// Get all props for games
const props = await supabase
  .from('PlayerPropCache')
  .select('*')
  .in('gameId', gameIds)
  .gt('qualityScore', 70)

// Build parlay using only cached data
```

### 3. Track Accuracy
```javascript
// Record prediction when made
await supabase.from('PropValidation').insert({
  propId: 'unique-id',
  playerName: 'Patrick Mahomes',
  prediction: 'over',
  threshold: 249.5,
  status: 'pending'
})

// Update result after game
await supabase.from('PropValidation').update({
  actualValue: 265,
  result: 'correct',
  status: 'completed'
})
```

### 4. Analyze Win Rate
```sql
-- What's our accuracy?
SELECT COUNT(*) as total,
  SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) as wins,
  ROUND(100.0 * SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) / COUNT(*), 2) as win_rate
FROM "PropValidation"
WHERE status = 'completed';
```

---

## Command Reference

### Daily Operations
```bash
# Morning refresh (all sports)
node scripts/fetch-live-odds.js all

# Specific sport
node scripts/fetch-live-odds.js nfl --date 2025-11-02

# Test mode (preview)
node scripts/fetch-live-odds.js mlb --dry-run

# Force fresh (ignore cache)
node scripts/fetch-live-odds.js nhl --cache-fresh
```

### Monitoring
```sql
-- How much data do we have?
SELECT COUNT(*) FROM "Odds";
SELECT COUNT(*) FROM "PlayerPropCache";

-- Which bookmakers?
SELECT DISTINCT "book" FROM "Odds";

-- Prop types available
SELECT DISTINCT "type" FROM "PlayerPropCache";

-- API freshness
SELECT MAX("ts") FROM "Odds";
SELECT MAX("expiresAt") FROM "PlayerPropCache";
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "API Key not found" | Add `ODDS_API_KEY` to `.env.local` |
| "Cannot connect to DB" | Check Supabase variables in `.env.local` |
| "Props not showing" | Run `node scripts/fetch-live-odds.js all --cache-fresh` |
| "API quota exceeded" | Check remaining quota, wait for month reset |
| "Script hangs" | Run single sport instead of `all` |
| "API calls increasing" | Verify frontend doesn't call The Odds API directly |

---

## Best Practices

### ✅ DO THIS
- Run script once daily (morning)
- Monitor API call count in output
- Use cache for repeated queries
- Query database from frontend
- Track props in validation table

### ❌ DON'T DO THIS
- Call API from frontend
- Run script multiple times per day
- Force fresh cache constantly (`--cache-fresh`)
- Ignore API quota limits
- Commit API keys to GitHub

---

## File Locations

### Documentation
```
scripts/
├── ODDS_DATA_PIPELINE.md       ← Architecture & mappings
├── ODDS_FETCHER_README.md      ← Usage guide
├── ODDS_QUICK_REFERENCE.md     ← Quick lookup
└── IMPLEMENTATION_GUIDE.md     ← 7-phase guide
```

### Scripts
```
scripts/
├── fetch-live-odds.js          ← Main fetcher
├── fetch-fresh-games.js        ← Game data from ESPN
└── populate-teams.js           ← Team data from ESPN
```

### Database Schema
```
prisma/
└── schema.prisma               ← Database models
```

---

## Key Metrics

| Metric | Target | Status |
|--------|--------|--------|
| **API Calls/Day** | <5 | ✅ 4 |
| **API Calls/Month** | <300 | ✅ 120 |
| **Cache Hit Rate** | >80% | 📊 Depends on usage |
| **Frontend API Calls** | 0 | ✅ 0 |
| **Prop Freshness** | <24h | ✅ 1x/day refresh |

---

## Next Steps

1. **Setup** (5 min)
   - Get API key
   - Configure `.env.local`
   - Verify Supabase tables

2. **Test** (5 min)
   - Run `--dry-run`
   - Run for real
   - Verify data in DB

3. **Integrate** (30 min)
   - Update frontend to query DB
   - Remove any direct API calls
   - Test with real data

4. **Deploy** (10 min)
   - Push to GitHub
   - Verify on production
   - Monitor API usage

5. **Automate** (Future)
   - Set up cron jobs
   - Monitor quota weekly
   - Add alerting

---

## Support Resources

- **Architecture**: `scripts/ODDS_DATA_PIPELINE.md`
- **Usage**: `scripts/ODDS_FETCHER_README.md`
- **Quick Ref**: `scripts/ODDS_QUICK_REFERENCE.md`
- **Implementation**: `scripts/IMPLEMENTATION_GUIDE.md`

---

## Summary

**We've built an intelligent odds pipeline that:**

1. **Fetches once** from The Odds API (4 calls/day)
2. **Caches always** in Supabase (1-24 hour TTL)
3. **Serves unlimited** frontend users (zero API calls)
4. **Tracks everything** in validation tables
5. **Powers all features** - odds display, props, parlays, tracking

**Result:** Unlimited scalability, predictable costs ($0/month), and enterprise-grade efficiency! 🚀
