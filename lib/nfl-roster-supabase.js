// NFL Roster and Depth Chart Management - SUPABASE VERSION
// This replaces lib/nfl-roster.js with Supabase client instead of Prisma

import { fetchAllESPNRosters, fetchESPNTeamRoster } from './vendors/espn-nfl-roster.js'
import { supabase } from './supabase.js'
import { upsertTeam, upsertPlayer } from './db-supabase.js'
import crypto from 'crypto'

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

// Team name mapping
function getTeamName(abbr) {
  const teamNames = {
    'ari': 'Arizona Cardinals', 'atl': 'Atlanta Falcons', 'bal': 'Baltimore Ravens', 'buf': 'Buffalo Bills',
    'car': 'Carolina Panthers', 'chi': 'Chicago Bears', 'cin': 'Cincinnati Bengals', 'cle': 'Cleveland Browns',
    'dal': 'Dallas Cowboys', 'den': 'Denver Broncos', 'det': 'Detroit Lions', 'gb': 'Green Bay Packers',
    'hou': 'Houston Texans', 'ind': 'Indianapolis Colts', 'jax': 'Jacksonville Jaguars', 'kc': 'Kansas City Chiefs',
    'lv': 'Las Vegas Raiders', 'lac': 'Los Angeles Chargers', 'lar': 'Los Angeles Rams', 'mia': 'Miami Dolphins',
    'min': 'Minnesota Vikings', 'ne': 'New England Patriots', 'no': 'New Orleans Saints', 'nyg': 'New York Giants',
    'nyj': 'New York Jets', 'phi': 'Philadelphia Eagles', 'pit': 'Pittsburgh Steelers', 'sf': 'San Francisco 49ers',
    'sea': 'Seattle Seahawks', 'tb': 'Tampa Bay Buccaneers', 'ten': 'Tennessee Titans', 'was': 'Washington Commanders'
  }
  return teamNames[abbr.toLowerCase()] || abbr.toUpperCase()
}

// Position groups for depth chart organization
export const NFL_POSITION_GROUPS = {
  offense: {
    QB: ['QB'],
    RB: ['RB', 'FB'],
    WR: ['WR1', 'WR2', 'WR3', 'WR4', 'WR5'],
    TE: ['TE1', 'TE2'],
    OL: ['LT', 'LG', 'C', 'RG', 'RT']
  },
  defense: {
    DL: ['DE1', 'DT1', 'DT2', 'DE2'],
    LB: ['OLB1', 'MLB1', 'MLB2', 'OLB2'],
    DB: ['CB1', 'FS', 'SS', 'CB2', 'NCB']
  },
  special: {
    ST: ['K', 'P', 'LS', 'KR', 'PR']
  }
}

/**
 * Fetch and store NFL team rosters from ESPN API
 */
export async function fetchAndStoreNFLRosters(season = '2025') {
  try {
    console.log(`🏈 Fetching LIVE NFL rosters from ESPN API for ${season} season...`)
    
    // Fetch all team rosters from ESPN
    const allRosters = await fetchAllESPNRosters()
    
    if (!allRosters || Object.keys(allRosters).length === 0) {
      console.log('No roster data received from ESPN')
      return { success: false, message: 'No roster data received' }
    }
    
    let totalPlayersAdded = 0
    let teamsProcessed = 0
    
    // Process each team's roster
    for (const [teamAbbr, roster] of Object.entries(allRosters)) {
      try {
        console.log(`  📡 Processing roster for ${teamAbbr.toUpperCase()}...`)
        
        // Find or create team using Supabase helper
        const team = await upsertTeam({
          abbr: teamAbbr.toUpperCase(),
          name: getTeamName(teamAbbr),
          sport: 'nfl'
        })
        
        // Clear existing NFL roster entries for this team
        const { error: deleteError } = await supabase
          .from('NFLRosterEntry')
          .delete()
          .eq('teamId', team.id)
          .eq('season', season)
        
        if (deleteError) {
          console.warn(`    ⚠️  Error clearing old roster entries: ${deleteError.message}`)
        }
        
        // Add players from ESPN roster
        for (const [position, players] of Object.entries(roster)) {
          for (const playerData of players) {
            if (playerData.status === 'Active') {
              // Create or find player using Supabase helper
              const playerId = `${team.id}_${playerData.name.replace(/\s+/g, '_')}`
              
              const player = await upsertPlayer({
                id: playerId,
                fullName: playerData.name,
                position: playerData.position,
                jerseyNumber: playerData.jersey ? parseInt(playerData.jersey) : null,
                teamId: team.id,
                isPitcher: false
              })
              
              // Create NFL roster entry
              const { error: rosterError } = await supabase
                .from('NFLRosterEntry')
                .insert({
                  id: generateId(),
                  playerId: player.id,
                  teamId: team.id,
                  season: season,
                  positionGroup: position,
                  specificPosition: playerData.position,
                  depthOrder: 1, // Assume all ESPN players are starters for now
                  isActive: true,
                  injuryStatus: playerData.injuryStatus || 'healthy'
                })
              
              if (rosterError && rosterError.code !== '23505') {
                // Ignore duplicate errors
                console.warn(`    ⚠️  Error creating roster entry for ${playerData.name}: ${rosterError.message}`)
              } else {
                totalPlayersAdded++
              }
            }
          }
        }
        
        teamsProcessed++
        console.log(`    ✅ Processed ${teamAbbr.toUpperCase()} roster (${Object.values(roster).flat().length} players)`)
        
      } catch (error) {
        console.error(`  ❌ Error processing roster for ${teamAbbr}:`, error.message)
      }
    }
    
    console.log(`✅ NFL Rosters Updated:`)
    console.log(`   • Teams processed: ${teamsProcessed}`)
    console.log(`   • Players added: ${totalPlayersAdded}`)
    
    return {
      success: true,
      teamsProcessed,
      totalPlayersAdded,
      message: `Processed ${teamsProcessed} teams with ${totalPlayersAdded} players`
    }
    
  } catch (error) {
    console.error('❌ Error fetching NFL rosters:', error.message)
    return { success: false, message: error.message }
  }
}

