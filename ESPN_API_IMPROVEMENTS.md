# ESPN API Improvements Based on Community Guide

## Current Usage

### NHL Endpoints (Currently Using)
- ✅ `/apis/site/v2/sports/hockey/nhl/scoreboard` - Scoreboard/game list
- ✅ `/apis/site/v2/sports/hockey/nhl/summary?event={gameId}` - Game details & team stats

### NFL Endpoints (Currently Using)
- ✅ `/apis/site/v2/sports/football/nfl/teams/{team_id}/roster` - Team rosters
- ✅ `/apis/site/v2/sports/football/nfl/scoreboard` - Scoreboard

## Recommended Improvements

### 1. Team Details with `enable` Parameter ⭐ **HIGH PRIORITY**

**Current Approach:**
- We extract team season stats from game summary endpoint
- Requires a game ID to work

**Better Approach:**
```javascript
// Direct team stats endpoint
GET /apis/site/v2/sports/hockey/nhl/teams/{team_id}?enable=roster,projection,stats
```

**Benefits:**
- ✅ No game ID required
- ✅ More reliable - direct team data
- ✅ Can get roster, stats, and projections in one call
- ✅ Works for any team, any time

**Implementation:**
```javascript
// lib/nhl-matchups.js - Better team stats fetch
async function fetchTeamSeasonStatsDirect(teamId, teamAbbr) {
  const espnTeamId = teamId.replace(/^NHL_/, '')
  const url = `${ESPN_NHL_BASE}/teams/${espnTeamId}?enable=roster,projection,stats`
  
  const response = await fetch(url, {
    headers: { 'User-Agent': 'OddsOnDeck/1.0' }
  })
  
  // Parse team stats from response
  // Response structure: team.statistics or team.record
}
```

### 2. Standings Endpoint ⭐ **HIGH PRIORITY**

**Endpoint:**
```javascript
GET /apis/site/v2/sports/hockey/nhl/standings?season={year}
```

**Benefits:**
- ✅ Team rankings and standings
- ✅ Season records (wins, losses, points)
- ✅ Division/conference standings
- ✅ Could include team stats

**Use Cases:**
- Show team rankings in matchup analysis
- Display division/conference standings
- Compare team records

### 3. Core API Team Endpoints ⭐ **MEDIUM PRIORITY**

**Endpoint:**
```javascript
GET /v2/sports/hockey/leagues/nhl/seasons/{year}/teams/{team_id}
```

**Benefits:**
- ✅ More detailed team data structure
- ✅ Season-specific information
- ✅ May include advanced statistics

### 4. Core API Leaders (For Rankings) ⭐ **MEDIUM PRIORITY**

**Endpoint:**
```javascript
GET /v2/sports/hockey/leagues/nhl/seasons/{year}/types/{st}/leaders
```

**Parameters:**
- `{year}` - Season year (e.g., 2024)
- `{st}` - Season type (2 = regular season)

**Benefits:**
- ✅ League leaders in various categories
- ✅ Team rankings for offense/defense
- ✅ Could supplement matchup analysis

### 5. Game Summary Enhancements ⭐ **LOW PRIORITY**

**Current:** We're already using this effectively
**Potential Enhancement:** Check if `enable` parameter works:
```javascript
GET /apis/site/v2/sports/hockey/nhl/summary?event={gameId}&enable=plays,boxscore
```

## Implementation Priority

### Phase 1: Quick Wins (Team Stats Direct Access)
1. ✅ Update `fetchTeamSeasonStats` to try team endpoint first
2. ✅ Fallback to game summary if team endpoint fails
3. ✅ Test with multiple teams

### Phase 2: Standings & Rankings
1. ✅ Add standings endpoint to fetch team rankings
2. ✅ Display rankings in matchup analysis
3. ✅ Show division/conference standings

### Phase 3: Enhanced Statistics
1. ✅ Explore Core API endpoints
2. ✅ Add league leader comparisons
3. ✅ Advanced matchup metrics

## Code Changes Needed

### File: `lib/nhl-matchups.js`
- Add `fetchTeamSeasonStatsDirect()` function
- Update `fetchTeamSeasonStats()` to try direct method first
- Add standings fetching function

### File: `lib/vendors/nhl-team-stats.js`
- Add function to fetch team details with `enable` parameter
- Add function to fetch standings

### New File: `lib/vendors/espn-standings.js`
- Centralized standings fetching
- Support for multiple sports (NHL, NFL, MLB)

## Testing Checklist

- [ ] Test team endpoint with `enable=stats` for NHL
- [ ] Test team endpoint with `enable=roster,stats` for NHL
- [ ] Test standings endpoint for current season
- [ ] Verify fallback to game summary still works
- [ ] Test with teams that have no recent games
- [ ] Compare stats from team endpoint vs game summary
- [ ] Check response structure for both endpoints

## Notes

⚠️ **Important:** These are undocumented APIs. ESPN may change them without notice.

**Best Practices:**
- Always implement fallbacks
- Cache responses when possible
- Handle errors gracefully
- Use `User-Agent` header
- Monitor for API changes




