# Score Update Guide

This guide explains how to safely update game scores without breaking existing functionality.

## Quick Start

### Update All Sports
```bash
node scripts/update-scores-safely.js all
```

### Update Specific Sport
```bash
# NHL scores
node scripts/update-scores-safely.js nhl

# NFL scores
node scripts/update-scores-safely.js nfl

# MLB scores
node scripts/update-scores-safely.js mlb
```

## Safety Features

The score update script is designed to be safe and non-breaking:

### ✅ **Duplicate Handling**
- Uses ESPN ID to find the correct game
- If duplicates exist, updates the game with odds mapped
- Never creates new games during score updates

### ✅ **Selective Updates**
- Only updates: `homeScore`, `awayScore`, `status`, `lastUpdate`
- Preserves all other game data (odds mappings, team IDs, dates, etc.)
- Won't accidentally delete or modify unrelated fields

### ✅ **Status Normalization**
- Automatically removes `"status_"` prefix if present
- Converts to clean format: `"in_progress"`, `"scheduled"`, `"final"`
- Ensures consistent status values across the database

### ✅ **Error Handling**
- Continues processing even if one game fails
- Logs errors but doesn't crash
- Safe to run multiple times

### ✅ **Rate Limiting**
- Includes 300ms delay between API calls
- Prevents ESPN API rate limiting
- Won't overwhelm the API

## Usage Scenarios

### During Live Games
Run this script periodically (every 1-2 minutes) during live games:

```bash
# Update all active games
node scripts/update-scores-safely.js all
```

### Automated Updates
Set up a cron job or scheduler to run automatically:

```bash
# Every 2 minutes during game hours
*/2 * * * * cd /path/to/project && node scripts/update-scores-safely.js all
```

### Manual Refresh
If you need to manually refresh scores:

```bash
# Just NHL games
node scripts/update-scores-safely.js nhl
```

## What Gets Updated

### ✅ Safe to Update
- `homeScore` - Current home team score
- `awayScore` - Current away team score
- `status` - Game status (normalized to clean format)
- `lastUpdate` - Timestamp of last update
- `lastPlay` - Period/inning info (NHL/MLB)
- `inning`, `inningHalf`, `outs`, `balls`, `strikes` (MLB only)

### ❌ Never Updated
- `id` - Game ID (never changes)
- `date` - Game date/time (only set when game is created)
- `homeId`, `awayId` - Team IDs (never change)
- `espnGameId`, `mlbGameId` - External API IDs (never change)
- `oddsApiEventId` - Odds mapping (only set by odds script)
- All other game metadata

## How It Works

1. **Finds Active Games**: Queries for games with `status: 'scheduled'` or `'in_progress'`
2. **Fetches Live Data**: Calls ESPN/MLB API for each game
3. **Finds Correct Game**: Uses ESPN ID to locate the game (handles duplicates)
4. **Selective Update**: Only updates score/status fields
5. **Preserves Data**: All other fields remain unchanged

## Troubleshooting

### No Scores Updating
- Check if games have `espnGameId` or `mlbGameId` set
- Verify games have `status: 'scheduled'` or `'in_progress'`
- Check API connection (ESPN/MLB API might be down)

### Wrong Game Updated
- Script uses ESPN ID to find correct game
- If duplicates exist, it updates the one with odds
- Run `node scripts/fix-game-statuses.js` to clean up statuses first

### Status Still Has Prefix
- The script normalizes status automatically
- If you see `"status_in_progress"`, run the fix script:
  ```bash
  node scripts/fix-game-statuses.js
  ```

## Best Practices

1. **Run Regularly During Games**: Update every 1-2 minutes for live games
2. **Don't Run Multiple Instances**: Only run one score update at a time
3. **Check Logs**: Review output to ensure updates are working
4. **Preserve Data**: Never manually edit game IDs, dates, or team mappings
5. **Use ESPN ID**: Always use ESPN ID to find games, not game IDs (handles duplicates)

## Integration with Daily Refresh

The score update script works alongside the daily refresh:

1. **Morning**: Run `node scripts/refresh-all-data.js all` to get fresh games
2. **During Games**: Run `node scripts/update-scores-safely.js all` every 1-2 minutes
3. **After Games**: Scores automatically update to `final` status

## API Endpoints

The script uses these APIs:
- **NHL**: ESPN `/summary?event={gameId}` endpoint
- **NFL**: ESPN `/summary?event={gameId}` endpoint  
- **MLB**: MLB Stats API `/game/{gameId}/linescore` endpoint

All APIs are called with proper rate limiting and error handling.

## Example Output

```
📊 SAFE SCORE UPDATE
============================================================
📅 Date: 11/5/2025
🏀 Sports: NHL, NFL, MLB
============================================================

🔄 Updating NHL scores...

📊 Found 2 active NHL games

🔄 Updating UTA @ TOR...
  ✅ Updated: 1-0 - Status: in_progress

🔄 Updating STL @ WSH...
  ✅ Updated: 2-1 - Status: in_progress

📊 NHL Summary:
  ✅ Updated: 2
  ❌ Errors: 0
  📋 Total: 2

✅ Score update complete! (2.3s)
  📊 Total updated: 2
  ❌ Total errors: 0
```

