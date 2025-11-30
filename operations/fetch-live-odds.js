#!/usr/bin/env node

/**
 * ODDS FETCHER - Efficient local script to fetch odds data from The Odds API
 * 
 * PURPOSE: Fetch odds/props once daily and cache in database
 * FREQUENCY: Run 1-2x per day (morning before games)
 * API BUDGET: ~500 requests/month (free tier) = 16/day available
 * 
 * USAGE:
 *   node scripts/fetch-live-odds.js nfl --date 2025-11-02 --dry-run
 *   node scripts/fetch-live-odds.js mlb
 *   node scripts/fetch-live-odds.js all
 * 
 * FLAGS:
 *   --dry-run      Don't save to DB, just show what would happen
 *   --date         Specific date to fetch (YYYY-MM-DD)
 *   --cache-fresh  Ignore cache, force fresh fetch from API
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { calculateQualityScore } from '../lib/quality-score.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ============================================================================
// CONFIGURATION
// ============================================================================

const ODDS_API_KEY = process.env.ODDS_API_KEY
const RATE_LIMIT_DELAY = 1000  // 1 second between API calls
const MONTHLY_QUOTA = parseInt(process.env.ODDS_API_QUOTA) || 20000  // Default to 20k for paid plans
const CACHE_DURATION = {
  MONEYLINE: 60 * 60 * 1000,      // 1 hour
  SPREADS: 60 * 60 * 1000,        // 1 hour
  PROPS: 24 * 60 * 60 * 1000      // 24 hours
}

const SPORTS = {
  nfl: { id: 'americanfootball_nfl', type: 'football' },
  mlb: { id: 'baseball_mlb', type: 'baseball' },
  nhl: { id: 'icehockey_nhl', type: 'hockey' }
}

const NFL_PROP_MARKETS = [
  'player_pass_yds', 'player_pass_tds',
  'player_rush_yds', 'player_receptions', 'player_reception_yds'
]

const MLB_PROP_MARKETS = [
  'batter_hits', 'batter_home_runs', 'pitcher_strikeouts',
  'pitcher_walks', 'batter_rbi', 'batter_singles', 'batter_doubles'
]

const NHL_PROP_MARKETS = [
  'player_points', 'player_assists', 'player_shots_on_goal',
  'player_power_play_points', 'player_blocked_shots'
]

// ============================================================================
// TEAM NAME MATCHING (ESPN ↔ The Odds API)
// ============================================================================

const TEAM_NAME_VARIATIONS = {
  nfl: {
    'Los Angeles Rams': ['LA Rams', 'Rams', 'Los Angeles Rams'],
    'Los Angeles Chargers': ['LA Chargers', 'Chargers', 'Los Angeles Chargers'],
    'New York Giants': ['NY Giants', 'Giants', 'New York Giants'],
    'New York Jets': ['NY Jets', 'Jets', 'New York Jets'],
  },
  nhl: {
    'Montreal Canadiens': ['Montréal Canadiens', 'Montreal Canadiens'],
    'Vegas Golden Knights': ['Las Vegas Golden Knights', 'Vegas Golden Knights'],
    'Utah Hockey Club': ['Utah Mammoth', 'Utah HC', 'Utah', 'UTA'],  // New team - Utah Mammoth is the Odds API name
    'Utah Mammoth': ['Utah Hockey Club', 'Utah HC', 'Utah', 'UTA'],  // Also map from Odds API name
  },
  mlb: {
    'Chicago White Sox': ['Chi White Sox', 'White Sox', 'Chicago White Sox'],
    'Chicago Cubs': ['Chi Cubs', 'Cubs', 'Chicago Cubs'],
    'Los Angeles Dodgers': ['LA Dodgers', 'Dodgers', 'Los Angeles Dodgers'],
    'Los Angeles Angels': ['LA Angels', 'Angels', 'Los Angeles Angels'],
  }
}

// Full team name to abbreviation mapping (for The Odds API)
const FULL_NAME_TO_ABBR = {
  nfl: {
    'arizona cardinals': 'ARI', 'atlanta falcons': 'ATL', 'baltimore ravens': 'BAL',
    'buffalo bills': 'BUF', 'carolina panthers': 'CAR', 'chicago bears': 'CHI',
    'cincinnati bengals': 'CIN', 'cleveland browns': 'CLE', 'dallas cowboys': 'DAL',
    'denver broncos': 'DEN', 'detroit lions': 'DET', 'green bay packers': 'GB',
    'houston texans': 'HOU', 'indianapolis colts': 'IND', 'jacksonville jaguars': 'JAX',
    'kansas city chiefs': 'KC', 'las vegas raiders': 'LV', 'los angeles rams': 'LAR',
    'los angeles chargers': 'LAC', 'miami dolphins': 'MIA', 'minnesota vikings': 'MIN',
    'new england patriots': 'NE', 'new orleans saints': 'NO', 'new york giants': 'NYG',
    'new york jets': 'NYJ', 'philadelphia eagles': 'PHI', 'pittsburgh steelers': 'PIT',
    'san francisco 49ers': 'SF', 'seattle seahawks': 'SEA', 'tampa bay buccaneers': 'TB',
    'tennessee titans': 'TEN', 'washington commanders': 'WSH', 'washington football team': 'WSH'
  },
  nhl: {
    'anaheim ducks': 'ANA', 'arizona coyotes': 'ARI', 'boston bruins': 'BOS',
    'buffalo sabres': 'BUF', 'calgary flames': 'CGY', 'carolina hurricanes': 'CAR',
    'chicago blackhawks': 'CHI', 'colorado avalanche': 'COL', 'columbus blue jackets': 'CBJ',
    'dallas stars': 'DAL', 'detroit red wings': 'DET', 'edmonton oilers': 'EDM',
    'florida panthers': 'FLA', 'los angeles kings': 'LAK', 'minnesota wild': 'MIN',
    'montreal canadiens': 'MTL', 'montréal canadiens': 'MTL', 'nashville predators': 'NSH',
    'new jersey devils': 'NJD', 'new york islanders': 'NYI', 'new york rangers': 'NYR',
    'ottawa senators': 'OTT', 'philadelphia flyers': 'PHI', 'pittsburgh penguins': 'PIT',
    'san jose sharks': 'SJS', 'seattle kraken': 'SEA', 'st louis blues': 'STL',
    'st. louis blues': 'STL', 'tampa bay lightning': 'TB', 'toronto maple leafs': 'TOR',
    'utah mammoth': 'UTA', 'utah': 'UTA', 'vancouver canucks': 'VAN',
    'vegas golden knights': 'VGK', 'washington capitals': 'WSH', 'winnipeg jets': 'WPG'
  }
}

// Team name to abbreviation mapping (city-based)
const TEAM_ABBREVIATIONS = {
  nfl: {
    'arizona': 'ARI', 'atlanta': 'ATL', 'baltimore': 'BAL', 'buffalo': 'BUF',
    'carolina': 'CAR', 'chicago': 'CHI', 'cincinnati': 'CIN', 'cleveland': 'CLE',
    'dallas': 'DAL', 'denver': 'DEN', 'detroit': 'DET', 'green bay': 'GB',
    'houston': 'HOU', 'indianapolis': 'IND', 'jacksonville': 'JAX', 'kansas city': 'KC',
    'las vegas': 'LV', 'la rams': 'LAR', 'los angeles rams': 'LAR', 'la chargers': 'LAC',
    'los angeles chargers': 'LAC', 'miami': 'MIA', 'minnesota': 'MIN', 'new england': 'NE',
    'new orleans': 'NO', 'ny giants': 'NYG', 'new york giants': 'NYG',
    'ny jets': 'NYJ', 'new york jets': 'NYJ', 'philadelphia': 'PHI',
    'pittsburgh': 'PIT', 'san francisco': 'SF', 'seattle': 'SEA',
    'tampa bay': 'TB', 'tennessee': 'TEN', 'washington': 'WSH'
  },
  nhl: {
    'anaheim': 'ANA', 'arizona': 'ARI', 'boston': 'BOS', 'buffalo': 'BUF',
    'calgary': 'CGY', 'carolina': 'CAR', 'chicago': 'CHI', 'colorado': 'COL',
    'columbus': 'CBJ', 'dallas': 'DAL', 'detroit': 'DET', 'edmonton': 'EDM',
    'florida': 'FLA', 'los angeles': 'LAK', 'minnesota': 'MIN', 'montreal': 'MTL',
    'montréal': 'MTL', 'nashville': 'NSH', 'new jersey': 'NJD', 'new york islanders': 'NYI',
    'new york rangers': 'NYR', 'ottawa': 'OTT', 'philadelphia': 'PHI', 'pittsburgh': 'PIT',
    'san jose': 'SJS', 'seattle': 'SEA', 'st louis': 'STL', 'st. louis': 'STL',
    'tampa bay': 'TB', 'toronto': 'TOR', 'utah': 'UTA', 'vancouver': 'VAN',
    'vegas': 'VGK', 'washington': 'WSH', 'winnipeg': 'WPG'
  }
}

function fullNameToAbbr(name, sport) {
  if (!name) return ''
  const lower = name.toLowerCase().trim()
  
  // If it's already a short abbreviation (3-4 chars), don't try to match it to full names
  // Abbreviations should match abbreviations, not partial strings in full names
  if (lower.length <= 4) {
    // Only return if it's an exact match in the map
    const fullNameMap = FULL_NAME_TO_ABBR[sport] || {}
    if (fullNameMap[lower]) {
      return fullNameMap[lower].toLowerCase()
    }
    // Don't try partial matching for short abbreviations
    return null
  }
  
  // For longer names, try direct full name match first
  const fullNameMap = FULL_NAME_TO_ABBR[sport] || {}
  if (fullNameMap[lower]) {
    return fullNameMap[lower].toLowerCase()
  }
  
  // Try partial match (only for longer names)
  for (const [fullName, abbr] of Object.entries(fullNameMap)) {
    // Only match if the input is longer than the abbreviation
    // This prevents "tor" from matching "toronto maple leafs"
    if (lower.length > abbr.length && (lower.includes(fullName) || fullName.includes(lower))) {
      return abbr.toLowerCase()
    }
  }
  
  return null
}

function normalizeTeamName(name, sport) {
  if (!name) return ''
  
  let normalized = name.toLowerCase().trim()
  
  // Remove common suffixes
  normalized = normalized
    .replace(/\s+(cardinals|falcons|ravens|bills|panthers|bears|bengals|browns|cowboys|broncos|lions|packers|texans|colts|jaguars|chiefs|raiders|rams|chargers|dolphins|vikings|patriots|saints|giants|jets|eagles|steelers|49ers|seahawks|buccaneers|titans|commanders)$/i, '')
    .replace(/\s+at\s+/i, ' @ ')
  
  // Check if name matches any canonical or variation
  const variations = TEAM_NAME_VARIATIONS[sport] || {}
  for (const [canonical, alts] of Object.entries(variations)) {
    if (alts.some(alt => alt.toLowerCase() === name.toLowerCase())) {
      return canonical.toLowerCase()
    }
  }
  
  // Try to extract city name or use as-is
  return normalized
}

function extractTeamIdentifier(name, sport = 'nfl') {
  if (!name) return ''
  const lower = name.toLowerCase().trim()
  
  // Try to find abbreviation mapping (sport-specific)
  const sportMap = TEAM_ABBREVIATIONS[sport] || {}
  for (const [key, abbr] of Object.entries(sportMap)) {
    if (lower.includes(key)) return abbr.toLowerCase()
  }
  
  // Extract first significant word(s)
  const words = lower.split(/\s+/)
  if (words[0] === 'new' && words[1] === 'york') {
    // For NHL, distinguish between Islanders and Rangers
    if (sport === 'nhl') {
      if (lower.includes('islanders')) return 'nyi'
      if (lower.includes('rangers')) return 'nyr'
      return 'ny' + (words[2] || '')
    }
    return 'ny' + (words[2] || '')
  }
  if (words[0] === 'new' && words[1] === 'orleans') return 'no'
  if (words[0] === 'new' && words[1] === 'england') return 'ne'
  if (words[0] === 'new' && words[1] === 'jersey') return 'njd'
  if (words[0] === 'las' && words[1] === 'vegas') return sport === 'nhl' ? 'vgk' : 'lv'
  if (words[0] === 'los' && words[1] === 'angeles') return sport === 'nhl' ? 'lak' : ('la' + (words[2] || ''))
  if (words[0] === 'san' && words[1] === 'francisco') return 'sf'
  if (words[0] === 'san' && words[1] === 'jose') return 'sjs'
  if (words[0] === 'st' && words[1] === 'louis') return 'stl'
  if (words[0] === 'tampa' && words[1] === 'bay') return 'tb'
  if (words[0] === 'green' && words[1] === 'bay') return 'gb'
  if (words[0] === 'kansas' && words[1] === 'city') return 'kc'
  
  return words[0]
}

// Helper function to find game by team names (for fallback lookup)
async function findGameByTeamNames(oddsHome, oddsAway, sport, date) {
  try {
    const dateStart = new Date(date)
    dateStart.setHours(0, 0, 0, 0)
    const dateEnd = new Date(date)
    dateEnd.setHours(23, 59, 59, 999)
    
    const { data: games } = await supabase
      .from('Game')
      .select('id, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
      .eq('sport', sport)
      .gte('date', dateStart.toISOString())
      .lte('date', dateEnd.toISOString())
    
    if (!games) return null
    
    for (const game of games) {
      const homeName = (game.home?.abbr || game.home?.name || '').trim()
      const awayName = (game.away?.abbr || game.away?.name || '').trim()
      if (matchTeams(homeName, awayName, oddsHome, oddsAway, sport)) {
        return game
      }
    }
    
    // Try ±1 day if nothing found
    const expandedStart = new Date(dateStart)
    expandedStart.setDate(expandedStart.getDate() - 1)
    const expandedEnd = new Date(dateEnd)
    expandedEnd.setDate(expandedEnd.getDate() + 1)
    
    const { data: expandedGames } = await supabase
      .from('Game')
      .select('id, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
      .eq('sport', sport)
      .gte('date', expandedStart.toISOString())
      .lte('date', expandedEnd.toISOString())
    
    if (!expandedGames) return null
    
    for (const game of expandedGames) {
      const homeName = (game.home?.abbr || game.home?.name || '').trim()
      const awayName = (game.away?.abbr || game.away?.name || '').trim()
      if (matchTeams(homeName, awayName, oddsHome, oddsAway, sport)) {
        return game
      }
    }
    
    return null
  } catch (error) {
    console.warn(`Error in findGameByTeamNames: ${error.message}`)
    return null
  }
}

function matchTeams(espnHome, espnAway, oddsHome, oddsAway, sport) {
  // Normalize team names - handle variations
  const normalizeName = (name) => {
    if (!name) return ''
    return name.toLowerCase()
      .trim()
      .replace(/^st\.\s+louis$/i, 'st louis')
      .replace(/^st\s+louis$/i, 'st louis')
      .replace(/\s+/g, ' ')
  }
  
  // Helper to check if two team names match
  const teamsMatch = (team1, team2) => {
    const norm1 = normalizeName(team1)
    const norm2 = normalizeName(team2)
    
    // Direct match
    if (norm1 === norm2) return true
    
    // Abbreviation match
    const abbr1 = fullNameToAbbr(team1, sport) || extractTeamIdentifier(team1, sport) || norm1
    const abbr2 = fullNameToAbbr(team2, sport) || extractTeamIdentifier(team2, sport) || norm2
    
    if (abbr1 === abbr2) return true
    if (abbr1.includes(abbr2) || abbr2.includes(abbr1)) return true
    
    // First word match (city name)
    const firstWord1 = norm1.split(' ')[0]
    const firstWord2 = norm2.split(' ')[0]
    if (firstWord1 === firstWord2 && firstWord1.length > 2) return true
    
    return false
  }
  
  // Try normal order (ESPN home vs Odds home, ESPN away vs Odds away)
  const normalMatch = teamsMatch(espnHome, oddsHome) && teamsMatch(espnAway, oddsAway)
  
  // Try reversed order (ESPN home vs Odds away, ESPN away vs Odds home)
  // ESPN and Odds API sometimes have home/away reversed
  const reversedMatch = teamsMatch(espnHome, oddsAway) && teamsMatch(espnAway, oddsHome)
  
  return normalMatch || reversedMatch
}

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArguments() {
  const args = process.argv.slice(2)
  
  let sport = 'all'
  // Use local date, not UTC (fixes timezone issue)
  const today = new Date()
  const localDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let date = localDate.toISOString().split('T')[0]

  let dryRun = false
  let cacheFresh = false
  
  // Check if first argument is a date (YYYY-MM-DD) or sport
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--cache-fresh') {
      cacheFresh = true
    } else if (arg === '--date' && args[i + 1]) {
      date = args[++i]
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      // Argument is a date format
      date = arg
    } else if (!arg.startsWith('--') && sport === 'all') {
      // First non-flag argument is sport
      sport = arg.toLowerCase()
    }
  }

  // For NHL, provide helpful tip about Odds API timing
  if (sport === 'nhl') {
    const tomorrow = new Date(localDate)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]
    console.log(`  💡 NHL Tip: Odds API data is usually available 2-3 days before games.`)
    console.log(`     Try: node scripts/fetch-live-odds.js nhl ${tomorrowStr}`)
  }

  return { sport, date, dryRun, cacheFresh }
}

// ============================================================================
// API UTILITIES
// ============================================================================

let apiCallsToday = 0

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callOddsAPI(endpoint) {
  apiCallsToday++
  console.log(`  📡 API Call #${apiCallsToday}: ${endpoint}`)
  
  // Check rate limit
  if (apiCallsToday > MONTHLY_QUOTA) {
    throw new Error(`⚠️  API QUOTA EXCEEDED! (${MONTHLY_QUOTA} calls/month)`)
  }
  
  // Rate limiting
  if (apiCallsToday > 1) {
    await sleep(RATE_LIMIT_DELAY)
  }
  
  const url = `https://api.the-odds-api.com${endpoint}&apiKey=${ODDS_API_KEY}`
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API Error ${response.status}: ${text}`)
    }
    
    const data = await response.json()
    return data
  } catch (error) {
    console.error(`  ❌ API Error: ${error.message}`)
    throw error
  }
}

// ============================================================================
// CACHE CHECKING
// ============================================================================

async function checkCache(table, where, maxAgeMs, ignoreCache = false) {
  // If cache should be ignored, always return false (no cache)
  if (ignoreCache) {
    return false
  }
  
  try {
    const { data } = await supabase
      .from(table)
      .select('ts')
      .match(where)
      .order('ts', { ascending: false })
      .limit(1)
    
    if (data?.[0]) {
      const age = Date.now() - new Date(data[0].ts).getTime()
      if (age < maxAgeMs) {
        return true  // Cache is fresh
      }
    }
  } catch (error) {
    console.error(`  ⚠️  Cache check error: ${error.message}`)
  }
  
  return false  // Cache is stale or doesn't exist
}

// ============================================================================
// ODDS DATA FETCHING
// ============================================================================

async function fetchGameOdds(sport, date, ignoreCache = false) {
  const sportConfig = SPORTS[sport]
  if (!sportConfig) {
    console.error(`❌ Unknown sport: ${sport}`)
    return []
  }
  
  console.log(`\n🎮 Fetching ${sport.toUpperCase()} odds for ${date}...`)
  
  try {
    // Check cache first (unless cache is being ignored)
    const isCached = await checkCache('Odds', 
      { market: 'h2h' }, 
      CACHE_DURATION.MONEYLINE,
      ignoreCache
    )
    
    if (isCached) {
      console.log(`  ✅ Cache hit for moneyline odds`)
    // Even if cached, we need games for props - query database for games with oddsApiEventId
    // Use UTC dates to avoid timezone issues
    const dateStart = new Date(Date.UTC(
      parseInt(date.split('-')[0]),  // year
      parseInt(date.split('-')[1]) - 1,  // month (0-based)
      parseInt(date.split('-')[2]),  // day
      0, 0, 0, 0  // 00:00:00.000 UTC
    ))
    const dateEnd = new Date(Date.UTC(
      parseInt(date.split('-')[0]),  // year
      parseInt(date.split('-')[1]) - 1,  // month (0-based)
      parseInt(date.split('-')[2]),  // day
      23, 59, 59, 999  // 23:59:59.999 UTC
    ))
      
      // First check if there are ANY games for this date
      const { data: allGames, error: allGamesError } = await supabase
        .from('Game')
        .select('id')
        .eq('sport', sport)
        .gte('date', dateStart.toISOString())
        .lte('date', dateEnd.toISOString())
      
      if (allGamesError) {
        console.log(`  ⚠️  Error querying games: ${allGamesError.message}`)
        return []
      }
      
      if (!allGames || allGames.length === 0) {
        console.log(`  ℹ️  No ${sport.toUpperCase()} games found in database for ${date}`)
        return []
      }
      
      // Now get games with event IDs
      const { data: games, error } = await supabase
        .from('Game')
        .select('oddsApiEventId, homeId, awayId, id')
        .eq('sport', sport)
        .gte('date', dateStart.toISOString())
        .lte('date', dateEnd.toISOString())
        .not('oddsApiEventId', 'is', null)
      
      if (error) {
        console.log(`  ⚠️  Error querying mapped games: ${error.message}`)
        return []
      }
      
      // Convert database games to Odds API format for props fetching
      const mappedGames = (games || []).map(game => ({
        id: game.oddsApiEventId,
        gameId: game.id,
        home_team: '', // Will be filled if needed
        away_team: ''
      }))
      
      if (mappedGames.length > 0) {
        console.log(`  📅 Found ${mappedGames.length} games with event IDs for props`)
        return mappedGames
      }
      
      // If games exist but aren't mapped, we can't fetch props without event IDs
      console.log(`  ⚠️  Found ${allGames.length} games but none are mapped to Odds API events`)
      console.log(`  💡 Tip: Run the script with --cache-fresh to fetch and map games`)
      return []
    }
    
    // Fetch from API
    const endpoint = `/v4/sports/${sportConfig.id}/odds`
    const params = `?regions=us&markets=h2h,spreads,totals&dateFormat=iso`
    
    const oddsData = await callOddsAPI(endpoint + params)
    const games = Array.isArray(oddsData) ? oddsData : []
    
    console.log(`  ✅ Fetched ${games.length} games with odds`)
    
    return games
    
  } catch (error) {
    console.error(`  ❌ Error fetching game odds: ${error.message}`)
    return []
  }
}

async function mapAndSaveEventIds(oddsGames, sport, date) {
  console.log(`  🔗 Mapping ESPN games to Odds API events...`)
  
  // Get ESPN games from database - try ±3 day range to catch all games
  // Odds API often returns games for multiple days even when querying a specific date
  // Also, Odds API dates might be +1 day from ESPN dates due to timezone differences
  const dateObj = new Date(date)
  const dateStart = new Date(dateObj)
  dateStart.setHours(0, 0, 0, 0)
  dateStart.setDate(dateStart.getDate() - 3) // 3 days before (to catch timezone differences)
  const dateEnd = new Date(dateObj)
  dateEnd.setHours(23, 59, 59, 999)
  dateEnd.setDate(dateEnd.getDate() + 4) // 4 days after (to catch timezone differences)
  
  // Get ALL games in the expanded date range (mapped and unmapped) for matching
  // IMPORTANT: Also get games with same ESPN ID across different dates to handle duplicates
  let { data: dbGames, error: dbError } = await supabase
    .from('Game')
    .select('id, sport, date, homeId, awayId, oddsApiEventId, espnGameId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
    .eq('sport', sport)
    .gte('date', dateStart.toISOString())
    .lte('date', dateEnd.toISOString())
  
  // Also check for games with the same ESPN IDs that might be on different dates (due to timezone)
  // This helps catch duplicates that weren't cleaned up
  if (dbGames && dbGames.length > 0) {
    const espnIds = [...new Set(dbGames.map(g => g.espnGameId).filter(Boolean))]
    if (espnIds.length > 0) {
      // Get all games with these ESPN IDs, even if outside the date range
      const { data: additionalGames } = await supabase
        .from('Game')
        .select('id, sport, date, homeId, awayId, oddsApiEventId, espnGameId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
        .eq('sport', sport)
        .in('espnGameId', espnIds)
      
      if (additionalGames) {
        // Merge, avoiding duplicates
        const existingIds = new Set(dbGames.map(g => g.id))
        additionalGames.forEach(g => {
          if (!existingIds.has(g.id)) {
            dbGames.push(g)
            existingIds.add(g.id)
          }
        })
      }
    }
  }
  
  if (dbError) {
    console.warn(`  ⚠️  Error querying games for mapping: ${dbError.message}`)
  }
  
  if (dbGames && dbGames.length > 0) {
    console.log(`  📅 Found ${dbGames.length} games in ±3 day range (${dateStart.toISOString().split('T')[0]} to ${dateEnd.toISOString().split('T')[0]})`)
  }
  
  if (!dbGames || dbGames.length === 0) {
    console.log(`  ℹ️  No ${sport.toUpperCase()} games in database for ${date} (±1 day)`)
    console.log(`  💡 Tip: Games may need to be fetched from ESPN API first`)
    return 0
  }
  
  // Filter to only unmapped games for mapping
  const unmappedGames = dbGames.filter(g => !g.oddsApiEventId)
  console.log(`  📊 Found ${dbGames.length} total games (${unmappedGames.length} unmapped, ${dbGames.length - unmappedGames.length} already mapped)`)
  
  let mapped = 0
  let unmapped = []
  let alreadyMappedCount = 0
  
  for (const oddsGame of oddsGames) {
    // Check if this odds game is already correctly mapped to a database game
    const alreadyMapped = dbGames.find(g => g.oddsApiEventId === oddsGame.id)
    if (alreadyMapped) {
      alreadyMappedCount++
      continue  // Skip games that are already correctly mapped
    }
    
    // Debug specific game
    if (oddsGame.away_team.includes('Utah') && oddsGame.home_team.includes('Toronto')) {
      console.log(`  🔍 Debugging UTA @ TOR mapping:`)
      console.log(`     Odds API: ${oddsGame.away_team} @ ${oddsGame.home_team}`)
      console.log(`     Checking ${dbGames.length} database games...`)
      const utaGames = dbGames.filter(g => 
        (g.away?.abbr === 'UTA' || g.away?.name?.includes('Utah')) &&
        (g.home?.abbr === 'TOR' || g.home?.name?.includes('Toronto'))
      )
      console.log(`     Found ${utaGames.length} UTA @ TOR games in database`)
      utaGames.forEach(g => {
        console.log(`       - ${g.id} (${new Date(g.date).toISOString().split('T')[0]}) - Mapped: ${g.oddsApiEventId ? 'Yes' : 'No'}`)
      })
    }
    
    // Try to find matching ESPN game (check ALL games, not just unmapped)
    // This allows remapping if a game was mapped to wrong event ID
    // But skip games that already have this exact event ID mapped
    const dbGame = dbGames.find(g => {
      // Skip if this game is already mapped to this exact event ID (correct mapping)
      if (g.oddsApiEventId === oddsGame.id) {
        return false
      }
      
      // Use abbreviation if available (more reliable), otherwise use name
      const homeName = (g.home?.abbr || g.home?.name || '').trim()
      const awayName = (g.away?.abbr || g.away?.name || '').trim()
      const oddsHome = (oddsGame.home_team || '').trim()
      const oddsAway = (oddsGame.away_team || '').trim()
      
      // Try matching - don't filter by date here, let the date range query handle that
      const matches = matchTeams(homeName, awayName, oddsHome, oddsAway, sport)
      
      // Debug: Log matching attempts for UTA/TOR specifically
      if (oddsGame.away_team.includes('Utah') && oddsGame.home_team.includes('Toronto')) {
        const isUtaTor = (g.away?.abbr === 'UTA' || g.away?.name?.includes('Utah')) &&
                         (g.home?.abbr === 'TOR' || g.home?.name?.includes('Toronto'))
        if (isUtaTor) {
          console.log(`     Testing match for ${g.id}:`)
          console.log(`       ESPN home: "${homeName}" (abbr: ${g.home?.abbr}, name: ${g.home?.name})`)
          console.log(`       ESPN away: "${awayName}" (abbr: ${g.away?.abbr}, name: ${g.away?.name})`)
          console.log(`       Odds home: "${oddsHome}"`)
          console.log(`       Odds away: "${oddsAway}"`)
          console.log(`       Match result: ${matches}`)
          if (!matches) {
            // Test the match manually
            const testMatch = matchTeams(homeName, awayName, oddsHome, oddsAway, sport)
            console.log(`       ⚠️  Manual test match: ${testMatch}`)
          }
        }
      }
      
      // Debug: Log matching attempts for unmapped games
      if (matches && !g.oddsApiEventId) {
        const gameDate = new Date(g.date).toISOString().split('T')[0]
        console.log(`  ✅ Match found: ${g.away.abbr} @ ${g.home.abbr} (${gameDate}) ↔ Odds "${oddsAway} @ ${oddsHome}"`)
      }
      
      return matches
    })
    
    if (dbGame) {
      // Save mapping
      const { error } = await supabase
        .from('Game')
        .update({ oddsApiEventId: oddsGame.id })
        .eq('id', dbGame.id)
      
      if (error) {
        console.error(`    ❌ Mapping error for ${dbGame.id}: ${error.message}`)
      } else {
        console.log(`    ✅ Mapped: ${dbGame.away.abbr} @ ${dbGame.home.abbr} → ${oddsGame.id.substring(0, 8)}...`)
        mapped++
      }
    } else {
      unmapped.push(`${oddsGame.away_team} @ ${oddsGame.home_team}`)
    }
  }
  
  console.log(`  ✅ Mapped ${mapped} new games`)
  if (alreadyMappedCount > 0) {
    console.log(`  ℹ️  ${alreadyMappedCount} games already correctly mapped`)
  }
  if (unmapped.length > 0) {
    console.log(`  ⚠️  Unmapped games (not in ESPN data):`)
    unmapped.forEach(game => console.log(`     - ${game}`))
  }
  
  return mapped + alreadyMappedCount  // Return total count of mapped games (new + existing)
}

async function saveGameOdds(games, sport, date) {
  if (games.length === 0) return
  
  const dateStr = date || new Date().toISOString().split('T')[0]
  
  // First, map event IDs (pass date for filtering)
  const mappedCount = await mapAndSaveEventIds(games, sport, dateStr)
  
  // Wait a moment for database updates to propagate
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Get mapping of Odds API event ID → our database game ID (filter by date)
  // Query ALL games with oddsApiEventId (including just mapped ones)
  const dateStart = new Date(dateStr)
  dateStart.setHours(0, 0, 0, 0)
  const dateEnd = new Date(dateStr)
  dateEnd.setHours(23, 59, 59, 999)
  
  // Also build a lookup from the odds games we just mapped
  const justMappedEventIds = new Set()
  if (mappedCount > 0) {
    // Get the games we just mapped by querying with the odds API event IDs
    const oddsEventIds = games.map(g => g.id)
    const { data: justMappedGames } = await supabase
      .from('Game')
      .select('id, oddsApiEventId')
      .eq('sport', sport)
      .in('oddsApiEventId', oddsEventIds)
    
    if (justMappedGames) {
      justMappedGames.forEach(g => {
        if (g.oddsApiEventId) {
          justMappedEventIds.add(g.oddsApiEventId)
        }
      })
      console.log(`  📋 Found ${justMappedGames.length} newly mapped games in database`)
    }
  }
  
  // PRIORITY 1: Direct lookup by event IDs from odds API (most reliable)
  // This works regardless of date - if a game is mapped, we can find it
  const allEventIds = games.map(g => g.id)
  let { data: dbGames, error: queryError } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('sport', sport)
    .in('oddsApiEventId', allEventIds)
  
  if (queryError) {
    console.warn(`  ⚠️  Error querying games by event IDs: ${queryError.message}`)
    dbGames = []
  }
  
  console.log(`  📋 Direct lookup by event IDs: Found ${dbGames?.length || 0} mapped games`)
  
  // PRIORITY 2: If direct lookup didn't find all games, try date-based lookup
  if ((!dbGames || dbGames.length < games.length) && games.length > 0) {
    console.log(`  🔍 Direct lookup incomplete, trying date-based lookup...`)
    const dateStart = new Date(dateStr)
    dateStart.setHours(0, 0, 0, 0)
    const dateEnd = new Date(dateStr)
    dateEnd.setHours(23, 59, 59, 999)
    
    const { data: dateGames, error: dateError } = await supabase
      .from('Game')
      .select('id, oddsApiEventId')
      .eq('sport', sport)
      .gte('date', dateStart.toISOString())
      .lte('date', dateEnd.toISOString())
      .not('oddsApiEventId', 'is', null)
    
    if (dateError) {
      console.warn(`  ⚠️  Error querying games by date: ${dateError.message}`)
    } else if (dateGames) {
      // Merge with existing results, avoiding duplicates
      const existingIds = new Set((dbGames || []).map(g => g.id))
      const newGames = dateGames.filter(g => !existingIds.has(g.id))
      if (newGames.length > 0) {
        dbGames = [...(dbGames || []), ...newGames]
        console.log(`  📅 Date lookup found ${newGames.length} additional games`)
      }
    }
    
    // If still not enough, try ±1 day range
    if ((!dbGames || dbGames.length < games.length) && games.length > 0) {
      console.log(`  🔍 Trying ±1 day range...`)
      const expandedStart = new Date(dateStart)
      expandedStart.setDate(expandedStart.getDate() - 1)
      const expandedEnd = new Date(dateEnd)
      expandedEnd.setDate(expandedEnd.getDate() + 1)
      
      const { data: expandedGames, error: expandedError } = await supabase
        .from('Game')
        .select('id, oddsApiEventId')
        .eq('sport', sport)
        .gte('date', expandedStart.toISOString())
        .lte('date', expandedEnd.toISOString())
        .not('oddsApiEventId', 'is', null)
      
      if (expandedError) {
        console.warn(`  ⚠️  Error querying expanded range: ${expandedError.message}`)
      } else if (expandedGames) {
        const existingIds = new Set((dbGames || []).map(g => g.id))
        const newGames = expandedGames.filter(g => !existingIds.has(g.id))
        if (newGames.length > 0) {
          dbGames = [...(dbGames || []), ...newGames]
          console.log(`  📅 ±1 day range found ${newGames.length} additional games`)
        }
      }
    }
  }
  
  // Create lookup map from all found games
  const eventIdToGameId = {}
  if (dbGames) {
    dbGames.forEach(g => {
      if (g.oddsApiEventId) {
        eventIdToGameId[g.oddsApiEventId] = g.id
      }
    })
  }
  
  console.log(`  ✅ Total mapped games for lookup: ${Object.keys(eventIdToGameId).length} out of ${games.length} odds games`)
  
  // Debug: Show which games we found vs which we're looking for
  if (Object.keys(eventIdToGameId).length < games.length) {
    const foundIds = Object.keys(eventIdToGameId)
    const missingIds = games.filter(g => !foundIds.includes(g.id)).map(g => g.id.substring(0, 16) + '...')
    console.log(`  ⚠️  Missing ${games.length - foundIds.length} game mappings`)
    if (missingIds.length <= 5) {
      console.log(`     Missing event IDs: ${missingIds.join(', ')}`)
    }
  }
  
  console.log(`  💾 Saving odds to database (${Object.keys(eventIdToGameId).length} games mapped, ${mappedCount} just mapped)...`)
  
  let saved = 0
  for (const game of games) {
    // Look up our database game ID
    let ourGameId = eventIdToGameId[game.id]
    
    if (!ourGameId) {
      // Try to find by team names as a last resort
      console.log(`    🔍 Attempting team name match for ${game.away_team} @ ${game.home_team}...`)
      const teamMatch = await findGameByTeamNames(game.home_team, game.away_team, sport, dateStr)
      if (teamMatch) {
        console.log(`    ✅ Found game by team match: ${teamMatch.id}`)
        // Update the mapping
        const { error: updateError } = await supabase
          .from('Game')
          .update({ oddsApiEventId: game.id })
          .eq('id', teamMatch.id)
        
        if (!updateError) {
          eventIdToGameId[game.id] = teamMatch.id
          ourGameId = teamMatch.id
        } else {
          console.warn(`    ⚠️  Failed to update mapping: ${updateError.message}`)
        }
      } else {
        console.warn(`    ⚠️  No database game found for Odds API event ${game.id.substring(0, 16)}... (${game.away_team} @ ${game.home_team})`)
        continue
      }
    }
    
    try {
      for (const bookmaker of game.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const outcomes = market.outcomes || []
          
          // Determine away and home prices
          let priceAway = null, priceHome = null, spread = null, total = null
          
          if (market.key === 'h2h' && outcomes.length >= 2) {
            // Match outcomes to teams by name
            const awayOutcome = outcomes.find(o => 
              o.name === game.away_team || 
              o.name?.toLowerCase().includes(game.away_team?.toLowerCase())
            )
            const homeOutcome = outcomes.find(o => 
              o.name === game.home_team || 
              o.name?.toLowerCase().includes(game.home_team?.toLowerCase())
            )
            priceAway = awayOutcome?.price || outcomes[0].price
            priceHome = homeOutcome?.price || outcomes[1].price
          } else if (market.key === 'spreads' && outcomes.length >= 2) {
            // Match outcomes to teams by name for spreads
            const awayOutcome = outcomes.find(o => 
              o.name === game.away_team || 
              o.name?.toLowerCase().includes(game.away_team?.toLowerCase())
            )
            const homeOutcome = outcomes.find(o => 
              o.name === game.home_team || 
              o.name?.toLowerCase().includes(game.home_team?.toLowerCase())
            )
            spread = awayOutcome?.point || homeOutcome?.point || (market.description ? parseFloat(market.description) : null)
            priceAway = awayOutcome?.price || outcomes[0]?.price
            priceHome = homeOutcome?.price || outcomes[1]?.price
          } else if (market.key === 'totals' && outcomes.length >= 2) {
            // Try multiple fields for total value
            total = market.description ? parseFloat(market.description) : null
            if (!total && outcomes[0]?.point != null) {
              total = parseFloat(outcomes[0].point)
            }
            if (!total && outcomes[0]?.description) {
              total = parseFloat(outcomes[0].description)
            }
            if (!total && outcomes[1]?.point != null) {
              total = parseFloat(outcomes[1].point)
            }
            if (!total && outcomes[1]?.description) {
              total = parseFloat(outcomes[1].description)
            }
            // For totals, first outcome is typically "Over", second is "Under"
            // But we need to check which is which
            const overOutcome = outcomes.find(o => o.name === 'Over' || o.name?.toLowerCase().includes('over'))
            const underOutcome = outcomes.find(o => o.name === 'Under' || o.name?.toLowerCase().includes('under'))
            priceAway = overOutcome?.price || outcomes[0]?.price
            priceHome = underOutcome?.price || outcomes[1]?.price
          }
          
          if (!priceAway || !priceHome) continue
          
          // Save to Odds table (insert only, ignore duplicates)
          const { error } = await supabase
            .from('Odds')
            .insert({
              id: generateId(),
              gameId: ourGameId,  // Use our database game ID
              book: bookmaker.title,
              market: market.key,
              priceAway,
              priceHome,
              spread,
              total,
              ts: new Date().toISOString()
            })
          
          // Ignore duplicate key errors (code 23505)
          if (error) {
            if (!error.code?.includes('23505')) {
              console.error(`    ❌ Save error: ${error.message} (code: ${error.code})`)
            }
          } else {
            saved++
          }
        }
      }
    } catch (error) {
      console.error(`    ❌ Processing error: ${error.message}`)
    }
  }
  
  console.log(`  ✅ Saved ${saved} odds records`)
}

// ============================================================================
// PLAYER PROPS FETCHING
// ============================================================================

async function fetchPlayerProps(sport, date, oddsGames) {
  const sportConfig = SPORTS[sport]
  if (!sportConfig) return []
  
  console.log(`\n👤 Fetching ${sport.toUpperCase()} player props for ${date}...`)
  
  try {
    // Use event IDs from the odds API response (not our database IDs)
    if (!oddsGames || oddsGames.length === 0) {
      console.log(`  ℹ️  No games available for props`)
      return []
    }
    
    console.log(`  📅 Found ${oddsGames.length} games from Odds API`)
    
    let allProps = []
    
    for (const game of oddsGames) {
      // Use The Odds API's event ID (hash format)
      const eventId = game.id
      const gameDisplayName = game.home_team && game.away_team 
        ? `${game.away_team} vs ${game.home_team}` 
        : `Game ${eventId.slice(0, 8)}...`
      
      // Check cache using the Odds API event ID
      const isCached = await checkCache('PlayerPropCache',
        { gameId: eventId },
        CACHE_DURATION.PROPS,
        false  // Props cache is always respected
      )
      
      if (isCached) {
        console.log(`    ✅ Cache hit for ${gameDisplayName}`)
        continue
      }
      
      try {
        // Select correct markets for sport
        let markets
        if (sport === 'nfl') markets = NFL_PROP_MARKETS
        else if (sport === 'mlb') markets = MLB_PROP_MARKETS
        else if (sport === 'nhl') markets = NHL_PROP_MARKETS
        else markets = []
        
        const marketsParam = markets.join(',')
        
        // Use The Odds API event ID in the endpoint
        const endpoint = `/v4/sports/${sportConfig.id}/events/${eventId}/odds`
        const params = `?regions=us&markets=${marketsParam}&dateFormat=iso`
        
        const propsData = await callOddsAPI(endpoint + params)
        
        allProps.push({ 
          gameId: eventId, 
          homeTeam: game.home_team || '',
          awayTeam: game.away_team || '',
          props: propsData
        })
        console.log(`    ✅ Fetched props for ${gameDisplayName}`)
        
      } catch (error) {
        console.error(`    ⚠️  Error fetching props for ${gameDisplayName}: ${error.message}`)
      }
    }
    
    return allProps
    
  } catch (error) {
    console.error(`  ❌ Error fetching player props: ${error.message}`)
    return []
  }
}

// ============================================================================
// EDGE CALCULATION HELPERS
// ============================================================================

/**
 * Convert decimal odds to implied probability
 * The Odds API returns DECIMAL odds (1.95, 2.10, etc), not American odds
 */
