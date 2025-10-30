/**
 * Props Repository
 * 
 * Handles database operations for player prop cache.
 */

import { BaseRepository } from './base.repository.js'

export class PropsRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'playerPropCache')
  }

  /**
   * Get cached props for a sport
   * @param {string} sport - 'mlb', 'nfl', or 'nhl'
   * @param {number} maxAgeMinutes - Maximum cache age in minutes
   */
  async getCachedProps(sport, maxAgeMinutes = 30) {
    const cutoffTime = new Date()
    cutoffTime.setMinutes(cutoffTime.getMinutes() - maxAgeMinutes)
    
    const cachedProps = await this.findMany({
      sport,
      createdAt: { gte: cutoffTime },
      isStale: false
    })
    
    return {
      hasFreshCache: cachedProps.length > 0,
      props: cachedProps.map(p => JSON.parse(p.propData)),
      cacheAge: cachedProps.length > 0 
        ? Math.round((Date.now() - new Date(cachedProps[0].createdAt)) / 1000 / 60)
        : null
    }
  }

  /**
   * Cache props for a sport
   */
  async cacheProps(props) {
    const operations = []
    
    for (const prop of props) {
      operations.push(
        this.model.create({
          data: {
            sport: prop.sport,
            gameId: prop.gameId,
            playerName: prop.playerName,
            propType: prop.type,
            propData: JSON.stringify(prop),
            expiresAt: new Date(prop.gameTime),
            isStale: false
          }
        })
      )
    }
    
    return await this.transaction(operations)
  }

  /**
   * Mark props as stale
   */
  async markStaleProps() {
    const now = new Date()
    
    return await this.model.updateMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { 
            createdAt: { 
              lt: new Date(now.getTime() - 60 * 60 * 1000) // 1 hour old
            } 
          }
        ]
      },
      data: { isStale: true }
    })
  }

  /**
   * Clean up old props
   */
  async cleanupOldProps(daysOld = 2) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)
    
    return await this.model.deleteMany({
      where: {
        createdAt: { lt: cutoffDate }
      }
    })
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    const [total, fresh, stale] = await Promise.all([
      this.count(),
      this.count({ isStale: false }),
      this.count({ isStale: true })
    ])
    
    return {
      total,
      fresh,
      stale,
      hitRate: total > 0 ? (fresh / total * 100).toFixed(1) + '%' : '0%'
    }
  }
}


