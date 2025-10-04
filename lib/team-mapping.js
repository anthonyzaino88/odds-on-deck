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
 * @param {string} awayTeam - Away team (name or abbr)
 * @param {string} homeTeam - Home team (name or abbr)
 * @param {string} date - Game date (YYYY-MM-DD format)
 * @returns {string} Consistent game ID
 */
export function createGameId(awayTeam, homeTeam, date) {
  const awayAbbr = getTeamAbbr(awayTeam) || awayTeam
  const homeAbbr = getTeamAbbr(homeTeam) || homeTeam
  return `${awayAbbr}_at_${homeAbbr}_${date}`
}
