// Centralized Data Manager - Single source of truth for all data
// Ensures fresh, consistent data across all pages

import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })
import { generateEditorPicks } from './picks.js'
import { generatePlayerProps } from './player-props.js'
import { generatePlayerPropsWithRealOdds } from './player-props-enhanced.js'
import { fetchAndStoreLiveGameData, fetchAndStoreLiveLineups } from './live-data.js'
import { fetchAndStoreNFLLiveData } from './nfl-data.js'
import { fetchOdds } from './vendors/odds.js'
import { createOdds } from './db.js'
import { getLiveScoringData, shouldUpdateLiveScoring } from './live-scoring-manager.js'
import { getCachedProps, cacheProps, markStaleProps, cleanupOldProps } from './prop-cache-manager.js'
import { getTodaysGamesRange, logCurrentTime } from './date-utils.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

// Cache for data freshness tracking
const dataCache = {
  lastRefresh: null,
  refreshInterval: 5 * 60 * 1000, // 5 minutes (was 30 seconds - 90% reduction in calls!)
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
    // Use real odds if USE_REAL_PROP_ODDS environment variable is set
    const useRealPropOdds = process.env.USE_REAL_PROP_ODDS === 'true'
    
    const [mlbGames, nflGames, nhlGames, picks] = await Promise.all([
      getTodaysMLBGames(),
      getThisWeeksNFLGames(),
      getTodaysNHLGames(),
      generateEditorPicks()
    ])
    
    // Get player props with caching to reduce API calls
    let playerProps = []
    
    if (useRealPropOdds) {
      console.log('🎯 Fetching player props (checking cache first)...')
      
      // Check cache for all sports
      const [mlbCache, nflCache, nhlCache] = await Promise.all([
        getCachedProps('mlb'),
        getCachedProps('nfl'),
        getCachedProps('nhl')
      ])
      
      // If we have fresh cache for all active sports, use it
      const hasMLBGames = mlbGames.length > 0
      const hasNFLGames = nflGames.length > 0
      const hasNHLGames = nhlGames.length > 0
      
      // ✅ OPTIMIZATION: Check if we have ANY cached props (even if slightly stale)
      const hasCachedProps = 
        (mlbCache.props.length > 0) ||
        (nflCache.props.length > 0) ||
        (nhlCache.props.length > 0)
      
      // ✅ Be VERY aggressive with cache - use it if available (even if "stale")
      // Only fetch fresh if cache is completely empty
      if (hasCachedProps) {
        // Use cached props (even if marked as stale)
        playerProps = [
          ...mlbCache.props,
          ...nflCache.props,
          ...nhlCache.props
        ]
        const freshStatus = mlbCache.hasFreshCache && nflCache.hasFreshCache && nhlCache.hasFreshCache ? 'FRESH' : 'CACHED'
        console.log(`✅ Using ${freshStatus} player props: ${mlbCache.props.length} MLB, ${nflCache.props.length} NFL, ${nhlCache.props.length} NHL (no API call!)`)
        console.log(`⚡ Cache age: MLB ${mlbCache.cacheAge || 'N/A'}min, NFL ${nflCache.cacheAge || 'N/A'}min, NHL ${nhlCache.cacheAge || 'N/A'}min`)
      } else {
        // Only fetch if cache is completely empty
        console.log('🔄 No cached props found, fetching fresh from API...')
        playerProps = await generatePlayerPropsWithRealOdds()
        
        // Store in cache for next time
        if (playerProps && playerProps.length > 0) {
          await cacheProps(playerProps)
        }
      }
      
      // ✅ Status message based on whether we used cache or fetched fresh
      if (hasCachedProps && playerProps.length > 0) {
        console.log('✅ Using REAL player prop odds (from cache - no API call!)')
      } else {
        console.log('✅ Using REAL player prop odds from The Odds API')
      }
    } else {
      // Use model-based projections (no caching for these)
      playerProps = await generatePlayerProps()
      console.log('📊 Using model-based player prop projections')
    }
    
    console.log(`✅ Data loaded: ${mlbGames.length} MLB, ${nflGames.length} NFL, ${nhlGames.length} NHL, ${picks.length} picks, ${playerProps.length} props`)
    
    return {
      mlbGames,
      nflGames,
      nhlGames,
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
    
    // Clean up old cached props and mark stale ones
    console.log('🗑️ Cleaning up prop cache...')
    await markStaleProps()
    await cleanupOldProps(2) // Delete props from games 2+ days old
    
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
    const { fetchNFLSchedule, fetchNFLTeams } = await import('./vendors/nfl-stats.js')
    const { fetchNHLSchedule, fetchNHLTeams } = await import('./vendors/nhl-stats.js')
    const { upsertTeam, upsertGame } = await import('./db.js')
    
    let gamesAdded = 0
    let teamsAdded = 0
    
    // Fetch and upsert MLB teams
    console.log('🏟️ Fetching MLB teams...')
    const mlbTeams = await fetchTeams(true) // Force fresh data
    for (const team of mlbTeams) {
      try {
        await upsertTeam(team)
        teamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Upserted ${teamsAdded} MLB teams`)
    
    // Fetch and upsert NFL teams
    console.log('🏈 Fetching NFL teams...')
    const nflTeams = await fetchNFLTeams()
    let nflTeamsAdded = 0
    for (const team of nflTeams) {
      try {
        await upsertTeam(team)
        nflTeamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Upserted ${nflTeamsAdded} NFL teams`)
    
    // Fetch and upsert NHL teams
    console.log('🏒 Fetching NHL teams...')
    const nhlTeams = await fetchNHLTeams()
    let nhlTeamsAdded = 0
    for (const team of nhlTeams) {
      try {
        await upsertTeam(team)
        nhlTeamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Upserted ${nhlTeamsAdded} NHL teams`)
    
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
    
    // Fetch today's NHL schedule
    console.log('🏒 Fetching NHL schedule...')
    const nhlGames = await fetchNHLSchedule()
    for (const game of nhlGames) {
      try {
        await upsertGame(game)
        gamesAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Added ${nhlGames.length} NHL games`)
    
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
    const [mlbOdds, nflOdds, nhlOdds] = await Promise.all([
      fetchOdds('mlb'),
      fetchOdds('nfl'),
      fetchOdds('nhl')
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
    
    // Store NHL odds
    for (const odds of nhlOdds) {
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
 * Uses Eastern Time to determine "today"
 */
async function getTodaysMLBGames() {
  logCurrentTime()
  
  const { start, end } = getTodaysGamesRange()
  
  console.log(`🔍 MLB: Fetching games between ${start.toISOString()} and ${end.toISOString()}`)
  
  const games = await prisma.game.findMany({
    where: {
      date: { gte: start, lt: end },
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
  
  console.log(`✅ MLB: Found ${games.length} games`)
  return games
}

/**
 * Get this week's NFL games with all related data
 * Uses Eastern Time for week calculation
 */
async function getThisWeeksNFLGames() {
  const { start, end } = getTodaysGamesRange()
  
  // For NFL, extend to full week (Thursday through Monday)
  const weekStart = new Date(start)
  weekStart.setDate(weekStart.getDate() - 4) // Go back to Thursday
  const weekEnd = new Date(end)
  weekEnd.setDate(weekEnd.getDate() + 3) // Extend to Monday night
  
  console.log(`🔍 NFL: Fetching games between ${weekStart.toISOString()} and ${weekEnd.toISOString()}`)
  
  const games = await prisma.game.findMany({
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
  
  console.log(`✅ NFL: Found ${games.length} games`)
  return games
}

/**
 * Get today's NHL games with all related data
 * Uses Eastern Time to determine "today"
 */
async function getTodaysNHLGames() {
  const { start, end } = getTodaysGamesRange()
  
  console.log(`🔍 NHL: Fetching games between ${start.toISOString()} and ${end.toISOString()}`)
  
  const games = await prisma.game.findMany({
    where: {
      date: { gte: start, lt: end },
      sport: 'nhl'
    },
    include: {
      home: true,
      away: true,
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
  
  console.log(`✅ NHL: Found ${games.length} games`)
  return games
}

/**
 * Force refresh all data (for manual refresh buttons)
 * @param {boolean} bypassCooldown - Whether to bypass the cooldown check
 */
export async function forceRefreshAllData(bypassCooldown = false) {
  console.log('⚡ Force refreshing all data...')
  
  // Check if refresh is allowed based on cooldown
  if (!bypassCooldown) {
    const { canRefresh: isRefreshAllowed } = await import('./api-usage-manager.js').then(mod => mod.canRefresh())
    
    if (!isRefreshAllowed) {
      console.log('⏳ Refresh cooldown active, skipping refresh')
      return {
        success: false,
        error: 'Refresh cooldown active',
        data: await getAllData(false) // Get cached data
      }
    }
  }
  
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