function oddsToImpliedProbability(decimalOdds) {
  // Decimal odds formula: probability = 1 / decimal_odds
  return 1 / decimalOdds
}

/**
 * Calculate our probability estimate
 * 
 * TEMPORARY: Until we build a real model based on historical data,
 * we use the bookmaker's implied probability directly.
 * 
 * TODO: Replace with real model using:
 * - Player season stats (goals/assists per game)
 * - Historical PropValidation data (our tracked results)
 * - Opponent defensive stats
 * - Home/away splits
 * - Recent form (last 5-10 games)
 */
function calculateOurProbability(pick, threshold, impliedProb) {
  // For now, use bookmaker's probability directly (no fake edges)
  // This is the honest approach until we have real data to back up adjustments
  return impliedProb
  
  // FUTURE: When we have historical data, use something like:
  // const playerHitRate = getHistoricalHitRate(playerName, propType, threshold)
  // const opponentFactor = getOpponentAdjustment(opponent, propType)
  // const formFactor = getRecentForm(playerName, propType, last5Games)
  // return weightedAverage([impliedProb, playerHitRate, opponentFactor, formFactor])
}

/**
 * Get confidence level based on probability (how likely to hit)
 * NOT based on edge - edge is about value, confidence is about likelihood
 * 
 * High confidence = High probability of hitting
 * Medium confidence = Moderate probability
 * Low confidence = Lower probability (but still might have value!)
 */
