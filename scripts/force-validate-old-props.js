#!/usr/bin/env node
/**
 * FORCE VALIDATE OLD PROPS
 * 
 * Directly validates old props that are stuck in pending/needs_review
 * and have final games
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Helper to fetch game stats from ESPN API
async function fetchESPNStats(sport, espnGameId) {
  try {
    const sportMap = {
      'nfl': 'football/nfl',
      'nhl': 'hockey/nhl'
    }
    
    const sportPath = sportMap[sport] || 'football/nfl'
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${espnGameId}`
    const response = await fetch(url)
    if (!response.ok) return null
    
    const data = await response.json()
    return data
  } catch (error) {
    return null
  }
}

// Extract player stats from ESPN data
function extractPlayerStat(espnData, playerName, statType) {
  try {
    const boxscore = espnData.boxscore
    if (!boxscore || !boxscore.players) return null

    // Search through both teams
    for (const team of boxscore.players) {
      for (const statGroup of team.statistics) {
        for (const athlete of statGroup.athletes) {
          const name = athlete.athlete.displayName
          if (name.toLowerCase().includes(playerName.toLowerCase()) ||
              playerName.toLowerCase().includes(name.toLowerCase())) {
            
            // Find the stat
            for (let i = 0; i < statGroup.labels.length; i++) {
              const label = statGroup.labels[i].toLowerCase()
              const value = athlete.stats[i]
              
              // Match stat types
              if (statType.includes('pass_attempts') && label.includes('c/att')) {
                const [completions, attempts] = value.split('/')
                return parseInt(attempts)
              }
              if (statType.includes('pass_completions') && label.includes('c/att')) {
                const [completions, attempts] = value.split('/')
                return parseInt(completions)
              }
              if (statType.includes('receiving_yards') && label.includes('rec')) {
                const parts = value.split('-')
                if (parts.length >= 2) return parseInt(parts[1])
              }
              if (statType.includes('receptions') && label.includes('rec')) {
                const parts = value.split('-')
                return parseInt(parts[0])
              }
              if (statType.includes('rushing_yards') && label.includes('car')) {
                const parts = value.split('-')
                if (parts.length >= 2) return parseInt(parts[1])
              }
              if (statType.includes('rushing_attempts') && label.includes('car')) {
                const parts = value.split('-')
                return parseInt(parts[0])
              }
              if (statType.includes('kicking_points') && label.includes('pts')) {
                return parseInt(value)
              }
            }
          }
        }
      }
    }
    
    return null
  } catch (error) {
    console.error('Error extracting stat:', error.message)
    return null
  }
}

async function forceValidateOldProps() {
  console.log('\n🔄 FORCE VALIDATE OLD PROPS')
  console.log('='.repeat(80))
  
  // Get old props that are:
  // 1. status = needs_review (marked by backfill)
  // 2. sport = nfl OR nhl
  // 3. older than 2 days
  
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  
  const { data: oldProps, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'needs_review')
    .in('sport', ['nfl', 'nhl'])
    .lt('timestamp', twoDaysAgo.toISOString())
    .order('timestamp', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`\n📊 Found ${oldProps?.length || 0} old props to validate\n`)
  
  if (!oldProps || oldProps.length === 0) {
    console.log('✅ No old props to validate!')
    return
  }
  
  let validated = 0
  let skipped = 0
  let errors = 0
  
  for (let i = 0; i < oldProps.length; i++) {
    const prop = oldProps[i]
    
    try {
      console.log(`\n[${i+1}/${oldProps.length}] ${prop.playerName} - ${prop.propType}`)
      
      // Get the game
      const { data: game } = await supabase
        .from('Game')
        .select('*')
        .eq('id', prop.gameIdRef)
        .maybeSingle()
      
      if (!game) {
        console.log('  ⚠️  Game not found')
        skipped++
        continue
      }
      
      if (!game.espnGameId) {
        console.log('  ⚠️  No ESPN game ID')
        skipped++
        continue
      }
      
      if (!['final', 'completed', 'f'].includes(game.status?.toLowerCase())) {
        console.log(`  ⏳ Game not final (${game.status})`)
        skipped++
        continue
      }
      
      console.log(`  📊 Game: ${game.homeTeam} vs ${game.awayTeam} (espnId: ${game.espnGameId})`)
      
      // Fetch ESPN stats
      const espnData = await fetchESPNStats(prop.sport, game.espnGameId)
      if (!espnData) {
        console.log('  ❌ Could not fetch ESPN data')
        errors++
        continue
      }
      
      // Extract actual stat
      const actualValue = extractPlayerStat(espnData, prop.playerName, prop.propType)
      
      if (actualValue === null) {
        console.log('  ⚠️  Could not find player stat')
        errors++
        continue
      }
      
      console.log(`  📈 Predicted: ${prop.prediction} ${prop.threshold}`)
      console.log(`  📊 Actual: ${actualValue}`)
      
      // Determine if correct
      let result = null
      if (prop.prediction === 'over') {
        result = actualValue > prop.threshold ? 'correct' : 'incorrect'
      } else if (prop.prediction === 'under') {
        result = actualValue < prop.threshold ? 'correct' : 'incorrect'
      }
      
      console.log(`  ${result === 'correct' ? '✅ CORRECT' : '❌ INCORRECT'}`)
      
      // Update the validation
      const { error: updateError } = await supabase
        .from('PropValidation')
        .update({
          status: 'completed',
          actualValue: actualValue,
          result: result,
          completedAt: new Date().toISOString(),
          notes: `Backfilled via force-validate script`
        })
        .eq('id', prop.id)
      
      if (updateError) throw updateError
      
      validated++
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
      
    } catch (err) {
      console.error(`  ❌ Error:`, err.message)
      errors++
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('📊 VALIDATION SUMMARY')
  console.log('='.repeat(80))
  console.log(`✅ Validated: ${validated}`)
  console.log(`⚠️  Skipped: ${skipped}`)
  console.log(`❌ Errors: ${errors}`)
  console.log(`📊 Total: ${oldProps.length}`)
  console.log('\n💡 Check your /validation dashboard to see updated stats!\n')
}

forceValidateOldProps().catch(console.error)

