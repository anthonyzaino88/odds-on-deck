# 🔧 Odds API Fix - Event IDs Issue

## Problem

The script was failing with 404 errors because it was using **our database game IDs** (like `CHI_at_CIN_2025-11-02`) instead of **The Odds API's event IDs** (like `6dd3b8a705ed0db85d59fa19b9062cc8`).

## Root Cause

**The Odds API uses hash-based event IDs**, not human-readable game IDs:

```json
{
  "id": "6dd3b8a705ed0db85d59fa19b9062cc8",  // ← The Odds API ID
  "home_team": "New England Patriots",
  "away_team": "Atlanta Falcons"
}
```

Our database uses ESPN-based IDs:
```
CHI_at_CIN_2025-11-02  // ← Our database ID format
```

## Solution

Changed the script to use The Odds API's event IDs:

### Before (❌ Wrong)
```javascript
// Used our database game IDs
const { data: games } = await supabase
  .from('Game')
  .select('id')

// Tried to use our IDs with Odds API
const endpoint = `/v4/sports/nfl/events/${game.id}/odds`
// This resulted in 404 errors
```

### After (✅ Correct)
```javascript
// Get games from The Odds API first
const oddsGames = await fetchGameOdds(sport, date)
// oddsGames contains The Odds API event IDs

// Use The Odds API's event IDs
const endpoint = `/v4/sports/nfl/events/${game.id}/odds`
// game.id is now the correct hash ID from The Odds API
```

## How It Works Now

```
Step 1: Fetch game odds
GET /v4/sports/americanfootball_nfl/odds
↓
Returns: [
  {
    "id": "6dd3b8a705ed...",  ← Odds API event ID
    "home_team": "New England Patriots",
    "away_team": "Atlanta Falcons"
  }
]

Step 2: Fetch player props using Odds API event IDs
GET /v4/sports/americanfootball_nfl/events/6dd3b8a705ed.../odds
↓
Returns: Player props for that game ✅
```

## API Key Verification

Your paid API key is working correctly:
```
API Key: [STORED IN .env.local] ✅
Status: Active (paid tier)
```

Test connection:
```bash
curl "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=YOUR_KEY&regions=us&markets=h2h"
```

## Fixed Endpoints

### 1. Game Odds (Working) ✅
```
GET /v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h,spreads,totals
```

### 2. Player Props (Now Fixed) ✅
```
GET /v4/sports/americanfootball_nfl/events/{ODDS_API_EVENT_ID}/odds?regions=us&markets=player_pass_yds,player_pass_tds,...
```

**Key:** Use event ID from step 1, not database ID!

## Testing

```bash
# Test with dry-run (safe, won't save to DB)
node scripts/fetch-live-odds.js nfl --dry-run

# Run for real
node scripts/fetch-live-odds.js all
```

## What's Different

| Before | After |
|--------|-------|
| Used database game IDs | Uses Odds API event IDs |
| `CHI_at_CIN_2025-11-02` | `6dd3b8a705ed0db85d59fa19b9062cc8` |
| Got 404 errors | Gets valid props ✅ |

## Files Changed

- `scripts/fetch-live-odds.js`
  - Changed `fetchPlayerProps()` to accept `oddsGames` parameter
  - Use event IDs from `/odds` endpoint response
  - Pass team names for better logging

## Status

✅ **FIXED** - Script now uses correct Odds API event IDs  
✅ **API Key Working** - Connection to The Odds API verified  
✅ **Ready to Use** - Can fetch odds and props successfully

---

**Last Updated:** 2025-11-02  
**Issue:** Event ID mismatch  
**Resolution:** Use Odds API event IDs throughout