function getConfidence(probability) {
  if (probability >= 0.65) return 'high'      // 65%+ chance to hit
  if (probability >= 0.50) return 'medium'    // 50-65% chance
  if (probability >= 0.35) return 'low'       // 35-50% chance
  return 'very_low'                            // <35% chance
}

// ============================================================================
// PLAYER PROPS FETCHING AND SAVING
// ============================================================================

async function savePlayerProps(gameProps, sport) {
  if (gameProps.length === 0) return
  
  // Get mapping of Odds API event ID → our database game ID
  // Use direct lookup by event IDs (most reliable)
  const eventIds = gameProps.map(gp => gp.gameId)
  const { data: dbGames, error } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('sport', sport)
    .in('oddsApiEventId', eventIds)
  
  if (error) {
    console.warn(`  ⚠️  Error querying games for props: ${error.message}`)
  }
  
  // Create lookup map
  const eventIdToGameId = {}
  if (dbGames) {
    dbGames.forEach(g => {
      if (g.oddsApiEventId) {
        eventIdToGameId[g.oddsApiEventId] = g.id
      }
    })
  }
  
  // If direct lookup didn't find all, try broader query
  if (Object.keys(eventIdToGameId).length < eventIds.length) {
    console.log(`  🔍 Direct lookup incomplete, trying broader query...`)
    const { data: allMappedGames } = await supabase
      .from('Game')
      .select('id, oddsApiEventId')
      .eq('sport', sport)
      .not('oddsApiEventId', 'is', null)
    
    if (allMappedGames) {
      allMappedGames.forEach(g => {
        if (g.oddsApiEventId && eventIds.includes(g.oddsApiEventId) && !eventIdToGameId[g.oddsApiEventId]) {
          eventIdToGameId[g.oddsApiEventId] = g.id
        }
      })
    }
  }
  
  console.log(`  💾 Saving player props to database (${Object.keys(eventIdToGameId).length} games mapped out of ${eventIds.length} props)...`)
  
  // OPTIMIZED: Collect all props first, then batch insert
  const propsToSave = []
  
  for (const { gameId, homeTeam, awayTeam, props } of gameProps) {
    // Look up our database game ID
    const ourGameId = eventIdToGameId[gameId]
    
    if (!ourGameId) {
      console.warn(`    ⚠️  No database game found for Odds API event ${gameId}`)
      continue
    }
    
    // Note: Odds API doesn't provide team info for each player
    // We have homeTeam/awayTeam for the game, but can't match players to teams
    // without additional data sources. Setting team=null for now.
    
    try {
      for (const bookmaker of props.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          for (const outcome of market.outcomes || []) {
            // NHL/MLB props structure:
            // - outcome.description = player name (e.g., "Adam Fox")
            // - outcome.name = "Over" or "Under"
            // - outcome.point = threshold (e.g., 0.5 assists)
            const playerName = outcome.description || outcome.name
            const line = outcome.point || (market.description ? parseFloat(market.description) : null)
            const price = outcome.price
            const pick = (outcome.name || '').toLowerCase()
            
            if (!playerName || line === null || line === undefined || !price) continue
            if (!['over', 'under'].includes(pick)) continue
            
            const propId = `${ourGameId}-${playerName}-${market.key}-${line}`
            
            // Calculate edge and probability
            const impliedProb = oddsToImpliedProbability(price)
            const ourProb = calculateOurProbability(pick, line, impliedProb)
            const edge = (ourProb - impliedProb) / impliedProb
            
            // Note: Edge will be ~0% until we build a real model
            // We're using bookmaker probabilities directly for now
            // Skip only if edge is suspiciously high (data error)
            if (edge > 0.50) continue // Only filter obvious errors
            
            const confidence = getConfidence(ourProb)
            const qualityScore = calculateQualityScore({
              probability: ourProb,
              edge: edge,
              confidence: confidence
            })
            
            // Collect prop data
            propsToSave.push({
              id: generateId(),
              propId,
              gameId: ourGameId,  // Use our database game ID
              playerName,
              team: null,  // Odds API doesn't provide player-team mapping
              type: market.key,
              pick,
              threshold: line,
              odds: price,
              probability: ourProb,
              edge: edge,
              confidence: confidence,
              qualityScore: qualityScore,
              sport,
              bookmaker: bookmaker.title,
              gameTime: new Date().toISOString(),
              fetchedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + CACHE_DURATION.PROPS).toISOString(),
              isStale: false
            })
          }
        }
      }
    } catch (error) {
      console.error(`    ❌ Processing error: ${error.message}`)
    }
  }
  
  // DEDUPLICATE: Keep best odds for each unique propId
  const propMap = {}
  for (const prop of propsToSave) {
    if (!propMap[prop.propId] || prop.odds > propMap[prop.propId].odds) {
      propMap[prop.propId] = prop
    }
  }
  const uniqueProps = Object.values(propMap)
  
  console.log(`  📦 Batch saving ${uniqueProps.length} unique props (${propsToSave.length} total with duplicates)...`)
  let saved = 0
  const BATCH_SIZE = 50
  
  for (let i = 0; i < uniqueProps.length; i += BATCH_SIZE) {
    const batch = uniqueProps.slice(i, i + BATCH_SIZE)
    
    try {
      const { data, error } = await supabase
        .from('PlayerPropCache')
        .upsert(batch, {
          onConflict: 'propId',
          ignoreDuplicates: false
        })
      
      if (error) {
        // Ignore duplicate key errors
        if (!error.code?.includes('23505')) {
          console.error(`    ❌ Batch save error: ${error.message}`)
        }
      } else {
        saved += batch.length
      }
      
      // Progress indicator
      if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= uniqueProps.length) {
        console.log(`    ✓ Saved ${Math.min(i + BATCH_SIZE, uniqueProps.length)}/${uniqueProps.length} props`)
      }
    } catch (error) {
      console.error(`    ❌ Batch error: ${error.message}`)
    }
  }
  
  console.log(`  ✅ Saved ${saved} prop records`)
}

