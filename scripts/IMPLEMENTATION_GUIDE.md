# 🚀 Odds Data Pipeline - Implementation Guide

## Phase 1: Setup (One-Time)

### Step 1: Get API Key
1. Visit https://the-odds-api.com/clients/dashboard
2. Create free account
3. Copy your API key
4. Add to `.env.local`:
```bash
ODDS_API_KEY=your_key_here
```

### Step 2: Verify Environment Variables
Make sure `.env.local` has:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
ODDS_API_KEY=your_odds_api_key
```

### Step 3: Verify Supabase Tables Exist
```sql
-- These tables must exist in Supabase:
SELECT * FROM "Game" LIMIT 1;           -- Games must be populated
SELECT * FROM "Team" LIMIT 1;           -- Teams must be populated
SELECT * FROM "Odds" LIMIT 1;           -- Will be empty initially
SELECT * FROM "PlayerPropCache" LIMIT 1; -- Will be empty initially
```

**If tables don't exist**, run migrations:
```bash
npx prisma migrate deploy
```

---

## Phase 2: Initial Population (First Time)

### Step 1: Test the Script (Dry Run)
```bash
# Test without saving anything to DB
node scripts/fetch-live-odds.js nfl --dry-run

# Check output:
# 🎮 Fetching NFL ODDS for 2025-11-02...
#   ✅ Fetched 14 games with odds
# 👤 Fetching NFL PLAYER PROPS for 2025-11-02...
#   ✅ Saved 28 prop records
# ✅ Complete! API calls used: 2
```

### Step 2: Run for Real (First Sport)
```bash
# Run for NFL (smallest API cost)
node scripts/fetch-live-odds.js nfl

# Verify in Supabase:
SELECT COUNT(*) FROM "Odds" WHERE "book" = 'DraftKings';
SELECT COUNT(*) FROM "PlayerPropCache" WHERE "sport" = 'nfl';
```

### Step 3: Expand to All Sports
```bash
# Once NFL works, fetch all sports
node scripts/fetch-live-odds.js all

