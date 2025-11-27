#!/usr/bin/env node

// Force map today's NHL games even if Odds API doesn't have data yet
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

// Validate environment variables are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in environment variables')
  console.error('Please ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

if (!process.env.ODDS_API_KEY) {
  console.error('❌ Missing ODDS_API_KEY in environment variables')
  console.error('Please ensure .env.local contains ODDS_API_KEY')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const ODDS_API_KEY = process.env.ODDS_API_KEY

async function callOddsAPI(endpoint, params = '') {
  const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl${endpoint}?apiKey=${ODDS_API_KEY}&${params}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${response.statusText}`)
  }
  return await response.json()
}

async function forceMapTodayGames() {
  console.log('🔧 Force mapping today\'s NHL games...\n')

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  console.log(`Today: ${todayStr}\n`)

  // Get today's games from database
  const { data: dbGames, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      oddsApiEventId,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('sport', 'nhl')
    .gte('date', `${todayStr}T00:00:00Z`)
    .lte('date', `${todayStr}T23:59:59Z`)

  if (error) {
    console.error('❌ Database error:', error)
    return
  }

  console.log(`Found ${dbGames?.length || 0} games in database for today\n`)

  // Try to get Odds API data with different parameters
  console.log('🎯 Trying different Odds API parameters for today...\n')

  const testParams = [
    'regions=us&markets=h2h',
    'regions=us,eu,uk&markets=h2h',
    'regions=us&markets=h2h,spreads,totals',
    'markets=h2h' // No region filter
  ]

  let allOddsGames = []

  for (const params of testParams) {
    try {
      console.log(`Testing: ${params}`)
      const games = await callOddsAPI('/odds', params)

      // Filter for today's games
      const todayOddsGames = games.filter(game => {
        const gameDate = new Date(game.commence_time).toISOString().split('T')[0]
        return gameDate === todayStr
      })

      if (todayOddsGames.length > 0) {
        console.log(`  ✅ Found ${todayOddsGames.length} games for today!`)
        allOddsGames.push(...todayOddsGames)
      } else {
        console.log(`  ❌ No games for today`)
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`)
    }
  }

  // Remove duplicates
  const uniqueOddsGames = allOddsGames.filter((game, index, self) =>
    index === self.findIndex(g => g.id === game.id)
  )

  console.log(`\n📊 Found ${uniqueOddsGames.length} unique games from Odds API for today\n`)

  if (uniqueOddsGames.length > 0) {
    // Now try to map them to database games
    console.log('🔗 Attempting to map games...\n')

    let mapped = 0

    for (const oddsGame of uniqueOddsGames) {
      // Find matching database game
      const dbGame = dbGames?.find(db => {
        const homeTeam = (db.home?.abbr || '').toLowerCase()
        const awayTeam = (db.away?.abbr || '').toLowerCase()
        const oddsHome = oddsGame.home_team.toLowerCase()
        const oddsAway = oddsGame.away_team.toLowerCase()

        // Check team mappings
        const teamMappings = {
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

        const teamsMatch = (dbTeam, oddsTeam) => {
          const dbParts = teamMappings[dbTeam]
          if (!dbParts) return false
          return dbParts.every(part => oddsTeam.includes(part))
        }

        return teamsMatch(homeTeam, oddsHome) && teamsMatch(awayTeam, oddsAway)
      })

      if (dbGame) {
        console.log(`✅ Mapping ${dbGame.away.abbr} @ ${dbGame.home.abbr} -> ${oddsGame.id}`)

        // Update the database
        const { error: updateError } = await supabase
          .from('Game')
          .update({ oddsApiEventId: oddsGame.id })
          .eq('id', dbGame.id)

        if (updateError) {
          console.error(`   ❌ Error updating: ${updateError.message}`)
        } else {
          console.log(`   ✅ Successfully mapped`)
          mapped++
        }
      } else {
        console.log(`❌ No database match for ${oddsGame.away_team} @ ${oddsGame.home_team}`)
      }
    }

    console.log(`\n📊 Mapping complete: ${mapped} games mapped`)

    if (mapped > 0) {
      console.log(`\n🎯 Next: Run 'node scripts/fetch-live-odds.js nhl ${todayStr}' to get props`)
    }
  } else {
    console.log('❌ No Odds API data available for today\'s games')
    console.log('💡 Odds API typically only provides data 2-3 days before games')
    console.log('💡 Try again closer to game time, or check if API has changed')
  }
}

forceMapTodayGames().catch(console.error)
