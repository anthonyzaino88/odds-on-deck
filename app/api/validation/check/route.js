// API endpoint to check and update completed prop validations
// MIGRATED TO SUPABASE - No Prisma dependency

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase.js'
import { getPlayerGameStat as getMLBStat } from '../../../../lib/vendors/mlb-game-stats.js'
import { getPlayerGameStat as getNFLStat } from '../../../../lib/vendors/nfl-game-stats.js'
import { getPlayerGameStat as getNHLStat } from '../../../../lib/vendors/nhl-game-stats.js'

export async function POST(request) {
  try {
    console.log('🔍 Checking completed prop validations...')
    
    // Get all pending validations
    const { data: pendingValidations, error: fetchError } = await supabase
      .from('PropValidation')
      .select('*')
      .eq('status', 'pending')
    
    if (fetchError) throw fetchError
    
    console.log(`📊 Found ${pendingValidations?.length || 0} pending validations`)
    
    let updated = 0
    let errors = 0
    
    for (const validation of pendingValidations || []) {
      try {
        // Get the game to check if it's finished
        // Try multiple lookup strategies to find the game
        let game = null
        
        console.log(`🔍 Looking for game: ${validation.gameIdRef} (sport: ${validation.sport || 'unknown'})`)
        
        // First try by id
        const { data: gameById } = await supabase
          .from('Game')
          .select('*')
          .eq('id', validation.gameIdRef)
          .maybeSingle()
        
        if (gameById) {
          game = gameById
          console.log(`   ✅ Found by id`)
        } else {
          // Try by mlbGameId
          const { data: gameByMlbId } = await supabase
            .from('Game')
            .select('*')
            .eq('mlbGameId', validation.gameIdRef)
            .maybeSingle()
          
          if (gameByMlbId) {
            game = gameByMlbId
            console.log(`   ✅ Found by mlbGameId`)
          } else {
            // Try by espnGameId
            const { data: gameByEspnId } = await supabase
              .from('Game')
              .select('*')
              .eq('espnGameId', validation.gameIdRef)
              .maybeSingle()
            
            if (gameByEspnId) {
              game = gameByEspnId
              console.log(`   ✅ Found by espnGameId`)
            } else {
              // Try by oddsApiEventId
              const { data: gameByOddsId } = await supabase
                .from('Game')
                .select('*')
                .eq('oddsApiEventId', validation.gameIdRef)
                .maybeSingle()
              
              if (gameByOddsId) {
                game = gameByOddsId
                console.log(`   ✅ Found by oddsApiEventId`)
              }
            }
          }
        }
        
        // If still not found, try by sport-specific ID fields
        if (!game && validation.sport) {
          if (validation.sport === 'mlb') {
            const { data: mlbGame } = await supabase
              .from('Game')
              .select('*')
              .eq('mlbGameId', validation.gameIdRef)
              .eq('sport', 'mlb')
              .maybeSingle()
            
            if (mlbGame) {
              game = mlbGame
              console.log(`   ✅ Found by MLB sport-specific lookup`)
            }
          } else if (validation.sport === 'nhl' || validation.sport === 'nfl') {
            const { data: espnGame } = await supabase
              .from('Game')
              .select('*')
              .eq('espnGameId', validation.gameIdRef)
              .eq('sport', validation.sport)
              .maybeSingle()
            
            if (espnGame) {
              game = espnGame
              console.log(`   ✅ Found by ESPN sport-specific lookup`)
            }
          }
        }
        
        if (!game) {
          console.log(`⚠️ Game not found for validation ${validation.id} (gameIdRef: ${validation.gameIdRef}, sport: ${validation.sport || 'unknown'})`)
          // Mark as needs_review if game doesn't exist - might be deleted or invalid reference
          const { error: updateError } = await supabase
            .from('PropValidation')
            .update({
              status: 'needs_review',
              notes: `Game not found in database (gameIdRef: ${validation.gameIdRef}). Game may have been deleted or reference is invalid.`,
              completedAt: new Date().toISOString()
            })
            .eq('id', validation.id)
          
          if (updateError) throw updateError
          updated++
          continue
        }
        
        // Check if game is final
        // Either explicitly marked as final, OR game date was yesterday or earlier
        const gameDate = new Date(game.date || game.ts || game.commence_time)
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(23, 59, 59, 999)
        
        const isFinal = 
          ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
          (gameDate < yesterday) // If game was yesterday or earlier, it's done!
        
        if (!isFinal) {
          console.log(`⏳ Game ${game.id} not finished yet (${game.status}, date: ${gameDate.toLocaleDateString()})`)
          continue
        }
        
        console.log(`🏁 Game ${game.id} is final - fetching actual stats...`)
        
        // Determine sport and fetch stats accordingly
        const sport = validation.sport || game.sport || 'mlb'
        let actualValue = null
        
        if (sport === 'mlb') {
          // For MLB, we need the mlbGameId
          if (!game.mlbGameId) {
            console.warn(`⚠️ No mlbGameId for game ${game.id}, marking for manual review`)
            const { error: updateError } = await supabase
              .from('PropValidation')
              .update({
                status: 'needs_review',
                notes: `Game finished but no mlbGameId available. Manual verification needed.`,
                completedAt: new Date().toISOString()
              })
              .eq('id', validation.id)
            
            if (updateError) throw updateError
            updated++
            continue
          }
          
          actualValue = await getMLBStat(game.mlbGameId, validation.playerName, validation.propType)
        } else if (sport === 'nfl') {
          // For NFL, we need the espnGameId
          if (!game.espnGameId) {
            console.warn(`⚠️ No espnGameId for game ${game.id}, marking for manual review`)
            const { error: updateError } = await supabase
              .from('PropValidation')
              .update({
                status: 'needs_review',
                notes: `Game finished but no espnGameId available. Manual verification needed.`,
                completedAt: new Date().toISOString()
              })
              .eq('id', validation.id)
            
            if (updateError) throw updateError
            updated++
            continue
          }
          
          actualValue = await getNFLStat(game.espnGameId, validation.playerName, validation.propType)
        } else if (sport === 'nhl') {
          // For NHL, we need the espnGameId
          if (!game.espnGameId) {
            console.warn(`⚠️ No espnGameId for game ${game.id}, marking for manual review`)
            const { error: updateError } = await supabase
              .from('PropValidation')
              .update({
                status: 'needs_review',
                notes: `Game finished but no espnGameId available. Manual verification needed.`,
                completedAt: new Date().toISOString()
              })
              .eq('id', validation.id)
            
            if (updateError) throw updateError
            updated++
            continue
          }
          
          console.log(`📊 Fetching NHL stats for ${validation.playerName} (${validation.propType}) from game ${game.espnGameId}`)
          actualValue = await getNHLStat(game.espnGameId, validation.playerName, validation.propType)
        }
        
        // If we couldn't get the stat, mark for manual review
        if (actualValue === null || actualValue === undefined) {
          console.warn(`⚠️ Could not fetch stat for ${validation.playerName} ${validation.propType}`)
          const { error: updateError } = await supabase
            .from('PropValidation')
            .update({
              status: 'needs_review',
              notes: `Game finished but stat not available from API. Manual verification needed.`,
              completedAt: new Date().toISOString()
            })
            .eq('id', validation.id)
          
          if (updateError) throw updateError
          updated++
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
        
        // Update validation with result
        const { error: updateError } = await supabase
          .from('PropValidation')
          .update({
            actualValue,
            result,
            status: 'completed',
            completedAt: new Date().toISOString(),
            notes: `Auto-validated: ${validation.prediction.toUpperCase()} ${validation.threshold} → Actual: ${actualValue}`
          })
          .eq('id', validation.id)
        
        if (updateError) throw updateError
        
        updated++
        
        const resultEmoji = result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'
        console.log(`${resultEmoji} ${validation.playerName} ${validation.propType}: ${result} (${actualValue} vs ${validation.threshold}) - Status: completed, Result: ${result}`)
        
      } catch (error) {
        console.error(`❌ Error processing validation ${validation.id}:`, error)
        errors++
      }
    }
    
    console.log(`🎯 Validation check complete: ${updated} updated, ${errors} errors`)
    
    return NextResponse.json({
      success: true,
      message: `Checked ${pendingValidations?.length || 0} validations`,
      updated,
      errors,
      remaining: (pendingValidations?.length || 0) - updated - errors
    })
    
  } catch (error) {
    console.error('❌ Error checking validations:', error)
    return NextResponse.json(
      { error: 'Failed to check validations', details: error.message },
      { status: 500 }
    )
  }
}

export async function GET(request) {
  // Just return current validation stats
  try {
    const { count: pending } = await supabase
      .from('PropValidation')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
    
    const { count: completed } = await supabase
      .from('PropValidation')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
    
    const { count: correct } = await supabase
      .from('PropValidation')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .eq('result', 'correct')
    
    return NextResponse.json({
      success: true,
      pending: pending || 0,
      completed: completed || 0,
      correct: correct || 0,
      accuracy: (completed || 0) > 0 ? ((correct || 0) / completed) : 0
    })
    
  } catch (error) {
    console.error('❌ Error getting validation stats:', error)
    return NextResponse.json(
      { error: 'Failed to get stats', details: error.message },
      { status: 500 }
    )
  }
}

