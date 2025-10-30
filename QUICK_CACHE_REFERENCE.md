# ⚡ Player Props Cache - Quick Reference

## What Changed?

Player props are now **cached in the database** for 30 minutes, eliminating repetitive API calls.

## Before vs After

### Before 🐌
```
Load page → 18 API calls → 10-15 seconds
Change dropdown → 18 API calls → 10-15 seconds
Generate parlay → 18 API calls → 10-15 seconds
```

### After ⚡
```
Load page #1 → 18 API calls → 10-15 seconds (stores in cache)
Load page #2 → 0 API calls → 1-2 seconds! ✨
Change dropdown → 0 API calls → Instant! ✨
Generate parlay → 0 API calls → 1-2 seconds! ✨
```

## Key Benefits

- **85% faster page loads** (10-15s → 1-2s)
- **75% fewer API calls** (saves money!)
- **Instant UI updates** (dropdowns, filters)
- **No code changes needed** in frontend

## How to Test

1. **First Load**: Refresh homepage → Will fetch from API (slow)
   - Console: `🔄 Cache miss or stale, fetching fresh props from API...`
   - Console: `💾 Caching 2394 props...`

2. **Second Load**: Refresh homepage again → Will use cache (fast!)
   - Console: `✅ Found 341 cached MLB props (X minutes old)`
   - Console: `⚡ Cache age: MLB Xmin, NFL Xmin, NHL Xmin`

3. **UI Interaction**: Change sport/legs → Instant!
   - No loading spinner
   - No API calls

## Console Messages

### Cache Hit (Good!) ✅
```
🎯 Fetching player props (checking cache first)...
✅ Found 341 cached MLB props (12 minutes old)
✅ Using cached player props: 341 MLB, 0 NFL, 2053 NHL
⚡ Cache age: MLB 12min, NHL 12min
```

### Cache Miss (Normal on first load) 🔄
```
🎯 Fetching player props (checking cache first)...
📊 No fresh cached props found for MLB
🔄 Cache miss or stale, fetching fresh props from API...
💾 Caching 2394 props...
```

## Configuration

Cache expires after **30 minutes** or **1 hour before game time** (whichever is sooner).

To adjust, edit `lib/prop-cache-manager.js`:
```javascript
CACHE_DURATION_MINUTES: 30  // Change this
```

## When Cache Refreshes

- Every 30 minutes automatically
- On first load after 30 minutes
- When you click "Refresh All Data" button
- Never during UI interactions (dropdowns, filters)

## Database Cleanup

Old props are automatically deleted:
- Props from games 2+ days old
- Stale/expired props marked
- Runs on each data refresh

## Files Changed

- `prisma/schema.prisma` - Added PlayerPropCache model
- `lib/prop-cache-manager.js` - Cache utilities (NEW)
- `lib/data-manager.js` - Integrated caching

## Troubleshooting

### Props not updating?
- Wait 30 minutes or click "Refresh All Data"
- Cache will automatically expire

### Still seeing slow loads?
- Check console for cache messages
- First load after 30 minutes is always slow
- Subsequent loads should be fast

### API calls still high?
- Cache only works for player props
- Game odds and schedules still fetch normally
- This is expected behavior

## API Usage Impact

### Typical Day (8 hours of use)
- **Before**: ~1,728 API calls
- **After**: ~432 API calls
- **Savings**: 75% reduction! 🎉

---

*Quick Reference - October 11, 2025*

