#!/usr/bin/env node

/**
 * Remap NHL Odds API Event IDs
 *
 * This script clears existing Odds API event ID mappings for NHL games
 * and re-maps them based on current game times. This is needed when
 * NHL game times are corrected and the old mappings become invalid.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

// Check for required environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration!')
  console.error('')
  console.error('Please ensure your .env.local file contains:')
  console.error('NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url')
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key')
  console.error('')
  console.error('Get these values from: https://app.supabase.com → Settings → API')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const ODDS_API_KEY = process.env.ODDS_API_KEY

if (!ODDS_API_KEY) {
  console.error('❌ Missing ODDS_API_KEY!')
  console.error('')
  console.error('Please ensure your .env.local file contains:')
  console.error('ODDS_API_KEY=your_odds_api_key')
  console.error('')
  console.error('Get your free key from: https://the-odds-api.com/')
  process.exit(1)
}

// ============================================================================
// API CALL HELPER
// ============================================================================

async function callOddsAPI(endpoint, params = '') {
  const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl${endpoint}?apiKey=${ODDS_API_KEY}${params}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${response.statusText}`)
    }
    return await response.json()
  } catch (error) {
    console.error(`  ❌ API call failed: ${error.message}`)
    return null
  }
}

// ============================================================================
// MAIN REMAPPING FUNCTION
// ============================================================================

async function remapNHLEventIds() {
  console.log('🏒 REMAP NHL ODDS API EVENT IDs')
  console.log('='.repeat(60))
  console.log('This will clear existing mappings and re-map based on current times')
  console.log('='.repeat(60))
  console.log('')

  // Step 1: Clear existing NHL event ID mappings
  console.log('🧹 Step 1: Clearing existing NHL Odds API event ID mappings...\n')

  const { error: clearError } = await supabase
    .from('Game')
    .update({ oddsApiEventId: null })
    .eq('sport', 'nhl')
    .not('oddsApiEventId', 'is', null)

  if (clearError) {
    console.error('❌ Error clearing mappings:', clearError)
    return
  }

  console.log('✅ Cleared existing NHL event ID mappings\n')

  // Step 2: Fetch current NHL games from database
  console.log('📊 Step 2: Fetching current NHL games from database...\n')

  const today = new Date()
  const twoWeeksOut = new Date(today)
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14)

  const { data: games, error: fetchError } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
    .gte('date', today.toISOString())
    .lte('date', twoWeeksOut.toISOString())
    .order('date', { ascending: true })

  if (fetchError) {
    console.error('❌ Error fetching games:', fetchError)
    return
  }

  console.log(`📅 Found ${games?.length || 0} upcoming NHL games\n`)

  // Debug: Show what dates we have in the database
  console.log('📅 Database game dates:')
  const dbDates = [...new Set(games.map(g => new Date(g.date).toISOString().split('T')[0]))].sort()
  dbDates.forEach(date => {
    const count = games.filter(g => new Date(g.date).toISOString().split('T')[0] === date).length
    console.log(`   - ${date}: ${count} games`)
  })
  console.log('')

  if (!games || games.length === 0) {
    console.log('No games to map. Exiting.')
    return
  }

  // Step 3: Fetch NHL odds from The Odds API
  console.log('🎯 Step 3: Fetching current NHL odds from The Odds API...\n')

  const oddsGames = await callOddsAPI('/odds', '&regions=us&markets=h2h')

  if (!oddsGames) {
    console.error('❌ Failed to fetch odds from The Odds API')
    return
  }

  console.log(`📡 Found ${oddsGames.length} NHL games from Odds API\n`)

  // Debug: Show what dates The Odds API has
  console.log('📅 Odds API game dates:')
  const oddsDates = [...new Set(oddsGames.map(g => new Date(g.commence_time).toISOString().split('T')[0]))]
  oddsDates.forEach(date => console.log(`   - ${date}`))
  console.log('')

  // Debug: Show Odds API games with team names
  console.log('🎯 Odds API games available:')
  oddsGames.forEach(game => {
    const date = new Date(game.commence_time).toISOString().split('T')[0]
    console.log(`   - ${date}: ${game.away_team} @ ${game.home_team}`)
  })
  console.log('')

  // Step 4: Map games and update database
  console.log('🔗 Step 4: Mapping games and updating database...\n')

  let mapped = 0
  let skipped = 0

  for (const game of games) {
    const gameDate = new Date(game.date)
    const gameDateStr = gameDate.toISOString().split('T')[0]

    // Debug: Log what we're looking for
    const dbHomeTeam = (game.home?.abbr || game.home?.name || 'UNKNOWN').toLowerCase()
    const dbAwayTeam = (game.away?.abbr || game.away?.name || 'UNKNOWN').toLowerCase()
    console.log(`🔍 Looking for: ${dbAwayTeam} @ ${dbHomeTeam} (${gameDateStr})`)

    // Find matching Odds API game
    const matchingOddsGame = oddsGames.find(oddsGame => {
      const oddsDate = new Date(oddsGame.commence_time)
      const oddsDateStr = oddsDate.toISOString().split('T')[0]

      // Check if dates match (allow ±1 day for timezone differences)
      const dateDiff = Math.abs(new Date(oddsDateStr).getTime() - new Date(gameDateStr).getTime())
      const oneDayMs = 24 * 60 * 60 * 1000
      if (dateDiff > oneDayMs) {
        return false // More than 1 day difference
      }

      // Check if team names match (be flexible)
      const homeTeam = (game.home?.abbr || game.home?.name || '').toLowerCase()
      const awayTeam = (game.away?.abbr || game.away?.name || '').toLowerCase()
      const oddsHome = oddsGame.home_team.toLowerCase()
      const oddsAway = oddsGame.away_team.toLowerCase()

      // NHL Team name mapping (Database abbr ↔ Odds API full name)
      const teamMappings = {
        // Format: 'db_abbr': ['odds_api_name_parts', 'alternative_parts']
        'van': ['vancouver', 'canucks'],
        'tb': ['tampa', 'bay', 'lightning'],
        'vgk': ['vegas', 'golden', 'knights'],
        'min': ['minnesota', 'wild'],
        'nyi': ['new', 'york', 'islanders'],
        'col': ['colorado', 'avalanche'],
        'car': ['carolina', 'hurricanes'],
        'bos': ['boston', 'bruins'],
        'edm': ['edmonton', 'oilers'],
        'buf': ['buffalo', 'sabres'],
        'fla': ['florida', 'panthers'],
        'la': ['los', 'angeles', 'kings'],
        'wsh': ['washington', 'capitals'],
        'mtl': ['montreal', 'montréal', 'canadiens'],
        'cbj': ['columbus', 'blue', 'jackets'],
        'uta': ['utah', 'mammoth', 'hockey', 'club'],
        'ana': ['anaheim', 'ducks'],
        'stl': ['st', 'louis', 'blues'],
        'tor': ['toronto', 'maple', 'leafs'],
        'sea': ['seattle', 'kraken'],
        'det': ['detroit', 'red', 'wings'],
        'nj': ['new', 'jersey', 'devils'],
        'wpg': ['winnipeg', 'jets'],
        'dal': ['dallas', 'stars'],
        'nsh': ['nashville', 'predators'],
        'pit': ['pittsburgh', 'penguins'],
        'nyr': ['new', 'york', 'rangers'],
        'phi': ['philadelphia', 'flyers'],
        'cgy': ['calgary', 'flames'],
        'sj': ['san', 'jose', 'sharks'],
        'ott': ['ottawa', 'senators'],
        'ari': ['arizona', 'coyotes']
      }

      // Function to check if a database team matches an Odds API team
      const teamsMatch = (dbTeam, oddsTeam) => {
        const dbParts = teamMappings[dbTeam]
        if (!dbParts) return false

        // Check if all parts of the database team name are in the Odds API name
        return dbParts.every(part => oddsTeam.includes(part))
      }

      const homeMatch = teamsMatch(homeTeam, oddsHome)
      const awayMatch = teamsMatch(awayTeam, oddsAway)

      return homeMatch && awayMatch
    })

    if (matchingOddsGame) {
      // Update the game with the correct event ID
      const { error: updateError } = await supabase
        .from('Game')
        .update({ oddsApiEventId: matchingOddsGame.id })
        .eq('id', game.id)

      if (updateError) {
        console.error(`❌ Error updating game ${game.id}:`, updateError)
      } else {
        console.log(`✅ Mapped ${game.away.abbr} @ ${game.home.abbr} (${gameDateStr}) → ${matchingOddsGame.id}`)
        mapped++
      }
    } else {
      console.log(`⚠️  No match found for ${game.away.abbr} @ ${game.home.abbr} (${gameDateStr})`)
      skipped++
    }
  }

  // Step 5: Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 REMAPPING COMPLETE')
  console.log('='.repeat(60))
  console.log(`✅ Games mapped: ${mapped}`)
  console.log(`⚠️  Games skipped: ${skipped}`)
  console.log(`📅 Total games processed: ${games.length}`)
  console.log('')
  console.log('🎯 You can now run: node scripts/fetch-live-odds.js nhl')
  console.log('='.repeat(60))
}

// ============================================================================
// RUN SCRIPT
// ============================================================================

remapNHLEventIds().catch(console.error)
