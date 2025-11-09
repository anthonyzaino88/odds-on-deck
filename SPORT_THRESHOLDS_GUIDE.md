# Sport-Specific Thresholds Guide

## 🏈 NFL (American Football)

### Scoring (Points Per Game)
- **Hot Offense**: 28+ PPG 🔥
- **Average Offense**: 22 PPG
- **Cold Offense**: 18- PPG ❄️

### Defense (Points Allowed Per Game)
- **Weak Defense**: 26+ PPG (Good for props! ✅)
- **Average Defense**: 22 PPG
- **Strong Defense**: 18- PPG (Tough for props ⚠️)

### Game Totals
- **High Scoring**: 48+ total points ⚡
- **Average**: 44 total points
- **Low Scoring**: 40- total points 🐌

### Examples
```javascript
// Patrick Mahomes prop
KC Chiefs: 32.5 PPG  → 🔥 Hot Offense (146% of average)
vs Panthers: 27.0 PA → ✅ Weak Defense (123% of average)
Expected Total: 52.5 → ⚡ High Scoring Game
Result: EXCELLENT context for passing props!
```

## 🏒 NHL (Hockey)

### Scoring (Goals Per Game)
- **Hot Offense**: 3.5+ GPG 🔥
- **Average Offense**: 3.0 GPG
- **Cold Offense**: 2.5- GPG ❄️

### Defense (Goals Allowed Per Game)
- **Weak Defense**: 3.5+ GA (Good for props! ✅)
- **Average Defense**: 3.0 GA
- **Strong Defense**: 2.5- GA (Tough for props ⚠️)

### Game Totals
- **High Scoring**: 6.5+ total goals ⚡
- **Average**: 6.0 total goals
- **Low Scoring**: 5.5- total goals 🐌

### Examples
```javascript
// Connor McDavid prop
EDM Oilers: 3.8 GPG  → 🔥 Hot Offense (127% of average)
vs Sharks: 3.9 GA    → ✅ Weak Defense (130% of average)
Expected Total: 7.0  → ⚡ High Scoring Game
Result: EXCELLENT context for points props!
```

## ⚾ MLB (Baseball)

### Scoring (Runs Per Game)
- **Hot Offense**: 5.5+ RPG 🔥
- **Average Offense**: 4.5 RPG
- **Cold Offense**: 3.5- RPG ❄️

### Defense (Runs Allowed Per Game)
- **Weak Defense**: 5.0+ RA (Good for props! ✅)
- **Average Defense**: 4.5 RA
- **Strong Defense**: 3.5- RA (Tough for props ⚠️)

### Game Totals
- **High Scoring**: 9.5+ total runs ⚡
- **Average**: 8.5 total runs
- **Low Scoring**: 7.5- total runs 🐌

### Examples
```javascript
// Aaron Judge prop
NYY Yankees: 5.8 RPG → 🔥 Hot Offense (129% of average)
vs Rockies: 5.2 RA   → ✅ Weak Defense (116% of average)
Expected Total: 10.0 → ⚡ High Scoring Game
Result: EXCELLENT context for hitting props!
```

## 📊 Universal Thresholds (All Sports)

### Win Probability
- **Dominant**: 65%+ → 👑 Strong favorite
- **Favored**: 55-64% → ✅ Likely to win
- **Competitive**: 45-54% → 🎲 Toss-up
- **Underdog**: <45% → ⚠️ Unlikely to win

### Recent Form (Last 10 Games)
- **Hot**: 70%+ (7-3 or better) → 🔥
- **Average**: 50% (5-5) → 
- **Cold**: 30% or worse (3-7) → ❄️

### Home/Away Splits
- **Strong Home**: 65%+ home win rate → 🏠
- **Strong Away**: 55%+ away win rate → 🛫
- **Neutral**: <55% → 

## 🎯 Smart Filter Logic

### "Power Offense" Filter
```javascript
NFL: >= 28 PPG + 55% win probability
NHL: >= 3.5 GPG + 55% win probability
MLB: >= 5.5 RPG + 55% win probability
```

### "Weak Defense Matchup" Filter
```javascript
NFL: Opponent allows >= 26 PPG
NHL: Opponent allows >= 3.5 GA
MLB: Opponent allows >= 5.0 RA
```

