/**
 * Cache Service
 * 
 * Manages all caching operations for the application.
 * Currently handles player prop caching, can be extended for other caches.
 */

import { prisma } from '../database/prisma.js'
import { PropsRepository } from '../database/repositories/props.repository.js'

export class CacheService {
  constructor() {
    this.propsRepo = new PropsRepository(prisma)
    this.cacheDurationMinutes = 30
    this.expireBeforeGameMinutes = 60
  }

  /**
   * Get cached props for a sport
   */
  async getCachedProps(sport) {
    return await this.propsRepo.getCachedProps(sport, this.cacheDurationMinutes)
  }

  /**
   * Cache player props
   */
  async cacheProps(props) {
    console.log(`💾 CacheService: Caching ${props.length} props`)
    
    try {
      await this.propsRepo.cacheProps(props)
      console.log(`✅ CacheService: Successfully cached ${props.length} props`)
    } catch (error) {
      console.error('❌ CacheService: Error caching props:', error)
      // Don't throw - caching is non-critical
    }
  }

  /**
   * Clean up old caches
   */
  async cleanupOldCaches() {
    console.log('🗑️ CacheService: Cleaning up old caches...')
    
    try {
      // Mark stale props
      await this.propsRepo.markStaleProps()
      
      // Delete old props (2+ days old)
      const deleteResult = await this.propsRepo.cleanupOldProps(2)
      
      console.log(`✅ CacheService: Cleaned up ${deleteResult.count || 0} old props`)
    } catch (error) {
      console.error('❌ CacheService: Error cleaning up caches:', error)
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    return await this.propsRepo.getCacheStats()
  }

  /**
   * Invalidate cache for a sport
   */
  async invalidateCache(sport) {
    console.log(`🔄 CacheService: Invalidating ${sport} cache`)
    
    try {
      await prisma.playerPropCache.updateMany({
        where: { sport },
        data: { isStale: true }
      })
      
      console.log(`✅ CacheService: Invalidated ${sport} cache`)
    } catch (error) {
      console.error('❌ CacheService: Error invalidating cache:', error)
    }
  }

  /**
   * Clear all caches (use with caution!)
   */
  async clearAllCaches() {
    console.log('🔄 CacheService: Clearing ALL caches')
    
    try {
      await prisma.playerPropCache.deleteMany({})
      console.log('✅ CacheService: All caches cleared')
    } catch (error) {
      console.error('❌ CacheService: Error clearing caches:', error)
    }
  }
}


