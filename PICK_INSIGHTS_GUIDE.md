# Pick Insights System

## Overview

The Pick Insights system generates contextual summaries and analysis for every pick to help users make informed betting decisions. It leverages ESPN team performance data, recent form, matchup history, and our model's confidence to provide actionable insights.

## Features

### 📊 Quick Insights (Displayed on Pick Cards)
- **One-line summaries** that highlight the most important factor
- Automatically generated for every pick
- Examples:
  - `🔥 Hot streak: 7-2 recent form`
  - `🏠 Dominant at home: 5-1`
  - `📊 4.5 pt mismatch with market`
  - `5.5% betting edge identified`

### 🎯 Full Insights (Available via API)
Comprehensive analysis including:
- **Summary**: Overall recommendation with confidence and edge
- **Key Factors**: Positive indicators supporting the pick
- **Risk Factors**: Potential concerns or red flags
- **Recent Form**: Win/loss trends and performance analysis
- **Matchup Edge**: Head-to-head comparisons
- **Model Confidence**: Explanation of edge strength

## Data Sources

### From ESPN API:
- Team season records (overall, home, away)
- Recent form (last 10 games)
- Offensive stats (points/goals per game)
- Defensive stats (points/goals allowed per game)
- Player availability and stats

### From Our Database:
- Edge calculations and magnitude
- Probability assessments
- Quality scores
- Historical model performance

## Implementation

### Backend (`lib/pick-insights.js`)

#### Main Functions:

**`generatePickInsights(pick, game)`**
- Generates comprehensive insights for any pick type
- Returns full analysis with all insight categories
- Used for detailed pick pages

**`generateQuickInsight(pick, game)`**
- Generates one-line summary for quick display
- Prioritizes most important factor
- Used in pick lists and cards

### API Endpoint (`/api/picks`)

**Parameters:**
- `mode`: Filter mode (safe, balanced, value, all)
- `insights`: Include insights (default: true, set to false to skip)

**Response:**
```json
{
  "success": true,
  "picks": [
    {
      "type": "moneyline",
      "pick": "BUF",
      "probability": 0.75,
      "edge": 0.10,
      "quickInsight": "🔥 Hot streak: 6-2 recent form",
      ...
    }
  ],
  "count": 33,
  "mode": "safe"
}
```

### Frontend Display

**Pick Cards (Top Picks):**
```jsx
{pick.quickInsight && (
  <div className="text-xs text-blue-400 mt-1">
    💡 {pick.quickInsight}
  </div>
)}
```

**Pick Rows (Lists):**
```jsx
{pick.quickInsight && (
  <div className="text-xs text-blue-400 mt-0.5 truncate">
    {pick.quickInsight}
  </div>
)}
```

## Insight Types

### 1. Moneyline Pick Insights

**Key Factors:**
- `🔥 Strong recent form` - Win rate ≥ 70%
- `🏠 Dominant at home` - Home win rate ≥ 65%
- `✈️ Strong road team` - Away win rate ≥ 60%
- `⚔️ Offensive advantage` - Scoring 15%+ more than opponent allows
- `🛡️ Defensive edge` - Allowing 15%+ less than opponent scores

**Risk Factors:**
- `⚠️ Poor recent form` - Win rate ≤ 40%
- `⚠️ Struggles at home` - Home win rate ≤ 35%
- `⚠️ Poor road record` - Away win rate ≤ 30%

**Model Confidence:**
- `Very High` - Edge ≥ 8%
- `High` - Edge ≥ 5%
- `Moderate` - Edge ≥ 3%
- `Low` - Edge < 3%

### 2. Totals (Over/Under) Insights

**For OVER Picks:**
- High-powered offenses (25+ ppg in NFL, 3+ gpg in NHL)
- Weak defenses (allowing 24+ ppg NFL, 3+ gpg NHL)
- Combined scoring potential exceeds line

**For UNDER Picks:**
- Strong defenses (< 19 ppg allowed in NFL)
- Slow offenses (< 20 ppg in NFL)
- Low-scoring matchup history

**Key Metrics:**
- Predicted total vs market line difference
- Offensive/defensive matchups
- Recent scoring trends

### 3. Player Prop Insights

**Includes:**
- Projected stat value
- Historical performance vs threshold
- Quality score explanation
- Matchup advantages

**Model Confidence:**
- `Very High` - Quality score ≥ 80
- `High` - Quality score ≥ 70
- `Moderate` - Quality score ≥ 60
- `Low` - Quality score < 60

## Insight Generation Logic

### Record Parsing
```javascript
// Handles both NFL (W-L) and NHL (W-L-OT) formats
parseRecord("7-2")    // { wins: 7, losses: 2, otl: 0, total: 9 }
parseRecord("7-2-1")  // { wins: 7, losses: 2, otl: 1, total: 10 }
```

### Points Per Game Calculation
```javascript
// Calculates actual PPG from season totals
calculatePPG(team, isDefense=false)
// Uses avgPointsLast10 / games played
// Works for both offense and defense
```

### Insight Prioritization
1. **Extreme factors first** (70%+ win rate, 15%+ advantages)
2. **Home/away splits** (for venue-relevant games)
3. **Matchup advantages** (offense vs defense mismatches)
4. **Risk factors** (weakness warnings)
5. **Default edge** (if no standout factors)

## Future Enhancements

### Planned Features:
- **Injury Impact Analysis** - Factor in key player absences
- **Weather Conditions** - For outdoor NFL games
- **Rest Days** - Back-to-back games, travel fatigue
- **Line Movement Tracking** - Show if line moved for/against us
- **Historical Matchup Stats** - Head-to-head records
- **Advanced Metrics** - Pace, efficiency ratings, strength of schedule
- **Sentiment Analysis** - News and expert picks trends
- **Live Updates** - Real-time injury news and line shifts

### API Expansion:
- `/api/picks/:pickId/insights` - Full detailed insights for one pick
- `/api/game/:gameId/matchup-analysis` - Complete game breakdown
- `/api/player/:playerId/prop-analysis` - Player-specific insights

## Performance Considerations

### Caching Strategy:
- Quick insights are lightweight (minimal DB queries)
- Full insights can be cached per game (refresh every 30 minutes)
- Team stats refresh once daily (via `fetch-team-performance-data.js`)

### Optimization:
- Batch fetch game data for all picks at once
- Only generate insights when requested (`insights=true`)
- Limit to displayed picks (don't generate for filtered-out picks)

## Testing

### Manual Testing:
```bash
# Test API with insights
curl http://localhost:3000/api/picks?mode=safe&insights=true

# Test without insights (faster)
curl http://localhost:3000/api/picks?mode=safe&insights=false
```

### Example Insights to Verify:
1. **Hot Team** - Look for teams with 6+ wins in last 10
2. **Home Dominance** - Teams with 5-1 or better home records
3. **High Scoring** - Games with both teams averaging 25+ ppg
4. **Defensive Matchup** - Teams allowing < 19 ppg

## Conclusion

The Pick Insights system transforms raw statistical data into actionable intelligence that helps users understand **why** our model recommends a pick, not just **what** the pick is. This transparency builds trust and helps users make more informed betting decisions.

