# Honest Edge Calculation for NFL/NHL

## Overview

This document describes our honest, data-driven edge calculation model for NFL and NHL games. The model uses **real team performance data from ESPN** to evaluate betting opportunities.

## Data Sources

### ESPN API
We fetch the following live data for each team:
- **Overall Record** (W-L-OT format for NHL)
- **Home/Away Splits** (venue-specific performance)
- **Points/Goals Scored Per Game**
- **Points/Goals Allowed Per Game**
- **Games Played** (calculated from record)

### The Odds API
- **Moneyline odds** for both teams
- **Totals (Over/Under)** with lines
- Multiple bookmakers for best prices

## Model Components

### 1. Team Strength Rating (0-1 scale)

Each team gets a strength rating based on **four weighted factors**:

#### Factor 1: Win Rate (40% weight)
- Uses venue-specific record (home/away) when available
- Falls back to overall record if venue split unavailable
- For NHL: OT losses count as 0.5 losses (reflects their point value)

**Example:**
- Home team: 5-2 at home = 0.714 win rate
- Away team: 2-4 on road = 0.333 win rate

#### Factor 2: Offensive Power (30% weight)
- Calculates points/goals per game from season totals
- Compares to league average (NFL: ~22 ppg, NHL: ~3 gpg)
- Teams scoring above average get higher ratings

**Example:**
- IND: 290 points in 9 games = 32.2 ppg (146% of league avg)
- ATL: 143 points in 8 games = 17.9 ppg (81% of league avg)

#### Factor 3: Venue Performance (20% weight)
- Uses home/away record specific to game location
- Accounts for home field advantage variations

**Example:**
- DEN: 5-0 at home vs 3-2 away (strong home performance)

#### Factor 4: Advanced Metrics (10% weight - placeholder)
- Reserved for future implementation
- Could include: ELO rating, power rankings, point differential

### 2. Home Field Advantage

Base advantages applied:
- **NFL**: +3% (stronger home advantage)
- **NHL**: +2% (moderate home advantage)

### 3. Win Probability Calculation

Uses logistic function to convert strength differential to win probability:

```
P(home win) = 1 / (1 + e^(-8 * strengthDiff))
```

Where `strengthDiff` = (homeStrength - awayStrength + homeAdvantage)

**Caps**: Probabilities are limited to 20-80% range to avoid overconfidence

### 4. Edge Calculation

```
Edge = Our Probability - Market Probability (vig-removed)
```

**Edge Caps**:
- Maximum edge: ±10% (realistic limit)
- Minimum to show: 2% (noise filter)

## Example Calculation

### Game: ATL @ IND (NFL)

**Step 1: Team Strength**
- IND Home: 7-2 record (0.778), 32.2 ppg, 5-0 at home → 80.0% strength
- ATL Away: 3-5 record (0.375), 17.9 ppg, 1-3 away → 32.2% strength

**Step 2: Home Advantage**
- NFL home advantage: +3%

**Step 3: Win Probability**
- Strength diff: 0.800 - 0.322 + 0.03 = 0.508
- P(IND win) = 1 / (1 + e^(-8 * 0.508)) = 80.0%

**Step 4: Market Probability**
- IND moneyline: -102 → 50.5% implied probability (after vig removal)

**Step 5: Edge**
- Edge = 80.0% - 50.5% = **29.5%** → Capped to **10.0%**

**Result**: 10% edge on IND to win at home

## Model Limitations

### What It Does Well
✅ Uses real, verifiable data from ESPN
✅ Accounts for home/away performance differences
✅ Compares teams relative to league averages
✅ Transparent calculation method

### What It Doesn't Do (Yet)
❌ Doesn't account for injuries/lineup changes
❌ Doesn't consider matchup-specific factors
❌ Doesn't weight recent games more heavily
❌ Doesn't consider rest days, travel, or schedule strength
❌ Doesn't account for team pace/tempo in totals

### Totals Prediction Model

**NEW!** We now predict game totals using team offensive/defensive data:

**Formula:**
```
Home Expected Points = (Home Offense PPG + Away Defense PPG) / 2
Away Expected Points = (Away Offense PPG + Home Defense PPG) / 2
Predicted Total = Home Expected + Away Expected + Home Boost
```

**Edge Calculation:**
- If our total > market line: OVER has edge
- If our total < market line: UNDER has edge
- Edge strength = 3% per point/goal difference (capped at 12%)
- Minimum 2% edge to show pick

**Example:**
- NO @ CAR: Our 43.5 vs Market 38.5 = +5 pts → 10% OVER edge ✅
- LAR @ SF: Our 43.7 vs Market 49.5 = -5.8 pts → 10% UNDER edge ✅

### Current Gaps
- **Recent Form**: Uses season-long data, not weighted toward recent performance
- **Context**: Doesn't know about key player absences or weather conditions
- **Pace**: Doesn't account for team pace/tempo differences

## Honesty Features

1. **No Fake Edges**: If we don't have data, we return null rather than guessing
2. **Transparent Logging**: Shows team strength calculations and data sources
3. **Realistic Caps**: Edges capped at 10% to avoid absurd claims
4. **Minimum Threshold**: Only show edges ≥2% to filter noise
5. **Real Data Only**: Every number comes from ESPN or The Odds API

## Usage

### Fetch Team Performance Data
```bash
node scripts/fetch-team-performance-data.js
```
- Runs daily to update team stats from ESPN
- Updates 60+ NFL/NHL teams in ~30 seconds

### Calculate Game Edges
```bash
node scripts/calculate-game-edges.js
```
- Runs before game time to calculate edges
- Stores results in `EdgeSnapshot` table
- Uses appropriate model based on sport (MLB uses separate pitcher-based model)

### Editor's Picks Integration
The Editor's Picks page (`app/picks/page.js`) automatically:
1. Fetches edges from `EdgeSnapshot` table
2. Filters by edge size (safe: 5%+, balanced: 3%+, value: 5%+)
3. Combines with player props
4. Displays top opportunities by sport

## Future Improvements

1. **Weight Recent Games**: Last 5-10 games should count more
2. **Injury Data**: Integrate injury reports from ESPN
3. **Matchup History**: Head-to-head historical performance
4. **Rest & Travel**: Account for back-to-back games, time zones
5. **Weather**: For outdoor games (NFL)
6. **Totals Model**: Build honest over/under prediction using team pace and defense
7. **ELO Rating**: Implement ELO system for more stable ratings
8. **Live Adjustments**: Update edges during games based on score/situation

## Questions?

The model is intentionally simple and transparent. If a pick doesn't make sense, the logging will show exactly why the model thinks it's a good bet. Always verify against your own analysis!

