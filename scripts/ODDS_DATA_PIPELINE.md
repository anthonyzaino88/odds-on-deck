# 🎯 Odds Data Pipeline Architecture

## Overview

This document outlines how The Odds API data flows into our database tables, and how we efficiently fetch, cache, and use that data for props generation, validation, and parlay generation.

## The Odds API Response Structure

### Example: Player Props Response
```json
{
  "bookmakers": [
    {
      "title": "DraftKings",
      "markets": [
        {
          "key": "batter_hits",
          "description": "Batter Hits",
          "outcomes": [
            {
              "name": "Kyle Schwarber",
              "description": "1.5",
              "price": -110  // American odds
            }
          ]
        }
      ]
    }
  ]
}
```

### Example: Moneyline Response
```json
{
  "bookmakers": [
    {
      "title": "DraftKings",
      "markets": [
        {
          "key": "h2h",
          "outcomes": [
            { "name": "Home Team", "price": -110 },
            { "name": "Away Team", "price": -110 }
          ]
        }
      ]
    }
  ]
}
```

## Database Table Mapping

### 1. **Odds Table** - Game-level odds (moneyline, spreads, totals)

**Data Source:** `/sports/{sport}/odds` endpoint with `markets=h2h,spreads,totals`

**Mapping:**
| API Field | DB Field | Notes |
|-----------|----------|-------|
| gamemakers[].title | book | Bookmaker name (DraftKings, FanDuel, etc.) |
| markets[].key | market | h2h, spreads, totals |
| outcomes[0].price (away) | priceAway | American odds |
| outcomes[1].price (home) | priceHome | American odds |
| markets[].description | spread/total | Line value for spreads/totals |
| timestamp | ts | When the odds were fetched |

**Create Query:**
```javascript
await prisma.odds.create({
  data: {
    gameId: game.id,
    book: bookmaker.title,
    market: marketKey,  // 'h2h', 'spreads', 'totals'
    priceHome: homePrice,
    priceAway: awayPrice,
    spread: spreadValue,
    total: totalValue,
    ts: new Date()
  }
})
```

---

### 2. **NFLPlayerProp Table** - NFL player props

**Data Source:** `/sports/americanfootball_nfl/events/{gameId}/odds` with markets

**Mapping:**
| API Field | DB Field | Notes |
|-----------|----------|-------|
| player_name | Player lookup | Find player by name in our DB |
| market_key | propType | player_pass_yds, player_rush_yds, etc. |
| description | threshold | The line (e.g., "249.5") |
| price | overPrice/underPrice | American odds |

**NFL Markets Available:**
```
player_pass_yds - Passing yards
player_pass_tds - Passing TDs
player_rush_yds - Rushing yards
player_receptions - Receptions
player_reception_yds - Receiving yards
player_kicking_points - Kicking points
```

---

### 3. **PlayerPropCache Table** - Cache for all player props (not sport-specific)

**Purpose:** Single cache table to store props from any sport without creating separate tables

**Maps to:** MLB props, NFL props, NHL props (all in one table)

**Mapping:**
```javascript
{
  propId: `${gameId}-${playerName}-${propType}-${line}`,
  gameId: game.id,
  playerName: playerName,
  team: teamAbbr,
  type: propType,  // 'passing_yards', 'hits', 'goals'
  pick: 'over' or 'under',
  threshold: lineValue,
  odds: americanOdds,
  probability: calculatedProb,
  edge: calculatedEdge,
  confidence: 'high'|'medium'|'low',
  qualityScore: 0-100,
  sport: 'mlb'|'nfl'|'nhl',
  bookmaker: 'DraftKings',
  expiresAt: new Date() + 24 hours
}
```

---

### 4. **PropValidation Table** - Track prop results

**Purpose:** Store props we've made predictions on, track actual results

**Mapping:**
```javascript
{
  propId: uniqueId,
  gameIdRef: game.id,
  playerName: playerName,
  propType: 'passing_yards',
  threshold: 249.5,
  prediction: 'over',  // Our prediction
  actualValue: 265,    // Game result
  result: 'correct',   // After game completes
  status: 'pending',   // 'pending'|'completed'
  odds: -110,
  edge: 5.2            // Our calculated edge %
}
```

---

### 5. **MockPropValidation Table** - Mock props for testing

**Purpose:** Generate mock props using probability estimates (no real data needed)

**Same structure as PropValidation** but for training/testing

---

## API Call Efficiency Strategy

### Current API Quota
- The Odds API: **500 requests/month** (free tier)
- **~16 requests/day** available

### Efficient Call Pattern

#### Daily Schedule (4 calls max)
```
6:00 AM   - Fetch all day's games & moneyline odds (1 call)
9:00 AM   - Fetch player props for early games (1 call)
12:00 PM  - Update props/odds as needed (1 call)
3:00 PM   - Final odds snapshot before games (1 call)
```

#### API Call Types (in order of priority)

| Priority | Call | Cost | Frequency | Benefit |
|----------|------|------|-----------|---------|
| 1 | Games + h2h | 1 | 1x/day | Know what games exist |
| 2 | Player props | 1-2 | 1x/day | Generate props for users |
| 3 | Spreads/Totals | 1 | 1-2x/day | Update odds movement |
| 4 | Live updates | 1-2 | Every 4h | Track line movement |

**Total:** 4-6 calls/day (well within 500/month quota)

---

## Caching Strategy

### Cache Expiration Times
- **Moneyline**: 1 hour (odds move quickly)
- **Spreads/Totals**: 1 hour
- **Player Props**: 24 hours (less volatile)
- **Game Schedule**: 24 hours

### Check Cache Before API Call
```javascript
// Before fetching, check if fresh data exists
const cachedOdds = await prisma.odds.findFirst({
  where: {
    gameId: game.id,
    market: 'h2h',
    ts: { gte: new Date(Date.now() - 1 * 60 * 60 * 1000) }  // Last hour
  }
})

if (cachedOdds) {
  return cachedOdds  // Use cache
}

// If not cached, fetch from API
```

---

## Data Flow Diagram

```
The Odds API
    ↓
Local Script (fetch-live-odds.js)
    ↓
    ├─→ Game Schedule
    │   ↓
    │   Odds Table
    │   ├─ h2h (moneyline)
    │   ├─ spreads
    │   └─ totals
    │
    ├─→ Player Props
    │   ↓
    │   ├─ NFLPlayerProp Table (NFL-specific)
    │   └─ PlayerPropCache Table (all sports)
    │
    └─→ Store in Database
        ↓
        Frontend/Parlay/Validation Systems
        (Use cached data, no API calls needed)
```

---

## What We DON'T Do

❌ Fetch odds from the frontend (massive API quotas)
❌ Make real-time API calls for every user (wasteful)
❌ Cache props for longer than 24h (stale data)
❌ Fetch all historical data (too expensive)

---

## What We DO Do

✅ Fetch once daily from backend script
✅ Cache aggressively (use 24h cache for props)
✅ Frontend queries database only
✅ Track all API calls to stay within quota
✅ Prioritize: Games > Props > Odds > Live updates

