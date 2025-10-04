// Live NFL Roster Management with ESPN API

import { PrismaClient } from '@prisma/client'
import { fetchNFLOfficialRoster } from './vendors/nfl-official.js'

const prisma = new PrismaClient()

/**
 * Fetch and store LIVE NFL rosters from ESPN API
 */
export async function fetchAndStoreLiveNFLRosters() {
  try {
    console.log('🏈 Fetching LIVE NFL rosters from ESPN API for 2025 season...')
    
    let playersAdded = 0
    let rosterEntries = 0
    let teamsProcessed = 0
    
    // Get all NFL teams from database
    const teams = await prisma.team.findMany({
      where: { sport: 'nfl' }
    })
    
    console.log(`Found ${teams.length} NFL teams in database`)
    
    // Process each NFL team
    for (const team of teams) {
      try {
        console.log(`  📡 Fetching LIVE roster for ${team.name} (${team.abbr})...`)
        
        // Fetch live roster from ESPN API
        const liveRoster = await fetchNFLOfficialRoster(team.abbr.toLowerCase())
        
        if (!liveRoster) {
          console.log(`    ⚠️ No live roster data for ${team.abbr}, skipping...`)
          continue
        }
        
        teamsProcessed++
        
        // Process each position group from live data
        for (const [positionGroup, players] of Object.entries(liveRoster)) {
          for (let i = 0; i < players.length; i++) {
            const playerData = players[i]
            
            try {
              // Create unique player ID
              const playerId = `${team.id}_${playerData.name.replace(/\s+/g, '_').toLowerCase()}`
              
              // Create or update player with live data
              const player = await prisma.player.upsert({
                where: { id: playerId },
                update: {
                  fullName: playerData.name,
                  position: playerData.position || positionGroup,
                  jersey: playerData.jersey,
                  experience: playerData.experience,
                  teamId: team.id
                },
                create: {
                  id: playerId,
                  fullName: playerData.name,
                  position: playerData.position || positionGroup,
                  jersey: playerData.jersey,
                  experience: playerData.experience,
                  teamId: team.id
                }
              })
              
              playersAdded++
              
              // Create roster entry using correct unique constraint
              await prisma.nFLRosterEntry.upsert({
                where: {
                  playerId_teamId_season_specificPosition: {
                    playerId: player.id,
                    teamId: team.id,
                    season: '2025',
                    specificPosition: playerData.position || positionGroup
                  }
                },
                update: {
                  positionGroup: positionGroup,
                  depthOrder: i + 1,
                  injuryStatus: 'HEALTHY',
                  isActive: true,
                  week: 4
                },
                create: {
                  playerId: player.id,
                  teamId: team.id,
                  positionGroup: positionGroup,
                  specificPosition: playerData.position || positionGroup,
                  depthOrder: i + 1,
                  injuryStatus: 'HEALTHY',
                  isActive: true,
                  season: '2025',
                  week: 4
                }
              })
              
              rosterEntries++
              
            } catch (error) {
              console.error(`    ❌ Error processing ${playerData.name}:`, error.message)
            }
          }
        }
        
        console.log(`    ✅ Processed ${Object.keys(liveRoster).length} position groups`)
        
        // Rate limiting - wait between API calls
        await new Promise(resolve => setTimeout(resolve, 200))
        
      } catch (error) {
        console.error(`    ❌ Error processing ${team.name}:`, error.message)
      }
    }
    
    console.log('✅ LIVE NFL Rosters Updated:')
    console.log(`   • Teams processed: ${teamsProcessed}/${teams.length}`)
    console.log(`   • Players: ${playersAdded}`)
    console.log(`   • Roster entries: ${rosterEntries}`)
    
    return { success: true, teamsProcessed, playersAdded, rosterEntries }
    
  } catch (error) {
    console.error('❌ Error fetching LIVE NFL rosters:', error.message)
    return { success: false, error: error.message }
  } finally {
    await prisma.$disconnect()
  }
}

export default {
  fetchAndStoreLiveNFLRosters
}
