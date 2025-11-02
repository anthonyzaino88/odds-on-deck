# Local Testing Plan - Hybrid API Implementation

## Goal
Implement smart hybrid approach with efficient API usage, test locally, then push to GitHub.

---

## Phase 1: Database Schema Updates (5 minutes)

### Add `oddsApiEventId` to Game table

```sql
-- Run in Supabase SQL Editor
ALTER TABLE "Game" ADD COLUMN "oddsApiEventId" TEXT;
CREATE INDEX idx_game_odds_api_id ON "Game"("oddsApiEventId");
```

---

## Phase 2: Update Odds Fetcher Script (30 minutes)

### Goals:
1. ✅ Match ESPN games with Odds API events
2. ✅ Store event ID mapping in database
3. ✅ Use stored IDs for subsequent prop fetches
4. ✅ Minimize API calls

### Key Efficiency Features:

#### 1. Smart Caching
- Check database for `oddsApiEventId` BEFORE calling API
- Only fetch odds if cache is stale (1 hour)
- Only fetch props if cache is stale (24 hours)

#### 2. Batch Operations
- Fetch odds once, match to all games
- Store all mappings in single transaction
- Reuse event IDs for prop fetches

#### 3. Skip Completed Games
- Don't fetch props for games that already finished
- Don't fetch odds for games that started

---

## Phase 3: Local Testing Checklist

### Test 1: Populate Games from ESPN ✅
```bash
node scripts/fetch-fresh-games.js nfl
node scripts/fetch-fresh-games.js nhl
```

**Expected:**
- Games appear in database with ESPN IDs
- `oddsApiEventId` is NULL (not set yet)

### Test 2: Fetch Odds + Map Event IDs
```bash
node scripts/fetch-live-odds.js nfl --dry-run
```

**Expected:**
- Script fetches odds from The Odds API
- Matches games by team names + date
- Shows mapping (ESPN game → Odds API event)
- API calls: 1 (just /odds endpoint)

### Test 3: Save Odds + Mappings
```bash
node scripts/fetch-live-odds.js nfl
```

**Expected:**
- Odds saved to `Odds` table
- `oddsApiEventId` saved to `Game` table
- API calls: 1

### Test 4: Fetch Props Using Stored Event IDs
```bash
node scripts/fetch-live-odds.js nfl
```

**Expected:**
- Script uses stored `oddsApiEventId` (no matching needed)
- Fetches props for each game
- API calls: 13 (one per game)
- Total API calls so far: 14

### Test 5: Verify Caching Works
```bash
node scripts/fetch-live-odds.js nfl
```

**Expected:**
- Script skips odds fetch (cache hit)
- Script skips prop fetch (cache hit)
- API calls: 0 ✅

### Test 6: Test All Sports
```bash
node scripts/fetch-live-odds.js all
```

**Expected:**
- Fetches NFL, MLB, NHL
- Stores all mappings
- API calls: ~25-30 total

### Test 7: Verify Homepage
```bash
npm run dev
# Visit http://localhost:3000
```

**Expected:**
- Games display correctly
- Teams show up (not "?")
- Scores update

### Test 8: Check API Usage
Check Supabase database:
```sql
SELECT sport, COUNT(*) as game_count, 
       COUNT(oddsApiEventId) as mapped_count
FROM "Game" 
GROUP BY sport;

SELECT COUNT(*) FROM "Odds";
SELECT COUNT(*) FROM "PlayerPropCache";
```

---

## Phase 4: Efficiency Optimizations

### API Call Budget (per day)

With 20,000 calls/month = **~667 calls/day**

#### Daily API Call Allocation:
| Action | Frequency | Calls/Day |
|--------|-----------|-----------|
| Fetch odds (3 sports) | 2×/day | 6 |
| Fetch props (3 sports × 15 games) | 1×/day | 45 |
| **Total Daily** | | **51** |

**Monthly total:** 51 × 30 = **1,530 calls/month** (7.65% of quota) ✅

#### When to Call API:

**Morning (9 AM):**
- Fetch odds for all sports
- Fetch props for all games
- **Cost:** ~51 calls

**Evening (6 PM):**
- Fetch odds for all sports (lines may have moved)
- Skip props (cached for 24 hours)
- **Cost:** ~6 calls

**Total per day:** ~57 calls  
**Monthly:** ~1,710 calls (8.55% of quota) ✅

---

## Phase 5: Smart Matching Algorithm

### Team Name Matching
The Odds API uses slightly different team names than ESPN:

