# The Odds API - Betting Markets Reference

Complete reference for all betting markets available through The Odds API.

## Table of Contents
- [Featured Betting Markets](#featured-betting-markets)
- [Additional Markets](#additional-markets)
- [Game Period Markets](#game-period-markets)
- [Player Props by Sport](#player-props-by-sport)
  - [NFL/NCAAF/CFL](#nfl-player-props)
  - [NBA/NCAAB/WNBA](#nba-player-props)
  - [MLB](#mlb-player-props)
  - [NHL](#nhl-player-props)
  - [AFL](#afl-player-props)
  - [Rugby League](#rugby-league-player-props)
  - [Soccer](#soccer-player-props)

---

## Featured Betting Markets

The most common markets featured by bookmakers across all sports.

| Market Key | Market Names | Description |
|------------|--------------|-------------|
| `h2h` | Head to head, Moneyline | Bet on the winning team or player (includes draw for soccer) |
| `spreads` | Points spread, Handicap | Bet on the winning team after a points handicap is applied |
| `totals` | Total points/goals, Over/Under | Bet on total score being above or below a threshold |
| `outrights` | Outrights, Futures | Bet on final outcome of a tournament or competition |
| `h2h_lay` | Same as h2h | Bet against a h2h outcome (betting exchanges only) |
| `outrights_lay` | Same as outrights | Bet against an outrights outcome (betting exchanges only) |

**Note:** `spreads` and `totals` markets are mainly available for US sports.

---

## Additional Markets

Available for US sports and selected bookmakers. Update at 1-minute intervals.
Accessed via `/events/{eventId}/odds` endpoint.

| Market Key | Market Name | Description |
|------------|-------------|-------------|
| `alternate_spreads` | Alternate Spreads | All available point spread outcomes for each team |
| `alternate_totals` | Alternate Totals | All available over/under outcomes |
| `btts` | Both Teams to Score | Both teams will score (Yes/No) - Soccer only |
| `draw_no_bet` | Draw No Bet | Match winner excluding draw - Soccer only |
| `h2h_3_way` | Head to head 3 way | Match winner including draw |
| `team_totals` | Team Totals | Featured team totals (Over/Under) |
| `alternate_team_totals` | Alternate Team Totals | All available team totals (Over/Under) |

---

## Game Period Markets

Period-specific betting markets vary by sport.

### Quarter/Half Markets (Basketball, Football)

| Market Key | Market Name | Notes |
|------------|-------------|-------|
| `h2h_q1` | Moneyline 1st Quarter | |
| `h2h_q2` | Moneyline 2nd Quarter | |
| `h2h_q3` | Moneyline 3rd Quarter | |
| `h2h_q4` | Moneyline 4th Quarter | |
| `h2h_h1` | Moneyline 1st Half | |
| `h2h_h2` | Moneyline 2nd Half | |
| `spreads_q1` - `spreads_q4` | Spreads by Quarter | |
| `spreads_h1`, `spreads_h2` | Spreads by Half | |
| `totals_q1` - `totals_q4` | Totals by Quarter | |
| `totals_h1`, `totals_h2` | Totals by Half | |
| `alternate_spreads_q1` - `alternate_spreads_q4` | Alternate Spreads by Quarter | |
| `alternate_totals_q1` - `alternate_totals_q4` | Alternate Totals by Quarter | |

### Period Markets (Ice Hockey)

| Market Key | Market Name | Notes |
|------------|-------------|-------|
| `h2h_p1` - `h2h_p3` | Moneyline by Period | Ice hockey only |
| `spreads_p1` - `spreads_p3` | Spreads by Period | Ice hockey only |
| `totals_p1` - `totals_p3` | Totals by Period | Ice hockey only |
| `alternate_spreads_p1` - `alternate_spreads_p3` | Alternate Spreads by Period | Ice hockey only |
| `alternate_totals_p1` - `alternate_totals_p3` | Alternate Totals by Period | Ice hockey only |

### Innings Markets (Baseball)

| Market Key | Market Name | Notes |
|------------|-------------|-------|
| `h2h_1st_1_innings` | Moneyline 1st inning | Baseball only |
| `h2h_1st_3_innings` | Moneyline 1st 3 innings | Baseball only |
| `h2h_1st_5_innings` | Moneyline 1st 5 innings | Baseball only |
| `h2h_1st_7_innings` | Moneyline 1st 7 innings | Baseball only |
| `spreads_1st_1_innings` | Spreads 1st inning | Baseball only |
| `spreads_1st_3_innings` | Spreads 1st 3 innings | Baseball only |
| `spreads_1st_5_innings` | Spreads 1st 5 innings | Baseball only |
| `spreads_1st_7_innings` | Spreads 1st 7 innings | Baseball only |
| `totals_1st_1_innings` | Totals 1st inning | Baseball only |
| `totals_1st_3_innings` | Totals 1st 3 innings | Baseball only |
| `totals_1st_5_innings` | Totals 1st 5 innings | Baseball only |
| `totals_1st_7_innings` | Totals 1st 7 innings | Baseball only |

---

## Player Props by Sport

Player props accessed via `/events/{eventId}/odds` endpoint.
Coverage mainly limited to US sports and US bookmakers.

### NFL Player Props

#### Standard NFL Markets

| Market Key | Market Name |
|------------|-------------|
| `player_pass_yds` | Pass Yards (Over/Under) |
| `player_pass_tds` | Pass Touchdowns (Over/Under) |
| `player_pass_completions` | Pass Completions (Over/Under) |
| `player_pass_attempts` | Pass Attempts (Over/Under) |
| `player_pass_interceptions` | Pass Interceptions (Over/Under) |
| `player_rush_yds` | Rush Yards (Over/Under) |
| `player_rush_attempts` | Rush Attempts (Over/Under) |
| `player_rush_tds` | Rush Touchdowns (Over/Under) |
| `player_receptions` | Receptions (Over/Under) |
| `player_reception_yds` | Reception Yards (Over/Under) |
| `player_reception_tds` | Reception Touchdowns (Over/Under) |
| `player_kicking_points` | Kicking Points (Over/Under) |
| `player_field_goals` | Field Goals (Over/Under) |
| `player_defensive_interceptions` | Defensive Interceptions (Over/Under) |
| `player_sacks` | Sacks (Over/Under) |
| `player_tackles_assists` | Tackles + Assists (Over/Under) |
| `player_1st_td` | 1st Touchdown Scorer (Yes/No) |
| `player_anytime_td` | Anytime Touchdown Scorer (Yes/No) |
| `player_last_td` | Last Touchdown Scorer (Yes/No) |

#### Alternate NFL Markets

All standard markets have `_alternate` versions (e.g., `player_pass_yds_alternate`).

---

### NBA Player Props

#### Standard NBA Markets

| Market Key | Market Name |
|------------|-------------|
| `player_points` | Points (Over/Under) |
| `player_rebounds` | Rebounds (Over/Under) |
| `player_assists` | Assists (Over/Under) |
| `player_threes` | Threes (Over/Under) |
| `player_blocks` | Blocks (Over/Under) |
| `player_steals` | Steals (Over/Under) |
| `player_turnovers` | Turnovers (Over/Under) |
| `player_points_rebounds_assists` | Points + Rebounds + Assists (Over/Under) |
| `player_points_rebounds` | Points + Rebounds (Over/Under) |
| `player_points_assists` | Points + Assists (Over/Under) |
| `player_rebounds_assists` | Rebounds + Assists (Over/Under) |
| `player_double_double` | Double Double (Yes/No) |
| `player_triple_double` | Triple Double (Yes/No) |
| `player_first_basket` | First Basket Scorer (Yes/No) |

#### Alternate NBA Markets

All standard markets have `_alternate` versions (e.g., `player_points_alternate`).

---

### MLB Player Props

#### Batting Props

| Market Key | Market Name |
|------------|-------------|
| `batter_hits` | Batter hits (Over/Under) |
| `batter_home_runs` | Batter home runs (Over/Under) |
| `batter_total_bases` | Batter total bases (Over/Under) |
| `batter_rbis` | Batter RBIs (Over/Under) |
| `batter_runs_scored` | Batter runs scored (Over/Under) |
| `batter_strikeouts` | Batter strikeouts (Over/Under) |
| `batter_walks` | Batter walks (Over/Under) |
| `batter_stolen_bases` | Batter stolen bases (Over/Under) |
| `batter_singles` | Batter singles (Over/Under) |
| `batter_doubles` | Batter doubles (Over/Under) |
| `batter_triples` | Batter triples (Over/Under) |
| `batter_hits_runs_rbis` | Batter hits + runs + RBIs (Over/Under) |
| `batter_first_home_run` | Batter first home run (Yes/No) |

#### Pitching Props

| Market Key | Market Name |
|------------|-------------|
| `pitcher_strikeouts` | Pitcher strikeouts (Over/Under) |
| `pitcher_outs` | Pitcher outs (Over/Under) |
| `pitcher_hits_allowed` | Pitcher hits allowed (Over/Under) |
| `pitcher_walks` | Pitcher walks (Over/Under) |
| `pitcher_earned_runs` | Pitcher earned runs (Over/Under) |
| `pitcher_record_a_win` | Pitcher to record a win (Yes/No) |

#### Alternate MLB Markets

Most markets have `_alternate` versions (e.g., `batter_hits_alternate`).

---

### NHL Player Props

#### Standard NHL Markets

| Market Key | Market Name |
|------------|-------------|
| `player_points` | Points (Over/Under) |
| `player_goals` | Goals (Over/Under) |
| `player_assists` | Assists (Over/Under) |
| `player_shots_on_goal` | Shots on goal (Over/Under) |
| `player_power_play_points` | Power play points (Over/Under) |
| `player_blocked_shots` | Blocked shots (Over/Under) |
| `player_total_saves` | Total saves (Over/Under) |
| `player_goal_scorer_first` | First Goal Scorer (Yes/No) |
| `player_goal_scorer_last` | Last Goal Scorer (Yes/No) |
| `player_goal_scorer_anytime` | Anytime Goal Scorer (Yes/No) |

#### Alternate NHL Markets

| Market Key | Market Name |
|------------|-------------|
| `player_points_alternate` | Alternate Points (Over/Under) |
| `player_goals_alternate` | Alternate Goals (Over/Under) |
| `player_assists_alternate` | Alternate Assists (Over/Under) |
| `player_shots_on_goal_alternate` | Alternate Shots on Goal (Over/Under) |
| `player_power_play_points_alternate` | Alternate Power Play Points (Over/Under) |
| `player_blocked_shots_alternate` | Alternate Blocked Shots (Over/Under) |
| `player_total_saves_alternate` | Alternate Total Saves (Over/Under) |

---

### AFL Player Props

Available from select AU bookmakers (Sportsbet, Ladbrokes, TAB, Pointsbet, Betr).

| Market Key | Market Name |
|------------|-------------|
| `player_disposals` | Disposals (Over/Under) |
| `player_disposals_over` | Disposals (Over only) |
| `player_goal_scorer_first` | First Goal Scorer (Yes/No) |
| `player_goal_scorer_last` | Last Goal Scorer (Yes/No) |
| `player_goal_scorer_anytime` | Anytime Goal Scorer (Yes/No) |
| `player_goals_scored_over` | Goals scored (Over only) |
| `player_marks_over` | Marks (Over only) |
| `player_marks_most` | Most Marks (Yes/No) |
| `player_tackles_over` | Tackles (Over only) |
| `player_tackles_most` | Most Tackles (Yes/No) |
| `player_afl_fantasy_points` | AFL Fantasy Points (Over/Under) |

---

### Rugby League Player Props

NRL props from select AU bookmakers.

| Market Key | Market Name |
|------------|-------------|
| `player_try_scorer_first` | First Try Scorer (Yes/No) |
| `player_try_scorer_last` | Last Try Scorer (Yes/No) |
| `player_try_scorer_anytime` | Anytime Try Scorer (Yes/No) |
| `player_try_scorer_over` | Tries Scored (Over only) |

---

### Soccer Player Props

Available for EPL, Ligue 1, Bundesliga, Serie A, La Liga, and MLS.
Limited to US bookmakers.

| Market Key | Market Name |
|------------|-------------|
| `player_goal_scorer_anytime` | Anytime Goal Scorer (Yes/No) |
| `player_first_goal_scorer` | First Goal Scorer (Yes/No) |
| `player_last_goal_scorer` | Last Goal Scorer (Yes/No) |
| `player_to_receive_card` | Player to receive a card (Yes/No) |
| `player_to_receive_red_card` | Player to receive a red card (Yes/No) |
| `player_shots_on_target` | Player Shots on Target (Over/Under) |
| `player_shots` | Player Shots (Over/Under) |
| `player_assists` | Player Assists (Over/Under) |

#### Other Soccer Markets

| Market Key | Market Name |
|------------|-------------|
| `alternate_spreads_corners` | Handicap Corners |
| `alternate_totals_corners` | Total Corners (Over/Under) |
| `alternate_spreads_cards` | Handicap Cards/Bookings |
| `alternate_totals_cards` | Total Cards/Bookings (Over/Under) |
| `double_chance` | Double Chance |

---

## Implementation Notes

### Currently Implemented in Our App

#### MLB Markets
- `batter_hits`
- `batter_home_runs`
- `batter_total_bases`
- `batter_rbis`
- `batter_runs_scored`
- `batter_strikeouts`
- `batter_walks`
- `pitcher_strikeouts`
- `pitcher_outs`
- `pitcher_hits_allowed`
- `pitcher_earned_runs`
- `pitcher_walks`

#### NFL Markets
- `player_pass_yds`
- `player_pass_tds`
- `player_pass_completions`
- `player_pass_attempts`
- `player_pass_interceptions`
- `player_rush_yds`
- `player_rush_attempts`
- `player_rush_tds`
- `player_receptions`
- `player_reception_yds`
- `player_reception_tds`
- `player_kicking_points`

#### NHL Markets
- `player_points`
- `player_goals`
- `player_assists`
- `player_shots_on_goal`
- `player_power_play_points`
- `player_blocked_shots`
- `player_total_saves`
- `player_points_alternate`
- `player_goals_alternate`
- `player_assists_alternate`
- `player_shots_on_goal_alternate`

### Files to Update for New Markets

1. **`lib/vendors/player-props-odds.js`** - Add markets to sport-specific constants
2. **`lib/player-props-enhanced.js`** - Add market mapping functions
3. **`lib/[sport]-props.js`** - Add market-to-propType mapping
4. **`lib/vendors/[sport]-game-stats.js`** - Add stat extraction for validation

### API Rate Limits

- Default: ~10 requests/second
- Our implementation: 200ms delay (5 requests/second) for safety
- Monthly quota depends on subscription tier

### Access Methods

- **Featured Markets**: Available via `/sports/{sport}/odds` endpoint
- **Additional Markets**: Available via `/events/{eventId}/odds` endpoint
- **Player Props**: Available via `/events/{eventId}/odds` endpoint with specific market parameters

---

## Resources

- [The Odds API Documentation](https://the-odds-api.com/sports-odds-data/betting-markets.html)
- [API Dashboard](https://the-odds-api.com/account)
- [Twitter Updates](https://twitter.com/the_odds_api)

---

*Last Updated: October 2025*
*This document is maintained as a reference for the Odds on Deck betting platform.*

