// Database wrapper - Provides backward compatibility for pages still using old function names
// USES SUPABASE - This is just a compatibility layer
import { supabase } from './supabase.js'

/**
 * Get game detail by ID
 * Used by: app/game/[id]/page.js
 * 
 * Fetches game with all related data:
 * - Teams (home/away)
 * - Odds
 * - EdgeSnapshot (edges)
 */
export async function getGameDetail(gameId) {
  try {
    // Fetch game with teams
    const { data: game, error: gameError } = await supabase
      .from('Game')
      .select(`
        *,
        home:Team!Game_homeId_fkey(*),
        away:Team!Game_awayId_fkey(*)
      `)
      .eq('id', gameId)
      .maybeSingle()
    
    if (gameError) throw gameError
    if (!game) return null
    
    // Fetch odds for this game
    const { data: odds, error: oddsError } = await supabase
      .from('Odds')
      .select('*')
      .eq('gameId', gameId)
      .order('ts', { ascending: false })
      .limit(20)
    
    if (oddsError) {
      console.error('Error fetching odds:', oddsError)
    }
    
    // Fetch edge snapshot for this game
    const { data: edges, error: edgesError } = await supabase
      .from('EdgeSnapshot')
      .select('*')
      .eq('gameId', gameId)
      .order('ts', { ascending: false })
      .limit(5)
    
    if (edgesError) {
      console.error('Error fetching edges:', edgesError)
    }
    
    // Return game with all related data
    return {
      ...game,
      odds: odds || [],
      edges: edges || [],
      // These are not currently populated but kept for compatibility
      lineups: [],
      probableHomePitcher: null,
      probableAwayPitcher: null,
      nflData: null,
      postGameStats: null,
      postGamePlayerStats: null
    }
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


