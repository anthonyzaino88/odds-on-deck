# Prop Validation System Guide

## Overview

The validation system tracks the performance of all player prop predictions to measure model accuracy and improve future predictions.

## Current System Architecture

### 1. Data Flow

```
PlayerPropCache (Top Props) → PropValidation (Tracking) → Validation (Results)
       ↓
User Saves Prop → PropValidation
       ↓
User Creates Parlay → PropValidation (one record per leg)
```

### 2. Prop Sources Tracked

**Three sources of props are saved for validation:**

#### A. System-Generated Props (`source: 'system_generated'`)
- **How**: Automatically saved via `scripts/save-top-props-for-validation.js`
- **When**: Run daily before games start
- **What**: Up to 200 props across multiple quality tiers from `PlayerPropCache`
- **Criteria**: 
  - **Elite Tier (50 props)**: Quality Score ≥ 40, Probability ≥ 60%
  - **High Tier (75 props)**: Quality Score 35-39, Probability ≥ 55%
  - **Good Tier (75 props)**: Quality Score 30-34, Probability ≥ 52%
  - Not expired
- **Purpose**: Track performance across quality tiers for comprehensive model improvement

#### B. User-Saved Props (`source: 'user_saved'`)
- **How**: When users click "Save Prop" button
- **API**: `/api/props/save`
- **Purpose**: Track what users find valuable and their outcomes

#### C. Parlay Leg Props (`source: 'parlay_leg'`)
- **How**: When users save multi-leg parlays
- **API**: `/api/parlays/save`
- **Purpose**: Track performance of parlayed props
- **Note**: Each parlay leg gets its own `PropValidation` record

## Database Schema

### PropValidation Table

```javascript
{
  id: string,                    // Unique validation ID
  propId: string,                // References prop from cache/parlay
  gameIdRef: string,             // References Game.id
  playerName: string,            // Player name
  propType: string,              // 'hits', 'strikeouts', 'goals', etc.
  threshold: number,             // The line (e.g., 1.5 goals)
  prediction: string,            // 'over' or 'under'
  projectedValue: number,        // Our model's projection
  confidence: string,            // 'low', 'medium', 'high', 'very_high'
  edge: number,                  // Betting edge (0-1)
  odds: number,                  // American odds
  probability: number,           // Win probability (0-1)
  qualityScore: number,          // Overall quality (0-100)
  source: string,                // 'system_generated', 'user_saved', 'parlay_leg'
  parlayId: string | null,       // If from parlay
  status: string,                // 'pending', 'completed', 'needs_review'
  sport: string,                 // 'mlb', 'nhl', 'nfl'
  timestamp: datetime,           // When prediction was made
  actualValue: number | null,    // Actual stat value (filled after game)
  result: string | null,         // 'correct', 'incorrect', 'push'
  completedAt: datetime | null   // When validation completed
}
```

## Validation Process

### Step 1: Save Props for Validation

**Automatic (System-Generated):**
```bash
# Run daily before games start (e.g., 10 AM)
node scripts/save-top-props-for-validation.js
```

**Manual (User Actions):**
- User clicks "Save Prop" → Immediately saved
- User creates parlay → All legs saved

### Step 2: Games Complete

Props move to `status: 'needs_review'` when games end

### Step 3: Fetch Game Stats

**Automatic validation check:**
```bash
# Runs periodically (e.g., every 30 minutes)
POST /api/validation/check
```

**Manual validation:**
```bash
# Force check all pending props
node scripts/check-and-validate-props.js
```

### Step 4: Update Results

For each prop:
1. Fetch player's actual game stats from ESPN API
2. Compare actual value to threshold
3. Determine result:
   - `correct`: Prediction matched actual outcome
   - `incorrect`: Prediction didn't match
   - `push`: Actual value exactly equals threshold
4. Update `PropValidation` record with result

### Step 5: Track Performance

View validation dashboard:
- Overall accuracy by sport
- Performance by prop type
- ROI and edge analysis
- Best/worst performing categories

## Scripts Reference

### Daily Operations

**1. Save Top Props for Validation**
```bash
node scripts/save-top-props-for-validation.js
```
- **When**: Daily before games (10 AM recommended)
- **What**: Saves up to 200 props across 3 quality tiers
- **Why**: Tracks model performance with large sample size for statistical significance

**2. Validate Completed Props**
```bash
# Check all pending props
curl -X POST http://localhost:3000/api/validation/check

# Or via script
node scripts/check-and-validate-props.js
```
- **When**: Every 30-60 minutes during/after games
- **What**: Fetches stats and validates results
- **Why**: Keeps validation data current

### Maintenance Scripts

