// Database utilities - SUPABASE VERSION
// This replaces lib/db.js with Supabase client instead of Prisma

import { supabase } from './supabase.js'
import crypto from 'crypto'

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

// ============================================
// TEAM OPERATIONS
// ============================================

export async function upsertTeam(teamData) {
  try {
    const { data, error } = await supabase
      .from('Team')
      .upsert({
        id: teamData.id,
        name: teamData.name,
        abbr: teamData.abbr,
        sport: teamData.sport,
        league: teamData.league,
        division: teamData.division,
        parkFactor: teamData.parkFactor,
        last10Record: teamData.last10Record || null,
        avgPointsLast10: teamData.avgPointsLast10 || null,
        avgPointsAllowedLast10: teamData.avgPointsAllowedLast10 || null,
        homeRecord: teamData.homeRecord || null,
        awayRecord: teamData.awayRecord || null
      }, {
        onConflict: 'id',
        ignoreDuplicates: false
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  } catch (error) {
    // Handle duplicate abbr (find and update existing)
    if (error.code === '23505' && error.message.includes('abbr')) {
      console.log(`Team with abbr ${teamData.abbr} already exists, finding and updating...`)
      
      const { data: existingTeam } = await supabase
        .from('Team')
        .select('*')
        .eq('abbr', teamData.abbr)
        .single()
      
      if (existingTeam) {
        const { data, error: updateError } = await supabase
          .from('Team')
          .update({
            name: teamData.name,
            sport: teamData.sport,
            parkFactor: teamData.parkFactor,
            last10Record: teamData.last10Record,
            avgPointsLast10: teamData.avgPointsLast10,
            avgPointsAllowedLast10: teamData.avgPointsAllowedLast10,
            homeRecord: teamData.homeRecord,
            awayRecord: teamData.awayRecord
          })
          .eq('id', existingTeam.id)
          .select()
          .single()
        
        if (updateError) throw updateError
        return data
      }
    }
    throw error
  }
}

// ============================================
// PLAYER OPERATIONS
// ============================================

export async function upsertPlayer(playerData) {
  const { data, error } = await supabase
    .from('Player')
    .upsert({
      id: playerData.id,
      fullName: playerData.fullName,
      bats: playerData.bats,
      throws: playerData.throws,
      teamId: playerData.teamId,
      isPitcher: playerData.isPitcher,
      position: playerData.position,
      battingOrder: playerData.battingOrder,
      jerseyNumber: playerData.jerseyNumber,
      avgRest: playerData.avgRest,
      lastGameDate: playerData.lastGameDate
    }, {
      onConflict: 'id'
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

// ============================================
// GAME OPERATIONS
// ============================================

export async function upsertGame(gameData) {
  try {
    const { data, error} = await supabase
      .from('Game')
      .upsert({
        id: gameData.id,
        sport: gameData.sport,
        mlbGameId: gameData.mlbGameId,
        espnGameId: gameData.espnGameId,
        date: gameData.date,
        homeId: gameData.homeId,
        awayId: gameData.awayId,
        probableHomePitcherId: gameData.probableHomePitcherId,
        probableAwayPitcherId: gameData.probableAwayPitcherId,
        homeStartingQB: gameData.homeStartingQB,
        awayStartingQB: gameData.awayStartingQB,
        status: gameData.status,
        week: gameData.week,
        season: gameData.season,
        homeScore: gameData.homeScore,
        awayScore: gameData.awayScore,
        inning: gameData.inning,
        inningHalf: gameData.inningHalf,
        outs: gameData.outs,
        balls: gameData.balls,
        strikes: gameData.strikes,
        runnerOn1st: gameData.runnerOn1st,
        runnerOn2nd: gameData.runnerOn2nd,
        runnerOn3rd: gameData.runnerOn3rd,
        currentBatterId: gameData.currentBatterId,
        currentPitcherId: gameData.currentPitcherId,
        lastPlay: gameData.lastPlay,
        lastUpdate: gameData.lastUpdate,
        temperature: gameData.temperature,
        windSpeed: gameData.windSpeed,
        windDirection: gameData.windDirection,
        humidity: gameData.humidity,
        precipitation: gameData.precipitation,
        oddsApiEventId: gameData.oddsApiEventId
      }, {
        onConflict: 'id'
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  } catch (error) {
    // Handle foreign key constraint errors for team IDs
    if (error.code === '23503') {
      console.error(`Foreign key constraint error for game ${gameData.id}:`, error.message)
      throw error
    }
    throw error
  }
}

// ============================================
// ODDS OPERATIONS
// ============================================

export async function createOdds(oddsData) {
  // Filter out invalid fields
  const { sport, selection, odds, ...validFields } = oddsData
  
  const { data, error } = await supabase
    .from('Odds')
    .insert({
      id: generateId(),
      ...validFields
    })
    .select()
    .single()
  
  if (error && error.code !== '23505') throw error // Ignore duplicates
  return data
}

// ============================================
// EDGE SNAPSHOT OPERATIONS
// ============================================

export async function createEdgeSnapshot(snapshotData) {
  const { data, error } = await supabase
    .from('EdgeSnapshot')
    .insert({
      id: generateId(),
      ...snapshotData
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

// ============================================
// QUERY HELPERS
// ============================================

export async function getTodaysGames() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  const { data, error } = await supabase
    .from('Game')
    .select(`
      *,
      home:Team!Game_homeId_fkey(*),
      away:Team!Game_awayId_fkey(*)
    `)
    .gte('date', today.toISOString())
    .lt('date', tomorrow.toISOString())
    .order('date', { ascending: true })
  
  if (error) throw error
  return data
}

export async function getGameDetail(gameId) {
  // Get basic game data
  const { data, error } = await supabase
    .from('Game')
    .select(`
      *,
      home:Team!Game_homeId_fkey(*),
      away:Team!Game_awayId_fkey(*),
      probableHomePitcher:Player!Game_probableHomePitcherId_fkey(*),
      probableAwayPitcher:Player!Game_probableAwayPitcherId_fkey(*)
    `)
    .eq('id', gameId)
    .single()
  
  if (error) throw error
  
  // Get odds for this game
  const { data: odds } = await supabase
    .from('Odds')
    .select('*')
    .eq('gameId', gameId)
    .order('ts', { ascending: false })
  
  // Get edge snapshots for this game  
  const { data: edgeSnapshots } = await supabase
    .from('EdgeSnapshot')
    .select('*')
    .eq('gameId', gameId)
    .order('ts', { ascending: false })
  
  // Get NFL-specific data if applicable
  let nflData = null
  if (data.sport === 'nfl') {
    const { data: nflGameData, error: nflError } = await supabase
      .from('NFLGameData')
      .select('*')
      .eq('gameId', gameId)
      .maybeSingle() // Use maybeSingle() to return null if no row found
    
    if (!nflError && nflGameData) {
      nflData = nflGameData
    }
  }
  
  // Get lineups if available (MLB)
  const { data: lineups } = await supabase
    .from('LineupEntry')
    .select(`
      *,
      player:Player(*)
    `)
    .eq('gameId', gameId)
    .order('battingOrder')
  
  return {
    ...data,
    odds: odds || [],
    edges: edgeSnapshots || [], // Alias for backward compatibility
    edgeSnapshots: edgeSnapshots || [],
    nflData,
    lineups: lineups || []
  }
}

export async function getPlayersForDFS() {
  const { data, error } = await supabase
    .from('Player')
    .select(`
      *,
      team:Team(*)
    `)
    .order('fullName')
  
  if (error) throw error
  return data
}

// ============================================
// CLEANUP OPERATIONS
// ============================================

export async function cleanupOldOdds(daysToKeep = 7) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)
  
  const { error } = await supabase
    .from('Odds')
    .delete()
    .lt('ts', cutoffDate.toISOString())
  
  if (error) throw error
}

export async function cleanupOldEdgeSnapshots(daysToKeep = 30) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)
  
  const { error } = await supabase
    .from('EdgeSnapshot')
    .delete()
    .lt('ts', cutoffDate.toISOString())
  
  if (error) throw error
}

// ============================================
// DATABASE CONNECTION HELPERS
// ============================================

export async function checkDatabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('Team')
      .select('count')
      .limit(1)
    
    if (error) throw error
    return true
  } catch (error) {
    console.error('Database connection check failed:', error)
    return false
  }
}

// No-op for Supabase (connections are managed automatically)
export async function disconnectDatabase() {
  console.log('Supabase connections are managed automatically')
}

// Export supabase client for direct use if needed
export { supabase }

