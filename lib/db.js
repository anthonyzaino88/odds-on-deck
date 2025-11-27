// Database wrapper - Provides backward compatibility for pages still using old function names
// USES SUPABASE - This is just a compatibility layer
import { supabase } from './supabase.js'

/**
 * Get game detail by ID
 * Used by: app/game/[id]/page.js
 */
export async function getGameDetail(gameId) {
  try {
    const { data: game, error } = await supabase
      .from('Game')
      .select(`
        *,
        home:Team!Game_homeId_fkey(*),
        away:Team!Game_awayId_fkey(*)
      `)
      .eq('id', gameId)
      .maybeSingle()
    
    if (error) throw error
    return game
  } catch (error) {
    console.error('Error getting game detail:', error)
    return null
  }
}

/**
 * Get players for DFS
 * Used by: app/dfs/page.js
 */
export async function getPlayersForDFS() {
  try {
    // Return empty array - DFS functionality not currently active
    // Can be implemented later when needed
    return []
  } catch (error) {
    console.error('Error getting DFS players:', error)
    return []
  }
}

/**
 * Export a mock prisma object for compatibility
 * Used by: lib/api-usage-manager.js
 */
export const prisma = {
  // Mock Prisma client - not actually used
  // API usage tracking can be implemented in Supabase if needed
}

