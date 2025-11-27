#!/usr/bin/env node

// Sync today's games with ESPN - add missing games and fix existing ones
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

// Validate environment variables are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in environment variables')
  console.error('Please ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function syncTodayGames() {
  console.log('🔄 Syncing today\'s NHL games with ESPN...\n')

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  // Get ESPN data
  const espnDate = todayStr.replace(/-/g, '')
  const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${espnDate}`

  const response = await fetch(espnUrl, {
    headers: { 'User-Agent': 'OddsOnDeck/1.0' }
  })

  if (!response.ok) {
    console.error(`❌ ESPN API Error: ${response.status}`)
    return
  }

  const espnData = await response.json()
  const espnGames = espnData.events || []

  console.log(`ESPN has ${espnGames.length} games for today\n`)

  // Get current database games
  const { data: dbGames, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      status,
      home:Team!Game_homeId_fkey(id, name, abbr),
      away:Team!Game_awayId_fkey(id, name, abbr)
    `)
    .eq('sport', 'nhl')
    .gte('date', `${todayStr}T00:00:00Z`)
    .lte('date', `${todayStr}T23:59:59Z`)

  if (error) {
    console.error('❌ Database error:', error)
    return
  }

  console.log(`Database has ${dbGames?.length || 0} games for today\n`)

  // Get all teams for reference
  const { data: teams } = await supabase
    .from('Team')
    .select('id, name, abbr')
    .eq('sport', 'nhl')

  const teamMap = {}
  teams?.forEach(team => {
    teamMap[team.abbr] = team
  })

  // Process ESPN games
  let added = 0
  let updated = 0

  for (const espnGame of espnGames) {
    const competitors = espnGame.competitions?.[0]?.competitors || []
    const homeCompetitor = competitors.find(c => c.homeAway === 'home')
    const awayCompetitor = competitors.find(c => c.homeAway === 'away')

    if (!homeCompetitor || !awayCompetitor) continue

    const homeTeamAbbr = homeCompetitor.team?.abbreviation
    const awayTeamAbbr = awayCompetitor.team?.abbreviation
    const espnGameId = espnGame.id
    const gameTime = new Date(espnGame.date)

    console.log(`Processing: ${awayTeamAbbr} @ ${homeTeamAbbr} (${espnGameId})`)

    // Check if game exists in database
    const existingGame = dbGames?.find(g => g.espnGameId === espnGameId)

    if (existingGame) {
      // Update existing game time if needed
      const currentTime = new Date(existingGame.date)
      if (Math.abs(gameTime.getTime() - currentTime.getTime()) > 60000) { // More than 1 minute difference
        console.log(`  ⏰ Updating time: ${currentTime.toISOString()} -> ${gameTime.toISOString()}`)

        const { error: updateError } = await supabase
          .from('Game')
          .update({ date: gameTime.toISOString() })
          .eq('id', existingGame.id)

        if (!updateError) {
          updated++
        }
      } else {
        console.log(`  ✅ Time is correct`)
      }
    } else {
      // Add new game
      const homeTeam = teamMap[homeTeamAbbr]
      const awayTeam = teamMap[awayTeamAbbr]

      if (homeTeam && awayTeam) {
        console.log(`  ➕ Adding new game`)

        const { error: insertError } = await supabase
          .from('Game')
          .insert({
            id: `espn_${espnGameId}`, // Generate ID from ESPN ID
            sport: 'nhl',
            date: gameTime.toISOString(),
            espnGameId: espnGameId,
            homeId: homeTeam.id,
            awayId: awayTeam.id,
            status: 'scheduled'
          })

        if (!insertError) {
          added++
          console.log(`  ✅ Added successfully`)
        } else {
          console.log(`  ❌ Error adding: ${insertError.message}`)
        }
      } else {
        console.log(`  ❌ Missing team data: home=${homeTeam?.id}, away=${awayTeam?.id}`)
      }
    }
  }

  console.log(`\n📊 Sync complete:`)
  console.log(`   Added: ${added} games`)
  console.log(`   Updated: ${updated} games`)
  console.log(`   Total ESPN games: ${espnGames.length}`)

  if (added > 0 || updated > 0) {
    console.log(`\n🎯 Next steps:`)
    console.log(`   1. Run: node scripts/remap-nhl-event-ids.js`)
    console.log(`   2. Run: node scripts/fetch-live-odds.js nhl ${todayStr}`)
    console.log(`   3. Today's games should now have working props!`)
  }
}

syncTodayGames().catch(console.error)
