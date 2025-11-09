# Smart Prop Filters - Team Context Enrichment

## Overview

The Smart Prop Filters system enriches player props with team performance context, enabling intelligent filtering based on offensive power, defensive matchups, venue advantages, and game environments.

## What's New

### ✨ Features

1. **Team Context Enrichment**
   - Automatic enrichment of props with team performance data
   - Offensive power ratings, defensive matchup ratings
   - Win probabilities, recent form, venue advantages
   - Expected game totals and scoring environments

2. **Smart Filter Modes**
   - **⚡ Power Offense**: Hot teams with high scoring offenses
   - **🏠 Home Heroes**: Players with strong home-field advantage
   - **🎯 High Scoring**: Props from games expected to be high-scoring
   - **🎪 Weak Defense**: Favorable matchups against poor defenses

3. **Visual Indicators**
   - 🔥 = Hot Offense (28+ PPG NFL, 3.5+ GPG NHL)
   - 🏠 = Strong Home Record (65%+ win rate)
   - ⚡ = High Scoring Game (48+ expected NFL, 6.5+ NHL)
   - 🎯 = Weak Defense Matchup (26+ PPG allowed NFL, 3.5+ GA NHL)

4. **Matchup Context**
   - Team abbreviations and home/away indicators
   - Hover tooltips with detailed stats
   - Sort by context quality for each filter mode

## How It Works

### Backend Enrichment (`lib/prop-enrichment.js`)

```javascript
// Props are automatically enriched via API
const enrichedProps = await enrichPropsWithTeamContext(props)

// Each prop now has teamContext:
{
  propId: "...",
  playerName: "Patrick Mahomes",
  teamContext: {
    team: "KC",
    isHome: true,
    opponent: "LV",
    offensivePower: 29.8,      // PPG
    offensiveRating: 92,        // 0-100 scale
    isHotOffense: true,         // Above threshold
    opponentDefense: 27.5,      // PPG allowed
    defensiveMatchupRating: 85, // 0-100 (higher = softer)
    isWeakDefense: true,        // Above threshold
    winProbability: 0.72,       // 72% chance to win
    isDominant: true,           // 70%+ win prob
    isFavored: true,            // 55%+ win prob
    expectedTotal: 52.5,        // Expected points
    isHighScoring: true,        // Above threshold
    recentForm: "7-3",          // Last 10 games
    recentFormRating: 70,       // 0-100 scale
    venueRating: 82,            // Home/away performance
    contextScore: 88            // Overall quality (0-100)
  }
}
```

### Frontend Filtering (`components/PlayerPropsFilter.js`)

```javascript
// Original Filters
- 🛡️ Safe: 52%+ probability
- ⚖️ Balanced: Best quality scores
- 💰 Value: 15%+ edge
- 🎰 Home Run: Highest edges

// NEW Smart Filters
- ⚡ Power Offense: Hot teams, 55%+ win prob
- 🏠 Home Heroes: Strong home records
- 🎯 High Scoring: 48+ expected points
- 🎪 Weak Defense: Soft matchups
```

## Sport-Specific Thresholds

### NFL
- **Hot Offense**: 28+ PPG (top ~15%)
- **Weak Defense**: 26+ PPG allowed (bottom ~30%)
- **High Scoring Game**: 48+ expected total
- **Dominant Team**: 70%+ win probability
- **Favored Team**: 55%+ win probability

### NHL
- **Hot Offense**: 3.5+ GPG (top ~20%)
- **Weak Defense**: 3.5+ GA (bottom ~20%)
- **High Scoring Game**: 6.5+ expected total
- **Dominant Team**: 70%+ win probability
- **Favored Team**: 55%+ win probability

### MLB
- **Hot Offense**: 5.5+ RPG
- **Weak Defense**: 5.0+ RA
- **High Scoring Game**: 9.5+ expected total
- **Dominant Team**: 65%+ win probability
- **Favored Team**: 55%+ win probability

## Data Sources

### Team Performance Data
From `Team` table (populated by `scripts/fetch-team-performance-data.js`):
- `avgPointsLast10`: Average points/goals scored (last 10 games)
- `avgPointsAllowedLast10`: Average points/goals allowed (last 10 games)
- `last10Record`: Win-loss record (e.g., "7-3")
- `homeRecord`: Home win-loss record
- `awayRecord`: Away win-loss record

### Edge Calculations
From `EdgeSnapshot` table (populated by `scripts/calculate-game-edges.js`):
- `probHome`: Home team win probability (0.0-1.0)
- `probAway`: Away team win probability (0.0-1.0)
- `predictedTotal`: Expected total points/goals

## Rating System

All ratings use a 0-100 scale for easy interpretation:

