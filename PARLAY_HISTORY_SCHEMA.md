# Parlay History Schema

## Overview
Track completed parlay results after validation, before deletion from active parlays.

## Database Tables

### `ParlayHistory`
Stores validated parlay results for performance tracking:

```sql
CREATE TABLE "ParlayHistory" (
  id TEXT PRIMARY KEY,  -- Original parlay ID
  
  -- Parlay configuration
  sport TEXT NOT NULL,  -- "mlb", "nfl", "nhl", "mixed"
  type TEXT NOT NULL,   -- "single_game", "multi_game", "cross_sport"
  legCount INTEGER NOT NULL,
  
  -- Parlay metrics
  totalOdds REAL NOT NULL,
  probability REAL NOT NULL,
  edge REAL NOT NULL,
  expectedValue REAL NOT NULL,
  confidence TEXT NOT NULL,
  
  -- Results
  outcome TEXT NOT NULL,  -- "won", "lost", "cancelled"
  actualResult TEXT,      -- Description of outcome
  
  -- Leg details (JSON)
  legs JSONB NOT NULL,    -- Array of leg results
  
  -- Timestamps
  createdAt TIMESTAMPTZ NOT NULL,
  completedAt TIMESTAMPTZ NOT NULL,
  validatedAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_parlay_history_outcome ON "ParlayHistory"(outcome);
CREATE INDEX idx_parlay_history_sport ON "ParlayHistory"(sport);
CREATE INDEX idx_parlay_history_completed ON "ParlayHistory"(completedAt DESC);
```

## Leg Details JSON Structure

Each parlay's `legs` field contains an array of leg results:

```json
[
  {
    "gameId": "KC_at_BUF_2025-11-10",
    "betType": "prop",
    "selection": "over",
    "playerName": "Patrick Mahomes",
    "propType": "passing_yards",
    "threshold": 275.5,
    "odds": 1.91,
    "probability": 0.55,
    "outcome": "won",
    "actualValue": 312,
    "legOrder": 1
  },
  {
    "gameId": "PHI_at_GB_2025-11-10",
    "betType": "prop",
    "selection": "over",
    "playerName": "Saquon Barkley",
    "propType": "rushing_yards",
    "threshold": 75.5,
    "odds": 1.87,
    "probability": 0.58,
    "outcome": "lost",
    "actualValue": 62,
    "legOrder": 2
  }
]
```

## Performance Metrics to Display

### Overall Stats
- **Total Parlays**: Count of all parlays
- **Win Rate**: `(wins / total) * 100`
- **ROI**: Return on Investment (if tracking stakes)
- **Average Odds**: Mean of `totalOdds` for all parlays
- **Win/Loss Record**: "5-12-1" (Won-Lost-Cancelled)

### By Sport
- Win rate for NFL, NHL, MLB
- Best performing sport

### By Leg Count
- 2-leg: 60% win rate
- 3-leg: 45% win rate
- 4-leg: 30% win rate
- etc.

### By Confidence Level
- Very High: 70% win rate
- High: 55% win rate
- Medium: 40% win rate
- Low: 25% win rate

---

## API Endpoints

### `GET /api/parlays/history/stats`
Returns performance statistics

### `GET /api/parlays/history`
Returns list of completed parlays with pagination

---

## Migration Notes

To add this table to your Supabase database:
1. Run the SQL in Supabase SQL Editor
2. Grant permissions for your app to read/write
3. Update validation endpoint to save history before deleting

