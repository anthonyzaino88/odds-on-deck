// Centralized Data Manager - Single source of truth for all data
// Ensures fresh, consistent data across all pages

import { PrismaClient } from '@prisma/client'
import { generateEditorPicks } from './picks.js'
import { generatePlayerProps } from './player-props.js'
import { fetchAndStoreLiveGameData, fetchAndStoreLiveLineups } from './live-data.js'
import { fetchAndStoreNFLLiveData } from './nfl-data.js'
import { fetchOdds } from './vendors/odds.js'
import { createOdds } from './db.js'
import { getLiveScoringData, shouldUpdateLiveScoring } from './live-scoring-manager.js'

const prisma = new PrismaClient()

// Cache for data freshness tracking
const dataCache = {
  lastRefresh: null,
  refreshInterval: 30000, // 30 seconds
  isRefreshing: false
}

/**
 * Get all data needed for the application
 * This is the single source of truth for all pages
 */
export async function getAllData() {
  try {
    console.log('📊 Getting all application data...')
    
    // Check if we need to refresh data
    const shouldRefresh = shouldRefreshData()
    const shouldUpdateLive = shouldUpdateLiveScoring()
    
    if (shouldRefresh) {
      console.log('🔄 Data is stale or startup detected, refreshing...')
      await refreshAllData()
    }
    
    // Update live scoring for active games if needed
    if (shouldUpdateLive) {
      console.log('🏈 Updating live scoring for active games...')
      await getLiveScoringData()
    }
    
    // Fetch all data in parallel
    const [mlbGames, nflGames, picks, playerProps] = await Promise.all([
      getTodaysMLBGames(),
      getThisWeeksNFLGames(),
      generateEditorPicks(),
      generatePlayerProps()
    ])
    
    console.log(`✅ Data loaded: ${mlbGames.length} MLB, ${nflGames.length} NFL, ${picks.length} picks, ${playerProps.length} props`)
    
    return {
      mlbGames,
      nflGames,
      picks: picks.slice(0, 3), // Top 3 picks
      playerProps: playerProps, // All props (will be filtered by pages as needed)
      lastUpdated: dataCache.lastRefresh || new Date(),
      isStale: shouldRefresh
    }
    
  } catch (error) {
    console.error('❌ Error getting all data:', error)
    throw error
  }
}

/**
 * Check if data needs to be refreshed
 * Always refresh on startup to ensure fresh data
 */
function shouldRefreshData() {
  // Always refresh if no previous refresh (startup)
  if (!dataCache.lastRefresh) return true
  
  // Check if data is stale (older than refresh interval)
  const timeSinceLastRefresh = Date.now() - dataCache.lastRefresh.getTime()
  const isStale = timeSinceLastRefresh > dataCache.refreshInterval
  
  // Also check if data is from a previous day (force refresh for new day)
  const lastRefreshDate = new Date(dataCache.lastRefresh)
  const today = new Date()
  const isNewDay = lastRefreshDate.toDateString() !== today.toDateString()
  
  return isStale || isNewDay
}

/**
 * Refresh all data from external APIs
 */
async function refreshAllData() {
  if (dataCache.isRefreshing) {
    console.log('⏳ Refresh already in progress, skipping...')
    return
  }
  
  dataCache.isRefreshing = true
  
  try {
    console.log('🔄 Starting comprehensive data refresh...')
    
    // First, fetch fresh schedules and teams (foundation data)
    console.log('📅 Fetching fresh schedules and teams...')
    const scheduleResult = await refreshSchedulesAndTeams()
    
    // Then fetch odds (after games are in database)
    console.log('📊 Fetching odds for games...')
    const teamsResult = await refreshOdds()
    
    // Then refresh live data for existing games
    console.log('🏈 Refreshing live data for active games...')
    const [mlbLiveResult, nflLiveResult, lineupResult] = await Promise.allSettled([
      fetchAndStoreLiveGameData(),
      fetchAndStoreNFLLiveData(),
      fetchAndStoreLiveLineups()
    ])
    
    // Log results
    console.log(`✅ Schedules: ${scheduleResult.gamesAdded || 0} games, ${scheduleResult.teamsAdded || 0} teams`)
    console.log(`✅ Odds: ${teamsResult.oddsStored || 0} odds stored`)
    
    if (mlbLiveResult.status === 'fulfilled') {
      console.log(`✅ MLB live data: ${mlbLiveResult.value.gamesUpdated || 0} games updated`)
    }
    
    if (nflLiveResult.status === 'fulfilled') {
      console.log(`✅ NFL live data: ${nflLiveResult.value.gamesUpdated || 0} games updated`)
    }
    
    if (lineupResult.status === 'fulfilled') {
      console.log(`✅ Lineups: ${lineupResult.value.playersAdded || 0} players updated`)
    }
    
    dataCache.lastRefresh = new Date()
    console.log('🎯 Data refresh completed successfully')
    
  } catch (error) {
    console.error('❌ Error during data refresh:', error)
  } finally {
    dataCache.isRefreshing = false
  }
}

/**
 * Refresh schedules and teams from external APIs
 */
