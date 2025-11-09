# Game Pages Odds Display Fix - Complete Summary

## Issues Fixed Today (November 9, 2025)

### 1. ✅ **Odds Fetching Script - Home/Away Team Matching**
**Problem**: Odds were backwards - home team showing as underdog when they were favorites
**Files**: `scripts/fetch-live-odds.js`
**Fix**: Now matches outcomes to actual team names instead of assuming array order

```javascript
// BEFORE (wrong):
priceAway = outcomes[0].price  // Blindly assumes order
priceHome = outcomes[1].price

// AFTER (correct):
const awayOutcome = outcomes.find(o => 
  o.name === game.away_team || 
  o.name?.toLowerCase().includes(game.away_team?.toLowerCase())
)
priceAway = awayOutcome?.price
```

### 2. ✅ **Editor's Picks & Props Pages - Odds Format Display**
**Problem**: Showing decimal odds "+1.49" instead of American format "-223"
**Files**: `app/picks/page.js`, `components/PlayerPropsFilter.js`
**Fix**: Convert decimal to American format in display components

### 3. ✅ **Game Detail Pages - Odds Format Conversion**
**Problem**: NFL/NHL game detail pages showing "1.53" instead of "-189"
**Files**: `lib/implied.js`, `app/game/[id]/page.js`
**Fix**: Updated `formatOdds()` to auto-detect and convert decimal odds

```javascript
export function formatOdds(odds) {
  if (!odds || odds === 0) return 'N/A'
  
  // If odds are between 1.01 and 50, assume they're decimal format and convert
  if (odds > 1 && odds < 50) {
    if (odds >= 2.0) {
      // Underdog: +145
      return `+${Math.round((odds - 1) * 100)}`
    } else {
      // Favorite: -189
      return Math.round(-100 / (odds - 1)).toString()
    }
  }
  
  // Already in American format
  return odds > 0 ? `+${odds}` : odds.toString()
}
```

### 4. ✅ **Duplicate Prop Saves Prevention**
**Problem**: Users could save same prop multiple times (Brandon Saad saved 3x)
**Files**: `lib/validation.js`, `components/PlayerPropsFilter.js`
**Fix**: Use stable propId + keep button disabled after save

## Where Odds Are Now Displayed Correctly

### ✅ Editor's Picks Page (`/picks`)
- **Moneyline picks**: Show "-200" or "+145" (American format)
- **Totals picks**: Show "-110" or "+100" (American format)
- **Player props**: Show "-120" or "+130" (American format)

### ✅ Player Props Page (`/props`)
- All props show American odds format
- Bookmaker source displayed alongside odds

### ✅ Today's Slate (`/games`)
- Game cards show team names and scores
- No odds displayed (by design - keeps it simple)

### ✅ Game Detail Pages (`/game/[id]`)
- **Stat cards at top**:
  - Moneyline: "-189 / +145" (Home / Away)
  - Spread/Puck Line: Shows spread value
- **Detailed Odds Tables**:
  - Moneyline table: All bookmakers show American odds
  - Spread table: Spread values + American odds for both teams
  - Totals table: Total value + American odds for Over/Under

## Verification Examples

### Chicago Bears vs NY Giants (Nov 9, 2025)

**Correct Display (Now)**:
- Chicago (Home): **-189** to **-222** (favorite)
- New York (Away): **+117** to **+180** (underdog)

**Previous Display (Wrong)**:
- Chicago (Home): Was showing +160 to +190 (as underdog ❌)
- New York (Away): Was showing -208 to -263 (as favorite ❌)

## Technical Details

### Data Flow
1. **Fetch**: `scripts/fetch-live-odds.js` fetches odds from Odds API
2. **Store**: Saves as decimal format (1.53, 2.45) in `Odds` table
3. **Retrieve**: Game detail page queries `Odds` table
4. **Display**: `formatOdds()` converts decimal → American for UI

### Why Decimal in Database?
- Odds API returns decimal format (European standard)
- Decimal is easier for calculations (probability, edge, EV)
- We convert to American format only for display (US standard)

### Conversion Formula

**Decimal to American**:
- If decimal ≥ 2.0: `+[(decimal - 1) × 100]` → e.g., 2.45 = +145
- If decimal < 2.0: `-[100 / (decimal - 1)]` → e.g., 1.53 = -189

**American to Decimal** (for calculations):
- If positive: `(odds / 100) + 1` → e.g., +145 = 2.45
- If negative: `(100 / |odds|) + 1` → e.g., -189 = 1.53

## Files Modified (Today's Session)

1. `scripts/fetch-live-odds.js` - Fixed team matching for moneyline/spreads
2. `app/picks/page.js` - Added decimal→American conversion for picks
3. `components/PlayerPropsFilter.js` - Added conversion for props display
4. `lib/validation.js` - Fixed propId to prevent duplicates
5. `lib/implied.js` - Updated formatOdds() to handle decimal input
6. `app/game/[id]/page.js` - Applied formatOdds() to all odds displays

## Testing Checklist

- [x] Editor's Picks shows American odds correctly
- [x] Player Props shows American odds correctly
- [x] Game detail stat cards show correct format
- [x] Moneyline table shows correct odds
- [x] Spread/Puck Line table shows correct odds
- [x] Totals table shows correct odds
- [x] Home/Away teams match correctly (not swapped)
- [x] Favorites show negative odds (e.g., -200)
- [x] Underdogs show positive odds (e.g., +150)
- [x] Props can't be saved multiple times (button stays green)

## For Future Development

### When Adding New Sports
1. Ensure odds fetch script matches outcomes by team name
2. Test with a known game to verify home/away aren't swapped
3. Verify formatOdds() handles the decimal odds correctly

### When Adding New Odds Markets
1. Store as decimal in database
2. Use formatOdds() for all display components
3. Test with multiple bookmakers to ensure consistency

## Related Documentation
- `ODDS_DISPLAY_FIX.md` - Details of the home/away swap fix
- `PLAYER_PROP_EDGE_EXPLAINER.md` - Why props show 0% edge
- `scripts/fetch-live-odds.js` - Odds fetching implementation
- `lib/implied.js` - Odds conversion utilities

