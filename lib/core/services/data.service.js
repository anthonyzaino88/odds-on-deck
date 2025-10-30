/**
 * Data Service
 * 
 * Central orchestrator for all application data.
 * This replaces the monolithic data-manager.js (568 lines → ~150 lines)
 * 
 * Responsibilities:
 * - Coordinate data fetching from multiple sources
 * - Apply caching strategy
 * - Manage refresh logic
 * - Return unified data structure
 */

import { prisma } from '../database/prisma.js'
import { GamesRepository } from '../database/repositories/games.repository.js'
import { PropsRepository } from '../database/repositories/props.repository.js'
import { PropsService } from './props.service.js'
import { OddsService } from './odds.service.js'
import { CacheService } from './cache.service.js'
import { generateEditorPicks } from '../../../lib/picks.js' // Legacy import

export class DataService {
  constructor() {
    this.gamesRepo = new GamesRepository(prisma)
    this.propsRepo = new PropsRepository(prisma)
    this.propsService = new PropsService()
    this.oddsService = new OddsService()
    this.cacheService = new CacheService()
    
    this.lastRefresh = null
    this.refreshInterval = 30000 // 30 seconds
    this.isRefreshing = false
  }

  /**
   * Get all application data
   * This is the single source of truth
   */
  async getAllData() {
    try {
      console.log('📊 DataService: Getting all application data...')
      
      // Check if refresh needed
      const shouldRefresh = this._shouldRefreshData()
      
      if (shouldRefresh) {
        console.log('🔄 DataService: Refreshing stale data...')
        await this._refreshAllData()
      }
      
      // Fetch all data in parallel
      const [mlbGames, nflGames, nhlGames, picks, playerProps] = await Promise.all([
        this.gamesRepo.getTodaysMLBGames(),
        this.gamesRepo.getThisWeeksNFLGames(),
        this.gamesRepo.getTodaysNHLGames(),
        generateEditorPicks(), // TODO: Move to PicksService
        this._getPlayerProps()
      ])
      
      console.log(`✅ DataService: Loaded ${mlbGames.length} MLB, ${nflGames.length} NFL, ${nhlGames.length} NHL, ${picks.length} picks, ${playerProps.length} props`)
      
      return {
        mlbGames,
        nflGames,
        nhlGames,
        picks: picks.slice(0, 3), // Top 3
        playerProps,
        lastUpdated: this.lastRefresh || new Date(),
        isStale: shouldRefresh
      }
      
    } catch (error) {
      console.error('❌ DataService: Error getting data:', error)
      throw error
    }
  }

  /**
   * Force refresh all data
   */
  async forceRefresh(bypassCooldown = false) {
    console.log('⚡ DataService: Force refresh requested')
    
    // Check cooldown
    if (!bypassCooldown && !this._canRefresh()) {
      console.log('⏳ DataService: Refresh cooldown active')
      return {
        success: false,
        error: 'Refresh cooldown active',
        data: await this.getAllData()
      }
    }
    
    this.lastRefresh = null // Force refresh
    await this._refreshAllData()
    return await this.getAllData()
  }

  /**
   * Get data freshness status
   */
  getStatus() {
    return {
      lastRefresh: this.lastRefresh,
      isRefreshing: this.isRefreshing,
      isStale: this._shouldRefreshData()
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Check if data needs refresh
   */
  _shouldRefreshData() {
    if (!this.lastRefresh) return true
    
    const timeSinceRefresh = Date.now() - this.lastRefresh.getTime()
    const isStale = timeSinceRefresh > this.refreshInterval
    
    // Also check if new day
    const lastRefreshDate = new Date(this.lastRefresh)
    const today = new Date()
    const isNewDay = lastRefreshDate.toDateString() !== today.toDateString()
    
    return isStale || isNewDay
  }

  /**
   * Check if refresh is allowed (cooldown check)
   */
  _canRefresh() {
    if (!this.lastRefresh) return true
    
    const cooldownMinutes = 60 // 1 hour
    const timeSinceRefresh = Date.now() - this.lastRefresh.getTime()
    const minutesSinceRefresh = Math.floor(timeSinceRefresh / (1000 * 60))
    
    return minutesSinceRefresh >= cooldownMinutes
  }

  /**
   * Refresh all data from external sources
   */
  async _refreshAllData() {
    if (this.isRefreshing) {
      console.log('⏳ DataService: Refresh already in progress')
      return
    }
    
    this.isRefreshing = true
    
    try {
      console.log('🔄 DataService: Starting comprehensive refresh...')
      
      // 1. Clean up caches
      await this.cacheService.cleanupOldCaches()
      
      // 2. Refresh schedules and teams
      await this.oddsService.refreshSchedulesAndTeams()
      
      // 3. Refresh odds
      await this.oddsService.refreshOdds()
      
      // 4. Refresh live data (if games in progress)
      await this._refreshLiveData()
      
      this.lastRefresh = new Date()
      console.log('✅ DataService: Refresh completed')
      
    } catch (error) {
      console.error('❌ DataService: Refresh failed:', error)
    } finally {
      this.isRefreshing = false
    }
  }

  /**
   * Get player props (with caching)
   */
  async _getPlayerProps() {
    const useRealOdds = process.env.USE_REAL_PROP_ODDS === 'true'
    
    if (!useRealOdds) {
      console.log('📊 DataService: Using model-based props (no cache)')
      return await this.propsService.generateModelBasedProps()
    }
    
    // Check cache for each sport
    const [mlbCache, nflCache, nhlCache] = await Promise.all([
      this.cacheService.getCachedProps('mlb'),
      this.cacheService.getCachedProps('nfl'),
      this.cacheService.getCachedProps('nhl')
    ])
    
    // If all needed caches are fresh, use them
    const canUseCache = 
      mlbCache.hasFreshCache &&
      nflCache.hasFreshCache &&
      nhlCache.hasFreshCache
    
    if (canUseCache) {
      console.log(`✅ DataService: Using cached props`)
      return [
        ...mlbCache.props,
        ...nflCache.props,
        ...nhlCache.props
      ]
    }
    
    // Fetch fresh props
    console.log('🔄 DataService: Fetching fresh props from API')
    const props = await this.propsService.generatePropsWithRealOdds()
    
    // Cache them
    if (props && props.length > 0) {
      await this.cacheService.cacheProps(props)
    }
    
    return props
  }

  /**
   * Refresh live game data
   */
  async _refreshLiveData() {
    // Check for live games
    const liveGames = await this.gamesRepo.getLiveGames()
    
    if (liveGames.length === 0) {
      console.log('⏭️ DataService: No live games, skipping live refresh')
      return
    }
    
    console.log(`🏈 DataService: Refreshing ${liveGames.length} live games`)
    
    // Refresh live data by sport
    const liveSports = [...new Set(liveGames.map(g => g.sport))]
    
    for (const sport of liveSports) {
      try {
        // TODO: Move to LiveDataService
        if (sport === 'mlb') {
          const { fetchAndStoreLiveGameData } = await import('../../../lib/live-data.js')
          await fetchAndStoreLiveGameData()
        } else if (sport === 'nfl') {
          const { fetchAndStoreNFLLiveData } = await import('../../../lib/nfl-data.js')
          await fetchAndStoreNFLLiveData()
        }
      } catch (error) {
        console.error(`❌ DataService: Error refreshing ${sport} live data:`, error)
      }
    }
  }
}

// Singleton instance
let dataServiceInstance = null

export function getDataService() {
  if (!dataServiceInstance) {
    dataServiceInstance = new DataService()
  }
  return dataServiceInstance
}


