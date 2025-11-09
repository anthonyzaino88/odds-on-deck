# Player Prop Model Architecture - The Right Way

## Problem: Current Implementation is Fake

### What We're Doing Wrong:
```javascript
// CURRENT (BAD):
function calculateOurProbability(pick, threshold, impliedProb) {
  const baseAdjustment = 0.02 + (Math.random() * 0.03) // FAKE 2-5% edge
  return Math.min(0.65, impliedProb + baseAdjustment)
}
```

This is just **randomly adding 2-5% to bookmaker's probability**. It's not based on anything real!

## The Right Architecture

### Step 1: Start Conservative (No Model Yet)
When we have NO historical data, we should:
- Use bookmaker's implied probability AS-IS
- Don't claim fake edges
- Build up validation data first

### Step 2: Build Historical Database
Track these metrics in `PropValidation`:
- Player name
- Prop type (goals, assists, shots, etc.)
- Threshold (over/under X)
- Bookmaker's odds
- Our prediction
- **Actual result** (hit or miss)

### Step 3: Calculate Player-Specific Hit Rates
After collecting data, we can calculate:

```javascript
// Example: Connor McDavid, Over 0.5 Points
// Historical data:
// - Bookmaker implied prob: 55% (1.82 odds)
// - Actual hit rate: 62% (hit 62 out of 100 times)
// - TRUE EDGE: 62% / 55% = 12.7% edge!
```

### Step 4: Use Real Stats to Adjust Probabilities

Instead of random numbers, use:
- **Player's season stats** (goals/game, assists/game, etc.)
- **Opponent strength** (goals allowed per game)
- **Home/away splits**
- **Recent form** (last 5 games)
- **Historical validation data** (our tracked results)

## Implementation Plan

### Immediate Fix (Phase 1):
Remove fake probability inflation, use bookmaker odds directly until we have data

### Short Term (Phase 2):
Build analysis tools to:
1. Query `PropValidation` table for patterns
2. Calculate player-specific hit rates
3. Identify which prop types we're best at predicting

### Long Term (Phase 3):
Build machine learning model using:
- Player season stats (from ESPN API)
- Team stats
- Historical validation results
- Situational factors (home/away, back-to-back games, etc.)

## Data We Already Have Access To:

### ESPN API Provides:
- Player stats (goals, assists, points per game)
- Team stats (offense/defense rankings)
- Game schedules and results
- Player rosters

### PropValidation Table Contains:
- Our predictions vs actual results
- Edge calculations
- Confidence levels
- Time-series data to track improvement

### PlayerPropCache Contains:
- Current bookmaker odds
- Our estimated probabilities
- Quality scores

## Next Steps

1. **Fix the fake probability inflation** (remove random adjustments)
2. **Start with bookmaker probabilities** (conservative, honest approach)
3. **Build historical analysis tools** (analyze PropValidation data)
4. **Create player stat integration** (fetch real stats from ESPN)
5. **Build simple predictive models** (start with hit rate averages)
6. **Iterate and improve** (as we collect more validation data)

## The Goal

After 1-2 months of data collection:
```javascript
// FUTURE (GOOD):
function calculateOurProbability(player, propType, threshold, impliedProb) {
  // Get player's historical performance
  const playerHitRate = getPlayerHistoricalHitRate(player, propType, threshold)
  
  // Adjust based on opponent
  const opponentAdjustment = getOpponentAdjustment(opponent, propType)
  
  // Factor in recent form
  const formAdjustment = getRecentFormAdjustment(player, propType, last5Games)
  
  // Combine with bookmaker's probability
  const ourProbability = weightedAverage([
    { value: impliedProb, weight: 0.5 },        // Bookmaker knows things
    { value: playerHitRate, weight: 0.3 },      // Historical data
    { value: opponentAdjustment, weight: 0.1 }, // Matchup
    { value: formAdjustment, weight: 0.1 }      // Recent performance
  ])
  
  return ourProbability
}
```

This would be a **real model** based on **real data**, not random numbers!

## Validation Loop

The key is the **feedback loop**:
1. Make prediction with current model
2. Save to `PropValidation` with our probability estimate
3. Check actual game result
4. Calculate accuracy
5. **Update model parameters** based on what worked/didn't work
6. Repeat forever, getting better over time

This is how professional sports betting models work!

