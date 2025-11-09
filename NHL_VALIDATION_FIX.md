# NHL Validation System Fix

## Issues Found

### 1. **Mobile Nav** ✅ FIXED
- Added `/validation` link to mobile nav (replaced `/games`)

### 2. **NHL Prop Type Mismatch** 🐛 CRITICAL
**Problem:** PropValidation records have prop types like:
- `"player_shots_on_goal"` 
- `"player_power_play_points"`
- `"player_goals"`

But `nhl-game-stats.js` expects:
- `"shots"`
- `"powerplay_points"`
- `"goals"`

**Result:** 590 NHL validations marked as "needs_review" because stats couldn't be fetched.

### 3. **Root Cause**
When NHL props are saved from `fetch-live-odds.js`, they use the raw API prop type names (e.g., `"player_shots_on_goal"`). But the stat fetching function uses simplified names (e.g., `"shots"`).

## Solution

### Fix 1: Normalize Prop Types in `nhl-game-stats.js`

Update the stat mapping to handle both formats:

```javascript
const statMapping = {
  // Support both formats
  'goals': ['goals', 'G'],
  'player_goals': ['goals', 'G'],
  
  'assists': ['assists', 'A'],
  'player_assists': ['assists', 'A'],
  
  'points': ['points', 'PTS'],
  'player_points': ['points', 'PTS'],
  
  'shots': ['shots', 'SOG', 'shotsOnGoal'],
  'player_shots_on_goal': ['shots', 'SOG', 'shotsOnGoal'],
  
  'powerplay_points': ['powerPlayPoints', 'PPP'],
  'player_power_play_points': ['powerPlayPoints', 'PPP'],
  
  'blocked_shots': ['blockedShots', 'BLK'],
  'player_blocked_shots': ['blockedShots', 'BLK'],
  
  'saves': ['saves', 'SV'],
  'goalie_saves': ['saves', 'SV']
}
```

### Fix 2: Re-validate the 590 "needs_review" Records

After fixing the mapping, reprocess all NHL validations that are marked as "needs_review" for final games.

---

## Implementation

Let's implement the fixes now.