### Offensive Rating
- **90-100**: Elite (well above hot threshold)
- **80-89**: Hot (meets hot threshold)
- **60-79**: Above Average
- **40-59**: Average
- **0-39**: Below Average/Cold

### Defensive Matchup Rating
*Higher = Better for props (worse defense)*
- **90-100**: Elite matchup (elite terrible defense)
- **80-89**: Weak defense (meets threshold)
- **60-79**: Slightly favorable
- **40-59**: Average
- **0-39**: Tough matchup (strong defense)

### Recent Form Rating
Based on last 10 games win percentage:
- **80-100**: Hot streak (8-2 or better)
- **60-79**: Good form (6-4 to 7-3)
- **40-59**: Average (5-5)
- **20-39**: Cold streak (3-7 to 4-6)
- **0-19**: Very cold (2-8 or worse)

### Venue Rating
Home teams get +5 bonus, based on actual home/away records:
- **85-100**: Dominant at venue
- **70-84**: Strong at venue
- **55-69**: Above average
- **45-54**: Average
- **0-44**: Struggles at venue

### Context Score
Composite score weighing all factors:
- Offensive Power: 25%
- Defensive Matchup: 25%
- Win Probability: 20%
- Recent Form: 15%
- Venue Advantage: 15%

## Usage Examples

### Power Offense Filter
**Purpose**: Find props from teams with hot offenses and high win probability

**Criteria**:
- `isHotOffense === true` (28+ PPG NFL, 3.5+ GPG NHL)
- `isFavored === true` (55%+ win probability)
- `probability >= 0.50` (at least 50% prop hit rate)

**Sort**: By `offensiveRating` (highest first)

**Example Results**:
```
⚡ Power Offense (18 props)
#1  Patrick Mahomes 🔥⚡  OVER 275.5 Passing Yards
    • KC vs LV  |  +105  |  58% prob
    Team: 29.8 PPG, 72% win prob, 52.5 expected total

#2  Tyreek Hill 🔥🎯  OVER 75.5 Receiving Yards
    • MIA vs NYJ  |  -115  |  60% prob
    Team: 28.5 PPG, vs 27.2 PPG defense
```

### Home Heroes Filter
**Purpose**: Find props from players at home with strong home records

**Criteria**:
- `isHome === true`
- `venueRating >= 60` (60%+ home win rate)
- `probability >= 0.50`

**Sort**: By `venueRating` (highest first)

**Example Results**:
```
🏠 Home Heroes (22 props)
#1  Josh Allen 🏠⚡  OVER 1.5 Passing TDs
    • BUF vs MIA  |  -120  |  62% prob
    Home Record: 7-1 (87.5%), 30.2 PPG at home

#2  Travis Kelce 🏠🔥  OVER 60.5 Receiving Yards
    • KC vs LV  |  +110  |  56% prob
    Home Record: 6-2 (75%), Kelce averages 72 yards at home
```

### High Scoring Filter
**Purpose**: Find props from games expected to have lots of points

**Criteria**:
- `isHighScoring === true` (48+ expected NFL, 6.5+ NHL)
- `probability >= 0.50`

**Sort**: By `expectedTotal` (highest first)

**Example Results**:
```
🎯 High Scoring (15 props)
#1  Dak Prescott ⚡🔥  OVER 2.5 Passing TDs
    • DAL vs PHI  |  +115  |  55% prob
    Expected Total: 54.5 points

#2  CeeDee Lamb ⚡  OVER 85.5 Receiving Yards
    • DAL vs PHI  |  -105  |  58% prob
    Expected Total: 54.5 points, DAL 30.8 PPG
```

### Weak Defense Matchup Filter
**Purpose**: Find props against teams with poor defenses

**Criteria**:
- `isWeakDefense === true` (26+ PPG allowed NFL, 3.5+ GA NHL)
- `probability >= 0.50`

**Sort**: By `defensiveMatchupRating` (highest first)

**Example Results**:
```
🎪 Weak Defense (20 props)
#1  Joe Burrow 🎯🔥  OVER 265.5 Passing Yards
    • CIN vs KC  |  -110  |  61% prob
    vs KC Defense: 27.8 PPG allowed (Rank 28th)

#2  Ja'Marr Chase 🎯  OVER 75.5 Receiving Yards
    • CIN vs KC  |  +100  |  57% prob
    vs KC Defense: 27.8 PPG allowed, 285 yards/game
```

## UI Components

### Filter Buttons
Each mode has a distinct color and icon:
- 🛡️ Safe (Green)
- ⚖️ Balanced (Blue)
- 💰 Value (Yellow)
- 🎰 Home Run (Purple)
- ⚡ Power Offense (Orange)
- 🏠 Home Heroes (Cyan)
- 🎯 High Scoring (Red)
- 🎪 Weak Defense (Pink)

