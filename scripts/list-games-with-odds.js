#!/usr/bin/env node

/**
 * List all games that have odds
 */

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

async function listGames() {
  console.log('🔍 Finding games with odds...\n')
  
  // Get all games with odds
  const { data: odds, error } = await supabase
    .from('Odds')
    .select('gameId, game:Game!Odds_gameId_fkey(id, date, sport, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr))')
    .order('ts', { ascending: false })
    .limit(100)
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  // Get unique games
  const gameMap = new Map()
  odds.forEach(o => {
    if (o.game && !gameMap.has(o.game.id)) {
      gameMap.set(o.game.id, o.game)
    }
  })
  
  console.log(`📊 Found ${gameMap.size} games with odds\n`)
  
  // Group by date
  const byDate = {}
  Array.from(gameMap.values()).forEach(game => {
    const date = new Date(game.date).toISOString().split('T')[0]
    if (!byDate[date]) {
      byDate[date] = []
    }
    byDate[date].push(game)
  })
  
  Object.keys(byDate).sort().forEach(date => {
    console.log(`\n📅 ${date} (${byDate[date].length} games):`)
    byDate[date].forEach(game => {
      const oddsCount = odds.filter(o => o.gameId === game.id).length
      console.log(`   ${game.away.abbr} @ ${game.home.abbr} - ${oddsCount} odds records`)
    })
  })
}

listGames().catch(console.error)

