# Daily Data Refresh Guide

This guide explains how to run the daily data refresh to ensure all game data, times, and odds are correctly loaded and mapped.

## Overview

The daily refresh process ensures:
- ✅ Fresh game data from ESPN with correct times
- ✅ No duplicate games
- ✅ Correct odds mapping to games
- ✅ Proper score updates without creating duplicates
- ✅ Games with correct times prioritized over placeholder times

## Quick Start

### Single Sport Refresh

```bash
# Refresh NHL data
node scripts/refresh-all-data.js nhl

# Refresh NFL data  
node scripts/refresh-all-data.js nfl

# Refresh all sports
node scripts/refresh-all-data.js all
```

## What the Script Does

The `refresh-all-data.js` script runs in this order:

1. **Cleanup Old Duplicates** - Removes duplicate games without odds
2. **Fetch Fresh Games** - Gets latest games from ESPN with:
   - Correct game times (not placeholder 7pm times)
   - Automatic duplicate prevention
   - Time updates for existing games
   - Automatic odds migration when better times are found
3. **Map and Save Odds** - Fetches odds from The Odds API and maps them to games
4. **Verify Results** - Shows summary of games, odds coverage, and duplicates

## Daily Workflow

### Morning Refresh (Before Games Start)

Run this once per day in the morning to get fresh game data:

```bash
node scripts/refresh-all-data.js all
```

This will:
- Fetch fresh games for the next 7 days
- Map odds to all games
- Clean up any duplicates
- Update game times if ESPN provides better times

### During Games (Score Updates)

Scores are automatically updated via the live scoring system. The system:
- Uses ESPN ID to find the correct game (even if duplicates exist)
- Prioritizes updating the game with odds mapped
- Never creates new games during score updates

Manual score refresh:
```bash
# NHL scores
node scripts/refresh-nhl-scores.js

# Or use the live scoring API endpoint
# /api/live-scores/refresh
```

## Preventing Duplicates

The system automatically prevents duplicates through:

1. **ESPN ID Checking** - Before creating a game, checks if a game with the same ESPN ID exists
2. **Time-Based Prioritization** - If duplicates exist, keeps the game with the better time
3. **Odds Preservation** - If a duplicate has odds, those odds are moved to the game with the better time before deletion
4. **Pre-Update Cleanup** - Removes old duplicates without odds before fetching new games

## Troubleshooting

### Duplicates Still Appearing

If you see duplicates after running the refresh:

1. Check if they have odds:
   ```bash
   node scripts/find-duplicate-games.js
   ```

2. If duplicates have odds, they're being handled - the system will move odds to the better game on next refresh

3. If duplicates don't have odds, they should be cleaned up automatically

### Odds Not Mapping

If odds aren't mapping to games:

1. Check team name matching:
   ```bash
   node scripts/test-team-matching.js
   ```

2. Check what games are in the database:
   ```bash
   node scripts/list-games-with-odds.js
   ```

3. Debug mapping for a specific game:
   ```bash
   node scripts/debug-odds-mapping.js
   ```

### Wrong Times Showing

If games show 7pm (12:00 AM EST) instead of actual times:

1. The system automatically detects and replaces games with placeholder times
2. Run the refresh again - it will move odds to games with correct times
3. Check ESPN's actual response:
   ```bash
   node scripts/test-espn-game-time.js
   ```

## Manual Cleanup

If you need to manually clean up duplicates:

```bash
# Find duplicates
node scripts/find-duplicate-games.js

# Remove duplicates (keeps the one with odds)
node scripts/remove-duplicate-games-by-espn-id.js --confirm
```

## Automation

To run automatically daily, add to your cron job or scheduler:

```bash
# Daily at 8 AM
0 8 * * * cd /path/to/project && node scripts/refresh-all-data.js all
```

Or use Vercel Cron Jobs (see `vercel.json` for configuration).

## Key Features

### Automatic Time Correction

When ESPN provides better times (not placeholder midnight UTC times):
- The system detects games with better times
- Automatically moves odds from old games to new games with better times
- Deletes old games with placeholder times

### Duplicate Prevention

- Checks for existing games by ESPN ID before creating
- Updates existing games instead of creating duplicates
- Handles timezone differences that cause date shifts

### Score Update Safety

- Uses ESPN ID to find the correct game
- Prioritizes updating the game with odds mapped
- Never creates new games during score updates

## Best Practices

1. **Run refresh once daily** in the morning before games start
2. **Don't run multiple refresh scripts simultaneously** - they may conflict
3. **Check logs** after running to verify no errors
4. **Monitor for duplicates** - if you see them, run the cleanup scripts
5. **Let the system handle odds migration** - don't manually move odds

## Verification

After running the refresh, verify everything worked:

```bash
# Check for duplicates
node scripts/find-duplicate-games.js

# Check odds coverage
node scripts/list-games-with-odds.js

# Check game times
node scripts/check-game-times.js
```

Expected results:
- ✅ No duplicates (or only duplicates without odds that will be cleaned up)
- ✅ Most games have odds mapped (80%+ coverage)
- ✅ Games show correct times (not all 7pm)

