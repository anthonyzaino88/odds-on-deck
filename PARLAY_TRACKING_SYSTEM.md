# Parlay Tracking System

## Overview

The parlay tracking system provides a complete flow from **generation → saving → tracking → validation**. This allows users to:

1. Generate optimized parlays based on player props
2. Save parlays they want to bet on
3. Track saved parlays with performance metrics
4. Automatically validate outcomes when games complete

---

## Data Flow

```
[Parlay Generator] 
    ↓ (User clicks "Save Parlay")
[/api/parlays/save]
    ↓
[Database Tables]
    • Parlay (main parlay record)
    • ParlayLeg (individual legs)
    • PropValidation (for accuracy tracking)
    ↓
[Parlay History Display]
    • View saved parlays
    • See performance metrics
    • Track pending vs completed
    ↓
[Validation System]
    • Auto-checks games when they finish
    • Updates PropValidation results
    • Calculates parlay outcomes
```

---

## Database Tables

### `Parlay`
Stores the main parlay record:
- `id`: Unique parlay identifier
- `sport`: Sport type (nfl, nhl, mlb, mixed)
- `type`: Parlay type (multi_game, single_game)
- `legCount`: Number of legs in the parlay
- `totalOdds`: Combined decimal odds
- `probability`: Combined win probability
- `edge`: Expected edge over bookmaker
- `confidence`: Confidence level (high, medium, low)
- `status`: Current status (pending, won, lost, cancelled)
- `outcome`: Final outcome (null if pending)
- `createdAt`, `updatedAt`: Timestamps

### `ParlayLeg`
Stores individual legs of a parlay:
- `id`: Unique leg identifier
- `parlayId`: Reference to parent parlay
- `gameIdRef`: Reference to game
- `betType`: Type of bet (prop, spread, moneyline)
- `selection`: The pick (over, under, team name)
- `odds`: Leg odds
- `probability`: Leg win probability
- `edge`: Leg edge
- `confidence`: Leg confidence
- `playerName`: Player name (for props)
- `propType`: Prop type (points, assists, etc.)
- `threshold`: Prop threshold value
- `legOrder`: Order within parlay
- `createdAt`, `updatedAt`: Timestamps

### `PropValidation`
Tracks individual prop outcomes for accuracy:
- All prop details (player, type, threshold, pick)
- `status`: pending, completed, needs_review
- `result`: correct, incorrect, push
- `actualValue`: Final stat value
- `source`: user_saved, parlay_leg, system_generated
- `sourceId`: Reference to original parlay (if from parlay)

---

## API Endpoints

### `POST /api/parlays/save`
**Purpose**: Save a generated parlay for tracking

**Request Body**:
```json
{
  "parlay": {
    "sport": "nfl",
    "type": "multi_game",
    "totalOdds": 4.5,
    "probability": 0.35,
    "edge": 0.12,
    "confidence": "medium",
    "legs": [
      {
        "gameId": "game123",
        "playerName": "Patrick Mahomes",
        "propType": "passing_yards",
        "threshold": 275.5,
        "selection": "over",
        "odds": 1.91,
        "probability": 0.55,
        "edge": 0.08,
        "confidence": "medium"
      }
    ]
  }
}
```

**Response**:
```json
{
  "success": true,
  "parlay": { /* saved parlay object */ },
  "validationRecordsCreated": 3,
  "message": "Parlay saved and props recorded for validation"
}
```

**What it does**:
1. Saves parlay to `Parlay` table
2. Saves each leg to `ParlayLeg` table
3. Records each prop leg in `PropValidation` table with `source: 'parlay_leg'`
4. Returns saved parlay details

---

### `GET /api/parlays/history`
**Purpose**: Fetch saved parlays with performance metrics

**Query Parameters**:
- `limit`: Number of parlays to fetch (default: 50)
- `sport`: Filter by sport (nfl, nhl, mlb)
- `status`: Filter by status (pending, won, lost)

**Response**:
```json
{
  "success": true,
  "parlays": [
    {
      "id": "parlay123",
      "sport": "nfl",
      "legCount": 3,
      "totalOdds": 4.5,
      "status": "pending",
      "legs": [/* leg objects */],
      "createdAt": "2025-11-09T..."
    }
  ],
  "count": 10,
  "performance": {
    "totalParlays": 10,
    "wonParlays": 3,
    "lostParlays": 5,
    "winRate": 37.5,
    "avgEdge": 0.12,
    "avgExpectedValue": 0.05,
    "roi": -15.0
  }
}
```

---

### `POST /api/parlays/validate`
**Purpose**: Validate pending parlays when games complete

**How it works**:
1. Fetches all pending parlays
2. For each parlay, checks all legs
3. Looks up `PropValidation` records for each leg
4. Determines if parlay won/lost based on leg outcomes
5. Updates `Parlay.status` and `Parlay.outcome`

**Response**:
```json
{
  "success": true,
  "validated": 5,
  "updated": {
    "won": 2,
    "lost": 3
  }
}
```

