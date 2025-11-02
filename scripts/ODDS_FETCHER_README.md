# 📊 Odds Fetcher Script - User Guide

## Quick Start

```bash
# Fetch today's odds for all sports (recommended)
node scripts/fetch-live-odds.js all

# Fetch NFL odds for a specific date
node scripts/fetch-live-odds.js nfl --date 2025-11-02

# Test without saving to database
node scripts/fetch-live-odds.js mlb --dry-run

# Force fresh API call (ignore cache)
node scripts/fetch-live-odds.js nhl --cache-fresh
```

---

## What This Script Does

This script fetches odds and player props from **The Odds API** and stores them in your Supabase database. Frontend pages **never call The Odds API directly** - they just query the cached database.

### Data Fetched

**For Each Sport:**
1. **Moneyline Odds** → `Odds` table (h2h market)
2. **Spread/Total Odds** → `Odds` table
3. **Player Props** → `PlayerPropCache` table

### API Efficiency

| Call Type | API Cost | Frequency | Purpose |
|-----------|----------|-----------|---------|
| Game odds | 1 call | 1-2x/day | Moneyline/spreads/totals |
| Player props | 1-2 calls | 1x/day | Batter hits, passing yards, etc. |
| **Total** | **4-6 calls/day** | - | **Well within 500/month quota** |

---

## Prerequisites

### 1. The Odds API Key

Get your free API key:
1. Go to https://the-odds-api.com/clients/dashboard
2. Sign up for free account
3. Copy your API key
4. Add to `.env.local`:
```bash
ODDS_API_KEY=your_api_key_here
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 2. Supabase Connection

Make sure these are set in `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_public_anon_key
```

---

## Usage Examples

### Example 1: Daily Morning Run
```bash
# Monday morning before games - fetch all odds for the week
node scripts/fetch-live-odds.js all

# Output:
# ============================================================
# ⚡ ODDS FETCHER - LOCAL SCRIPT
# ============================================================
# 📅 Date: 2025-11-02
# 🎮 Sport: all
# 🏗️  Mode: PRODUCTION
# ============================================================
# 
# 🎮 Fetching NFL ODDS for 2025-11-02...
#   ✅ Cache hit for moneyline odds
# 
# 👤 Fetching NFL PLAYER PROPS for 2025-11-02...
#   📅 Found 14 games
#   ✅ Fetched 5 bookmakers for NFL_CHI_at_CIN_2025-11-02
#   ✅ Saved 28 prop records
# 
# ✅ Complete! API calls used: 2
# 📊 Remaining quota: ~498 calls this month
```

### Example 2: Test Mode (No Database Saves)
```bash
# Preview what would be fetched without saving
node scripts/fetch-live-odds.js mlb --dry-run

# Shows all the data but doesn't save anything
# Useful for testing or checking data format
```

### Example 3: Force Fresh Data
```bash
# Ignore cache, fetch fresh from API
node scripts/fetch-live-odds.js nfl --cache-fresh

# Use when:
# - You suspect cache is stale
# - Lines have moved significantly
# - You're testing the API
```

### Example 4: Specific Date
```bash
# Fetch data for a specific past/future date
node scripts/fetch-live-odds.js mlb --date 2025-10-30

# Use for:
# - Historical data
# - Upcoming games
# - Makeup games or postponements
```

---

## What Gets Stored Where

### Odds Table
```javascript
{
  gameId: "MLB_NYY_vs_BOS_2025-11-02",
  book: "DraftKings",           // Bookmaker name
  market: "h2h",                // moneyline | spreads | totals
  priceHome: -110,              // American odds
  priceAway: -110,
  spread: -1.5,
  total: 8.5,
  ts: "2025-11-02T14:30:00Z"   // When fetched
}
```

### PlayerPropCache Table
```javascript
{
  propId: "MLB_NYY_vs_BOS_2025-11-02-Aaron Judge-batter_home_runs-1.5",
  gameId: "MLB_NYY_vs_BOS_2025-11-02",
  playerName: "Aaron Judge",
  type: "batter_home_runs",       // Prop type
  pick: "over",                   // Our pick
  threshold: 1.5,                 // The line
  odds: -110,                     // American odds
  probability: 0.5,               // Default (calculate later)
  edge: 0,                        // Default (calculate later)
  confidence: "low",              // Default (calculate later)
  qualityScore: 0,
  sport: "mlb",
  bookmaker: "DraftKings",
  expiresAt: "2025-11-03T14:30:00Z"  // Refresh after this
}
```

---

## Available Props by Sport

### NFL Props
```
player_pass_yds    - Passing yards
player_pass_tds    - Passing touchdowns
player_interceptions - Interceptions thrown
player_rush_yds    - Rushing yards
player_receptions  - Receptions caught
player_reception_yds - Receiving yards
```

### MLB Props
```
batter_hits        - Hits
batter_home_runs   - Home runs
batter_rbi         - RBIs
batter_singles     - Singles
batter_doubles     - Doubles
pitcher_strikeouts - Strikeouts
pitcher_walks      - Walks
```

### NHL Props (Coming Soon)
```
player_points      - Points (goals + assists)
player_goals       - Goals
player_assists     - Assists
player_shots_on_goal - Shots on goal
```

---

## API Call Budget

### Free Tier: 500 calls/month

**Recommended Daily Schedule:**
```
6:00 AM  - Fetch all odds (1 call)
9:00 AM  - Fetch player props (1 call)
3:00 PM  - Update lines (1 call)
8:00 PM  - Final snapshot (1 call)
         = 4 calls/day × 30 days = 120 calls/month ✅
