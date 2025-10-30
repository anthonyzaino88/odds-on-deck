// Player Props Cache Manager
// Reduces API calls by caching props in database

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

// Cache configuration
const CACHE_CONFIG = {
  // How long cached props are valid (in minutes)
  CACHE_DURATION_MINUTES: 30, // 30 minutes for prop odds
  
  // Props expire 1 hour before game time (too late to use stale odds)
  EXPIRE_BEFORE_GAME_MINUTES: 60
}

/**
 * Check if we have fresh cached props for today's games
 * @param {string} sport - 'mlb', 'nfl', or 'nhl'
 * @returns {Promise<{hasFreshCache: boolean, props: Array, cacheAge: number}>}
 */
export async function getCachedProps(sport) {
  try {
    const now = new Date()
    
    // Get today's date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Find cached props for this sport and today
    const cachedProps = await prisma.playerPropCache.findMany({
      where: {
        sport: sport,
        gameTime: {
          gte: today,
          lt: tomorrow
        },
        expiresAt: {
          gt: now // Not expired
        },
        isStale: false
      }
    })
    
    if (cachedProps.length === 0) {
      console.log(`📊 No fresh cached props found for ${sport.toUpperCase()}`)
      return {
        hasFreshCache: false,
        props: [],
        cacheAge: null
      }
    }
    
    // Calculate cache age
    const oldestProp = cachedProps.reduce((oldest, prop) => 
      prop.fetchedAt < oldest.fetchedAt ? prop : oldest
    , cachedProps[0])
    
    const cacheAgeMs = now - new Date(oldestProp.fetchedAt)
    const cacheAgeMinutes = Math.floor(cacheAgeMs / 60000)
    
    console.log(`✅ Found ${cachedProps.length} cached ${sport.toUpperCase()} props (${cacheAgeMinutes} minutes old)`)
    
    // Convert cached props to the format expected by the app
    const props = cachedProps.map(cached => ({
      id: cached.propId,
      gameId: cached.gameId,
      playerName: cached.playerName,
      team: cached.team,
      type: cached.type,
      pick: cached.pick,
      threshold: cached.threshold,
      odds: cached.odds,
      probability: cached.probability,
      edge: cached.edge,
      confidence: cached.confidence,
      qualityScore: cached.qualityScore,
      sport: cached.sport,
      category: cached.category,
      reasoning: cached.reasoning,
      projection: cached.projection,
      bookmaker: cached.bookmaker,
      gameTime: cached.gameTime
    }))
    
    return {
      hasFreshCache: true,
      props,
      cacheAge: cacheAgeMinutes
    }
    
  } catch (error) {
    console.error('❌ Error checking prop cache:', error)
    return {
      hasFreshCache: false,
      props: [],
      cacheAge: null
    }
  }
}

/**
 * Store props in cache
 * @param {Array} props - Array of prop objects to cache
 * @returns {Promise<number>} Number of props cached
 */
export async function cacheProps(props) {
  try {
    if (!props || props.length === 0) {
      return 0
    }
    
    const now = new Date()
    const expiresAt = new Date(now.getTime() + CACHE_CONFIG.CACHE_DURATION_MINUTES * 60 * 1000)
    
    console.log(`💾 Caching ${props.length} props...`)
    
    let cachedCount = 0
    
    for (const prop of props) {
      try {
        // Calculate expiration (earlier of cache duration or game time)
        const gameTime = new Date(prop.gameTime)
        const gameExpiry = new Date(gameTime.getTime() - CACHE_CONFIG.EXPIRE_BEFORE_GAME_MINUTES * 60 * 1000)
        const finalExpiry = expiresAt < gameExpiry ? expiresAt : gameExpiry
        
        await prisma.playerPropCache.upsert({
          where: { propId: prop.id },
          create: {
            propId: prop.id,
            gameId: prop.gameId,
            playerName: prop.playerName,
            team: prop.team,
            type: prop.type,
            pick: prop.pick,
            threshold: prop.threshold,
            odds: prop.odds,
            probability: prop.probability,
            edge: prop.edge,
            confidence: prop.confidence,
            qualityScore: prop.qualityScore,
            sport: prop.sport,
            category: prop.category,
            reasoning: prop.reasoning,
            projection: prop.projection,
            bookmaker: prop.bookmaker,
            gameTime: new Date(prop.gameTime),
            fetchedAt: now,
            expiresAt: finalExpiry,
            isStale: false
          },
          update: {
            odds: prop.odds,
            probability: prop.probability,
            edge: prop.edge,
            confidence: prop.confidence,
            qualityScore: prop.qualityScore,
            reasoning: prop.reasoning,
            projection: prop.projection,
            bookmaker: prop.bookmaker,
            fetchedAt: now,
            expiresAt: finalExpiry,
            isStale: false
          }
        })
        
        cachedCount++
      } catch (error) {
        console.error(`Error caching prop ${prop.id}:`, error.message)
      }
    }
    
    console.log(`✅ Cached ${cachedCount} props (expires in ${CACHE_CONFIG.CACHE_DURATION_MINUTES} minutes)`)
    return cachedCount
    
  } catch (error) {
    console.error('❌ Error caching props:', error)
    return 0
  }
}

/**
 * Mark old props as stale
 * @returns {Promise<number>} Number of props marked stale
 */
export async function markStaleProps() {
  try {
    const now = new Date()
    
    const result = await prisma.playerPropCache.updateMany({
      where: {
        expiresAt: {
          lte: now
        },
        isStale: false
      },
      data: {
        isStale: true
      }
    })
    
    if (result.count > 0) {
      console.log(`🗑️ Marked ${result.count} props as stale`)
    }
    
    return result.count
    
  } catch (error) {
    console.error('❌ Error marking stale props:', error)
    return 0
  }
}

/**
 * Clean up old cached props
 * @param {number} daysOld - Delete props older than this many days
 * @returns {Promise<number>} Number of props deleted
 */
export async function cleanupOldProps(daysOld = 2) {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)
    
    const result = await prisma.playerPropCache.deleteMany({
      where: {
        gameTime: {
          lt: cutoffDate
        }
      }
    })
    
    if (result.count > 0) {
      console.log(`🗑️ Deleted ${result.count} old cached props (older than ${daysOld} days)`)
    }
    
    return result.count
    
  } catch (error) {
    console.error('❌ Error cleaning up old props:', error)
    return 0
  }
}

/**
 * Get cache statistics
 * @returns {Promise<object>} Cache stats
 */
export async function getCacheStats() {
  try {
    const now = new Date()
    
    const [total, fresh, stale] = await Promise.all([
      prisma.playerPropCache.count(),
      prisma.playerPropCache.count({
        where: {
          expiresAt: { gt: now },
          isStale: false
        }
      }),
      prisma.playerPropCache.count({
        where: {
          OR: [
            { expiresAt: { lte: now } },
            { isStale: true }
          ]
        }
      })
    ])
    
    return {
      total,
      fresh,
      stale,
      freshPercentage: total > 0 ? Math.round((fresh / total) * 100) : 0
    }
    
  } catch (error) {
    console.error('❌ Error getting cache stats:', error)
    return { total: 0, fresh: 0, stale: 0, freshPercentage: 0 }
  }
}

export default {
  getCachedProps,
  cacheProps,
  markStaleProps,
  cleanupOldProps,
  getCacheStats,
  CACHE_CONFIG
}

