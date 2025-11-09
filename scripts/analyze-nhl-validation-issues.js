#!/usr/bin/env node
/**
 * ANALYZE NHL VALIDATION ISSUES
 * 
 * Check what's wrong with the 600 NHL props marked as needs_review
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function analyzeNHLIssues() {
  console.log('\n🏒 ANALYZING NHL VALIDATION ISSUES\n')
  console.log('='.repeat(80))
  
  // Get all NHL props
  const { data: nhlProps, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`\n📊 Total NHL Props: ${nhlProps?.length || 0}\n`)
  
  // Group by status
  const byStatus = nhlProps.reduce((acc, prop) => {
    acc[prop.status] = (acc[prop.status] || 0) + 1
    return acc
  }, {})
  
  console.log('By Status:')
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })
  
  // Get unique game IDs
  const uniqueGames = [...new Set(nhlProps.map(p => p.gameIdRef))]
  console.log(`\nUnique Games: ${uniqueGames.length}`)
  
  // Sample a few props to understand the issue
  console.log('\n📋 Sample "needs_review" Props:\n')
  
  const needsReview = nhlProps.filter(p => p.status === 'needs_review')
  const samples = needsReview.slice(0, 5)
  
  for (const prop of samples) {
    console.log(`Player: ${prop.playerName}`)
    console.log(`Type: ${prop.propType}`)
    console.log(`Game: ${prop.gameIdRef}`)
    console.log(`Notes: ${prop.notes}`)
    
    // Check if game exists and is final
    const { data: game } = await supabase
      .from('Game')
      .select('id, status, espnGameId, homeTeam, awayTeam')
      .eq('id', prop.gameIdRef)
      .maybeSingle()
    
    if (game) {
      console.log(`Game Status: ${game.status} (${game.awayTeam} @ ${game.homeTeam})`)
      console.log(`ESPN ID: ${game.espnGameId || 'MISSING'}`)
    } else {
      console.log(`Game: NOT FOUND`)
    }
    console.log()
  }
  
  // Analyze the patterns
  console.log('='.repeat(80))
  console.log('\n🔍 ANALYSIS:\n')
  
  // Check how many games are actually final
  let gamesChecked = 0
  let gamesFinal = 0
  let gamesWithEspnId = 0
  
  for (const gameId of uniqueGames.slice(0, 10)) {
    const { data: game } = await supabase
      .from('Game')
      .select('status, espnGameId')
      .eq('id', gameId)
      .maybeSingle()
    
    if (game) {
      gamesChecked++
      if (['final', 'completed', 'f'].includes(game.status?.toLowerCase())) {
        gamesFinal++
      }
      if (game.espnGameId) {
        gamesWithEspnId++
      }
    }
  }
  
  console.log(`Sample of 10 games:`)
  console.log(`  Games found: ${gamesChecked}`)
  console.log(`  Games final: ${gamesFinal}`)
  console.log(`  Games with ESPN ID: ${gamesWithEspnId}`)
  
  console.log('\n💡 LIKELY ISSUES:')
  console.log('  1. Player names don\'t match ESPN API format')
  console.log('  2. Players didn\'t play in the game (scratched)')
  console.log('  3. Prop types need better mapping')
  console.log('  4. ESPN API doesn\'t include all stat types')
  
  console.log('\n🎯 RECOMMENDED SOLUTIONS:')
  console.log('  Option 1: Accept "needs_review" as normal (10-20% is expected)')
  console.log('  Option 2: Try to re-validate with better player name matching')
  console.log('  Option 3: Delete invalid props and start fresh')
  console.log('  Option 4: Separate validation by sport on dashboard')
  
  console.log('\n📊 CURRENT STATE:')
  console.log(`  NFL: 357 completed (working great!) ✅`)
  console.log(`  NHL: ${nhlProps.length} needs_review (need fixing) ⚠️`)
  console.log('\n')
}

analyzeNHLIssues().catch(console.error)


