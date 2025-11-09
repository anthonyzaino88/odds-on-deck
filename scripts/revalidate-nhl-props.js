import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { getPlayerGameStat } from '../lib/vendors/nhl-game-stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function revalidateNHLProps() {
  console.log('\n🔄 REVALIDATING NHL PROPS\n')
  console.log('='.repeat(80))
  
  // Get all NHL validations marked as "needs_review" with final games
  const { data: needsReview, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .eq('status', 'needs_review')
  
  console.log(`\nFound ${needsReview?.length || 0} NHL props marked as "needs_review"`)
  
  if (!needsReview || needsReview.length === 0) {
    console.log('✅ No props to revalidate!')
    return
  }
  
  let updated = 0
  let stillNeedsReview = 0
  let errors = 0
  
  for (const validation of needsReview) {
    try {
      // Find the game
      const { data: game } = await supabase
        .from('Game')
        .select('*')
        .eq('id', validation.gameIdRef)
        .eq('sport', 'nhl')
        .maybeSingle()
      
      if (!game) {
        console.log(`⚠️ Game ${validation.gameIdRef} not found - skipping`)
        stillNeedsReview++
        continue
      }
      
      // Check if game is final
      const isFinal = ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase())
      
      if (!isFinal) {
        console.log(`⏳ Game ${game.id} not final yet (${game.status}) - skipping`)
        continue
      }
      
      console.log(`\n🏒 Revalidating: ${validation.playerName} - ${validation.propType}`)
      console.log(`   Game: ${game.id} (${game.status})`)
      console.log(`   ESPN Game ID: ${game.espnGameId}`)
      
      // Fetch the stat
      const actualValue = await getPlayerGameStat(game.espnGameId, validation.playerName, validation.propType)
      
      if (actualValue === null || actualValue === undefined) {
        console.log(`   ❌ Still can't fetch stat - keeping as needs_review`)
        stillNeedsReview++
        continue
      }
      
      // Determine result
      let result = 'incorrect'
      if (actualValue === validation.threshold) {
        result = 'push'
      } else if (
        (validation.prediction === 'over' && actualValue > validation.threshold) ||
        (validation.prediction === 'under' && actualValue < validation.threshold)
      ) {
        result = 'correct'
      }
      
      // Update validation
      const { error: updateError } = await supabase
        .from('PropValidation')
        .update({
          actualValue,
          result,
          status: 'completed',
          completedAt: new Date().toISOString(),
          notes: `Revalidated: ${validation.prediction.toUpperCase()} ${validation.threshold} → Actual: ${actualValue}`
        })
        .eq('id', validation.id)
      
      if (updateError) {
        console.log(`   ❌ Error updating: ${updateError.message}`)
        errors++
        continue
      }
      
      const resultEmoji = result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'
      console.log(`   ${resultEmoji} ${result.toUpperCase()}: ${actualValue} vs ${validation.threshold}`)
      updated++
      
    } catch (error) {
      console.error(`❌ Error processing ${validation.id}:`, error.message)
      errors++
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log(`\n✅ Revalidation complete!`)
  console.log(`   - Updated: ${updated}`)
  console.log(`   - Still needs review: ${stillNeedsReview}`)
  console.log(`   - Errors: ${errors}`)
  
  // Show updated stats
  const { data: completed } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .eq('status', 'completed')
  
  if (completed && completed.length > 0) {
    const correct = completed.filter(v => v.result === 'correct').length
    const incorrect = completed.filter(v => v.result === 'incorrect').length
    const accuracy = ((correct / (correct + incorrect)) * 100).toFixed(1)
    
    console.log(`\n📊 NHL Validation Stats:`)
    console.log(`   - Total Completed: ${completed.length}`)
    console.log(`   - Correct: ${correct}`)
    console.log(`   - Incorrect: ${incorrect}`)
    console.log(`   - Accuracy: ${accuracy}%`)
  }
}

revalidateNHLProps().catch(console.error)

