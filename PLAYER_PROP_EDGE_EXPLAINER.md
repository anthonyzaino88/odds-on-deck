# Player Prop Edge Calculation - Explanation

## What Does "0%" Edge Mean on Player Props?

When you see a player prop showing **"70% +0.0%"** on the Editor's Picks page, here's what it means:

- **70%** = Our estimated probability that the prop will hit (e.g., player will go OVER 1.5 assists)
- **+0.0%** = The calculated edge (difference between our probability and the bookmaker's implied probability)

## Why Are Player Props Showing 0% Edge?

Currently, we're using the **bookmaker's implied probability** directly for player props because:

1. **No Historical Player Stats Model Yet**: Unlike game outcomes (moneyline/totals), we don't have enough historical player performance data integrated to calculate our own probabilities.

2. **Bookmaker Probabilities Are Accurate**: Sportsbooks invest heavily in setting accurate player prop lines, so their implied probabilities are already quite good.

3. **Focus on Quality Score**: Instead of edge, we rank player props by their **Quality Score**, which combines:
   - Probability (higher is better)
   - Consistency with other bookmakers
   - Line value

## How Edges ARE Calculated for Game Picks (Moneyline/Totals)

For **NFL and NHL game picks**, we DO calculate real edges using:
- Team performance data (wins/losses, points scored/allowed)
- Home/away splits
- Recent form (last 10 games)
- Head-to-head matchup history

This is why you'll see moneyline and totals picks with actual edge percentages like **"+3.2%"** or **"+2.8%"**.

## Example: Understanding the Display

### Player Prop Example
```
🔥 Austin Matthews
NHL • Player points
OVER 1.5 total points
70% +0.0%
+145
```

- **70%**: We estimate a 70% chance this hits
- **+0.0%**: No edge calculated (using bookmaker probability)
- **+145**: The odds (American format)
- **Ranking**: Sorted by quality score, so this 70% prop is ranked higher than a 60% prop

### Moneyline Example
```
💰 MIN
vs BAL
73% +2.8%
-200
```

- **73%**: We estimate a 73% chance MIN wins
- **+2.8%**: We think the real probability is 2.8% higher than the bookmaker's implied odds
- **-200**: The odds (American format)
- **Edge is real**: Based on our team performance model

## Future Improvements

To calculate real edges for player props, we would need to:

1. **Build Player Performance Database**
   - Historical stats per player (goals, assists, points, etc.)
   - Performance vs specific opponents
   - Home/away splits for players
   - Recent form trends

2. **Develop Player Prop Model**
   - Predict player performance based on:
     - Season averages
     - Recent games (hot/cold streaks)
     - Opponent defense quality
     - Injury status
     - Playing time expectations

3. **Compare to Bookmaker Lines**
   - Calculate our probability
   - Compare to bookmaker's implied probability
   - Generate edge percentage

## How to Use Player Props Currently

Even without edge calculations, player props can be valuable:

1. **High Probability = Higher Confidence**: A 70% prop is more likely to hit than a 55% prop
2. **Quality Score Matters**: Higher quality scores indicate more consistent lines across bookmakers
3. **Look for Value**: Compare our probability estimate to the odds offered
4. **Combine with Research**: Use these as starting points, then do your own player research

## Bottom Line

- **0% edge on props is expected** - we're not claiming to beat the bookmaker lines on player props yet
- **Moneyline/totals edges are real** - based on our team performance model
- **Props are ranked by quality** - focus on the probability and quality score
- **Future updates will add real player prop edges** - once we build the player stats database

## Related Files
- `lib/picks.js` - Pick generation logic
- `scripts/fetch-live-odds.js` - Where odds are fetched
- `lib/quality-score.js` - How quality scores are calculated

