# 🔧 Vercel NHL Games Fix

## Issues Found

1. **10 NHL games showing instead of 5** - Likely due to timezone date filtering
2. **No scores showing** - Scores might be `null` instead of `0`

## Fixes Applied

### 1. Timezone-Aware Date Filtering

Changed from:
```javascript
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
```

To:
```javascript
// Use UTC to avoid timezone issues on Vercel
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD
```

### 2. Date String Comparison

Changed from:
```javascript
.gte('date', today.toISOString())
.lt('date', tomorrow.toISOString())
```

To:
```javascript
.gte('date', todayStr)  // YYYY-MM-DD format
.lt('date', tomorrowStr)
```

This ensures consistent date filtering regardless of timezone.

### 3. Default Scores to 0

Changed from:
```javascript
homeScore: game.homeScore,
awayScore: game.awayScore,
```

To:
```javascript
homeScore: game.homeScore ?? 0,
awayScore: game.awayScore ?? 0,
```

This ensures scores always display (0 for scheduled games, actual scores for live/final).

## Next Steps

1. **Deploy the fix** - Push to GitHub and Vercel will auto-deploy
2. **Check for duplicates** - If still showing 10 games, run:
   ```bash
   node scripts/remove-duplicate-nhl-games.js
   ```
3. **Refresh scores** - If scores still missing, run:
   ```bash
   node scripts/refresh-nhl-scores.js
   ```

## Verification

After deploy, check:
- ✅ Shows exactly 5 NHL games (not 10)
- ✅ All games show scores (0-0 for scheduled, actual scores for live/final)
- ✅ Date filtering works correctly

