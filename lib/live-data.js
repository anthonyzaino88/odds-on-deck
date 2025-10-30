// Live data service for fetching real MLB lineups and player stats

import { fetchGameLineup, fetchPlayerStats, fetchTeamRoster, fetchLiveGameData } from './vendors/stats.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Fetch and store live lineups for all games
 */
export async function fetchAndStoreLiveLineups() {
  console.log('Fetching live lineups...')
  
  try {
    // Get all games that have MLB game IDs
    const games = await prisma.game.findMany({
      where: {
        mlbGameId: { not: null },
        status: { in: ['scheduled', 'pre_game', 'pre-game', 'warmup', 'in_progress'] }
      }
    })
    
    let totalPlayersAdded = 0
    
    for (const game of games) {
      try {
        console.log(`Fetching lineup for game ${game.id} (MLB: ${game.mlbGameId})`)
        
        // Fetch the lineup from MLB API
        const lineups = await fetchGameLineup(game.mlbGameId).catch(err => {
          console.warn(`⚠️ Skipping lineup for game ${game.id}: ${err.message}`)
          return null
        })
        
        if (!lineups) continue // Skip if lineup fetch failed
        
        // Process home team lineup
        if (lineups.home && lineups.home.length > 0) {
          totalPlayersAdded += await storePlayersAndStats(lineups.home, game.homeId)
          await storeBattingLineup(lineups.home, game.id, 'home')
        }
        
        // Process away team lineup
        if (lineups.away && lineups.away.length > 0) {
          totalPlayersAdded += await storePlayersAndStats(lineups.away, game.awayId)
          await storeBattingLineup(lineups.away, game.id, 'away')
        }
        
        // Small delay to be respectful to MLB API
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`Failed to fetch lineup for game ${game.id}:`, error)
      }
    }
    
    console.log(`Live lineup fetch completed. Added/updated ${totalPlayersAdded} players.`)
    return { success: true, playersAdded: totalPlayersAdded }
    
  } catch (error) {
    console.error('Error in fetchAndStoreLiveLineups:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Store batting lineup information (1-9 batting order)
 */
async function storeBattingLineup(lineup, gameId, team) {
  try {
    // Clear existing lineup for this game and team
    await prisma.lineup.deleteMany({
      where: {
        gameId: gameId,
        team: team
      }
    })
    
    // Store the new lineup
    for (const player of lineup) {
      if (player.battingOrder) { // Only store players with batting order
        await prisma.lineup.create({
          data: {
            gameId: gameId,
            playerId: player.id,
            team: team,
            battingOrder: player.battingOrder,
            position: player.position || null,
            isStarting: true
          }
        })
      }
    }
    
    console.log(`  Stored ${team} batting lineup for game ${gameId}`)
  } catch (error) {
    console.error(`Error storing batting lineup for ${team} team:`, error)
  }
}

/**
 * Store players and their stats in the database
 */
async function storePlayersAndStats(lineup, teamId) {
  let playersProcessed = 0
  
  for (const player of lineup) {
    try {
      // Check if player already exists
      const existingPlayer = await prisma.player.findUnique({
        where: { id: player.id }
      })
      
      if (!existingPlayer) {
        // Create new player
        await prisma.player.create({
          data: {
            id: player.id,
            fullName: player.fullName,
            bats: player.bats,
            throws: player.throws,
            teamId: teamId,
            isPitcher: player.isPitcher || false
          }
        })
        
        console.log(`  Added player: ${player.fullName}`)
        playersProcessed++
      } else {
        // Update existing player with current team
        await prisma.player.update({
          where: { id: player.id },
          data: {
            teamId: teamId,
            bats: player.bats || existingPlayer.bats,
            throws: player.throws || existingPlayer.throws
          }
        })
        
        console.log(`  Updated player: ${player.fullName}`)
        playersProcessed++
      }
      
      // Fetch and store current season stats
      if (!player.isPitcher) { // Only fetch hitter stats for now
        await fetchAndStorePlayerStats(player.id)
      }
      
      // Small delay between player API calls
      await new Promise(resolve => setTimeout(resolve, 50))
      
    } catch (error) {
      console.error(`Failed to store player ${player.fullName}:`, error)
    }
  }
  
  return playersProcessed
}

/**
 * Fetch and store player stats including splits
 */
async function fetchAndStorePlayerStats(playerId) {
  try {
    const stats = await fetchPlayerStats(playerId)
    
    if (stats && stats.length > 0) {
      // Delete existing splits for this player/season
      const currentYear = new Date().getFullYear()
      await prisma.splitStat.deleteMany({
        where: {
          playerId: playerId,
          season: currentYear
        }
      })
      
      // Insert new splits
      for (const split of stats) {
        const seasonInt = Number(split.season) || currentYear
        await prisma.splitStat.create({
          data: {
            playerId: playerId,
            season: seasonInt,
            vsHand: split.vsHand, // Already converted in mapping
            wOBA: split.wOBA,
            ISO: split.ISO,
            kRate: split.kRate,
            bbRate: split.bbRate,
            xwOBA: split.xwOBA,
            samplePA: split.samplePA,
            scope: split.scope
          }
        })
      }
      
      console.log(`  Stored stats for player ${playerId}`)
    }
  } catch (error) {
    console.error(`Failed to fetch/store stats for player ${playerId}:`, error)
  }
}

/**
 * Clean up old/stale player data
 */
/**
 * Backfill current rosters for teams in today's games
 */
export async function backfillCurrentRosters() {
  try {
    console.log('Backfilling current rosters...')
    
    // First, clear old player-team relationships for today's teams
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const games = await prisma.game.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
      select: { homeId: true, awayId: true }
    })
    
    const teamIds = [...new Set(games.flatMap(g => [g.homeId, g.awayId]))]
    
    // Clear existing team assignments for these teams to avoid stale data
    console.log('Clearing old team assignments...')
    await prisma.player.updateMany({
      where: {
        teamId: { in: teamIds }
      },
      data: {
        teamId: null // Temporarily clear team assignments
      }
    })
    
    let playersAdded = 0
    let playersUpdated = 0
    
    for (const teamId of teamIds) {
      try {
        console.log(`Fetching current roster for team ${teamId}`)
        const roster = await fetchTeamRoster(teamId)
        
        for (const player of roster) {
          const existing = await prisma.player.findUnique({ 
            where: { id: player.id } 
          })
          
          if (!existing) {
            await prisma.player.create({
              data: {
                id: player.id,
                fullName: player.fullName,
                bats: player.bats,
                throws: player.throws,
                teamId: teamId,
                isPitcher: player.isPitcher || false
              }
            })
            playersAdded++
            console.log(`  Added player: ${player.fullName} to team ${teamId}`)
          } else {
            // Always update team assignment and other data
            await prisma.player.update({
              where: { id: player.id },
              data: {
                teamId: teamId,
                bats: player.bats || existing.bats,
                throws: player.throws || existing.throws,
                fullName: player.fullName || existing.fullName
              }
            })
            playersUpdated++
            console.log(`  Updated player: ${player.fullName} -> Team ${teamId}`)
          }
        }
        
        // Small delay between teams
        await new Promise(resolve => setTimeout(resolve, 200))
        
      } catch (error) {
        console.error(`Failed to fetch roster for team ${teamId}:`, error)
      }
    }
    
    console.log(`Roster backfill completed. Added: ${playersAdded}, Updated: ${playersUpdated}`)
    return { success: true, playersAdded: playersAdded + playersUpdated }
    
  } catch (error) {
    console.error('Error in backfillCurrentRosters:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Force refresh all current rosters (for debugging stale data)
 */
export async function forceRefreshAllRosters() {
  try {
    console.log('Force refreshing all current rosters...')
    
    // Get all MLB teams
    const teams = await prisma.team.findMany({
      select: { id: true, name: true, abbr: true }
    })
    
    console.log(`Found ${teams.length} teams to process`)
    
    if (teams.length === 0) {
      console.log('No teams found in database')
      return { success: true, playersAdded: 0, message: 'No teams found' }
    }
    
    // Clear ALL team assignments to start fresh
    console.log('Clearing all team assignments...')
    const clearResult = await prisma.player.updateMany({
      data: { teamId: null }
    })
    console.log(`Cleared team assignments for ${clearResult.count} players`)
    
    let totalPlayersAdded = 0
    let totalPlayersUpdated = 0
    let teamsProcessed = 0
    
    for (const team of teams) {
      try {
        console.log(`Processing team ${teamsProcessed + 1}/${teams.length}: ${team.name} (${team.abbr})`)
        const roster = await fetchTeamRoster(team.id)
        
        console.log(`  Found ${roster.length} players in roster`)
        
        for (const player of roster) {
          try {
            const existing = await prisma.player.findUnique({ 
              where: { id: player.id } 
            })
            
            if (!existing) {
              await prisma.player.create({
                data: {
                  id: player.id,
                  fullName: player.fullName,
                  bats: player.bats,
                  throws: player.throws,
                  teamId: team.id,
                  isPitcher: player.isPitcher || false
                }
              })
              totalPlayersAdded++
              console.log(`    Added: ${player.fullName} to ${team.abbr}`)
            } else {
              await prisma.player.update({
                where: { id: player.id },
                data: {
                  teamId: team.id,
                  bats: player.bats || existing.bats,
                  throws: player.throws || existing.throws,
                  fullName: player.fullName || existing.fullName
                }
              })
              totalPlayersUpdated++
              console.log(`    Updated: ${player.fullName} -> ${team.abbr}`)
            }
          } catch (playerError) {
            console.error(`    Error processing player ${player.fullName}:`, playerError)
          }
        }
        
        teamsProcessed++
        
        // Small delay between teams
        await new Promise(resolve => setTimeout(resolve, 300))
        
      } catch (error) {
        console.error(`Failed to fetch roster for ${team.name}:`, error)
        teamsProcessed++
      }
    }
    
    console.log(`Force refresh completed. Teams processed: ${teamsProcessed}, Added: ${totalPlayersAdded}, Updated: ${totalPlayersUpdated}`)
    return { 
      success: true, 
      playersAdded: totalPlayersAdded + totalPlayersUpdated,
      teamsProcessed,
      playersAdded: totalPlayersAdded,
      playersUpdated: totalPlayersUpdated
    }
    
  } catch (error) {
    console.error('Error in forceRefreshAllRosters:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Fetch and store live game data (scores, innings, game state)
 */
export async function fetchAndStoreLiveGameData() {
  console.log('Fetching live game data...')
  
  try {
    // Get all active games
    const games = await prisma.game.findMany({
      where: {
        mlbGameId: { not: null },
        status: { in: ['scheduled', 'pre_game', 'in_progress', 'warmup'] }
      }
    })
    
    let gamesUpdated = 0
    
    for (const game of games) {
      try {
        console.log(`Fetching live data for game ${game.id} (MLB: ${game.mlbGameId})`)
        
        // Fetch live game data from MLB API
        const liveData = await fetchLiveGameData(game.mlbGameId).catch(err => {
          console.warn(`⚠️ Skipping game ${game.id}: ${err.message}`)
          return null
        })
        
        if (liveData) {
          // Only update status if the game has actually started or finished
          // Don't overwrite 'scheduled' or 'pre-game' with incorrect statuses
          const updateData = {
            homeScore: liveData.homeScore,
            awayScore: liveData.awayScore,
            inning: liveData.inning,
            inningHalf: liveData.inningHalf,
            outs: liveData.outs,
            balls: liveData.balls,
            strikes: liveData.strikes,
            lastPlay: liveData.lastPlay,
            lastUpdate: liveData.lastUpdate,
            runnerOn1st: liveData.runnerOn1st,
            runnerOn2nd: liveData.runnerOn2nd,
            runnerOn3rd: liveData.runnerOn3rd,
            currentBatterId: liveData.currentBatterId,
            currentPitcherId: liveData.currentPitcherId,
          }
          
          // Only update status if it's a meaningful change (game started or finished)
          if (liveData.status === 'in_progress' || liveData.status === 'final' || liveData.status === 'warmup') {
            updateData.status = liveData.status
          }
          
          await prisma.game.update({
            where: { id: game.id },
            data: updateData
          })
          
          gamesUpdated++
          console.log(`  Updated live data: ${liveData.awayScore}-${liveData.homeScore} ${liveData.inningHalf ? `${liveData.inningHalf} ${liveData.inning}` : ''}`)
        }
        
        // Small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`Failed to fetch live data for game ${game.id}:`, error)
      }
    }
    
    console.log(`Live game data fetch completed. Updated ${gamesUpdated} games.`)
    return { success: true, gamesUpdated }
    
  } catch (error) {
    console.error('Error in fetchAndStoreLiveGameData:', error)
    return { success: false, error: error.message }
  }
}

export async function cleanupPlayerData() {
  try {
    // Remove players that haven't been active recently
    // For MVP, we'll just clean up splits older than current season
    const currentYear = new Date().getFullYear()
    
    const deleted = await prisma.splitStat.deleteMany({
      where: {
        season: { lt: currentYear }
      }
    })
    
    console.log(`Cleaned up ${deleted.count} old split stats`)
    return { success: true, deletedSplits: deleted.count }
    
  } catch (error) {
    console.error('Error cleaning up player data:', error)
    return { success: false, error: error.message }
  }
}
