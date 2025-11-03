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
    'Utah Hockey Club': ['Utah Mammoth', 'Utah HC'],  // New team
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
  }
}

function fullNameToAbbr(name, sport) {
  if (!name) return ''
  const lower = name.toLowerCase().trim()
  
  // Try direct full name match first
  const fullNameMap = FULL_NAME_TO_ABBR[sport] || {}
  if (fullNameMap[lower]) {
    return fullNameMap[lower].toLowerCase()
  }
  
  // Try partial match
  for (const [fullName, abbr] of Object.entries(fullNameMap)) {
    if (lower.includes(fullName) || fullName.includes(lower)) {
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

function extractTeamIdentifier(name) {
  if (!name) return ''
  const lower = name.toLowerCase().trim()
  
  // Try to find abbreviation mapping
  for (const [key, abbr] of Object.entries(TEAM_ABBREVIATIONS.nfl || {})) {
    if (lower.includes(key)) return abbr.toLowerCase()
  }
  
  // Extract first significant word(s)
  const words = lower.split(/\s+/)
  if (words[0] === 'new' && words[1] === 'york') return 'ny' + (words[2] || '')
  if (words[0] === 'new' && words[1] === 'orleans') return 'no'
  if (words[0] === 'new' && words[1] === 'england') return 'ne'
  if (words[0] === 'las' && words[1] === 'vegas') return 'lv'
  if (words[0] === 'los' && words[1] === 'angeles') return 'la' + (words[2] || '')
  if (words[0] === 'san' && words[1] === 'francisco') return 'sf'
  if (words[0] === 'tampa' && words[1] === 'bay') return 'tb'
  if (words[0] === 'green' && words[1] === 'bay') return 'gb'
  if (words[0] === 'kansas' && words[1] === 'city') return 'kc'
  
  return words[0]
}

function matchTeams(espnHome, espnAway, oddsHome, oddsAway, sport) {
  // Convert both to abbreviations for reliable matching
  let espnHomeAbbr = espnHome.toLowerCase().trim()
  let espnAwayAbbr = espnAway.toLowerCase().trim()
  
  // If ESPN already has abbreviation (3-4 chars), use it
  // Otherwise, try to get abbreviation from full name
  if (espnHomeAbbr.length > 4) {
    const abbr = fullNameToAbbr(espnHome, sport) || extractTeamIdentifier(espnHome)
    if (abbr) espnHomeAbbr = abbr
  }
  if (espnAwayAbbr.length > 4) {
    const abbr = fullNameToAbbr(espnAway, sport) || extractTeamIdentifier(espnAway)
    if (abbr) espnAwayAbbr = abbr
  }
  
  // Convert Odds API full names to abbreviations
  const oddsHomeAbbr = fullNameToAbbr(oddsHome, sport) || extractTeamIdentifier(oddsHome)
  const oddsAwayAbbr = fullNameToAbbr(oddsAway, sport) || extractTeamIdentifier(oddsAway)
  
  // Match using abbreviations
  const homeMatch = espnHomeAbbr === oddsHomeAbbr || 
                    espnHomeAbbr.includes(oddsHomeAbbr) || 
                    oddsHomeAbbr.includes(espnHomeAbbr)
  const awayMatch = espnAwayAbbr === oddsAwayAbbr ||
                    espnAwayAbbr.includes(oddsAwayAbbr) ||
                    oddsAwayAbbr.includes(espnAwayAbbr)
  
  return homeMatch && awayMatch
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
      const dateStart = new Date(date)
      dateStart.setHours(0, 0, 0, 0)
      const dateEnd = new Date(date)
      dateEnd.setHours(23, 59, 59, 999)
      
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
  
  // Get ESPN games from database - try exact date first, then ±1 day
  const dateStart = new Date(date)
  dateStart.setHours(0, 0, 0, 0)
  const dateEnd = new Date(date)
  dateEnd.setHours(23, 59, 59, 999)
  
  // First try exact date
  let { data: dbGames } = await supabase
    .from('Game')
    .select('id, sport, date, homeId, awayId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
    .eq('sport', sport)
    .gte('date', dateStart.toISOString())
    .lte('date', dateEnd.toISOString())
    .is('oddsApiEventId', null)  // Only games without mapping yet
  
  // If no unmapped games for exact date, try ±1 day range
  if ((!dbGames || dbGames.length === 0) && oddsGames.length > 0) {
    console.log(`  🔍 No unmapped games for exact date, checking ±1 day...`)
    const expandedStart = new Date(dateStart)
    expandedStart.setDate(expandedStart.getDate() - 1)
    const expandedEnd = new Date(dateEnd)
    expandedEnd.setDate(expandedEnd.getDate() + 1)
    
    const { data: expandedGames } = await supabase
      .from('Game')
      .select('id, sport, date, homeId, awayId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
      .eq('sport', sport)
      .gte('date', expandedStart.toISOString())
      .lte('date', expandedEnd.toISOString())
      .is('oddsApiEventId', null)
    
    if (expandedGames && expandedGames.length > 0) {
      dbGames = expandedGames
      console.log(`  📅 Found ${expandedGames.length} unmapped games in ±1 day range`)
    }
  }
  
  if (!dbGames || dbGames.length === 0) {
    console.log(`  ℹ️  No unmapped ${sport.toUpperCase()} games in database for ${date} (±1 day)`)
    console.log(`  💡 Tip: Games may need to be fetched from ESPN API first, or may already be mapped`)
    return []
  }
  
  let mapped = 0
  let unmapped = []
  
  for (const oddsGame of oddsGames) {
    // Try to find matching ESPN game
    const dbGame = dbGames.find(g => {
      // Use abbreviation if available (more reliable), otherwise use name
      const homeName = (g.home?.abbr || g.home?.name || '').trim()
      const awayName = (g.away?.abbr || g.away?.name || '').trim()
      const oddsHome = (oddsGame.home_team || '').trim()
      const oddsAway = (oddsGame.away_team || '').trim()
      
      // Debug: Log first few attempts
      if (mapped === 0 && unmapped.length === 0) {
        console.log(`  🔍 Matching example: ESPN "${awayName} @ ${homeName}" vs Odds "${oddsAway} @ ${oddsHome}"`)
      }
      
      return matchTeams(homeName, awayName, oddsHome, oddsAway, sport)
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
  
  console.log(`  ✅ Mapped ${mapped} games`)
  if (unmapped.length > 0) {
    console.log(`  ⚠️  Unmapped games (not in ESPN data):`)
    unmapped.forEach(game => console.log(`     - ${game}`))
  }
  
  return mapped  // Return count of successfully mapped games
}

async function saveGameOdds(games, sport, date) {
  if (games.length === 0) return
  
  // First, map event IDs (pass date for filtering)
  await mapAndSaveEventIds(games, sport, date || new Date().toISOString().split('T')[0])
  
  // Get mapping of Odds API event ID → our database game ID (filter by date)
  const dateStart = new Date(date)
  dateStart.setHours(0, 0, 0, 0)
  const dateEnd = new Date(date)
  dateEnd.setHours(23, 59, 59, 999)
  
  // Try exact date first, then ±1 day if needed
  let { data: dbGames } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('sport', sport)
    .gte('date', dateStart.toISOString())
    .lte('date', dateEnd.toISOString())
    .not('oddsApiEventId', 'is', null)
  
  // If no games found, try ±1 day range
  if ((!dbGames || dbGames.length === 0) && games.length > 0) {
    const expandedStart = new Date(dateStart)
    expandedStart.setDate(expandedStart.getDate() - 1)
    const expandedEnd = new Date(dateEnd)
    expandedEnd.setDate(expandedEnd.getDate() + 1)
    
    const { data: expandedGames } = await supabase
      .from('Game')
      .select('id, oddsApiEventId')
      .eq('sport', sport)
      .gte('date', expandedStart.toISOString())
      .lte('date', expandedEnd.toISOString())
      .not('oddsApiEventId', 'is', null)
    
    if (expandedGames) {
      dbGames = expandedGames
    }
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
  
  console.log(`  💾 Saving odds to database (${Object.keys(eventIdToGameId).length} games mapped)...`)
  
  let saved = 0
  for (const game of games) {
    // Look up our database game ID
    const ourGameId = eventIdToGameId[game.id]
    
    if (!ourGameId) {
      console.warn(`    ⚠️  No database game found for Odds API event ${game.id}`)
      continue
    }
    
    try {
      for (const bookmaker of game.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const outcomes = market.outcomes || []
          
          // Determine away and home prices
          let priceAway = null, priceHome = null, spread = null, total = null
          
          if (market.key === 'h2h' && outcomes.length >= 2) {
            priceAway = outcomes[0].price
            priceHome = outcomes[1].price
          } else if (market.key === 'spreads' && outcomes.length >= 2) {
            const away = outcomes.find(o => o.name === 'Away' || o.name.includes('Away'))
            const home = outcomes.find(o => o.name === 'Home' || o.name.includes('Home'))
            spread = market.description ? parseFloat(market.description) : null
            priceAway = away?.price
            priceHome = home?.price
          } else if (market.key === 'totals' && outcomes.length >= 2) {
            total = market.description ? parseFloat(market.description) : null
            priceAway = outcomes[0].price
            priceHome = outcomes[1].price
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

async function savePlayerProps(gameProps, sport) {
  if (gameProps.length === 0) return
  
  // Get mapping of Odds API event ID → our database game ID
  const { data: dbGames } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('sport', sport)
    .not('oddsApiEventId', 'is', null)
  
  // Create lookup map
  const eventIdToGameId = {}
  if (dbGames) {
    dbGames.forEach(g => {
      if (g.oddsApiEventId) {
        eventIdToGameId[g.oddsApiEventId] = g.id
      }
    })
  }
  
  console.log(`  💾 Saving player props to database (${Object.keys(eventIdToGameId).length} games mapped)...`)
  
  let saved = 0
  
  for (const { gameId, props } of gameProps) {
    // Look up our database game ID
    const ourGameId = eventIdToGameId[gameId]
    
    if (!ourGameId) {
      console.warn(`    ⚠️  No database game found for Odds API event ${gameId}`)
      continue
    }
    
    try {
      for (const bookmaker of props.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          for (const outcome of market.outcomes || []) {
            const playerName = outcome.name
            const line = market.description ? parseFloat(market.description) : null
            const price = outcome.price
            
            if (!playerName || !line || !price) continue
            
            // Determine over/under
            let pick = 'over'
            if (outcome.point !== undefined && outcome.point < 0) {
              pick = 'under'
            }
            
            const propId = `${ourGameId}-${playerName}-${market.key}-${line}`
            
            // Save to PlayerPropCache (insert only, ignore duplicates)
            const { error } = await supabase
              .from('PlayerPropCache')
              .insert({
                id: generateId(),
                propId,
                gameId: ourGameId,  // Use our database game ID
                playerName,
                type: market.key,
                pick,
                threshold: line,
                odds: price,
                probability: 0.5,  // Default, will be calculated later
                edge: 0,           // Default, will be calculated later
                confidence: 'low',  // Default, will be calculated later
                qualityScore: 0,
                sport,
                bookmaker: bookmaker.title,
                gameTime: new Date().toISOString(),
                fetchedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + CACHE_DURATION.PROPS).toISOString(),
                isStale: false
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
      }
    } catch (error) {
      console.error(`    ❌ Processing error: ${error.message}`)
    }
  }
  
  console.log(`  ✅ Saved ${saved} prop records`)
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
