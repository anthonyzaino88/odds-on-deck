#!/usr/bin/env node

// Fix NHL games for 2025-11-17 by syncing with ESPN and mapping to Odds API
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL in environment variables')
  console.error('Please ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY')
  process.exit(1)
}

if (!process.env.ODDS_API_KEY) {
  console.error('❌ Missing ODDS_API_KEY in environment variables')
  console.error('Please ensure .env.local contains ODDS_API_KEY')
  process.exit(1)
}

const supabase = createScriptSupabaseClient()

const ODDS_API_KEY = process.env.ODDS_API_KEY

async function fetchESPNGames(date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${date.replace(/-/g, '')}`
  const response = await fetch(url)
  const data = await response.json()

  return data.events.map(event => ({
    espnId: event.id,
    homeTeam: event.competitions[0].competitors.find(c => c.homeAway === 'home').team.abbreviation,
    awayTeam: event.competitions[0].competitors.find(c => c.homeAway === 'away').team.abbreviation,
    date: event.date,
    status: event.status.type.name
  }))
}

async function fetchOddsAPIGames(date) {
  const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h`
  const response = await fetch(url)
  const data = await response.json()

  return data.filter(game =>
    game.commence_time.startsWith(date)
  ).map(game => ({
    eventId: game.id,
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    commenceTime: game.commence_time
  }))
}

function teamsMatch(dbTeam, oddsTeam) {
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

  const dbParts = teamMappings[dbTeam.toLowerCase()]
  if (!dbParts) return false

  const oddsParts = oddsTeam.toLowerCase().split(/\s+/)
  return dbParts.every(part => oddsParts.includes(part))
}

async function main() {
  console.log('🔧 Fixing NHL games for 2025-11-17...\n')

  const targetDate = '2025-11-17'

  // Get all NHL teams for reference
  const { data: teams } = await supabase
    .from('Team')
    .select('id, name, abbr')
    .eq('sport', 'nhl')

  const teamMap = {}
  teams?.forEach(team => {
    teamMap[team.abbr] = team
  })

  // 1. Find and delete existing games for this date
  console.log('🗑️  Finding games to delete for 2025-11-17...')
  const { data: gamesToDelete, error: findError } = await supabase
    .from('Game')
    .select('id')
    .eq('sport', 'nhl')
    .gte('date', `${targetDate}T00:00:00.000Z`)
    .lt('date', `${targetDate}T23:59:59.999Z`)

  if (findError) {
    console.error('❌ Error finding games to delete:', findError)
    return
  }

  if (gamesToDelete && gamesToDelete.length > 0) {
    console.log(`Found ${gamesToDelete.length} games to delete`)
    const gameIds = gamesToDelete.map(g => g.id)

    const { error: deleteError } = await supabase
      .from('Game')
      .delete()
      .in('id', gameIds)

    if (deleteError) {
      console.error('❌ Error deleting games:', deleteError)
      return
    }
    console.log('✅ Deleted existing games\n')
  } else {
    console.log('✅ No existing games to delete\n')
  }

  // 2. Fetch correct games from ESPN
  console.log('📡 Fetching games from ESPN...')
  const espnGames = await fetchESPNGames(targetDate)
  console.log(`Found ${espnGames.length} games from ESPN:`)
  espnGames.forEach(game => {
    console.log(`  ${game.awayTeam} @ ${game.homeTeam} (${game.espnId})`)
  })
  console.log()

  // 3. Insert ESPN games into database
  console.log('💾 Inserting games into database...')
  for (const game of espnGames) {
    const gameDate = new Date(game.date)
    const utcDate = gameDate.toISOString()

    const homeTeam = teamMap[game.homeTeam]
    const awayTeam = teamMap[game.awayTeam]

    if (homeTeam && awayTeam) {
      const { error: insertError } = await supabase
        .from('Game')
        .insert({
          id: `espn_${game.espnId}`,
          sport: 'nhl',
          homeId: homeTeam.id,
          awayId: awayTeam.id,
          date: utcDate,
          status: game.status,
          espnGameId: game.espnId
        })

      if (insertError) {
        console.error(`❌ Error inserting ${game.awayTeam} @ ${game.homeTeam}:`, insertError)
      } else {
        console.log(`✅ Inserted ${game.awayTeam} @ ${game.homeTeam}`)
      }
    } else {
      console.log(`⚠️  Missing team data for ${game.awayTeam} @ ${game.homeTeam}: home=${homeTeam?.id}, away=${awayTeam?.id}`)
    }
  }
  console.log()

  // 4. Fetch Odds API games
  console.log('🎲 Fetching games from Odds API...')
  const oddsGames = await fetchOddsAPIGames(targetDate)
  console.log(`Found ${oddsGames.length} games from Odds API for ${targetDate}`)
  console.log()

  // 5. Map and update games
  console.log('🔗 Mapping games to Odds API...')
  for (const espnGame of espnGames) {
    const matchingOddsGame = oddsGames.find(oddsGame =>
      teamsMatch(espnGame.homeTeam, oddsGame.homeTeam) &&
      teamsMatch(espnGame.awayTeam, oddsGame.awayTeam)
    )

    if (matchingOddsGame) {
      const { error: updateError } = await supabase
        .from('Game')
        .update({ oddsApiEventId: matchingOddsGame.eventId })
        .eq('espnId', espnGame.espnId)

      if (updateError) {
        console.error(`❌ Error updating ${espnGame.awayTeam} @ ${espnGame.homeTeam}:`, updateError)
      } else {
        console.log(`✅ Mapped ${espnGame.awayTeam} @ ${espnGame.homeTeam} → ${matchingOddsGame.eventId}`)
      }
    } else {
      console.log(`⚠️  No Odds API match found for ${espnGame.awayTeam} @ ${espnGame.homeTeam}`)
    }
  }

  console.log('\n🎉 Done! NHL games for 2025-11-17 should now be correctly mapped.')
}

main().catch(console.error)
