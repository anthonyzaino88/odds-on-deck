// Script to validate all pending props that are ready
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import stat fetchers
const { getPlayerGameStat: getMLBStat } = require('../lib/vendors/mlb-game-stats.js')
const { getPlayerGameStat: getNFLStat } = require('../lib/vendors/nfl-game-stats.js')
const { getPlayerGameStat: getNHLStat } = require('../lib/vendors/nhl-game-stats.js')

async function validatePendingProps() {
  try {
    console.log('🔍 Starting prop validation...\n')
    
    // Get all pending validations
    const pendingValidations = await prisma.propValidation.findMany({
      where: { status: 'pending' },
      orderBy: { timestamp: 'desc' }
    })
    
    console.log(`📊 Found ${pendingValidations.length} pending validations\n`)
    
    if (pendingValidations.length === 0) {
      console.log('✅ No pending validations!')
      return
    }
    
    let updated = 0
    let skipped = 0
    let errors = 0
    
    for (const validation of pendingValidations) {
      try {
        // Get the game
        const game = await prisma.game.findFirst({
          where: {
            OR: [
              { id: validation.gameIdRef },
              { mlbGameId: validation.gameIdRef },
              { espnGameId: validation.gameIdRef }
            ]
          }
        })
        
        if (!game) {
          console.log(`⏭️  Skipping ${validation.playerName} - No game found`)
          skipped++
          continue
        }
        
        // Check if game is final
        const gameDate = new Date(game.date || game.ts || game.commence_time)
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(23, 59, 59, 999)
        
        const isFinal = 
          ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
          (gameDate < yesterday)
        
        if (!isFinal) {
          // Game not finished yet
          skipped++
          continue
        }
        
        console.log(`\n🔍 Validating: ${validation.playerName} ${validation.propType} ${validation.prediction} ${validation.threshold}`)
        console.log(`   Game: ${game.homeTeam} vs ${game.awayTeam}`)
        
        // Determine sport and fetch stats
        const sport = validation.sport || game.sport || 'mlb'
        let actualValue = null
        
        if (sport === 'mlb') {
          if (!game.mlbGameId) {
            console.log(`   ⚠️  No mlbGameId - marking for review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no mlbGameId available.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          console.log(`   📊 Fetching MLB stats from game ${game.mlbGameId}...`)
          actualValue = await getMLBStat(game.mlbGameId, validation.playerName, validation.propType)
        } else if (sport === 'nfl') {
          if (!game.espnGameId) {
            console.log(`   ⚠️  No espnGameId - marking for review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no espnGameId available.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          console.log(`   📊 Fetching NFL stats from game ${game.espnGameId}...`)
          actualValue = await getNFLStat(game.espnGameId, validation.playerName, validation.propType)
        } else if (sport === 'nhl') {
          if (!game.espnGameId) {
            console.log(`   ⚠️  No espnGameId - marking for review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no espnGameId available.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          console.log(`   📊 Fetching NHL stats from game ${game.espnGameId}...`)
          actualValue = await getNHLStat(game.espnGameId, validation.playerName, validation.propType)
        }
        
        if (actualValue === null || actualValue === undefined) {
          console.log(`   ⚠️  Stat not available - marking for review`)
          await prisma.propValidation.update({
            where: { id: validation.id },
            data: {
              status: 'needs_review',
              notes: `Game finished but stat not available from API.`,
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
        
        console.log(`   📈 Actual value: ${actualValue} (predicted ${validation.prediction} ${validation.threshold})`)
        console.log(`   ${result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'} Result: ${result.toUpperCase()}`)
        
        // Update validation
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
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`)
        errors++
      }
    }
    
    console.log('\n\n=== VALIDATION COMPLETE ===')
    console.log(`✅ Updated: ${updated}`)
    console.log(`⏭️  Skipped (not ready): ${skipped}`)
    console.log(`❌ Errors: ${errors}`)
    console.log(`📊 Remaining pending: ${skipped - errors}`)
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

validatePendingProps()

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import stat fetchers
const { getPlayerGameStat: getMLBStat } = require('../lib/vendors/mlb-game-stats.js')
const { getPlayerGameStat: getNFLStat } = require('../lib/vendors/nfl-game-stats.js')
const { getPlayerGameStat: getNHLStat } = require('../lib/vendors/nhl-game-stats.js')

async function validatePendingProps() {
  try {
    console.log('🔍 Starting prop validation...\n')
    
    // Get all pending validations
    const pendingValidations = await prisma.propValidation.findMany({
      where: { status: 'pending' },
      orderBy: { timestamp: 'desc' }
    })
    
    console.log(`📊 Found ${pendingValidations.length} pending validations\n`)
    
    if (pendingValidations.length === 0) {
      console.log('✅ No pending validations!')
      return
    }
    
    let updated = 0
    let skipped = 0
    let errors = 0
    
    for (const validation of pendingValidations) {
      try {
        // Get the game
        const game = await prisma.game.findFirst({
          where: {
            OR: [
              { id: validation.gameIdRef },
              { mlbGameId: validation.gameIdRef },
              { espnGameId: validation.gameIdRef }
            ]
          }
        })
        
        if (!game) {
          console.log(`⏭️  Skipping ${validation.playerName} - No game found`)
          skipped++
          continue
        }
        
        // Check if game is final
        const gameDate = new Date(game.date || game.ts || game.commence_time)
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(23, 59, 59, 999)
        
        const isFinal = 
          ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
          (gameDate < yesterday)
        
        if (!isFinal) {
          // Game not finished yet
          skipped++
          continue
        }
        
        console.log(`\n🔍 Validating: ${validation.playerName} ${validation.propType} ${validation.prediction} ${validation.threshold}`)
        console.log(`   Game: ${game.homeTeam} vs ${game.awayTeam}`)
        
        // Determine sport and fetch stats
        const sport = validation.sport || game.sport || 'mlb'
        let actualValue = null
        
        if (sport === 'mlb') {
          if (!game.mlbGameId) {
            console.log(`   ⚠️  No mlbGameId - marking for review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no mlbGameId available.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          console.log(`   📊 Fetching MLB stats from game ${game.mlbGameId}...`)
          actualValue = await getMLBStat(game.mlbGameId, validation.playerName, validation.propType)
        } else if (sport === 'nfl') {
          if (!game.espnGameId) {
            console.log(`   ⚠️  No espnGameId - marking for review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no espnGameId available.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          console.log(`   📊 Fetching NFL stats from game ${game.espnGameId}...`)
          actualValue = await getNFLStat(game.espnGameId, validation.playerName, validation.propType)
        } else if (sport === 'nhl') {
          if (!game.espnGameId) {
            console.log(`   ⚠️  No espnGameId - marking for review`)
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but no espnGameId available.`,
                completedAt: new Date()
              }
            })
            updated++
            continue
          }
          
          console.log(`   📊 Fetching NHL stats from game ${game.espnGameId}...`)
          actualValue = await getNHLStat(game.espnGameId, validation.playerName, validation.propType)
        }
        
        if (actualValue === null || actualValue === undefined) {
          console.log(`   ⚠️  Stat not available - marking for review`)
          await prisma.propValidation.update({
            where: { id: validation.id },
            data: {
              status: 'needs_review',
              notes: `Game finished but stat not available from API.`,
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
        
        console.log(`   📈 Actual value: ${actualValue} (predicted ${validation.prediction} ${validation.threshold})`)
        console.log(`   ${result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'} Result: ${result.toUpperCase()}`)
        
        // Update validation
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
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`)
        errors++
      }
    }
    
    console.log('\n\n=== VALIDATION COMPLETE ===')
    console.log(`✅ Updated: ${updated}`)
    console.log(`⏭️  Skipped (not ready): ${skipped}`)
    console.log(`❌ Errors: ${errors}`)
    console.log(`📊 Remaining pending: ${skipped - errors}`)
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

validatePendingProps()

