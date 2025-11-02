# 🎯 Local Odds Fetcher Script

This script allows you to **fetch and store live odds data locally** without wasting API calls through the web interface.

## ✨ Features

- ✅ **Rate-limited API calls** - Respects The Odds API rate limits (3 requests/sec)
- ✅ **Efficient batch operations** - All writes happen at once
- ✅ **Dry-run mode** - Preview what will be saved without actually saving
- ✅ **Sport filtering** - Fetch MLB, NFL, or NHL separately
- ✅ **Date-based queries** - Fetch games for today, tomorrow, or any specific date
- ✅ **Detailed logging** - See exactly what's happening
- ✅ **Error handling** - Gracefully handles API failures

## 📋 Prerequisites

1. **ODDS_API_KEY** set in `.env.local`:
   ```
   ODDS_API_KEY=your_api_key_here
   ```

2. **Database populated** with games (use `scripts/setup-database.js` first)

3. **Node.js 16+**

## 🚀 Usage

### Basic Examples

```bash
# Fetch tonight's MLB games
node scripts/fetch-live-odds.js mlb

# Fetch today's NFL games  
node scripts/fetch-live-odds.js nfl today

# Fetch NHL games for a specific date
node scripts/fetch-live-odds.js nhl 2025-11-02

# Dry-run (preview without saving)
node scripts/fetch-live-odds.js mlb --dry-run
```

### Command Format

```bash
node scripts/fetch-live-odds.js [sport] [date] [--dry-run]
```

**Arguments:**
- `sport` - Required: `mlb`, `nfl`, or `nhl`
- `date` - Optional: `today` (default), or `YYYY-MM-DD` format
- `--dry-run` - Optional: Preview mode (don't save to DB)

## 📊 What Gets Fetched

### MLB Props (10 markets)
- Batting: Hits, HRs, Total Bases, RBIs, Runs, Strikeouts
- Pitching: Strikeouts, Outs, Hits Allowed, Earned Runs

### NFL Props (6 markets)
- Passing: Yards, TDs, Completions
- Rushing: Yards, Attempts, TDs
- Receiving: Receptions, Yards, TDs
- Kicking: Points

### NHL Props (4 markets)
- Points, Goals, Assists, Shots on Goal

## 📈 API Call Efficiency

**Rate Limiting:**
- 300ms delay between API calls = ~3 requests/second
- Safe buffer below The Odds API's ~10 requests/second limit
- Prevents 429 rate-limit errors

**Example Scenarios:**
- 5 MLB games = ~5 API calls (~2 seconds)
- 14 NFL games = ~14 API calls (~5 seconds)  
- 13 NHL games = ~13 API calls (~4 seconds)

## 💡 Best Practices

1. **Always test with `--dry-run` first:**
   ```bash
   node scripts/fetch-live-odds.js mlb --dry-run
   ```

2. **Run during non-peak hours** to avoid conflicts with web requests

3. **Check API usage** on The Odds API dashboard afterward

4. **Save frequently used commands** as npm scripts in `package.json`:
   ```json
   {
     "scripts": {
       "odds:mlb": "node scripts/fetch-live-odds.js mlb",
       "odds:nfl": "node scripts/fetch-live-odds.js nfl",
       "odds:nhl": "node scripts/fetch-live-odds.js nhl"
     }
   }
   ```

## 🔧 Customization

### Changing Markets

Edit the `*_MARKETS` arrays in `scripts/fetch-live-odds.js`:

```javascript
const MLB_MARKETS = [
  'batter_hits',
  'batter_home_runs',
  // Add or remove markets here
].join(',')
```

Available markets: See The Odds API [documentation](https://the-odds-api.com/sports-odds-data/betting-markets.html)

### Changing Rate Limit

Adjust `RATE_LIMIT_DELAY_MS` (in milliseconds):
```javascript
const RATE_LIMIT_DELAY_MS = 200  // 5 requests/sec (faster)
const RATE_LIMIT_DELAY_MS = 500  // 2 requests/sec (slower)
```

## 📝 Output Example

```
🎯 Odds Fetcher - MLB
📅 Date: today
==================================================
📅 Fetching games from 2025-11-02T00:00:00.000Z to 2025-11-03T00:00:00.000Z

🎲 Loading MLB games from database...
✅ Found 1 games

📋 Games:
  1. LAD @ NYM at 7:08:00 PM

🔄 Fetching odds for 1 games...
⏱️  Rate limit: 300ms between requests

[1/1] LAD @ NYM
  📊 Fetching player props...
  ✅ Got props (45 markets)
  💾 Saved props

==================================================
📊 SUMMARY
✅ Success: 1/1
❌ Errors: 0/1
💾 Mode: SAVED
```

## ⚠️ Troubleshooting

### "ODDS_API_KEY not set"
- Make sure `.env.local` exists and has `ODDS_API_KEY=...`

### "No props available" / Empty results
- The Odds API may not have props available for that sport/date
- Try a different date or check API status

### "Rate limit errors" (429)
- Increase `RATE_LIMIT_DELAY_MS` in the script
- Or use `--dry-run` to test without making API calls

### "No games found"
- Ensure games are populated in the database first
- Use `scripts/setup-database.js` to populate games

## 🔐 Security Notes

- Never commit `.env.local` to git (it's in `.gitignore`)
- Keep your `ODDS_API_KEY` private
- Don't share this script with public API keys

---

**Need help?** Check the script comments or run with `--help` flag.
