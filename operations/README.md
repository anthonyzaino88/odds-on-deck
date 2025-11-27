# 🔒 Private Operational Scripts

This directory contains operational scripts that are **NOT** pushed to GitHub. These scripts contain API keys and are used for daily data operations.

## 📋 What These Scripts Do

- **Data Fetching**: Pull live odds, scores, and team data from APIs
- **Database Updates**: Update Supabase with fresh data for the website
- **Live Operations**: Handle real-time score updates during games
- **Weekly Maintenance**: NFL game fetching and mapping

## 🚀 How to Use

These scripts are run locally to update the database that powers your Vercel-deployed website:

```bash
# Morning data refresh
node operations/fetch-team-performance-data.js
node operations/fetch-live-odds.js nhl --cache-fresh
node scripts/calculate-game-edges.js   # Note: This is in scripts/ folder

# During games (every 15-30 min)
node operations/update-scores-safely.js

# Weekly NFL operations
node operations/fetch-nfl-week-12.js
node operations/map-nfl-week-12-to-odds-api.js
```

## 🔐 Security

- These scripts contain real API keys
- Never commit this directory to version control
- Keep local only for operational use

## 📁 Directory Structure

```
operations/
├── fetch-live-odds.js          # Main odds/props fetcher
├── fetch-team-performance-data.js  # Team stats from ESPN
├── update-scores-safely.js      # Live score updates
├── fetch-nfl-week-12.js         # Weekly NFL game fetch
├── map-nfl-week-12-to-odds-api.js # NFL game mapping
├── run-nhl-fetch.js             # NHL fetch wrapper
├── run-nhl-remap.js             # NHL remap wrapper
└── [other operational scripts]
```
