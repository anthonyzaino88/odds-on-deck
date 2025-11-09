# Parlay Display Fixes - November 9, 2025

## Issues Fixed

### 1. Long Decimal Odds Display
**Problem**: Parlay odds were displaying as long decimals like `+1.6439315063212688` instead of proper American odds format like `+164`.

**Root Cause**: The `formatOdds` function in `ParlayResults.js` was receiving decimal odds from the parlay generator but not converting them to American odds format.

**Fix**: Updated the `formatOdds` function to properly convert decimal odds to American odds:
- Decimal odds >= 2.0 → Positive American odds: `(decimal - 1) * 100`
- Decimal odds < 2.0 → Negative American odds: `-100 / (decimal - 1)`
- Both rounded to whole numbers

**Example**:
- Decimal: `1.64` → American: `+64`
- Decimal: `3.50` → American: `+250`
- Decimal: `1.83` → American: `-120`

### 2. Single-Game Parlay Dropdown Filtering
**Problem**: Single-game dropdown was showing games without available props (games already in progress or finished).

**Root Cause**: The game filter included `in_progress` games, but props expire when games start, so these games have no available bets.

**Fix**: Updated `ParlayBuilder.js` to filter out `in_progress` and `final` games from the single-game dropdown. Now only shows:
- `scheduled`
- `pre-game` / `pre_game`
- `delayed_start`
- `warmup`

These statuses indicate games that haven't started yet and are more likely to have active props.

## Files Modified

### components/ParlayResults.js
**Lines 53-64**: Rewrote `formatOdds` function to convert decimal to American odds
```javascript
const formatOdds = (decimalOdds) => {
  // Convert decimal odds to American odds
  if (decimalOdds >= 2.0) {
    const americanOdds = Math.round((decimalOdds - 1) * 100)
    return `+${americanOdds}`
  } else {
    const americanOdds = Math.round(-100 / (decimalOdds - 1))
    return americanOdds.toString()
  }
}
```

### components/ParlayBuilder.js
**Lines 109-113**: Updated game filtering to exclude in-progress games
```javascript
const activeGames = games.filter(g => 
  // For single-game parlays, prefer scheduled games (more likely to have props)
  // Exclude in_progress and final games as props expire when games start
  ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup'].includes(g.status)
)
```

## Current NHL Props Status

As of now (Nov 9, 2025 ~1:30 AM EST):
- **Total fresh NHL props**: 50 (down from 285)
- **Available for**: Only 1 game (`ANA_at_VGK_2025-11-08`)
- **Reason**: Most games have already started or finished, causing their props to expire

### Game Status Breakdown:
```
✅ Scheduled (has props): ANA @ VGK
🔴 In Progress (no props): NYI @ NYR, WSH @ TB, BUF @ CAR, UTA @ MTL, BOS @ TOR, SEA @ STL
🔴 Scheduled (no props yet): CBJ @ VAN, COL @ EDM, FLA @ SJ
⚫ Final (expired props): PIT @ NJ, OTT @ PHI, DAL @ NSH
```

## Expected Behavior

### Multi-Game Parlays
- ✅ Works with any sport that has props
- ✅ Combines props from multiple games
- ✅ Currently works for NHL (1 game with props) and NFL (1000 props)

### Single-Game Parlays
- ✅ Dropdown only shows games with status `scheduled`/`pre-game` (not started yet)
- ⚠️ May show "Not enough bets available" if selected game has no props
- ✅ Works for `ANA_at_VGK_2025-11-08` (only game with active props)

### Parlay Display
- ✅ Odds shown in clean American format (e.g., `+164`, `-120`)
- ✅ Payout multiplier shown with 2 decimals (e.g., `1.64x`)
- ✅ No more long decimal strings

## Notes

- Props naturally expire as games approach or start
- This is expected behavior - new props will be available when fresh games are scheduled
- For best results with single-game parlays, select games that are scheduled but haven't started yet
- Multi-game parlays work better when multiple games have active props

## Next Steps

To get more props for tomorrow's games:
1. Run `node scripts/fetch-fresh-games.js nhl` to get tomorrow's NHL schedule
2. Run `node scripts/fetch-live-odds.js nhl` to fetch props for those games

