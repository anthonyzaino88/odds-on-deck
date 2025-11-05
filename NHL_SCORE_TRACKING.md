# 🏒 NHL Score Tracking Implementation

## Overview

NHL live score tracking has been integrated into the existing live scoring system. Scores update automatically for active games every 15 seconds.

## How It Works

### 1. **Live Scoring Manager** (`lib/live-scoring-manager.js`)

The live scoring manager now includes NHL games:

- **Fetches active NHL games** with status `in_progress` and `espnGameId`
- **Updates every 15 seconds** for live games
- **Stores scores** in the `Game` table
- **Stores period info** in `lastPlay` field (e.g., "Period 2 - 15:30")

### 2. **NHL Game Detail Fetcher** (`lib/vendors/nhl-stats.js`)

The `fetchNHLGameDetail()` function:
- Fetches live game data from ESPN's `/summary?event={gameId}` endpoint
- Returns scores, status, period, clock, and period descriptor
- Maps ESPN status codes to our internal status format

### 3. **API Endpoints**

#### Live Scoring API
```
GET /api/live-scoring
GET /api/live-scoring?force=true  (force refresh)
```

Returns all active games (MLB, NFL, NHL) with live scores.

#### Manual Refresh Script
```bash
node scripts/refresh-nhl-scores.js
```

Manually refreshes scores for all active NHL games.

## Data Structure

### Game Updates
When an NHL game is updated, the following fields are set:

- `homeScore` - Home team score
- `awayScore` - Away team score  
- `status` - Game status (`scheduled`, `in_progress`, `final`)
- `lastUpdate` - Timestamp of last update
- `lastPlay` - Period info (e.g., "Period 2 - 15:30" or "End of 1st Period")

### Status Mapping

ESPN Status → Our Status:
- `STATUS_SCHEDULED` / `1` → `scheduled`
- `STATUS_IN_PROGRESS` / `2` → `in_progress`
- `STATUS_FINAL` / `3` → `final`
- `STATUS_FINAL_OVERTIME` → `final`
- `STATUS_END_PERIOD` → `in_progress`

## Usage

### Automatic Updates

The live scoring system automatically:
1. Finds all active NHL games (`status = 'in_progress'` and `espnGameId` exists)
2. Fetches live data from ESPN every 15 seconds
3. Updates scores and status in the database
4. Frontend components can poll `/api/live-scoring` to get updates

### Manual Refresh

**Via Script:**
```bash
node scripts/refresh-nhl-scores.js
```

**Via API:**
```bash
# Browser
http://localhost:3000/api/live-scoring?force=true

# PowerShell
Invoke-WebRequest -Uri "http://localhost:3000/api/live-scoring?force=true" -Method GET
```

### Frontend Integration

Use the existing `useLiveScoring` hook:

```javascript
import { useLiveScoring } from '@/hooks/useLiveScoring'

function NHLGameComponent({ game }) {
  const { liveGames, loading } = useLiveScoring([game])
  
  // Find this game in live games
  const liveGame = liveGames.find(g => g.id === game.id)
  
  if (liveGame) {
    return (
      <div>
        <div>{liveGame.away.abbr} {liveGame.awayScore}</div>
        <div>{liveGame.home.abbr} {liveGame.homeScore}</div>
        <div>{liveGame.lastPlay}</div>
        <div>Status: {liveGame.status}</div>
      </div>
    )
  }
}
```

## Requirements

For score tracking to work, games must have:
- ✅ `sport = 'nhl'`
- ✅ `espnGameId` set (from ESPN API)
- ✅ `status = 'in_progress'` (or scheduled)

## Automatic Status Detection

The system automatically:
- Detects when games start (`scheduled` → `in_progress`)
- Updates scores during games
- Detects when games end (`in_progress` → `final`)

## Integration with Existing System

NHL score tracking integrates seamlessly with:
- ✅ **MLB** live scoring (same system)
- ✅ **NFL** live scoring (same system)
- ✅ **Live scoring API** (`/api/live-scoring`)
- ✅ **Cron jobs** (can be added to `vercel.json`)

## Cron Job Setup (Optional)

To automatically refresh scores every minute during game days:

```json
{
  "crons": [
    {
      "path": "/api/live-scoring",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

Or create a dedicated NHL refresh endpoint:

```javascript
// app/api/cron/refresh-nhl-scores/route.js
export async function GET() {
  const { refreshNHLScores } = await import('../../../../scripts/refresh-nhl-scores.js')
  const result = await refreshNHLScores()
  return NextResponse.json(result)
}
```

## Testing

### Test Live Scoring

1. **Find an active NHL game:**
   ```bash
   # Check database for active games
   SELECT id, "espnGameId", status, "homeScore", "awayScore" 
   FROM "Game" 
   WHERE sport = 'nhl' AND status = 'in_progress';
   ```

2. **Manually refresh:**
   ```bash
   node scripts/refresh-nhl-scores.js
   ```

3. **Check API:**
   ```bash
   curl http://localhost:3000/api/live-scoring
   ```

### Test Game Detail Fetching

```javascript
// Test in Node console
const { fetchNHLGameDetail } = require('./lib/vendors/nhl-stats.js')
const gameData = await fetchNHLGameDetail('401802552') // Example ESPN game ID
console.log(gameData)
```

## Troubleshooting

### No scores updating?

1. **Check if game has `espnGameId`:**
   ```sql
   SELECT id, "espnGameId", status FROM "Game" WHERE sport = 'nhl';
   ```

2. **Check if game is active:**
   - Status must be `in_progress` (not `scheduled` or `final`)
   - Game must have a valid `espnGameId`

3. **Check ESPN API:**
   - Visit: `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event={espnGameId}`
   - Verify the game is live and has scores

### Scores not showing in UI?

1. **Check live scoring API:**
   ```bash
   curl http://localhost:3000/api/live-scoring
   ```

2. **Check frontend hook:**
   - Ensure `useLiveScoring` is being called
   - Check browser console for errors

3. **Check game status:**
   - Game must be `in_progress` to show live scores
   - Scheduled games won't have live scores yet

## Future Enhancements

Potential improvements:
- [ ] Store period/shots data in dedicated table (like NFLGameData)
- [ ] Add power play time tracking
- [ ] Add shot-on-goal tracking
- [ ] Add penalty tracking
- [ ] Real-time notifications for goals
- [ ] Period-by-period scoring breakdown

## Related Files

- `lib/live-scoring-manager.js` - Main live scoring logic
- `lib/vendors/nhl-stats.js` - NHL API integration
- `app/api/live-scoring/route.js` - Live scoring API endpoint
- `scripts/refresh-nhl-scores.js` - Manual refresh script
- `hooks/useLiveScoring.js` - Frontend hook for live scores



