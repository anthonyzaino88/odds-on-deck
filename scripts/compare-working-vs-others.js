#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function compareGames() {
  console.log('🔍 Comparing OTT @ BOS (working) vs other NHL games...\n')
  
  // Get all NHL games for today
  const today = new Date(Date.UTC(2025, 10, 6))
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const todayStr = today.toISOString().split('T')[0]
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const todayStart = `${todayStr}T00:00:00`
  const tomorrowStart = `${tomorrowStr}T00:00:00`
  
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, date, status, homeId, awayId, homeScore, awayScore, espnGameId, oddsApiEventId')
    .eq('sport', 'nhl')
    .gte('date', todayStart)
    .lt('date', tomorrowStart)
    .order('date')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games?.length || 0} NHL games for today\n`)
  
  // Find the working game (OTT @ BOS)
  const workingGame = games?.find(g => g.id === 'OTT_at_BOS_2025-11-06')
  const otherGames = games?.filter(g => g.id !== 'OTT_at_BOS_2025-11-06') || []
  
  if (!workingGame) {
    console.error('❌ Working game (OTT @ BOS) not found!')
    return
  }
  
  console.log('✅ WORKING GAME (OTT @ BOS):')
  console.log(`   ID: ${workingGame.id}`)
  console.log(`   Date: ${workingGame.date}`)
  console.log(`   Status: ${workingGame.status}`)
  console.log(`   Home ID: ${workingGame.homeId}`)
  console.log(`   Away ID: ${workingGame.awayId}`)
  console.log(`   ESPN ID: ${workingGame.espnGameId}`)
  console.log(`   Odds Event ID: ${workingGame.oddsApiEventId || 'null'}`)
  console.log('')
  
  // Get teams for all games
  const { data: allTeams } = await supabase
    .from('Team')
    .select('id, name, abbr, sport')
  
  const teamById = {}
  if (allTeams) {
    allTeams.forEach(team => {
      if (team.id) {
        teamById[team.id] = team
      }
    })
  }
  
  // Check team lookups for working game
  const workingHomeTeam = teamById[workingGame.homeId]
  const workingAwayTeam = teamById[workingGame.awayId]
  
  console.log('   Team Lookups:')
  console.log(`   Home: ${workingHomeTeam ? `✅ ${workingHomeTeam.name} (${workingHomeTeam.abbr})` : `❌ NOT FOUND (ID: ${workingGame.homeId})`}`)
  console.log(`   Away: ${workingAwayTeam ? `✅ ${workingAwayTeam.name} (${workingAwayTeam.abbr})` : `❌ NOT FOUND (ID: ${workingGame.awayId})`}`)
  console.log('')
  
  // Compare with other games
  console.log(`📊 OTHER GAMES (${otherGames.length}):\n`)
  
  for (const game of otherGames) {
    const homeTeam = teamById[game.homeId]
    const awayTeam = teamById[game.awayId]
    
    const hasHomeTeam = !!homeTeam
    const hasAwayTeam = !!awayTeam
    const sameDate = game.date === workingGame.date
    const sameStatus = game.status === workingGame.status
    const hasEspnId = !!game.espnGameId
    const hasOdds = !!game.oddsApiEventId
    
    console.log(`   ${game.id}:`)
    console.log(`     Date: ${game.date} ${sameDate ? '✅' : '⚠️'}`)
    console.log(`     Status: ${game.status} ${sameStatus ? '✅' : '⚠️'}`)
    console.log(`     Home Team: ${hasHomeTeam ? `✅ ${homeTeam.name}` : `❌ NOT FOUND (ID: ${game.homeId})`}`)
    console.log(`     Away Team: ${hasAwayTeam ? `✅ ${awayTeam.name}` : `❌ NOT FOUND (ID: ${game.awayId})`}`)
    console.log(`     ESPN ID: ${hasEspnId ? '✅' : '❌'} ${game.espnGameId || 'null'}`)
    console.log(`     Odds Event ID: ${hasOdds ? '✅' : '❌'} ${game.oddsApiEventId || 'null'}`)
    
    // Check what's different
    const differences = []
    if (!hasHomeTeam) differences.push('Missing home team')
    if (!hasAwayTeam) differences.push('Missing away team')
    if (!sameDate) differences.push('Different date format')
    if (!sameStatus) differences.push('Different status')
    if (!hasEspnId) differences.push('Missing ESPN ID')
    
    if (differences.length > 0) {
      console.log(`     ⚠️  DIFFERENCES: ${differences.join(', ')}`)
    } else {
      console.log(`     ✅ All checks passed - should work like OTT @ BOS`)
    }
    console.log('')
  }
  
  // Summary
  const gamesWithMissingTeams = otherGames.filter(g => {
    const homeTeam = teamById[g.homeId]
    const awayTeam = teamById[g.awayId]
    return !homeTeam || !awayTeam
  })
  
  console.log('\n📊 SUMMARY:')
  console.log(`   Total games: ${games?.length || 0}`)
  console.log(`   Working: 1 (OTT @ BOS)`)
  console.log(`   Not working: ${otherGames.length}`)
  console.log(`   Games with missing teams: ${gamesWithMissingTeams.length}`)
  
  if (gamesWithMissingTeams.length > 0) {
    console.log(`\n   ⚠️  Games with missing teams:`)
    gamesWithMissingTeams.forEach(g => {
      const homeTeam = teamById[g.homeId]
      const awayTeam = teamById[g.awayId]
      console.log(`     - ${g.id}: home=${homeTeam ? '✅' : '❌'}, away=${awayTeam ? '✅' : '❌'}`)
    })
  }
}

compareGames().catch(console.error)

