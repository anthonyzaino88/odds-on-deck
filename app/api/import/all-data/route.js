// Import ALL data from local database export
// POST with JSON data from local export

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    const data = await request.json()
    
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid data format. Expected an object with tables.' 
      }, { status: 400 })
    }
    
    console.log('📦 Starting full database import...')
    const results = {}
    
    // 1. Import Teams (must be first - other tables depend on it)
    if (data.teams && Array.isArray(data.teams)) {
      console.log(`\n🏟️  Importing ${data.teams.length} teams...`)
      results.teams = { total: data.teams.length, imported: 0, skipped: 0 }
      for (const team of data.teams) {
        try {
          await prisma.team.upsert({
            where: { id: team.id },
            update: team,
            create: team,
          })
          results.teams.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping team ${team.id}: ${error.message}`)
          results.teams.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.teams.imported} teams`)
    }
    
    // 2. Import Players (depends on Teams)
    if (data.players && Array.isArray(data.players)) {
      console.log(`\n👤 Importing ${data.players.length} players...`)
      results.players = { total: data.players.length, imported: 0, skipped: 0 }
      for (const player of data.players) {
        try {
          await prisma.player.upsert({
            where: { id: player.id },
            update: player,
            create: player,
          })
          results.players.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping player ${player.id}: ${error.message}`)
          results.players.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.players.imported} players`)
    }
    
    // 3. Import Games (depends on Teams)
    if (data.games && Array.isArray(data.games)) {
      console.log(`\n🎮 Importing ${data.games.length} games...`)
      results.games = { total: data.games.length, imported: 0, skipped: 0 }
      for (const game of data.games) {
        try {
          await prisma.game.upsert({
            where: { id: game.id },
            update: { ...game, id: undefined }, // Don't update ID
            create: game,
          })
          results.games.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping game ${game.id}: ${error.message}`)
          results.games.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.games.imported} games`)
    }
    
    // 4. Import Odds (depends on Games)
    if (data.odds && Array.isArray(data.odds)) {
      console.log(`\n📊 Importing ${data.odds.length} odds...`)
      results.odds = { total: data.odds.length, imported: 0, skipped: 0 }
      for (const odd of data.odds) {
        try {
          // Remove fields that don't exist in Odds schema
          const { sport, selection, odds: oddsField, ...validOddData } = odd
          
          // Odds don't have a unique constraint, so we'll create them all
          await prisma.odds.create({
            data: validOddData
          })
          results.odds.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping odds record: ${error.message}`)
          results.odds.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.odds.imported} odds`)
    }
    
    // 5. Import PropValidations
    if (data.propValidations && Array.isArray(data.propValidations)) {
      console.log(`\n✅ Importing ${data.propValidations.length} prop validations...`)
      results.propValidations = { total: data.propValidations.length, imported: 0, skipped: 0 }
      for (const prop of data.propValidations) {
        try {
          await prisma.propValidation.upsert({
            where: { propId: prop.propId },
            update: { ...prop, id: undefined }, // Don't update ID
            create: prop,
          })
          results.propValidations.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping prop ${prop.propId}: ${error.message}`)
          results.propValidations.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.propValidations.imported} prop validations`)
    }
    
    // 6. Import Parlays (must come before ParlayLegs)
    if (data.parlays && Array.isArray(data.parlays)) {
      console.log(`\n🎲 Importing ${data.parlays.length} parlays...`)
      results.parlays = { total: data.parlays.length, imported: 0, skipped: 0 }
      results.parlayLegs = { total: 0, imported: 0, skipped: 0 }
      
      for (const parlay of data.parlays) {
        try {
          const { legs, ...parlayData } = parlay
          
          // Import parlay
          await prisma.parlay.upsert({
            where: { id: parlay.id },
            update: parlayData,
            create: parlayData,
          })
          results.parlays.imported++
          
          // Import legs
          if (legs && Array.isArray(legs)) {
            results.parlayLegs.total += legs.length
            for (const leg of legs) {
              try {
                await prisma.parlayLeg.create({
                  data: leg
                })
                results.parlayLegs.imported++
              } catch (error) {
                console.warn(`⚠️ Skipping leg: ${error.message}`)
                results.parlayLegs.skipped++
              }
            }
          }
        } catch (error) {
          console.warn(`⚠️ Skipping parlay ${parlay.id}: ${error.message}`)
          results.parlays.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.parlays.imported} parlays with ${results.parlayLegs.imported} legs`)
    }
    
    // 7. Import SplitStats (depends on Players)
    if (data.splitStats && Array.isArray(data.splitStats)) {
      console.log(`\n📈 Importing ${data.splitStats.length} split stats...`)
      results.splitStats = { total: data.splitStats.length, imported: 0, skipped: 0 }
      for (const stat of data.splitStats) {
        try {
          await prisma.splitStat.create({
            data: stat
          })
          results.splitStats.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping split stat: ${error.message}`)
          results.splitStats.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.splitStats.imported} split stats`)
    }
    
    // 8. Import PitchMix (depends on Players)
    if (data.pitchMix && Array.isArray(data.pitchMix)) {
      console.log(`\n⚾ Importing ${data.pitchMix.length} pitch mix records...`)
      results.pitchMix = { total: data.pitchMix.length, imported: 0, skipped: 0 }
      for (const pitch of data.pitchMix) {
        try {
          await prisma.pitchMix.create({
            data: pitch
          })
          results.pitchMix.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping pitch mix: ${error.message}`)
          results.pitchMix.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.pitchMix.imported} pitch mix records`)
    }
    
    // 9. Import Lineups (depends on Players and Games)
    if (data.lineups && Array.isArray(data.lineups)) {
      console.log(`\n📋 Importing ${data.lineups.length} lineups...`)
      results.lineups = { total: data.lineups.length, imported: 0, skipped: 0 }
      for (const lineup of data.lineups) {
        try {
          await prisma.lineup.create({
            data: lineup
          })
          results.lineups.imported++
        } catch (error) {
          console.warn(`⚠️ Skipping lineup: ${error.message}`)
          results.lineups.skipped++
        }
      }
      console.log(`   ✅ Imported ${results.lineups.imported} lineups`)
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('✅ DATABASE IMPORT COMPLETE!')
    console.log('='.repeat(60))
    
    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('❌ Error importing data:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}

export async function GET() {
  // Check current database state
  try {
    const counts = {
      teams: await prisma.team.count(),
      players: await prisma.player.count(),
      games: await prisma.game.count(),
      odds: await prisma.odds.count(),
      propValidations: await prisma.propValidation.count(),
      parlays: await prisma.parlay.count(),
      splitStats: await prisma.splitStat.count(),
      pitchMix: await prisma.pitchMix.count(),
      lineups: await prisma.lineup.count(),
    }
    
    return NextResponse.json({ 
      message: 'Import endpoint ready. Send POST request with JSON data.',
      currentDatabaseState: counts
    })
  } catch (error) {
    return NextResponse.json({ 
      message: 'Import endpoint ready. Send POST request with JSON data.',
      error: error.message
    })
  }
}