# Monitor API usage:
# ✅ Complete! API calls used: 6
# 📊 Remaining quota: ~494 calls this month
```

---

## Phase 3: Frontend Integration

### Step 1: Query Odds from Database

**Before** (❌ Don't do this):
```javascript
// Wasteful - calls API every time user loads page
const response = await fetch('https://api.the-odds-api.com/...')
```

**After** (✅ Do this):
```javascript
// Query cached database (zero API cost)
export default function OddsPage() {
  const [odds, setOdds] = useState([])
  
  useEffect(() => {
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

### Step 2: Query Props from Database

```javascript
// Get all props for a game
const { data: props } = await supabase
  .from('PlayerPropCache')
  .select('*')
  .eq('gameId', gameId)
  .eq('sport', 'nfl')

// Filter by quality score
const highConfidence = props.filter(p => p.qualityScore > 75)
```

### Step 3: Use in Parlay Generator

```javascript
// Parlay generator queries database only
async function generateParlay(games) {
  // Get props for games
  const props = await supabase
    .from('PlayerPropCache')
    .select('*')
    .in('gameId', games.map(g => g.id))
  
  // Get odds for moneylines
  const odds = await supabase
    .from('Odds')
    .select('*')
    .in('gameId', games.map(g => g.id))
    .eq('market', 'h2h')
  
  // Build parlay from cached data (no API calls!)
  return buildParlay(props, odds, games)
}
```

---

## Phase 4: Daily Operations

### Recommended Daily Schedule

```
6:00 AM   Morning refresh
│
├─ node scripts/fetch-live-odds.js nfl --date today
│ └─ Update NFL odds for today
│
├─ node scripts/fetch-live-odds.js mlb
│ └─ Update MLB props if there are games
│
└─ Frontend automatically uses fresh cached data
   (no changes needed, already queries DB)

3:00 PM   Afternoon update (optional)
└─ node scripts/fetch-live-odds.js all
   (Update odds if lines have moved significantly)
```

### Weekly Quota Check

```bash
# Monday morning - verify budget
# Output should show something like:
# ✅ Complete! API calls used: 4
# 📊 Remaining quota: ~496 calls this month

# If used >100 calls by day 3, reduce frequency
# If used <50 calls by day 7, budget is safe
```

---

## Phase 5: Optimization

### Reduce API Calls

If you want to use fewer than 4 calls/day:

```bash
# Option 1: Run less frequently
# Once per day only (morning)
0 6 * * * node scripts/fetch-live-odds.js all

# Option 2: Run only needed sports
# Skip sports with no games
0 6 * * * node scripts/fetch-live-odds.js nfl   # Football season only
0 6 * * * node scripts/fetch-live-odds.js mlb   # Baseball season only

# Option 3: Use cache more
# Run with --cache-fresh less often
# --cache-fresh forces new fetch, normal run uses cache
```

### Monitor Cache Effectiveness

```sql
-- Check how much data is cached
SELECT COUNT(*), MAX("ts") FROM "Odds";
SELECT COUNT(*), MAX("expiresAt") FROM "PlayerPropCache";

-- See which bookmakers we have
SELECT DISTINCT "book" FROM "Odds";

-- Check prop distribution
SELECT "sport", "type", COUNT(*) as count 
FROM "PlayerPropCache" 
GROUP BY "sport", "type";
```

---

## Phase 6: Parlay Generation

### Build Props for Parlay

```javascript
// Example: Build NFL passing yards parlays

// Step 1: Get cached props from database
const props = await supabase
  .from('PlayerPropCache')
  .select('*')
  .eq('sport', 'nfl')
  .eq('type', 'player_pass_yds')
  .gt('qualityScore', 70)
  .limit(5)

// Step 2: Add calculated fields
const enricedProps = props.map(p => ({
  ...p,
  expectedValue: calculateEV(p.probability, p.odds),
  winProbability: calculateWinProb(p.odds),
  kellyCriterion: calculateKelly(p.probability, p.odds)
}))

// Step 3: Build parlay
const parlay = {
  legs: enrichedProps.slice(0, 3),
  totalOdds: calculateParayOdds([...]),
  expectedValue: enrichedProps.reduce((sum, p) => sum + p.expectedValue, 0)
}

return parlay
```

### Track Parlay Results

```javascript
// After game completes
const actualValue = getPlayerStat(playerId, propType)

// Update validation tracking
await supabase
  .from('PropValidation')
  .update({
    actualValue,
    result: actualValue > p.threshold ? 'correct' : 'incorrect',
    status: 'completed'
  })
  .eq('propId', propId)
```

---

## Phase 7: Validation System

### Track Prop Accuracy

```javascript
// Create validation record when prop is made
const validation = await supabase
  .from('PropValidation')
  .insert({
    propId: generateId(),
    playerName: 'Patrick Mahomes',
    propType: 'player_pass_yds',
    threshold: 249.5,
    prediction: 'over',
    projectedValue: 265,
    edge: 5.2,
    confidence: 'high',
    odds: -110,
    status: 'pending'
  })

// After game, update with result
await supabase
  .from('PropValidation')
  .update({
    actualValue: 285,
    result: 'correct',
    status: 'completed'
  })
  .eq('propId', propId)
```

### Analyze Accuracy

```sql
-- Win rate
SELECT 
  COUNT(CASE WHEN result = 'correct' THEN 1 END)::float / COUNT(*) as win_rate
FROM "PropValidation"
WHERE status = 'completed';

-- By confidence level
SELECT 
  confidence,
  COUNT(*) as count,
  COUNT(CASE WHEN result = 'correct' THEN 1 END)::float / COUNT(*) as win_rate
FROM "PropValidation"
WHERE status = 'completed'
GROUP BY confidence;

-- ROI calculation
SELECT 
  COUNT(CASE WHEN result = 'correct' THEN 1 END) as wins,
  COUNT(CASE WHEN result = 'incorrect' THEN 1 END) as losses,
  ROUND(AVG(CASE WHEN result = 'correct' THEN 1 ELSE 0 END), 3) as accuracy
FROM "PropValidation"
WHERE status = 'completed';
```

---

## ⚠️ Common Mistakes

### ❌ Don't Do This

1. **Call API from frontend**
   ```javascript
   // BAD - wastes API quota
   const response = await fetch('https://api.the-odds-api.com/...')
   ```

2. **Forget to cache**
   ```javascript
   // BAD - calls API every refresh
   node scripts/fetch-live-odds.js all --cache-fresh  // Every time!
   ```

3. **Run script too frequently**
   ```bash
   # BAD - wastes quota (uses 480 calls/month!)
   */15 * * * * node scripts/fetch-live-odds.js all  # Every 15 minutes!
   ```

4. **Ignore API limits**
   ```bash
   # BAD - you'll hit 500 calls quickly
   No monitoring, no schedule
   ```

### ✅ Do This Instead

1. **Query database from frontend**
   ```javascript
   const { data } = await supabase.from('Odds').select('*')
   ```

2. **Trust cache**
   ```bash
   # GOOD - uses cache, checks if fresh
   node scripts/fetch-live-odds.js all  # Normal run (not --cache-fresh)
   ```

3. **Run on schedule**
   ```bash
   # GOOD - only 4 calls/day = 120/month
   0 6 * * * node scripts/fetch-live-odds.js all
   ```

4. **Monitor actively**
   ```bash
   # GOOD - check output for API call count
   ✅ Complete! API calls used: 4
   📊 Remaining quota: ~496 calls this month
   ```

---

## 🎯 Success Metrics

**Phase 1 Complete When:**
- ✅ API key obtained
- ✅ `.env.local` configured
- ✅ Supabase tables verified

**Phase 2 Complete When:**
- ✅ `--dry-run` shows data fetching
- ✅ Real run shows data saved to DB
- ✅ Can query Odds & PlayerPropCache tables

**Phase 3 Complete When:**
- ✅ Frontend queries database (not API)
- ✅ Props display on frontend
- ✅ Zero API calls from frontend

**Phase 4 Complete When:**
- ✅ Daily schedule established
- ✅ API quota monitored
- ✅ <120 calls/month usage

**Phase 5+ Complete When:**
- ✅ Parlay generation working
- ✅ Validation system tracking
- ✅ Accuracy metrics calculated

---

## 📞 Support

**Issue: "API call count keeps increasing"**
- Check if frontend is calling API directly
- Verify database queries in frontend code
- Use network inspector to check API requests

**Issue: "Props not showing on frontend"**
- Verify `PlayerPropCache` has data
- Check `expiresAt` timestamps
- Try running script with `--cache-fresh`

**Issue: "Running out of API quota"**
- Reduce frequency (run only 1x/day)
- Use cache more (don't force fresh)
- Consider upgrading to paid API tier

---

## 🎓 Key Takeaway

```
LOCAL SCRIPT (Daily)     SUPABASE (Always Fresh)     FRONTEND (Zero Cost)
──────────────────────────────────────────────────────────────────────
Fetch odds/props   →    Cache in database    →    Query DB only
(4 API calls)            (unlimited queries)        (instant response)
Runs 1x morning          Refreshes automatically    User sees cached data
Costs $0/month           Costs $0/month            Costs $0/month
                         (within free tier)         (no API calls)
```

**Result: Unlimited frontend users, only 4 API calls/day, no quota concerns! 🎉**

