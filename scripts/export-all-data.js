/**
 * Export ALL data from local SQLite database to JSON
 * This includes: Teams, Players, Games, Props, Parlays, and Validation data
 */

import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'

const prisma = new PrismaClient()

async function exportAllData() {
  try {
    console.log('📦 Exporting ALL data from local database...\n')
    
    const data = {}
    
    // 1. Export Teams
    console.log('🏟️  Exporting teams...')
    data.teams = await prisma.team.findMany()
    console.log(`   ✅ ${data.teams.length} teams\n`)
    
    // 2. Export Players
    console.log('👤 Exporting players...')
    data.players = await prisma.player.findMany()
    console.log(`   ✅ ${data.players.length} players\n`)
    
    // 3. Export Games
    console.log('🎮 Exporting games...')
    data.games = await prisma.game.findMany()
    console.log(`   ✅ ${data.games.length} games\n`)
    
    // 4. Export Odds
    console.log('📊 Exporting odds...')
    data.odds = await prisma.odds.findMany()
    console.log(`   ✅ ${data.odds.length} odds records\n`)
    
    // 5. Export PropValidation
    console.log('✅ Exporting prop validations...')
    data.propValidations = await prisma.propValidation.findMany()
    console.log(`   ✅ ${data.propValidations.length} prop validations\n`)
    
    // 6. Export Parlays
    console.log('🎲 Exporting parlays...')
    data.parlays = await prisma.parlay.findMany({
      include: {
        legs: true
      }
    })
    console.log(`   ✅ ${data.parlays.length} parlays\n`)
    
    // 7. Export SplitStats
    console.log('📈 Exporting split stats...')
    data.splitStats = await prisma.splitStat.findMany()
    console.log(`   ✅ ${data.splitStats.length} split stats\n`)
    
    // 8. Export PitchMix
    console.log('⚾ Exporting pitch mix data...')
    data.pitchMix = await prisma.pitchMix.findMany()
    console.log(`   ✅ ${data.pitchMix.length} pitch mix records\n`)
    
    // 9. Export Lineups
    console.log('📋 Exporting lineups...')
    data.lineups = await prisma.lineup.findMany()
    console.log(`   ✅ ${data.lineups.length} lineup records\n`)
    
    // Write to JSON file
    const jsonPath = path.join(process.cwd(), 'local-database-export.json')
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2))
    
    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📦 EXPORT COMPLETE!')
    console.log('='.repeat(60))
    console.log(`File: ${jsonPath}`)
    console.log(`\nSummary:`)
    console.log(`  - Teams:            ${data.teams.length}`)
    console.log(`  - Players:          ${data.players.length}`)
    console.log(`  - Games:            ${data.games.length}`)
    console.log(`  - Odds:             ${data.odds.length}`)
    console.log(`  - Prop Validations: ${data.propValidations.length}`)
    console.log(`  - Parlays:          ${data.parlays.length}`)
    console.log(`  - Split Stats:      ${data.splitStats.length}`)
    console.log(`  - Pitch Mix:        ${data.pitchMix.length}`)
    console.log(`  - Lineups:          ${data.lineups.length}`)
    console.log('='.repeat(60))
    
    // Calculate file size
    const stats = await fs.stat(jsonPath)
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
    console.log(`\n💾 File size: ${fileSizeMB} MB`)
    console.log(`\n✨ Next step: Upload this file to Vercel via API endpoint`)
    
  } catch (error) {
    console.error('❌ Error exporting data:', error)
  } finally {
    await prisma.$disconnect()
  }
}

exportAllData()

