# Parlay Generation Fix - November 9, 2025

## Problem
- No parlays were generating
- Single-game dropdown showed no games for any sport (NFL or NHL)
- Frontend logs showed "Fetched 0 props from Supabase" despite having props in the database

## Root Causes

### 1. API Response Structure Mismatch
**Issue**: The `ParlayBuilder.js` component was expecting the wrong response structure from `/api/games/today`.

**Expected**:
```json
{
  "success": true,
  "games": [...]
}
```

**Actual**:
```json
{
  "success": true,
  "data": {
    "mlb": [...],
    "nfl": [...],
    "nhl": [...]
  }
}
```

**Fix**: Updated `components/ParlayBuilder.js` line 63-69 to correctly parse `result.data.mlb`, `result.data.nfl`, and `result.data.nhl` instead of `data.games`.

### 2. Wrong Default Sport
**Issue**: The parlay builder was defaulting to `mlb`, which has 0 available props (MLB season is over).

**Database Status**:
- NHL: 285 props, 93 high-edge (10%+), 7 active games
- NFL: 1000 props, 32 high-edge (10%+), 0 active games today (Saturday)
- MLB: 0 props, 0 games (off-season)

**Fix**: Changed the default sport from `mlb` to `nhl` in `components/ParlayBuilder.js` line 6.

## Files Modified

### components/ParlayBuilder.js
1. **Line 6**: Changed default sport from `'mlb'` to `'nhl'`
   ```javascript
   const [sport, setSport] = useState('nhl') // Changed default from 'mlb' to 'nhl'
   ```

2. **Lines 53-88**: Fixed API response parsing
   ```javascript
   if (result.success && result.data) {
     // The API returns data in a nested structure: { success, data: { mlb, nfl, nhl } }
     const allGames = {
       mlb: result.data.mlb || [],
       nfl: result.data.nfl || [],
       nhl: result.data.nhl || []
     }
   ```

## Verification

### Database Props Available:
```
NHL:
  Total Props: 285
  High Edge (10%+): 93
  Avg Edge: 9.2%
  Avg Probability: 46.0%

NFL:
  Total Props: 1000
  High Edge (10%+): 32
  Avg Edge: 6.8%
  Avg Probability: 55.8%

MLB:
  Total Props: 0
```

### Games Available:
```
NHL: 7 active games today
NFL: 0 active games today (Saturday)
MLB: 0 active games (off-season)
```

## Expected Behavior After Fix

1. **Parlay Page Loads**: Default to NHL sport (not MLB)
2. **Games Dropdown**: Populated with 7 NHL games when "Single Game" parlay type is selected
3. **Parlay Generation**: Successfully generates parlays using the 285 available NHL props
4. **NFL Toggle**: User can switch to NFL and generate parlays from 1000 NFL props
5. **MLB Toggle**: Shows "No props available" message (expected - off-season)

## Notes

- The hot reloader will automatically pick up these changes without needing a manual refresh
- All data comes from the Supabase database (no Prisma dependencies)
- The `simple-parlay-generator.js` is already using Supabase exclusively
- The old `lib/parlay-generator.js` has been deleted (was using Prisma)

## Next Steps

If parlays still don't generate:
1. Check browser console for any new error messages
2. Verify the `/api/parlays/generate` endpoint is being called with correct parameters
3. Check that `simple-parlay-generator.js` is correctly fetching props from `PlayerPropCache`
