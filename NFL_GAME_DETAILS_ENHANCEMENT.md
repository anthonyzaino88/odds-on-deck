# NFL Game Details Enhancement Plan

## Current Status
- ✅ Basic game info (teams, date, status, scores)
- ✅ Odds display (moneyline, spread, totals)
- ❌ Starting Lineups (empty - needs roster data)
- ❌ Matchup Analysis (empty - needs historical/season stats)

## What We Can Add (Using ESPN API - FREE)

### 1. **Starting Lineups** ⭐ HIGH PRIORITY
**What to Show:**
- QB, RB, WR, TE starters
- Player names, positions, jersey numbers
- Injury status (if available)

**How to Populate:**
```bash
# Option 1: Use API endpoint
curl -X POST http://localhost:3000/api/nfl/roster

# Option 2: Run script directly
node -e "import('./lib/nfl-roster.js').then(m => m.fetchAndStoreNFLRosters('2025'))"
```

**Data Source:** ESPN API → `NFLRosterEntry` table
**API Endpoint:** `/apis/site/v2/sports/football/nfl/teams/{team_id}/roster`

---

### 2. **Matchup Analysis** ⭐ HIGH PRIORITY
**What to Show (Current Season Stats - Quick Win):**
- **Team A Offense vs Team B Defense:**
  - Points per game (offense) vs Points allowed per game (defense)
  - Yards per game vs Yards allowed per game
  - Turnovers per game vs Takeaways per game
  - 3rd down conversion % vs 3rd down defense %
  - Red zone efficiency % vs Red zone defense %

- **Team B Offense vs Team A Defense:**
  - Same metrics reversed

**How to Populate:**
- Fetch current season stats from ESPN API
- Use team endpoint: `/apis/site/v2/sports/football/nfl/teams/{team_id}?enable=stats`
- Or extract from game summary: `/apis/site/v2/sports/football/nfl/summary?event={gameId}`

**Alternative (Future Enhancement):**
- Historical matchup data (last 3 years)
- Store in `NFLMatchupHistory` table
- Calculate trends and advantages

---

### 3. **Team Season Stats** ⭐ MEDIUM PRIORITY
**What to Show:**
- Current season record (W-L)
- Points per game (offense)
- Points allowed per game (defense)
- Yards per game (offense)
- Yards allowed per game (defense)
- Turnover differential
- Home/Away record

**Data Source:** ESPN API team stats endpoint

---

### 4. **Injury Report** ⭐ MEDIUM PRIORITY
**What to Show:**
- Key players injury status
- Questionable/Doubtful/Out players
- Impact on starting lineup

**API Endpoint:** `/api/nfl/roster?action=injury-report&teamId={teamId}`

---

### 5. **Weather Information** ⭐ LOW PRIORITY
**What to Show:**
- Temperature, wind, precipitation
- Impact on passing/running game

**Data Source:** Weather API or ESPN game summary

---

## Implementation Priority

### Phase 1: Quick Wins (Can implement today)
1. ✅ **Populate NFL Rosters** - Run roster fetch script
2. ✅ **Add Current Season Stats** - Modify `lib/nfl-matchups.js` to fetch season stats from ESPN (like NHL does)
3. ✅ **Display Team Records** - Add to game details page

### Phase 2: Enhanced Features (Next week)
1. **Historical Matchup Data** - Fetch past games between teams
2. **Injury Reports** - Display key injuries
3. **Advanced Stats** - Red zone %, 3rd down %, etc.

---

## Quick Implementation Steps

### Step 1: Populate NFL Rosters
```bash
# This will populate NFLRosterEntry table with starter data
node -e "import('./lib/nfl-roster.js').then(m => m.fetchAndStoreNFLRosters('2025'))"
```

### Step 2: Add Season Stats to Matchup Analysis
Modify `lib/nfl-matchups.js` to:
- Fetch current season stats from ESPN API (similar to NHL)
- Show offense vs defense comparisons
- Display rankings and efficiency metrics

### Step 3: Display Team Records
Add team record display to game details page header

---

## ESPN API Endpoints Available

### NFL Team Stats
```
GET /apis/site/v2/sports/football/nfl/teams/{team_id}?enable=stats
```

### NFL Game Summary (includes team stats)
```
GET /apis/site/v2/sports/football/nfl/summary?event={gameId}
```

### NFL Team Roster
```
GET /apis/site/v2/sports/football/nfl/teams/{team_id}/roster
```

### NFL Scoreboard (current week)
```
GET /apis/site/v2/sports/football/nfl/scoreboard
```

---

## Example Data Structure

### Starting Lineups Response
```json
{
  "starters": {
    "away": {
      "team": { "id": "NFL_1", "name": "Atlanta Falcons", "abbr": "ATL" },
      "starters": [
        { "id": "player1", "fullName": "Kirk Cousins", "position": "QB", "jersey": "8", "injuryStatus": "healthy" },
        { "id": "player2", "fullName": "Bijan Robinson", "position": "RB", "jersey": "7", "injuryStatus": "healthy" }
      ]
    },
    "home": { ... }
  }
}
```

### Matchup Analysis Response
```json
{
  "game": { "id": "ATL_at_IND_2025-11-09", ... },
  "advantages": {
    "away": {
      "pointsAvg": 24.5,
      "totalYardsAvg": 385,
      "turnoversAvg": 1.2,
      "thirdDownPct": 42,
      "redZonePct": 65,
      "gamesAnalyzed": 8,
      "trend": "improving"
    },
    "home": { ... }
  },
  "insights": [
    {
      "type": "advantage",
      "message": "ATL offense ranks 8th in points per game vs IND defense ranks 22nd",
      "category": "offensive_matchup",
      "confidence": "high"
    }
  ]
}
```

---

## Next Steps

1. **Immediate:** Run roster fetch to populate starting lineups
2. **Today:** Modify matchup analysis to show season stats (like NHL)
3. **This Week:** Add team records and injury reports
4. **Future:** Build historical matchup database

