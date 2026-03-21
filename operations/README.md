# 🔒 Private Operational Scripts

This directory contains operational scripts that are **NOT** pushed to GitHub. These scripts contain API keys and are used for daily data operations.

## 📅 Updated: Dec 17, 2025

## 📋 What These Scripts Do

- **Data Fetching**: Pull live odds, scores, and team data from APIs
- **Database Updates**: Update Supabase with fresh data for the website
- **Live Operations**: Handle real-time score updates during games
- **Cleanup**: Remove stale data to keep the app functioning properly

## 🚀 Daily Operations (Critical Order!)

### Morning Routine
```bash
# 1. FIRST: Clear stale props (prevents yesterday's data from showing)
node scripts/clear-stale-props.js

# 2. Fetch fresh games from ESPN
node scripts/fetch-fresh-games.js all

# 3. Fetch odds with proper gameTime mapping
node scripts/fetch-live-odds.js all --cache-fresh

# 4. (Optional) Calculate game edges
node scripts/calculate-game-edges.js   # Requires SUPABASE_SECRET_KEY
```

### During Games (Every 15-30 min)
```bash
node scripts/update-scores-safely.js all
```

### After Games
```bash
npm run validate:all
node scripts/check-validation-status.js
```

### End of Day
```bash
node scripts/clear-stale-props.js  # Prep for tomorrow
```

## 🔑 Required Environment Variables

Your `.env.local` must have:
```env
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SECRET_KEY=your_service_role_key  # Required for write operations!
ODDS_API_KEY=your_odds_api_key
```

## ⚠️ Key Points

1. **Run `clear-stale-props.js` FIRST every day** - prevents yesterday's props from showing
2. **Use `--cache-fresh` flag** - ensures proper gameTime mapping from Game.date
3. **SUPABASE_SECRET_KEY is required** - for `clear-stale-props.js`, `fetch-live-odds.js`, `calculate-game-edges.js`

## 🔐 Security

- These scripts contain real API keys
- Never commit this directory to version control
- Keep local only for operational use

## 📁 Key Scripts

```
scripts/
├── clear-stale-props.js        # Remove past/expired props (RUN DAILY!)
├── fetch-fresh-games.js        # Fetch games from ESPN (FREE)
├── fetch-live-odds.js          # Fetch odds/props from Odds API (PAID)
├── update-scores-safely.js     # Live score updates (FREE)
├── calculate-game-edges.js     # Calculate edges (requires secret key)
├── check-validation-status.js  # Check validation results
└── find-real-value-props.js    # Line shopping for real edges
```

## 🔗 Related Docs

- `DAILY_OPERATIONS.md` - Full daily workflow guide
- `DAILY_QUICK_START.md` - Quick copy-paste commands
- `VALIDATION_SYSTEM_GUIDE.md` - Validation details
