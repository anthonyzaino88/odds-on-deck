// Player Props Cache Manager
// Reduces API calls by caching props in database

// ✅ MIGRATED TO SUPABASE - Uses admin client for write operations
import { supabaseAdmin as supabase } from './supabase-admin.js'

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
    const { data: cachedProps, error } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('sport', sport)
      .gte('gameTime', today.toISOString())
      .lt('gameTime', tomorrow.toISOString())
      .gt('expiresAt', now.toISOString())
      .eq('isStale', false)
    
    if (error) {
      console.error('❌ Error querying cached props:', error)
      return {
        hasFreshCache: false,
        props: [],
        cacheAge: null
      }
    }
    
    if (!cachedProps || cachedProps.length === 0) {
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
        
        // Try to update first
        const { data: existing } = await supabase
          .from('PlayerPropCache')
          .select('id')
          .eq('propId', prop.id)
          .single()
        
        if (existing) {
          // Update existing record
          const { error: updateError } = await supabase
            .from('PlayerPropCache')
            .update({
              odds: prop.odds,
              probability: prop.probability,
              edge: prop.edge,
              confidence: prop.confidence,
              qualityScore: prop.qualityScore,
              reasoning: prop.reasoning,
              projection: prop.projection,
              bookmaker: prop.bookmaker,
              fetchedAt: now.toISOString(),
              expiresAt: finalExpiry.toISOString(),
              isStale: false
            })
            .eq('id', existing.id)
          
          if (updateError) throw updateError
        } else {
          // Insert new record
          const { error: insertError } = await supabase
            .from('PlayerPropCache')
            .insert({
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
              gameTime: new Date(prop.gameTime).toISOString(),
              fetchedAt: now.toISOString(),
              expiresAt: finalExpiry.toISOString(),
            isStale: false
            })
          
          if (insertError) throw insertError
        }
        
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
    
    const { data, error } = await supabase
      .from('PlayerPropCache')
      .update({ isStale: true })
      .lte('expiresAt', now.toISOString())
      .eq('isStale', false)
      .select()
    
    if (error) {
      console.error('❌ Error marking stale props:', error)
      return 0
    }
    
    const count = data ? data.length : 0
    
    if (count > 0) {
      console.log(`🗑️ Marked ${count} props as stale`)
    }
    
    return count
    
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
    
    const { data, error } = await supabase
      .from('PlayerPropCache')
      .delete()
      .lt('gameTime', cutoffDate.toISOString())
      .select()
    
    if (error) {
      console.error('❌ Error cleaning up old props:', error)
      return 0
    }
    
    const count = data ? data.length : 0
    
    if (count > 0) {
      console.log(`🗑️ Deleted ${count} old cached props (older than ${daysOld} days)`)
    }
    
    return count
    
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
    
    // Get total count
    const { count: total, error: totalError } = await supabase
      .from('PlayerPropCache')
      .select('*', { count: 'exact', head: true })
    
    // Get fresh count
    const { count: fresh, error: freshError } = await supabase
      .from('PlayerPropCache')
      .select('*', { count: 'exact', head: true })
      .gt('expiresAt', now.toISOString())
      .eq('isStale', false)
    
    // Get stale count (Supabase doesn't support OR, so we do it manually)
    const { data: allProps, error: allError } = await supabase
      .from('PlayerPropCache')
      .select('id, expiresAt, isStale')
    
    const stale = allProps ? allProps.filter(p => 
      new Date(p.expiresAt) <= now || p.isStale
    ).length : 0
    
    return {
      total: total || 0,
      fresh: fresh || 0,
      stale,
      freshPercentage: (total || 0) > 0 ? Math.round(((fresh || 0) / (total || 0)) * 100) : 0
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

