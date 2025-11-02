# Hybrid API Strategy - Best of Both Worlds

## The Problem
We're using two APIs with different ID systems:
- **ESPN API** uses IDs like `401671891`
- **The Odds API** uses IDs like `6dd3b8a705ed0db85d59fa19b9062cc8`

## The Solution: Smart Hybrid Approach ✅

### Use ESPN API For:
1. ✅ **Game schedules** - Free, unlimited
2. ✅ **Live scores** - Real-time updates
3. ✅ **Team data** - Rosters, standings
4. ✅ **Player stats** - Historical performance
5. ✅ **Game details** - Play-by-play, inning/quarter info

### Use The Odds API For:
1. ✅ **Odds data** - Moneyline, spreads, totals
2. ✅ **Player props** - Our core feature
3. ✅ **Bookmaker data** - DraftKings, FanDuel, etc.

---

## ID Mapping Implementation

### Step 1: Update Database Schema

Add `oddsApiEventId` to `Game` table:

```prisma
model Game {
  id               String   @id
  espnGameId       String?  // ESPN's ID
  oddsApiEventId   String?  // The Odds API's event ID
  sport            String
  date             DateTime
  homeId           String
  awayId           String
  // ... rest of fields
}
```

### Step 2: Match Games by Team Names + Date

When fetching odds:

```javascript
// 1. Get games from ESPN (already have in DB)
const dbGames = await supabase
  .from('Game')
  .select('*, home:Team!Game_homeId_fkey(*), away:Team!Game_awayId_fkey(*)')
  .eq('sport', 'nfl')

// 2. Fetch odds from The Odds API
const oddsGames = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds`)

// 3. Match by team names and date
for (const oddsGame of oddsGames) {
  const dbGame = dbGames.find(g => 
    (g.home.name === oddsGame.home_team || g.home.abbr === oddsGame.home_team) &&
    (g.away.name === oddsGame.away_team || g.away.abbr === oddsGame.away_team) &&
    isSameDate(g.date, oddsGame.commence_time)
  )
  
  if (dbGame) {
    // Store the mapping
    await supabase
      .from('Game')
      .update({ oddsApiEventId: oddsGame.id })
      .eq('id', dbGame.id)
  }
}
```

### Step 3: Use Stored Event IDs for Props

```javascript
// Now when fetching props, use the stored Odds API event ID
const game = await supabase
  .from('Game')
  .select('id, oddsApiEventId')
  .eq('id', 'CHI_at_CIN_2025-11-02')
  .single()

// Use the Odds API event ID for props
const props = await fetch(
  `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${game.oddsApiEventId}/odds`
)
```

---

## Cost Analysis

### Current Hybrid Approach
**Monthly API Costs:**
- ESPN: **$0** (free)
- The Odds API: **~100 calls/month** (just odds + props)
  - 3 sports × 2 calls/day (odds + props) × 30 days = 180 calls
  - **$0/month** (within free tier of 500 calls)

### The Odds API Only Approach
**Monthly API Costs:**
- The Odds API: **~4,500 calls/month**
  - 3 sports × 50 games/day × 30 days = 4,500 calls
  - **$2,000+/month** ($0.50/call after 500)

**Savings: $24,000/year by using hybrid approach!**

---

## Implementation Plan

### Phase 1: Add Event ID Mapping (1-2 hours)
1. Add `oddsApiEventId` column to `Game` table in Supabase
2. Update `scripts/fetch-live-odds.js` to store event ID mappings
3. Test with a few games

### Phase 2: Update Odds Fetcher (30 minutes)
1. Modify script to check for existing `oddsApiEventId` first
2. If missing, match by team names + date
3. Store mapping for future use

### Phase 3: Optimize (1 hour)
1. Create index on `oddsApiEventId` for fast lookups
2. Add caching for team name mappings
3. Handle edge cases (team name variations)

---

## Team Name Mapping

The Odds API uses different team names than ESPN sometimes:

```javascript
const TEAM_NAME_MAP = {
  // NFL
  'Los Angeles Rams': ['LA Rams', 'Rams'],
  'Los Angeles Chargers': ['LA Chargers', 'Chargers'],
  'New York Giants': ['NY Giants', 'Giants'],
  'New York Jets': ['NY Jets', 'Jets'],
  // Add more as needed...
}