### "High Scoring Game" Filter
```javascript
NFL: Expected total >= 48 points
NHL: Expected total >= 6.5 goals
MLB: Expected total >= 9.5 runs
```

### "Home Heroes" Filter
```javascript
All sports:
- Player's team is home
- Team has >= 65% home win rate
- OR team has strong overall record (70%+)
```

## 🔧 Using the Thresholds

### Example: Filter NFL Props
```javascript
import { getThresholds, isHotOffense } from './lib/prop-thresholds.js'

const nflThresholds = getThresholds('nfl')

props.filter(prop => {
  const team = getTeamData(prop.team)
  
  // Check if offense is hot
  const isHot = team.avgPointsLast10 >= nflThresholds.hotOffense
  // Returns true if >= 28 PPG
  
  // Or use helper function
  const isHotHelper = isHotOffense(team.avgPointsLast10, 'nfl')
  
  return isHot && prop.probability >= 0.55
})
```

### Example: Filter NHL Props
```javascript
import { getThresholds, isWeakDefense } from './lib/prop-thresholds.js'

const nhlThresholds = getThresholds('nhl')

props.filter(prop => {
  const opponent = getOpponentData(prop.team)
  
  // Check if opponent defense is weak (good for props)
  const isWeak = opponent.avgPointsAllowedLast10 >= nhlThresholds.weakDefense
  // Returns true if >= 3.5 GA
  
  // Or use helper function
  const isWeakHelper = isWeakDefense(opponent.avgPointsAllowedLast10, 'nhl')
  
  return isWeak
})
```

## 📈 Offensive Rating Scale (0-100)

### NFL
- **90-100**: Elite (32+ PPG) - Chiefs, Bills, Lions
- **80-89**: Excellent (28-32 PPG) - 49ers, Cowboys
- **70-79**: Good (24-28 PPG)
- **60-69**: Above Average (22-24 PPG)
- **50-59**: Average (20-22 PPG)
- **40-49**: Below Average (18-20 PPG)
- **0-39**: Poor (<18 PPG) - Panthers, Giants

### NHL
- **90-100**: Elite (4.0+ GPG) - Oilers, Avalanche
- **80-89**: Excellent (3.5-4.0 GPG) - Hurricanes, Panthers
- **70-79**: Good (3.2-3.5 GPG)
- **60-69**: Above Average (3.0-3.2 GPG)
- **50-59**: Average (2.8-3.0 GPG)
- **40-49**: Below Average (2.5-2.8 GPG)
- **0-39**: Poor (<2.5 GPG) - Sharks, Blackhawks

## 💡 Practical Tips

### DO Use Thresholds For:
✅ Filtering props by team context
✅ Ranking props by offensive opportunity
✅ Identifying favorable matchups
✅ Visual indicators (🔥 hot, ❄️ cold)
✅ Comparative analysis across sports

### DON'T Use Thresholds For:
❌ Absolute win/loss predictions
❌ Ignoring individual player skill
❌ Excluding all underdogs
❌ Over-filtering (missing good value)
❌ Replacing your own research

## 🎯 Context Quality Score

Combined score (0-100) based on:
- **30%** - Offensive power
- **25%** - Defensive matchup
- **25%** - Win probability
- **15%** - Recent form
- **5%** - Venue advantage

**Example**:
```javascript
Patrick Mahomes - Over 275.5 Pass Yds
Team Context Score: 87/100

Breakdown:
- Offensive Power: 95/100 (32.5 PPG)
- Defensive Matchup: 92/100 (27.0 PA)
- Win Probability: 68/100 (68% to win)
- Recent Form: 90/100 (9-1 last 10)
- Venue Advantage: 85/100 (Strong home)

Result: ELITE prop opportunity
```

## 🔄 Updating Thresholds

Run these scripts to refresh team data:
```bash
# Update team performance from ESPN
node scripts/fetch-team-performance-data.js

# Recalculate game edges
node scripts/calculate-game-edges.js
```

Frequency:
- **Daily**: Before major slate of games
- **Weekly**: For season-long updates
- **After trades/injuries**: When team context changes

