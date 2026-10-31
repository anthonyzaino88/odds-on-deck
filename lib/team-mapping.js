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
  'Chicago White Sox': 'CHW',
  'Cleveland Guardians': 'CLE',
  'Detroit Tigers': 'DET',
  'Kansas City Royals': 'KC',
  'Minnesota Twins': 'MIN',
  
  // American League West
  'Houston Astros': 'HOU',
  'Los Angeles Angels': 'LAA',
  'Oakland Athletics': 'ATH',
  'Athletics': 'ATH', // Odds API uses just "Athletics"
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

// Reverse mapping for lookups. Prefer the longer official name when two
// names share a code (Athletics / Oakland Athletics → ATH).
export const TEAM_ABBR_TO_NAME = Object.fromEntries(
  Object.entries(MLB_TEAM_NAMES)
    .sort(([left], [right]) => left.length - right.length)
    .map(([name, abbr]) => [abbr, name])
)

/**
 * ESPN stored codes are canonical (ATH, CHW). Historical and Odds-API
 * codes alias onto them. Other common feed variants share this table so
 * every mapper / lookup uses one source of truth.
 */
export const MLB_TEAM_CODE_ALIASES = Object.freeze({
  ATH: 'ATH',
  OAK: 'ATH',
  CHW: 'CHW',
  CWS: 'CHW',
  AZ: 'ARI',
  ARI: 'ARI',
  WAS: 'WSH',
  WSH: 'WSH',
  SFG: 'SF',
  SF: 'SF',
  SDP: 'SD',
  SD: 'SD',
  KCR: 'KC',
  KC: 'KC',
  TBR: 'TB',
  TB: 'TB',
})

/**
 * Get team abbreviation from full name
 * @param {string} teamName - Full team name
 * @returns {string|null} Team abbreviation or null if not found
 */
export function getTeamAbbr(teamName) {
  const mapped = MLB_TEAM_NAMES[teamName]
  return mapped ? canonicalizeMlbAbbr(mapped) : null
}

/**
 * Get full team name from abbreviation
 * @param {string} abbr - Team abbreviation
 * @returns {string|null} Full team name or null if not found
 */
export function getTeamName(abbr) {
  const canonical = canonicalizeMlbAbbr(abbr)
  return TEAM_ABBR_TO_NAME[canonical] || TEAM_ABBR_TO_NAME[abbr] || null
}

/**
 * Strip sport prefixes and map OAK/CWS (and other feed variants) to the
 * stored ESPN codes ATH/CHW.
 */
export function canonicalizeMlbAbbr(value) {
  const raw = String(value || '').replace(/^(MLB|NFL|NHL)_/i, '').toUpperCase().trim()
  if (!raw) return ''
  return MLB_TEAM_CODE_ALIASES[raw] || raw
}

/** Resolve a name or abbreviation to the stored ESPN team code. */
export function resolveMlbTeamCode(value) {
  if (value == null || value === '') return ''
  return canonicalizeMlbAbbr(getTeamAbbr(value) || value)
}

export function mlbTeamCodesEqual(left, right) {
  const a = resolveMlbTeamCode(left)
  const b = resolveMlbTeamCode(right)
  return Boolean(a && b && a === b)
}

/**
 * Non-MLB selection aliases (NFL historical / feed variants).
 * LV↔OAK is Raiders-only: OAK also aliases to ATH in MLB_TEAM_CODE_ALIASES,
 * so LV matching is explicit here and never rewrites Athletics to Las Vegas.
 */
export const NFL_SELECTION_ALIASES = Object.freeze({
  JAX: 'JAC',
  JAC: 'JAX',
  WSH: 'WAS',
  WAS: 'WSH',
  LA: 'LAR',
  LAR: 'LA',
  TB: 'TBL',
  TBL: 'TB',
})

export function teamSelectionMatches(selection, abbr) {
  if (!selection || !abbr) return false
  const a = String(selection).toUpperCase().trim()
  const b = String(abbr).toUpperCase().trim()
  if (!a || !b) return false
  if (a === b) return true
  if (mlbTeamCodesEqual(a, b)) return true
  if ((a === 'LV' && b === 'OAK') || (a === 'OAK' && b === 'LV')) return true
  return NFL_SELECTION_ALIASES[a] === b || NFL_SELECTION_ALIASES[b] === a
}

/** Codes a results map should also answer to for this team abbreviation. */
export function aliasedTeamCodes(abbr) {
  const raw = String(abbr || '').toUpperCase().trim()
  if (!raw) return []
  const out = new Set([raw])
  const mlb = canonicalizeMlbAbbr(raw)
  if (mlb) {
    out.add(mlb)
    for (const [from, to] of Object.entries(MLB_TEAM_CODE_ALIASES)) {
      if (to === mlb) out.add(from)
    }
  }
  if (raw === 'LV') out.add('OAK')
  if (NFL_SELECTION_ALIASES[raw]) out.add(NFL_SELECTION_ALIASES[raw])
  return [...out]
}

/** Look up a static map keyed by MLB abbr, accepting OAK/CWS aliases. */
export function lookupByMlbAbbr(map, abbr) {
  if (!map || abbr == null || abbr === '') return undefined
  const canonical = canonicalizeMlbAbbr(abbr)
  if (Object.prototype.hasOwnProperty.call(map, canonical)) return map[canonical]
  if (Object.prototype.hasOwnProperty.call(map, abbr)) return map[abbr]
  return undefined
}

/**
 * ESPN scoreboard event.season.year as a Game.season string, or null.
 */
export function espnEventSeasonYear(event) {
  const raw = event?.season?.year ?? (typeof event?.season === 'number' || typeof event?.season === 'string'
    ? event.season
    : null)
  if (raw == null || raw === '') return null
  return String(raw)
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
  // Normalize team abbreviations (ATH/CHW stored; OAK/CWS accepted)
  let awayAbbr = resolveMlbTeamCode(awayTeam) || String(awayTeam || '')
  let homeAbbr = resolveMlbTeamCode(homeTeam) || String(homeTeam || '')
  
  // Handle team IDs like "NFL_3" or "NHL_25" - extract just the number for abbreviation lookup
  // For now, if it's already an abbreviation, use it
  // Remove prefixes like "NFL_", "NHL_", "MLB_"
  awayAbbr = awayAbbr.replace(/^(NFL|NHL|MLB)_/i, '').toUpperCase()
  homeAbbr = homeAbbr.replace(/^(NFL|NHL|MLB)_/i, '').toUpperCase()
  awayAbbr = canonicalizeMlbAbbr(awayAbbr) || awayAbbr
  homeAbbr = canonicalizeMlbAbbr(homeAbbr) || homeAbbr
  
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