```

**You have 380 calls left for:**
- Emergency refreshes
- Catching up on missed days
- Testing/development
- Line movement tracking

---

## Caching Strategy

### How Caching Works

Before fetching from API, script checks if **recent data exists**:

```
Cache Age Check:
├─ Moneyline/Spreads: 1 hour old? → Use cache ✅
├─ Props: 24 hours old? → Use cache ✅
└─ Stale? → Fetch fresh from API 🔄
```

### Cache Expiration Times

| Data Type | Expiry | Reason |
|-----------|--------|--------|
| Moneyline | 1 hour | Lines move quickly |
| Spreads | 1 hour | Bet action moves lines |
| Totals | 1 hour | Sharp money adjusts totals |
| Props | 24 hours | Less volatile |
| Games | 24 hours | Schedule rarely changes |

### Force Fresh Cache
```bash
node scripts/fetch-live-odds.js nfl --cache-fresh
# Ignores all cache, fetches everything from API
```

---

## Troubleshooting

### Error: "ODDS_API_KEY not found"
```bash
# Add to .env.local:
ODDS_API_KEY=your_key_here
```

### Error: "Cannot reach database"
```bash
# Check .env.local has these:
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

### Error: "API QUOTA EXCEEDED"
```bash
# You've used all 500 calls for the month
# Check remaining quota in script output
# Wait until next month or upgrade plan
```

### Props not showing in frontend
```bash
# 1. Check if props are in database:
SELECT * FROM "PlayerPropCache" LIMIT 10;

# 2. Check if they've expired:
SELECT * FROM "PlayerPropCache" WHERE "expiresAt" > NOW();

# 3. Re-run script to refresh:
node scripts/fetch-live-odds.js all --cache-fresh
```

### Script hangs/times out
```bash
# Increase timeout or run with specific sport:
node scripts/fetch-live-odds.js nfl
# Instead of:
node scripts/fetch-live-odds.js all
```

---

## Frontend Integration

### Frontend queries database (NOT API)

```javascript
// GOOD ✅ - Query cached data from database
const { data: odds } = await supabase
  .from('Odds')
  .select('*')
  .eq('gameId', gameId)
  .eq('market', 'h2h')

// BAD ❌ - Never call The Odds API directly
const response = await fetch('https://api.the-odds-api.com/...')  // WRONG!
```

### Example: Props Component
```javascript
// pages/props.js
export default function PropsPage() {
  const [props, setProps] = useState([])
  
  useEffect(() => {
    // Query database only (already cached by local script)
    supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('sport', 'mlb')
      .then(({ data }) => setProps(data))
  }, [])
  
  return <PropsList props={props} />
}
```

---

## Scheduling (Future)

To run automatically on a schedule, use a cron job:

### Linux/Mac
```bash
# Run every day at 6 AM
0 6 * * * cd /path/to/app && node scripts/fetch-live-odds.js all >> logs/odds-fetcher.log 2>&1
```

### Windows (Task Scheduler)
```
1. Task Scheduler → Create Basic Task
2. Trigger: Daily at 6:00 AM
3. Action: Start program
4. Program: node.exe
5. Arguments: scripts/fetch-live-odds.js all
```

---

## Best Practices

✅ **Do This:**
- Run once daily in the morning
- Use caching (don't force fresh constantly)
- Monitor API usage in script output
- Check database for data before frontend queries
- Keep `ODDS_API_KEY` in `.env.local` (NOT in git)

❌ **Don't Do This:**
- Call The Odds API from the frontend (wasteful)
- Run the script multiple times per hour (quota exhaustion)
- Fetch all historical data (too expensive)
- Ignore cache (wastes API calls)
- Commit API keys to GitHub

---

## Support

**Issues?**
1. Check `.env.local` has all required variables
2. Run with `--dry-run` to test without DB saves
3. Check Supabase database for data presence
4. Check API call count: `console.log(apiCallsToday)`
5. Review error messages for specific failures
