// Team name mapping between different APIs

// Map MLB team names to consistent identifiers
export const MLB_TEAM_NAMES = {
  // American League East
  'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 
  'New York Yankees': 'NYY',
  'Tampa Bay Rays': 'TB',
  'Toronto Blue Jays': 'TOR',
  
  // American League Central
  'Chicago White Sox': 'CWS',
  'Cleveland Guardians': 'CLE',
  'Detroit Tigers': 'DET',
  'Kansas City Royals': 'KC',
  'Minnesota Twins': 'MIN',
  
  // American League West
  'Houston Astros': 'HOU',
  'Los Angeles Angels': 'LAA',
  'Oakland Athletics': 'OAK',
  'Athletics': 'OAK', // Odds API uses just "Athletics"
  'Seattle Mariners': 'SEA',
  'Texas Rangers': 'TEX',
  
  // National League East
  'Atlanta Braves': 'ATL',
  'Miami Marlins': 'MIA',
  'New York Mets': 'NYM',
  'Philadelphia Phillies': 'PHI',
  'Washington Nationals': 'WSH',
  
  // National League Central
  'Chicago Cubs': 'CHC',
  'Cincinnati Reds': 'CIN',
  'Milwaukee Brewers': 'MIL',
  'Pittsburgh Pirates': 'PIT',
  'St. Louis Cardinals': 'STL',
  
  // National League West
  'Arizona Diamondbacks': 'ARI',
  'Colorado Rockies': 'COL',
  'Los Angeles Dodgers': 'LAD',
  'San Diego Padres': 'SD',
  'San Francisco Giants': 'SF'
}

// Reverse mapping for lookups
export const TEAM_ABBR_TO_NAME = Object.fromEntries(
  Object.entries(MLB_TEAM_NAMES).map(([name, abbr]) => [abbr, name])
)

/**
 * Get team abbreviation from full name
 * @param {string} teamName - Full team name
 * @returns {string|null} Team abbreviation or null if not found
 */
export function getTeamAbbr(teamName) {
  return MLB_TEAM_NAMES[teamName] || null
}

/**
 * Get full team name from abbreviation
 * @param {string} abbr - Team abbreviation
 * @returns {string|null} Full team name or null if not found
 */
export function getTeamName(abbr) {
  return TEAM_ABBR_TO_NAME[abbr] || null
}

/**
 * Create a consistent game ID from team names and date
 * Format: AWAY_AT_HOME_YYYY-MM-DD
 * @param {string} awayTeam - Away team (name, abbr, or team ID)
 * @param {string} homeTeam - Home team (name, abbr, or team ID)
 * @param {string|Date} date - Game date (YYYY-MM-DD format or Date object)
 * @returns {string} Consistent game ID (e.g., "VAN_at_NSH_2025-11-04")
 */
export function createGameId(awayTeam, homeTeam, date) {
  // Normalize team abbreviations
  let awayAbbr = getTeamAbbr(awayTeam) || awayTeam
  let homeAbbr = getTeamAbbr(homeTeam) || homeTeam
  
  // Handle team IDs like "NFL_3" or "NHL_25" - extract just the number for abbreviation lookup
  // For now, if it's already an abbreviation, use it
  // Remove prefixes like "NFL_", "NHL_", "MLB_"
  awayAbbr = awayAbbr.replace(/^(NFL|NHL|MLB)_/i, '').toUpperCase()
  homeAbbr = homeAbbr.replace(/^(NFL|NHL|MLB)_/i, '').toUpperCase()
  
  // Normalize date to YYYY-MM-DD format
  let dateStr
  if (date instanceof Date) {
    dateStr = date.toISOString().split('T')[0]
  } else if (typeof date === 'string') {
    // If it's already YYYY-MM-DD, use it
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dateStr = date
    } else {
      // Try to parse it
      const parsed = new Date(date)
      if (!isNaN(parsed.getTime())) {
        dateStr = parsed.toISOString().split('T')[0]
      } else {
        dateStr = date
      }
    }
  } else {
    dateStr = String(date)
  }
  
  return `${awayAbbr}_at_${homeAbbr}_${dateStr}`
}
