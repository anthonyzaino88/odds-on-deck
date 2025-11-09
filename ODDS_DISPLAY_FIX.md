# Odds Display Fix - November 2025

## Issue Discovered
**Date**: November 9, 2025
**Problem**: Moneyline and spread odds were displaying incorrectly throughout the app - home and away odds were swapped.

### Example
For **Bears vs Giants** game:
- **Correct odds** (from sportsbooks):
  - Chicago Bears (home): **-223** (favorite)
  - New York Giants (away): **+183** (underdog)

- **Incorrect display** (before fix):
  - Chicago Bears (home): +160 to +190 (showing as underdog)
  - New York Giants (away): -208 to -263 (showing as favorite)

## Root Cause
In `scripts/fetch-live-odds.js`, the code was blindly assigning outcomes by array position:
```javascript
// WRONG - assumes order
priceAway = outcomes[0].price
priceHome = outcomes[1].price
```

The Odds API can return outcomes in any order, so this assumption was incorrect. The outcomes need to be matched by team name.

## Solution
Updated the script to match outcomes to teams by name:
```javascript
// CORRECT - matches by team name
const awayOutcome = outcomes.find(o => 
  o.name === game.away_team || 
  o.name?.toLowerCase().includes(game.away_team?.toLowerCase())
)
const homeOutcome = outcomes.find(o => 
  o.name === game.home_team || 
  o.name?.toLowerCase().includes(game.home_team?.toLowerCase())
)
priceAway = awayOutcome?.price || outcomes[0].price
priceHome = homeOutcome?.price || outcomes[1].price
```

Applied this fix to:
- **Moneyline** (`h2h` market)
- **Spreads** (`spreads` market)
- Totals were already correct (they use Over/Under, not team names)

## How to Verify Odds Are Correct

### Quick Check
1. Find a game where there's a clear favorite
2. Compare odds in the app to a sportsbook website (DraftKings, FanDuel, etc.)
3. Verify:
   - Favorite shows negative odds (e.g., -223)
   - Underdog shows positive odds (e.g., +183)
   - Home/away teams match correctly

### Script-Based Verification
If you need to verify odds in the database:
```bash
# Create a quick check script
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

(async () => {
  const { data } = await supabase
    .from('Odds')
    .select('*, game:Game!inner(*, home:Team!Game_homeId_fkey(name), away:Team!Game_awayId_fkey(name))')
    .eq('game.id', 'YOUR_GAME_ID_HERE')
    .eq('market', 'h2h')
    .limit(5);
  
  console.log(JSON.stringify(data, null, 2));
})();
"
```

## Impact on User Experience

### Before Fix
- Users saw incorrect odds, making it confusing to compare with sportsbooks
- Favorites appeared as underdogs and vice versa
- Could lead to betting mistakes if users trusted the displayed odds

### After Fix
- All odds now accurately reflect sportsbook data
- Users can confidently compare odds across bookmakers
- Moneyline picks in Editor's Picks now show correct value
- Props display correctly (were not affected by this issue)

## Files Changed
- `scripts/fetch-live-odds.js` - Core fix for outcome matching

## Testing Done
1. ✅ Cleared all incorrect odds from database
2. ✅ Re-fetched NFL odds with fixed script
3. ✅ Re-fetched NHL odds with fixed script  
4. ✅ Verified Bears vs Giants odds match sportsbook data
5. ✅ Confirmed odds display correctly in Editor's Picks
6. ✅ Verified player props still work correctly

## Future Prevention
- When adding new sports or markets, always match outcomes by name
- Test with real sportsbook data before deployment
- Create verification scripts for any odds changes

## Related Documentation
- `scripts/fetch-live-odds.js` - Main odds fetching script
- `LIVE_ODDS_SCHEDULE.md` - Recommended update schedule
- `lib/picks.js` - How odds are used to generate picks