**Check Validation Status**
```bash
node scripts/check-validation-status.js
```
Shows counts by status (pending, completed, needs_review)

**Revalidate Specific Props**
```bash
node scripts/revalidate-props.js --sport nhl --date 2024-11-09
```
Re-runs validation for specific date/sport

**Clean Up Orphaned Props**
```bash
node scripts/cleanup-orphaned-props.js
```
Removes props referencing non-existent games

## Cron Job Setup

Add to your cron schedule or task scheduler:

```bash
# Save top props daily at 10 AM (before most games)
0 10 * * * cd /path/to/project && node scripts/save-top-props-for-validation.js >> logs/validation.log 2>&1

# Check and validate props every 30 minutes (during game hours)
*/30 14-23 * * * cd /path/to/project && curl -X POST http://localhost:3000/api/validation/check >> logs/validation-check.log 2>&1

# Cleanup orphaned props weekly (Sunday 3 AM)
0 3 * * 0 cd /path/to/project && node scripts/cleanup-orphaned-props.js >> logs/cleanup.log 2>&1
```

## API Endpoints

### GET /api/validation/stats
Get validation statistics
```javascript
{
  overall: { total, correct, accuracy, roi },
  byPropType: { ... },
  bySport: { ... }
}
```

### POST /api/validation/check
Trigger validation check for pending props
```javascript
{
  checked: 42,
  validated: 38,
  needsReview: 4
}
```

### GET /api/validation/records
Get validation records with filters
```javascript
?sport=nhl&status=completed&limit=100
```

## Monitoring

### Key Metrics to Watch

**1. Overall Accuracy**
- Target: ≥ 55% (better than implied odds)
- Alert if < 50% over 100+ props

**2. ROI (Return on Investment)**
- Target: Positive ROI across all tracked props
- Formula: `(wins * avgOdds - losses) / total_bets`

**3. Props Stuck in "needs_review"**
- Should be < 5% of completed games
- Indicates API issues or missing data

**4. Quality Score Correlation**
- Higher quality scores should have higher win rates
- If not, model needs recalibration

### Dashboard Access

**Validation Dashboard:**
```
http://localhost:3000/validation
```

Shows:
- Overall performance stats
- Sport-specific breakdown
- Prop type performance
- Recent predictions and results
- Props needing review

## Troubleshooting

### Props Not Validating

**Problem**: Props stuck in "pending" or "needs_review"

**Solutions**:
1. Check game status: `SELECT * FROM Game WHERE id = 'game-id'`
2. Verify ESPN Game ID exists
3. Manually fetch stats: `node scripts/test-espn-api.js game-id`
4. Check player name spelling matches ESPN

### Incorrect Validations

**Problem**: Props marked incorrect when they should be correct

**Solutions**:
1. Check actual stat value logged
2. Verify prop type mapping (hits → 'H', strikeouts → 'SO')
3. Re-fetch stats with debug logging
4. Update stat mapping in `lib/vendors/*-game-stats.js`

### Performance Issues

**Problem**: Validation checks taking too long

**Solutions**:
1. Add index on `PropValidation.status`
2. Batch process by sport
3. Cache ESPN API responses
4. Rate limit validation checks

## Future Enhancements

### Planned Features

**1. Line Movement Tracking**
- Record odds at save time and game time
- Analyze if we're betting at good lines

**2. Confidence Calibration**
- Compare stated confidence to actual win rate
- Auto-adjust confidence scoring

**3. Historical Performance**
- Track accuracy trends over time
- Identify improving/declining performance

**4. Player-Specific Tracking**
- Which players do we predict best?
- Identify consistently profitable props

**5. Bookmaker Comparison**
- Track which bookmakers have best lines for us
- ROI by bookmaker

## Best Practices

### For System Maintenance

1. **Run saves before games start** - Don't save props mid-game
2. **Validate frequently** - Every 30-60 minutes during games
3. **Monitor logs** - Check for API errors and failures
4. **Clean up weekly** - Remove orphaned/invalid props
5. **Review performance monthly** - Adjust model based on results

### For Model Improvement

1. **Track everything** - More data = better insights
2. **Analyze failures** - Why did high-quality props lose?
3. **Adjust thresholds** - If 65+ quality props underperform, raise bar
4. **Sport-specific tuning** - Different sports need different criteria
5. **Iterate quickly** - Test model changes and measure impact

## Summary

The validation system provides:
✅ Automatic tracking of top model picks
✅ User-saved prop performance
✅ Parlay leg outcome tracking  
✅ Comprehensive performance analytics
✅ Model improvement feedback loop

**Key Script**: Run `scripts/save-top-props-for-validation.js` daily to track your best picks!