// ============================================================================
// AUTO-SAVE TOP PROPS FOR VALIDATION
// ============================================================================

async function autoSaveTopPropsForValidation(sport) {
  console.log(`\n📊 Auto-saving top ${sport.toUpperCase()} props for validation...`)
  
  const now = new Date().toISOString()
  
  // Fetch top quality props from cache
  const { data: topProps, error } = await supabase
    .from('PlayerPropCache')
    .select('*')
    .eq('sport', sport)
    .eq('isStale', false)
    .gte('expiresAt', now)
    .gte('qualityScore', 35)  // Only high quality
    .gte('probability', 0.55) // Only 55%+ probability
    .order('qualityScore', { ascending: false })
    .limit(50)  // Top 50 per sport
  
  if (error) {
    console.log(`  ⚠️ Error fetching top props: ${error.message}`)
    return
  }
  
  if (!topProps || topProps.length === 0) {
    console.log(`  ℹ️ No high-quality props found to save for validation`)
    return
  }
  
  console.log(`  🎯 Found ${topProps.length} top props to save for validation`)
  
  let saved = 0
  let skipped = 0
  
  for (const prop of topProps) {
    try {
      // Check if already saved
      const { data: existing } = await supabase
        .from('PropValidation')
        .select('id')
        .eq('propId', prop.propId)
        .maybeSingle()
      
      if (existing) {
        skipped++
        continue
      }
      
      // Verify game exists
      const { data: game } = await supabase
        .from('Game')
        .select('id, sport')
        .eq('id', prop.gameId)
        .maybeSingle()
      
      if (!game) {
        continue
      }
      
      // Determine tier based on quality score
      const tier = prop.qualityScore >= 40 ? 'elite' : 
                   prop.qualityScore >= 35 ? 'high' : 'good'
      
      // Save to validation
      const validationData = {
        id: generateId(),
        propId: prop.propId,
        gameIdRef: prop.gameId,
        playerName: prop.playerName,
        propType: prop.type,
        threshold: prop.threshold,
        prediction: prop.pick,
        projectedValue: prop.projection || 0,
        confidence: prop.confidence || 'medium',
        edge: prop.edge || 0,
        odds: prop.odds || null,
        probability: prop.probability || null,
        qualityScore: prop.qualityScore,
        source: 'system_generated',
        parlayId: null,
        status: 'pending',
        sport: prop.sport,
        timestamp: new Date().toISOString(),
        notes: `tier:${tier},auto-saved`
      }
      
      const { error: saveError } = await supabase
        .from('PropValidation')
        .insert(validationData)
      
      if (!saveError) {
        saved++
      }
      
    } catch (err) {
      // Skip on error
    }
  }
  
  console.log(`  ✅ Saved ${saved} props for validation (${skipped} already tracked)`)
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { sport, date, dryRun, cacheFresh } = parseArguments()
  
  console.log('\n' + '='.repeat(60))
  console.log('⚡ ODDS FETCHER - LOCAL SCRIPT')
  console.log('='.repeat(60))
  console.log(`📅 Date: ${date}`)
  console.log(`🎮 Sport: ${sport}`)
  console.log(`🏗️  Mode: ${dryRun ? 'DRY RUN (no DB saves)' : 'PRODUCTION'}`)
  console.log(`🔄 Cache: ${cacheFresh ? 'IGNORE (force fresh)' : 'CHECK (use if fresh)'}`)
  console.log('='.repeat(60))
  
  if (!ODDS_API_KEY) {
    console.error('❌ ODDS_API_KEY not found in .env.local')
    console.error('   Get one at https://the-odds-api.com/clients/dashboard')
    process.exit(1)
  }
  
  try {
    const sports = sport === 'all' ? Object.keys(SPORTS) : [sport]
    
    for (const s of sports) {
      // 1. Fetch and save game odds
      const games = await fetchGameOdds(s, date, cacheFresh)
      if (!dryRun && games.length > 0) {
        await saveGameOdds(games, s, date)
      }
      
      // 2. Fetch and save player props (using The Odds API event IDs from games)
      const gameProps = await fetchPlayerProps(s, date, games)
      if (!dryRun && gameProps.length > 0) {
        await savePlayerProps(gameProps, s)
        
        // 3. Auto-save top props for validation tracking
        await autoSaveTopPropsForValidation(s)
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log(`✅ Complete! API calls used: ${apiCallsToday}`)
    console.log(`📊 Remaining quota: ~${MONTHLY_QUOTA - apiCallsToday} calls this month (${MONTHLY_QUOTA} total)`)
    console.log('='.repeat(60))
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message)
    process.exit(1)
  }
}

main()