/**
 * Get team roster with depth chart
 */
export async function getTeamRoster(teamId, season = '2025') {
  try {
    const { data: rosterEntries, error } = await supabase
      .from('NFLRosterEntry')
      .select(`
        *,
        player:Player(*),
        team:Team(*)
      `)
      .eq('teamId', teamId)
      .eq('season', season)
      .eq('isActive', true)
      .order('positionGroup', { ascending: true })
      .order('specificPosition', { ascending: true })
      .order('depthOrder', { ascending: true })
    
    if (error) throw error
    
    // Group by position
    const depthChart = {}
    
    rosterEntries?.forEach(entry => {
      if (!depthChart[entry.positionGroup]) {
        depthChart[entry.positionGroup] = {}
      }
      if (!depthChart[entry.positionGroup][entry.specificPosition]) {
        depthChart[entry.positionGroup][entry.specificPosition] = []
      }
      
      depthChart[entry.positionGroup][entry.specificPosition].push({
        ...entry.player,
        depthOrder: entry.depthOrder,
        injuryStatus: entry.injuryStatus,
        specificPosition: entry.specificPosition
      })
    })
    
    return depthChart
    
  } catch (error) {
    console.error('Error getting team roster:', error)
    return {}
  }
}

/**
 * Get starting lineup for a game
 */
export async function getGameStarters(gameId) {
  try {
    // Get game with teams
    const { data: game, error: gameError } = await supabase
      .from('Game')
      .select(`
        *,
        home:Team!Game_homeId_fkey(*),
        away:Team!Game_awayId_fkey(*)
      `)
      .eq('id', gameId)
      .single()
    
    if (gameError || !game) {
      console.error('Game not found:', gameError)
      return null
    }
    
    const homeStarters = await getTeamStarters(game.homeId)
    const awayStarters = await getTeamStarters(game.awayId)
    
    return {
      home: {
        team: game.home,
        starters: homeStarters
      },
      away: {
        team: game.away,
        starters: awayStarters
      }
    }
    
  } catch (error) {
    console.error('Error getting game starters:', error)
    return null
  }
}

/**
 * Get team starters (depth order 1)
 */
export async function getTeamStarters(teamId, season = '2025') {
  try {
    const { data: starters, error } = await supabase
      .from('NFLRosterEntry')
      .select(`
        *,
        player:Player(*)
      `)
      .eq('teamId', teamId)
      .eq('season', season)
      .eq('depthOrder', 1)
      .eq('isActive', true)
      .order('positionGroup', { ascending: true })
      .order('specificPosition', { ascending: true })
    
    if (error) throw error
    
    return (starters || []).map(entry => ({
      ...entry.player,
      position: entry.specificPosition,
      injuryStatus: entry.injuryStatus,
      jersey: entry.player?.jerseyNumber || entry.player?.jersey,
      fullName: entry.player?.fullName || entry.player?.name,
      experience: entry.player?.experience
    }))
    
  } catch (error) {
    console.error('Error getting team starters:', error)
    return []
  }
}

/**
 * Update player injury status
 */
export async function updatePlayerInjuryStatus(playerId, teamId, injuryStatus, season = '2025') {
  try {
    const { error } = await supabase
      .from('NFLRosterEntry')
      .update({ injuryStatus })
      .eq('playerId', playerId)
      .eq('teamId', teamId)
      .eq('season', season)
    
    if (error) throw error
    
    console.log(`Updated ${playerId} injury status to: ${injuryStatus}`)
    return { success: true }
    
  } catch (error) {
    console.error('Error updating injury status:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get injury report for a team
 */
export async function getTeamInjuryReport(teamId, season = '2025') {
  try {
    const { data: injuredPlayers, error } = await supabase
      .from('NFLRosterEntry')
      .select(`
        *,
        player:Player(*)
      `)
      .eq('teamId', teamId)
      .eq('season', season)
      .neq('injuryStatus', 'healthy')
      .order('positionGroup', { ascending: true })
      .order('depthOrder', { ascending: true })
    
    if (error) throw error
    
    return (injuredPlayers || []).map(entry => ({
      ...entry.player,
      position: entry.specificPosition,
      injuryStatus: entry.injuryStatus,
      depthOrder: entry.depthOrder,
      jersey: entry.player?.jerseyNumber || entry.player?.jersey,
      fullName: entry.player?.fullName || entry.player?.name
    }))
    
  } catch (error) {
    console.error('Error getting injury report:', error)
    return []
  }
}

export default {
  fetchAndStoreNFLRosters,
  getTeamRoster,
  getGameStarters,
  getTeamStarters,
  updatePlayerInjuryStatus,
  getTeamInjuryReport
}