**Note**: This endpoint should be called after `/api/validation/check` runs (which updates individual prop validations).

---

## Frontend Components

### `ParlayBuilder` (components/ParlayBuilder.js)
- Allows users to select sport, leg count, and strategy
- Calls `/api/parlays/generate` to create parlays
- Passes generated parlays to `ParlayResults`

### `ParlayResults` (components/ParlayResults.js)
- Displays generated parlays
- Shows odds, win probability, edge, quality score
- "Save Parlay" button for each parlay
- Calls `/api/parlays/save` when user saves
- Triggers refresh of `ParlayHistory` via callback

### `ParlayHistory` (components/ParlayHistory.js)
- Displays saved parlays from `/api/parlays/history`
- Shows performance metrics (win rate, ROI, avg edge)
- Lists all saved parlays with status (pending, won, lost)
- Shows individual legs for each parlay
- Auto-refreshes when new parlays are saved (`refreshTrigger` prop)

---

## Pages

### `/parlays` (app/parlays/page.js)
Main parlay page with three sections:
1. **Generator** (left): Build and generate parlays
2. **Results** (right): View generated parlays and save them
3. **History** (bottom): View all saved parlays and performance

The page manages state coordination:
- `generatedParlays`: Parlays from generator
- `refreshHistory`: Trigger to refresh history after save

---

## Validation Dashboard Integration

The **Validation Dashboard** (`/validation`) shows:
- Individual prop tracking (all sources)
- **Parlay-specific section** showing props from saved parlays
- Performance metrics by source:
  - 👤 **Individual Props** (user_saved)
  - 🎯 **Saved Parlays** (parlay_leg)
  - 🤖 **Auto-Generated** (system_generated)

This allows users to see:
- How accurate their saved parlays are performing
- Which prop types are most reliable
- Overall win rate and ROI

---

## Workflow Example

### 1. User Generates Parlays
```
User selects:
- Sport: NFL
- Legs: 3
- Strategy: BALANCED

System generates 10 parlays sorted by quality score
```

### 2. User Saves a Parlay
```
User clicks "Save Parlay" on #2

API saves:
- Parlay record (id: p123, status: pending)
- 3 ParlayLeg records
- 3 PropValidation records (source: parlay_leg, sourceId: p123)
```

### 3. ParlayHistory Refreshes
```
History component re-fetches saved parlays
Shows new parlay in "pending" section
Performance metrics update (now 11 total parlays)
```

### 4. Games Complete
```
Automated script runs: /api/validation/check
- Updates PropValidation records with actual values
- Marks correct/incorrect

Then runs: /api/parlays/validate
- Checks all legs for parlay p123
- If all 3 correct → status: won, outcome: won
- If any incorrect → status: lost, outcome: lost
```

### 5. User Views Results
```
User visits /parlays
- ParlayHistory shows parlay p123 as "WON" 🎉
- Performance metrics update (win rate increased)

User visits /validation
- Sees 3 parlay leg props marked as "correct"
- Overall accuracy reflects parlay performance
```

---

## Key Features

✅ **Full Supabase Migration**: All Prisma code removed
✅ **End-to-End Tracking**: From generation to validation
✅ **Performance Metrics**: Win rate, ROI, avg edge
✅ **Source Tracking**: Know which parlays came from where
✅ **Auto-Validation**: System checks outcomes automatically
✅ **Dark Theme**: Consistent UI across all components
✅ **Real-Time Updates**: History refreshes when parlays saved

---

## Future Enhancements

1. **Copy to Clipboard**: One-click copy parlay legs for betting
2. **Parlay Sharing**: Share parlays with others
3. **Bet Slip Integration**: Direct API integration with sportsbooks
4. **Advanced Filters**: Filter history by date, sport, outcome
5. **Parlay Builder Improvements**: Add/remove legs manually
6. **Correlation Analysis**: Avoid correlated props in same parlay
7. **Bankroll Management**: Track actual bets and profit/loss

---

## Files Modified

### API Routes
- ✅ `app/api/parlays/save/route.js` - Migrated to Supabase, added `updatedAt`
- ✅ `app/api/parlays/history/route.js` - Migrated from Prisma to Supabase
- ✅ `app/api/parlays/validate/route.js` - Already uses Supabase

### Frontend
- ✅ `app/parlays/page.js` - Added ParlayHistory section and refresh trigger
- ✅ `components/ParlayHistory.js` - Completely rewritten for dark theme
- ✅ `components/ParlayResults.js` - Already handles save callback

### Validation
- ✅ `app/validation/page.js` - Already shows parlay leg props
- ✅ `lib/validation.js` - Already uses Supabase

---

## Summary

The parlay tracking system is now **100% Supabase**, fully integrated, and provides a complete user experience from generation to validation. Users can:

1. **Generate** optimized parlays based on real data
2. **Save** parlays they want to bet on
3. **Track** performance with detailed metrics
4. **Validate** outcomes automatically when games finish
5. **Learn** from historical data to improve strategy

All components work together seamlessly with auto-refresh and consistent dark theme styling.

