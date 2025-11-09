#!/usr/bin/env node
/**
 * FORCE VALIDATE ALL NHL PROPS
 * Validates both pending and needs_review NHL props
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { getPlayerGameStat } from '../lib/vendors/nhl-game-stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function forceValidateAllNHL() {
  console.log('\n🏒 FORCE VALIDATE ALL NHL PROPS')
  console.log('='.repeat(80))
  
  // Get all NHL props that need validation (both pending and needs_review)
  const { data: propsToValidate, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .in('status', ['pending', 'needs_review'])
    .order('timestamp', { ascending: true })
  
  if (error) {
    console.error('❌ Error fetching props:', error)
    return
  }
  
  console.log(`\n📊 Found ${propsToValidate?.length || 0} NHL props to validate`)
  console.log(`   - Pending: ${propsToValidate?.filter(p => p.status === 'pending').length || 0}`)
  console.log(`   - Needs Review: ${propsToValidate?.filter(p => p.status === 'needs_review').length || 0}\n`)
  
  if (!propsToValidate || propsToValidate.length === 0) {
    console.log('✅ No NHL props to validate!')
    return
  }
  
  let validated = 0
  let stillPending = 0
  let stillNeedsReview = 0
  let errors = 0
  
  for (let i = 0; i < propsToValidate.length; i++) {
    const prop = propsToValidate[i]
    
    try {
      console.log(`\n[${i + 1}/${propsToValidate.length}] ${prop.playerName} - ${prop.propType}`)
      console.log(`   Status: ${prop.status}`)
      console.log(`   Prediction: ${prop.prediction} ${prop.threshold}`)
      
      // Find the game
      const { data: game, error: gameError } = await supabase
        .from('Game')
        .select('*')
        .eq('id', prop.gameIdRef)
        .eq('sport', 'nhl')
        .maybeSingle()
      
      if (gameError || !game) {
        console.log(`   ⚠️  Game not found - skipping`)
        stillNeedsReview++
        continue
      }
      
      console.log(`   Game: ${game.awayTeam} @ ${game.homeTeam} (${game.status})`)
      
      // Check if game is final
      const isFinal = ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase())
      
      if (!isFinal) {
        console.log(`   ⏳ Game not final yet - keeping as pending`)
        stillPending++
        continue
      }
      
      if (!game.espnGameId) {
        console.log(`   ⚠️  No ESPN Game ID - marking for review`)
        await supabase
          .from('PropValidation')
          .update({
            status: 'needs_review',
            notes: 'Game finished but no espnGameId available',
            completedAt: new Date().toISOString()
          })
          .eq('id', prop.id)
        stillNeedsReview++
        continue
      }
      
      console.log(`   ESPN ID: ${game.espnGameId}`)
      console.log(`   Fetching player stats...`)
      
      // Fetch the actual stat value
      const actualValue = await getPlayerGameStat(
        game.espnGameId,
        prop.playerName,
        prop.propType
      )
      
      if (actualValue === null || actualValue === undefined) {
        console.log(`   ❌ Could not fetch stat - marking for review`)
        await supabase
          .from('PropValidation')
          .update({
            status: 'needs_review',
            notes: 'Game finished but stat not available from API',
            completedAt: new Date().toISOString()
          })
          .eq('id', prop.id)
        stillNeedsReview++
        continue
      }
      
      console.log(`   📊 Actual Value: ${actualValue}`)
      
      // Determine result
      let result = 'incorrect'
      if (actualValue === prop.threshold) {
        result = 'push'
      } else if (
        (prop.prediction === 'over' && actualValue > prop.threshold) ||
        (prop.prediction === 'under' && actualValue < prop.threshold)
      ) {
        result = 'correct'
      }
      
      const resultEmoji = result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'
      console.log(`   ${resultEmoji} ${result.toUpperCase()}`)
      
      // Update validation
      const { error: updateError } = await supabase
        .from('PropValidation')
        .update({
          actualValue,
          result,
          status: 'completed',
          completedAt: new Date().toISOString(),
          notes: `Force validated: ${prop.prediction.toUpperCase()} ${prop.threshold} → Actual: ${actualValue}`
        })
        .eq('id', prop.id)
      
      if (updateError) {
        console.log(`   ❌ Error updating: ${updateError.message}`)
        errors++
        continue
      }
      
      validated++
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300))
      
    } catch (error) {
      console.error(`   ❌ Error processing prop:`, error.message)
      errors++
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('📊 VALIDATION SUMMARY')
  console.log('='.repeat(80))
  console.log(`✅ Validated: ${validated}`)
  console.log(`⏳ Still Pending: ${stillPending}`)
  console.log(`⚠️  Still Needs Review: ${stillNeedsReview}`)
  console.log(`❌ Errors: ${errors}`)
  console.log(`📊 Total Processed: ${propsToValidate.length}`)
  
  // Show updated stats
  const { data: completed } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .eq('status', 'completed')
  
  if (completed && completed.length > 0) {
    const correct = completed.filter(v => v.result === 'correct').length
    const incorrect = completed.filter(v => v.result === 'incorrect').length
    const push = completed.filter(v => v.result === 'push').length
    const accuracy = correct + incorrect > 0 ? ((correct / (correct + incorrect)) * 100).toFixed(1) : 0
    
    console.log(`\n🏒 NHL VALIDATION STATS:`)
    console.log(`   - Total Completed: ${completed.length}`)
    console.log(`   - Correct: ${correct}`)
    console.log(`   - Incorrect: ${incorrect}`)
    console.log(`   - Push: ${push}`)
    console.log(`   - Accuracy: ${accuracy}%`)
  }
  
  console.log('\n💡 Check your /validation dashboard to see updated stats!\n')
}

forceValidateAllNHL().catch(console.error)