```javascript
// Add to fetch-live-odds.js

const TEAM_NAME_VARIATIONS = {
  nfl: {
    'Los Angeles Rams': ['LA Rams', 'Rams'],
    'Los Angeles Chargers': ['LA Chargers', 'Chargers'],
    'New York Giants': ['NY Giants', 'Giants'],
    'New York Jets': ['NY Jets', 'Jets'],
  },
  nhl: {
    'Montreal Canadiens': ['Montréal Canadiens'],
    'Vegas Golden Knights': ['Las Vegas Golden Knights'],
  },
  mlb: {
    'Chicago White Sox': ['Chi White Sox', 'White Sox'],
    'Chicago Cubs': ['Chi Cubs', 'Cubs'],
  }
}

function normalizeTeamName(name, sport) {
  // Remove common prefixes
  const normalized = name
    .replace(/^(Los Angeles|New York|San Francisco) /i, '')
    .trim()
  
  // Check variations
  const variations = TEAM_NAME_VARIATIONS[sport] || {}
  for (const [canonical, alts] of Object.entries(variations)) {
    if (alts.includes(name) || canonical.includes(normalized)) {
      return canonical
    }
  }
  
  return name
}

function matchTeams(espnHome, espnAway, oddsHome, oddsAway, sport) {
  const homeMatch = 
    normalizeTeamName(espnHome, sport) === normalizeTeamName(oddsHome, sport) ||
    espnHome.includes(oddsHome) ||
    oddsHome.includes(espnHome)
  
  const awayMatch =
    normalizeTeamName(espnAway, sport) === normalizeTeamName(oddsAway, sport) ||
    espnAway.includes(oddsAway) ||
    oddsAway.includes(espnAway)
  
  return homeMatch && awayMatch
}
```

---

## Phase 6: Error Handling

### Handle Edge Cases:

1. **Game not found in Odds API**
   - Log warning
   - Skip that game
   - Continue with others

2. **Odds API rate limit hit**
   - Stop immediately
   - Log remaining quota
   - Resume from where we left off

3. **Database save fails**
   - Retry once
   - Log error
   - Continue (don't crash entire script)

4. **Team name mismatch**
   - Try fuzzy matching
   - Log mismatches for manual review
   - Create mapping for next run

---

## Phase 7: Monitoring & Logging

### Add API Call Counter

```javascript
// Add to fetch-live-odds.js

let apiCallsThisRun = 0
let apiCallsTotal = 0  // Load from database

async function trackApiCall(endpoint) {
  apiCallsThisRun++
  apiCallsTotal++
  
  console.log(`📞 API Call #${apiCallsThisRun} this run (${apiCallsTotal} total this month)`)
  console.log(`📊 Remaining quota: ${20000 - apiCallsTotal} calls`)
  
  // Save to database
  await supabase
    .from('ApiUsage')
    .insert({
      endpoint,
      timestamp: new Date().toISOString(),
      totalCallsThisMonth: apiCallsTotal
    })
}
```

### Create ApiUsage Table

```sql
CREATE TABLE "ApiUsage" (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  "totalCallsThisMonth" INTEGER,
  "responseTime" INTEGER,
  success BOOLEAN DEFAULT true
);
```

---

## Testing Script Checklist

### Before Testing:
- [ ] Supabase database has `oddsApiEventId` column
- [ ] `.env.local` has correct `ODDS_API_KEY`
- [ ] Database has games from ESPN (run `fetch-fresh-games.js`)

### Test Steps:
1. [ ] Run `node scripts/fetch-live-odds.js nfl --dry-run`
2. [ ] Verify team matching works (check logs)
3. [ ] Run `node scripts/fetch-live-odds.js nfl`
4. [ ] Check database has `oddsApiEventId` values
5. [ ] Check `Odds` table has data
6. [ ] Run again to verify caching works (0 API calls)
7. [ ] Test with `all` sports
8. [ ] Check homepage displays correctly
9. [ ] Verify API usage tracking

### Success Criteria:
✅ All games have `oddsApiEventId`  
✅ Odds saved to database  
✅ Props saved to database  
✅ Caching prevents duplicate API calls  
✅ Team name matching works 100%  
✅ Homepage displays games correctly  
✅ API usage < 100 calls total

---

## Files to Update

1. **Database (Supabase):**
   - Add `oddsApiEventId` column
   - Create `ApiUsage` table (optional but recommended)

2. **`scripts/fetch-live-odds.js`:**
   - Add team name matching logic
   - Add event ID mapping
   - Add smart caching checks
   - Add API usage tracking

3. **Test locally:**
   - All commands listed above
   - Verify each step
   - Check database after each run

4. **When all working:**
   - Commit changes
   - Push to GitHub
   - Deploy to Vercel

---

## API Efficiency Best Practices

### ✅ DO:
1. Cache odds for 1 hour
2. Cache props for 24 hours
3. Store event ID mappings
4. Skip completed/started games
5. Batch operations
6. Track API usage
7. Use stored mappings instead of re-matching

### ❌ DON'T:
1. Fetch same data twice
2. Call API for every game individually for odds
3. Fetch props for completed games
4. Ignore cache
5. Make API calls from frontend
6. Fetch data more than 2-3 times per day

---

## Next Steps

1. **Add `oddsApiEventId` column to Supabase** (SQL command above)
2. **Update `scripts/fetch-live-odds.js`** with matching logic
3. **Test locally** following checklist
4. **Verify all working** before GitHub push
5. **Commit & push** when confident

Ready to start implementation? Let's begin with step 1!