async function refreshSchedulesAndTeams() {
  try {
    console.log('📅 Refreshing schedules and teams...')
    
    // Import required functions
    const { fetchSchedule, fetchTeams } = await import('./vendors/stats.js')
    const { fetchNFLSchedule } = await import('./vendors/nfl-stats.js')
    const { upsertTeam, upsertGame } = await import('./db.js')
    
    let gamesAdded = 0
    let teamsAdded = 0
    
    // Fetch and upsert teams
    console.log('🏟️ Fetching teams...')
    const teams = await fetchTeams(true) // Force fresh data
    for (const team of teams) {
      try {
        await upsertTeam(team)
        teamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Upserted ${teamsAdded} teams`)
    
    // Fetch today's MLB schedule
    console.log('⚾ Fetching MLB schedule...')
    const mlbGames = await fetchSchedule({ useLocalDate: true, noCache: true })
    
    // First, create probable pitchers as players
    const { upsertPlayer } = await import('./db.js')
    for (const game of mlbGames) {
      if (game.probablePitchers?.home) {
        try {
          await upsertPlayer({
            id: game.probablePitchers.home.id,
            fullName: game.probablePitchers.home.fullName,
            throws: game.probablePitchers.home.throws,
            bats: game.probablePitchers.home.throws, // Assume same as throws for pitchers
            isPitcher: true,
            teamId: game.home.id
          })
        } catch (error) {
          // Skip duplicates
        }
      }
      if (game.probablePitchers?.away) {
        try {
          await upsertPlayer({
            id: game.probablePitchers.away.id,
            fullName: game.probablePitchers.away.fullName,
            throws: game.probablePitchers.away.throws,
            bats: game.probablePitchers.away.throws, // Assume same as throws for pitchers
            isPitcher: true,
            teamId: game.away.id
          })
        } catch (error) {
          // Skip duplicates
        }
      }
    }
    
    // Then create games
    for (const game of mlbGames) {
      try {
        // Transform nested objects to flat fields for database
        const transformedGame = {
          id: game.id,
          mlbGameId: game.mlbGameId,
          date: game.date,
          status: game.status,
          homeId: game.home.id,
          awayId: game.away.id,
          probableHomePitcherId: game.probablePitchers?.home?.id || null,
          probableAwayPitcherId: game.probablePitchers?.away?.id || null
        }
        await upsertGame(transformedGame)
        gamesAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Added ${mlbGames.length} MLB games`)
    
    // Fetch this week's NFL schedule
    console.log('🏈 Fetching NFL schedule...')
    const nflGames = await fetchNFLSchedule()
    for (const game of nflGames) {
      try {
        await upsertGame(game)
        gamesAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Added ${nflGames.length} NFL games`)
    
    return { gamesAdded, teamsAdded }
    
  } catch (error) {
    console.error('❌ Error refreshing schedules and teams:', error)
    return { gamesAdded: 0, teamsAdded: 0 }
  }
}

/**
 * Refresh odds data
 */
async function refreshOdds() {
  try {
    const [mlbOdds, nflOdds] = await Promise.all([
      fetchOdds('mlb'),
      fetchOdds('nfl')
    ])
    
    let oddsStored = 0
    
    // Store MLB odds
    for (const odds of mlbOdds) {
      try {
        await createOdds(odds)
        oddsStored++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    // Store NFL odds
    for (const odds of nflOdds) {
      try {
        await createOdds(odds)
        oddsStored++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    return { oddsStored }
    
  } catch (error) {
    console.error('❌ Error refreshing odds:', error)
    return { oddsStored: 0 }
  }
}

/**
 * Get today's MLB games with all related data
 */
async function getTodaysMLBGames() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayAfterTomorrow = new Date(today)
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
  
  return await prisma.game.findMany({
    where: {
      date: { gte: today, lt: dayAfterTomorrow },
      sport: 'mlb'
    },
    include: {
      home: true,
      away: true,
      lineups: {
        include: { player: true },
        orderBy: [{ team: 'asc' }, { battingOrder: 'asc' }]
      },
      odds: {
        orderBy: { ts: 'desc' },
        take: 1
      },
      edges: {
        orderBy: { ts: 'desc' },
        take: 1
      },
      probableHomePitcher: true,
      probableAwayPitcher: true
    },
    orderBy: { date: 'asc' }
  })
}

/**
 * Get this week's NFL games with all related data
 */
async function getThisWeeksNFLGames() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay()) // Start of week
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7) // End of week
  
  return await prisma.game.findMany({
    where: {
      date: { gte: weekStart, lt: weekEnd },
      sport: 'nfl'
    },
    include: {
      home: true,
      away: true,
      nflData: true,
      odds: {
        orderBy: { ts: 'desc' },
        take: 1
      },
      edges: {
        orderBy: { ts: 'desc' },
        take: 1
      }
    },
    orderBy: { date: 'asc' }
  })
}

/**
 * Force refresh all data (for manual refresh buttons)
 */
export async function forceRefreshAllData() {
  console.log('⚡ Force refreshing all data...')
  dataCache.lastRefresh = null // Force refresh
  await refreshAllData()
  return await getAllData()
}

/**
 * Get data freshness status
 */
export function getDataStatus() {
  return {
    lastRefresh: dataCache.lastRefresh,
    isRefreshing: dataCache.isRefreshing,
    isStale: shouldRefreshData()
  }
}

/**
 * Initialize data manager on startup
 * Ensures fresh data is loaded when the application starts
 */
export async function initializeDataManager() {
  console.log('🚀 Initializing data manager on startup...')
  
  // Reset cache to force fresh data on startup
  dataCache.lastRefresh = null
  dataCache.isRefreshing = false
  
  // Force refresh all data
  await refreshAllData()
  
  console.log('✅ Data manager initialized with fresh data')
}