function matchTeamName(espnName, oddsApiName) {
  if (espnName === oddsApiName) return true
  const variations = TEAM_NAME_MAP[espnName] || []
  return variations.includes(oddsApiName)
}
```

---

## Benefits of Hybrid Approach

### 1. Cost Efficiency 💰
- **$0/month** vs **$2,000+/month**
- Free ESPN data for 95% of needs
- The Odds API only for what it does best (odds + props)

### 2. Better Data Quality 📊
- ESPN has more comprehensive game data
- ESPN has better live score updates
- ESPN has player stats and rosters
- The Odds API has accurate, up-to-date odds

### 3. Reliability 🛡️
- If one API goes down, still have partial functionality
- ESPN is more stable (backed by Disney)
- The Odds API quota management

### 4. Flexibility 🔧
- Easy to add more data sources later
- Can switch odds providers if needed
- Not locked into single vendor

---

## When to Use The Odds API Only

### You should ONLY use The Odds API for everything if:
1. ❌ You have **unlimited budget** ($2,000+/month)
2. ❌ You **don't need** live scores or player stats
3. ❌ You **only care** about odds data
4. ❌ You have **very few games** to track (< 50/month)

**For our use case: Hybrid is clearly better ✅**

---

## Migration Path (If You Want to Try Odds API Only)

### Step 1: Add Supabase Edge Function
Create a serverless function to fetch game data from The Odds API:

```javascript
// supabase/functions/fetch-odds-games/index.ts
export default async function handler() {
  const sports = ['americanfootball_nfl', 'baseball_mlb', 'icehockey_nhl']
  
  for (const sport of sports) {
    const response = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${ODDS_API_KEY}`
    )
    const games = await response.json()
    
    // Save to database
    for (const game of games) {
      await supabase.from('Game').insert({
        id: game.id,  // Use Odds API ID directly
        oddsApiEventId: game.id,
        sport: sport.split('_')[0],
        date: game.commence_time,
        homeTeam: game.home_team,
        awayTeam: game.away_team
      })
    }
  }
}
```

### Step 2: Update Frontend
Change homepage to use Odds API IDs:

```javascript
// Before
const game = await fetch(`/api/games/${espnId}`)

// After
const game = await fetch(`/api/games/${oddsApiEventId}`)
```

### Step 3: Remove ESPN Dependencies
- Delete `scripts/fetch-fresh-games.js`
- Remove ESPN API calls from codebase
- Update team population script

**Estimated effort: 4-6 hours**  
**Estimated cost increase: $24,000/year**

---

## Recommendation

### ✅ **Keep Hybrid Approach**

**Why:**
1. **Free** - Saves $24,000/year
2. **Better data** - ESPN has more comprehensive info
3. **Working now** - Homepage already populated with games
4. **Simple mapping** - Just add one column and matching logic

**Action Items:**
1. Add `oddsApiEventId` column to `Game` table (5 minutes)
2. Update `fetch-live-odds.js` to store mappings (30 minutes)
3. Test with current games (15 minutes)

**Total work: ~1 hour**  
**Cost savings: $24,000/year**

---

## Files to Update

### 1. `prisma/schema.prisma`
```prisma
model Game {
  id               String   @id
  espnGameId       String?
  oddsApiEventId   String?  // ADD THIS
  // ... rest
}
```

### 2. `scripts/fetch-live-odds.js`
Add event ID mapping logic after fetching odds.

### 3. Database (Supabase)
```sql
ALTER TABLE "Game" ADD COLUMN "oddsApiEventId" TEXT;
CREATE INDEX idx_game_odds_api_id ON "Game"("oddsApiEventId");
```

---

**Decision Time:** 

Should we implement the hybrid approach with ID mapping, or would you like to explore using The Odds API exclusively?

My strong recommendation: **Hybrid + ID Mapping** (1 hour work, $24k/year savings)

