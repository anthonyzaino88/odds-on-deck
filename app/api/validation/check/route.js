// API endpoint to check and update completed prop validations

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'
import { getPlayerGameStat as getMLBStat } from '../../../../lib/vendors/mlb-game-stats.js'
import { getPlayerGameStat as getNFLStat } from '../../../../lib/vendors/nfl-game-stats.js'
import { getPlayerGameStat as getNHLStat } from '../../../../lib/vendors/nhl-game-stats.js'

export async function POST(request) {
  try {
    console.log('🔍 Checking completed prop validations...')
    
    // Get all pending validations
    const pendingValidations = await prisma.propValidation.findMany({
      where: { status: 'pending' }
    })
    
    console.log(`📊 Found ${pendingValidations.length} pending validations`)
    
    let updated = 0
    let errors = 0
    
    for (const validation of pendingValidations) {
      try {
        // Get the game to check if it's finished
        const game = await prisma.game.findFirst({
          where: {
            OR: [
              { id: validation.gameIdRef },
              { mlbGameId: validation.gameIdRef }
            ]
          }
        })
        
        if (!game) {
          console.log(`⚠️ Game not found for validation ${validation.id}`)
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
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no mlbGameId available. Manual verification needed.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          actualValue = await getMLBStat(game.mlbGameId, validation.playerName, validation.propType)
        } else if (sport === 'nfl') {
          // For NFL, we need the espnGameId
          if (!game.espnGameId) {
            console.warn(`⚠️ No espnGameId for game ${game.id}, marking for manual review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no espnGameId available. Manual verification needed.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          actualValue = await getNFLStat(game.espnGameId, validation.playerName, validation.propType)
        } else if (sport === 'nhl') {
          // For NHL, we need the espnGameId
          if (!game.espnGameId) {
            console.warn(`⚠️ No espnGameId for game ${game.id}, marking for manual review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no espnGameId available. Manual verification needed.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          actualValue = await getNHLStat(game.espnGameId, validation.playerName, validation.propType)
        }
        
        // If we couldn't get the stat, mark for manual review
        if (actualValue === null || actualValue === undefined) {
          console.warn(`⚠️ Could not fetch stat for ${validation.playerName} ${validation.propType}`)
          await prisma.propValidation.update({
            where: { id: validation.id },
            data: {
              status: 'needs_review',
              notes: `Game finished but stat not available from API. Manual verification needed.`,
              completedAt: new Date()
            }
          })
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
        await prisma.propValidation.update({
          where: { id: validation.id },
          data: {
            actualValue,
            result,
            status: 'completed',
            completedAt: new Date(),
            notes: `Auto-validated: ${validation.prediction.toUpperCase()} ${validation.threshold} → Actual: ${actualValue}`
          }
        })
        
        updated++
        
        const resultEmoji = result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'
        console.log(`${resultEmoji} ${validation.playerName} ${validation.propType}: ${result} (${actualValue} vs ${validation.threshold})`)
        
      } catch (error) {
        console.error(`❌ Error processing validation ${validation.id}:`, error)
        errors++
      }
    }
    
    console.log(`🎯 Validation check complete: ${updated} updated, ${errors} errors`)
    
    return NextResponse.json({
      success: true,
      message: `Checked ${pendingValidations.length} validations`,
      updated,
      errors,
      remaining: pendingValidations.length - updated - errors
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
    const pending = await prisma.propValidation.count({
      where: { status: 'pending' }
    })
    
    const completed = await prisma.propValidation.count({
      where: { status: 'completed' }
    })
    
    const correct = await prisma.propValidation.count({
      where: { 
        status: 'completed',
        result: 'correct'
      }
    })
    
    return NextResponse.json({
      success: true,
      pending,
      completed,
      correct,
      accuracy: completed > 0 ? (correct / completed) : 0
    })
    
  } catch (error) {
    console.error('❌ Error getting validation stats:', error)
    return NextResponse.json(
      { error: 'Failed to get stats', details: error.message },
      { status: 500 }
    )
  }
}