### Prop Card Badges
Inline badges show context at a glance:
- Hover for detailed tooltips
- Multiple badges can appear per prop
- Positioned next to player name

### Matchup Info
Below prop type, shows:
- Team abbreviation
- Home (vs) or Away (@)
- Opponent abbreviation

## Performance Considerations

### Database Queries
- Single optimized query per API call
- Joins `Game`, `Team`, `EdgeSnapshot` tables
- Uses `in()` filter for batch fetching

### Caching
- Team performance data updated daily
- Edge snapshots recalculated for each slate
- Props cached in `PlayerPropCache` table

### Frontend
- Client-side filtering (no API calls on filter change)
- Memoized filter logic with `useMemo`
- Efficient array operations

## Maintenance

### Daily Tasks
1. Run `node scripts/fetch-team-performance-data.js` (updates team stats)
2. Run `node scripts/calculate-game-edges.js` (updates win probabilities)
3. Run `node scripts/fetch-live-odds.js` (updates props and odds)

### Weekly Tasks
1. Verify threshold accuracy (should capture ~15-30% of teams)
2. Review filter performance in validation system
3. Adjust thresholds if league-wide scoring changes

### Monitoring
- Watch for props with missing `teamContext`
- Check edge snapshot coverage (should match game count)
- Monitor query performance in API logs

## Troubleshooting

### Props missing teamContext
**Symptom**: Props show no badges, smart filters find nothing

**Causes**:
1. Missing gameId on props
2. Games not in database
3. Team performance data not fetched
4. Edge snapshots not calculated

**Fix**:
```bash
# Check data availability
node scripts/check-team-schema.js
node scripts/check-edgesnapshot-schema.js

# Refresh data
node scripts/fetch-team-performance-data.js
node scripts/calculate-game-edges.js
```

### Smart filters return empty
**Symptom**: Filter modes show "0 props"

**Causes**:
1. Thresholds too strict for current slate
2. Missing team context data
3. No props meet probability threshold (50%)

**Fix**:
1. Try original filters (safe, balanced, value)
2. Check if props have `teamContext` field
3. Verify team data exists in database

### Incorrect ratings
**Symptom**: Teams marked as "hot" when they're not

**Causes**:
1. Team data not updated recently
2. Incorrect PPG calculations
3. Wrong sport thresholds applied

**Fix**:
```bash
# Re-fetch team data
node scripts/fetch-team-performance-data.js nfl
node scripts/fetch-team-performance-data.js nhl
```

## Future Enhancements

### Planned
- [ ] Player-specific trends (last 5 games)
- [ ] Injury impact indicators
- [ ] Weather context for outdoor games
- [ ] Division rivalry factors
- [ ] Rest days / back-to-back games

### Under Consideration
- [ ] Custom threshold adjustments
- [ ] Multi-filter combinations
- [ ] Historical matchup data
- [ ] Coaching tendencies
- [ ] Pace of play factors

## Technical Architecture

```
User Request
    ↓
app/api/props/route.js
    ↓
1. Fetch props from PlayerPropCache
    ↓
2. Call enrichPropsWithTeamContext()
    ↓
lib/prop-enrichment.js
    ↓
3. Batch fetch game + team + edge data
    ↓
4. Calculate context for each prop
    - Offensive ratings
    - Defensive matchup ratings
    - Form ratings
    - Venue ratings
    - Context scores
    ↓
5. Return enriched props to API
    ↓
app/api/props/route.js
    ↓
6. Return to frontend
    ↓
components/PlayerPropsFilter.js
    ↓
7. Apply smart filters
    ↓
8. Render with badges
    ↓
User sees enriched props!
```

## Related Files

### Core Logic
- `lib/prop-enrichment.js` - Enrichment engine
- `lib/prop-thresholds.js` - Sport-specific thresholds
- `lib/edge-nfl-nhl.js` - Win probability calculations

### API Endpoints
- `app/api/props/route.js` - Props API with enrichment

### Frontend
- `components/PlayerPropsFilter.js` - Smart filters UI
- `app/props/page.js` - Props page

### Scripts
- `scripts/fetch-team-performance-data.js` - Team stats
- `scripts/calculate-game-edges.js` - Win probabilities

### Documentation
- `SPORT_THRESHOLDS_GUIDE.md` - Threshold details
- `PROP_ENHANCEMENT_PLAN.md` - Implementation plan
- `PROP_DATA_AVAILABILITY.md` - Data sources

## Credits

This system combines:
- ESPN API for team performance data
- Odds API for betting markets
- Custom edge calculation models
- Validated sport-specific thresholds

Built to help bettors make smarter, more informed prop decisions by surfacing the game context that matters most.

