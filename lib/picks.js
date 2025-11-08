// Editor's Picks - Generate recommended bets based on edges and analysis
// Now using Supabase instead of Prisma

import { supabase } from './supabase.js'

/**
 * Generate today's editor picks based on betting edges and matchup analysis
 * Supports MLB, NFL, and NHL
 */
export async function generateEditorPicks() {
  try {
    const picks = []
    
    // Generate picks for each sport
    const mlbPicks = await generatePicksFromSupabase('mlb', null, 0.05)
    const nflPicks = await generatePicksFromSupabase('nfl', null, 0.05)
    const nhlPicks = await generatePicksFromSupabase('nhl', null, 0.05)
    
    picks.push(...mlbPicks, ...nflPicks, ...nhlPicks)
    
    // Sort picks by WIN PROBABILITY (highest first), then edge as tiebreaker
    picks.sort((a, b) => {
      // Primary sort: Win probability (highest first)
      if (Math.abs((a.probability || 0.5) - (b.probability || 0.5)) > 0.01) {
        return (b.probability || 0.5) - (a.probability || 0.5)
      }
      // Tiebreaker: Edge (highest first)
      return b.edge - a.edge
    })
    
    console.log(`✅ Generated ${picks.length} editor picks sorted by win probability`)
    if (picks.length > 0) {
      console.log(`📊 Top pick: ${picks[0].team} ${picks[0].type} (${((picks[0].probability || 0.5) * 100).toFixed(1)}% win chance, ${(picks[0].edge * 100).toFixed(1)}% edge)`)
    }
    
    return picks
    
  } catch (error) {
    console.error('Error generating editor picks:', error)
    return []
  }
}

/**
 * Generate picks from Supabase data (similar to parlay generator)
 */
async function generatePicksFromSupabase(sport, gameId = null, minEdge = 0.05) {
  try {
    const picks = []
    
    // Build game query
    let gameQuery = supabase
      .from('Game')
      .select(`
        id,
        sport,
        date,
        status,
        home:Team!Game_homeId_fkey(id, name, abbr),
        away:Team!Game_awayId_fkey(id, name, abbr)
      `)
      .in('status', ['scheduled', 'pre-game', 'pre_game', 'warmup', 'in_progress'])
    
    // Filter by sport if not 'mixed'
    if (sport !== 'mixed' && ['mlb', 'nfl', 'nhl'].includes(sport)) {
      gameQuery = gameQuery.eq('sport', sport)
    }
    
    // Filter by gameId if provided
    if (gameId) {
      gameQuery = gameQuery.eq('id', gameId)
    }
    
    // Get today's games (or this week for NFL)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // For NFL, extend to full week
    if (sport === 'nfl' || sport === 'mixed') {
      const weekStart = new Date(today)
      weekStart.setDate(weekStart.getDate() - 4)
      const weekEnd = new Date(tomorrow)
      weekEnd.setDate(weekEnd.getDate() + 3)
      gameQuery = gameQuery.gte('date', weekStart.toISOString()).lt('date', weekEnd.toISOString())
    } else {
      gameQuery = gameQuery.gte('date', today.toISOString()).lt('date', tomorrow.toISOString())
    }
    
    const { data: games, error: gamesError } = await gameQuery
    
    if (gamesError) {
      console.error('❌ Error fetching games:', gamesError)
      return []
    }
    
    if (!games || games.length === 0) {
      console.log(`⚠️ No active games found for sport: ${sport}`)
      return []
    }
    
    console.log(`📊 Found ${games.length} active games for ${sport}`)
    
    // For each game, fetch edges and odds, then generate picks
    for (const game of games) {
      // Skip games that have ended
      if (isGameEnded(game.status)) {
        continue
      }
      
      // Fetch latest edge snapshot
      const { data: edges } = await supabase
        .from('EdgeSnapshot')
        .select('*')
        .eq('gameId', game.id)
        .order('ts', { ascending: false })
        .limit(1)
      
      if (!edges || edges.length === 0) continue
      
      const edge = edges[0]
      
      // Fetch latest odds
      const { data: oddsData } = await supabase
        .from('Odds')
        .select('*')
        .eq('gameId', game.id)
        .order('ts', { ascending: false })
        .limit(10) // Get recent odds
      
      if (!oddsData || oddsData.length === 0) continue
      
      // Get the most recent odds for each market
      const latestOdds = {}
      for (const odd of oddsData) {
        const marketKey = odd.market
        if (!latestOdds[marketKey] || new Date(odd.ts) > new Date(latestOdds[marketKey].ts)) {
          latestOdds[marketKey] = odd
        }
      }
      
      const homeAbbr = game.home?.abbr || 'HOME'
      const awayAbbr = game.away?.abbr || 'AWAY'
      const teamName = `${awayAbbr} @ ${homeAbbr}`
      
      // Generate picks from edges
      // Moneyline picks
      const h2hOdds = latestOdds['h2h']
      if (edge.edgeMlHome && edge.edgeMlHome >= minEdge && h2hOdds?.priceHome) {
        const mlOdds = h2hOdds.priceHome
        const impliedProb = oddsToImpliedProbability(mlOdds)
        const ourProb = Math.min(0.75, impliedProb * (1 + edge.edgeMlHome))
        
        picks.push({
          gameId: game.id,
          type: 'moneyline',
          pick: homeAbbr,
          team: homeAbbr,
          opponent: awayAbbr,
          edge: edge.edgeMlHome,
          odds: mlOdds,
          probability: ourProb,
          confidence: getConfidenceLevel(edge.edgeMlHome),
          reasoning: `${homeAbbr} ML - ${(edge.edgeMlHome * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
      
      if (edge.edgeMlAway && edge.edgeMlAway >= minEdge && h2hOdds?.priceAway) {
        const mlOdds = h2hOdds.priceAway
        const impliedProb = oddsToImpliedProbability(mlOdds)
        const ourProb = Math.min(0.75, impliedProb * (1 + edge.edgeMlAway))
        
        picks.push({
          gameId: game.id,
          type: 'moneyline',
          pick: awayAbbr,
          team: awayAbbr,
          opponent: homeAbbr,
          edge: edge.edgeMlAway,
          odds: mlOdds,
          probability: ourProb,
          confidence: getConfidenceLevel(edge.edgeMlAway),
          reasoning: `${awayAbbr} ML - ${(edge.edgeMlAway * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
      
      // Total picks
      const totalsOdds = latestOdds['totals']
      if (edge.edgeTotalO && edge.edgeTotalO >= minEdge && totalsOdds?.priceAway) {
        // For totals, priceAway is typically "Over", priceHome is "Under"
        const totalOdds = totalsOdds.priceAway
        const impliedProb = oddsToImpliedProbability(totalOdds)
        const ourProb = Math.min(0.65, impliedProb * (1 + edge.edgeTotalO))
        
        picks.push({
          gameId: game.id,
          type: 'total',
          pick: 'over',
          team: teamName,
          opponent: null,
          edge: edge.edgeTotalO,
          odds: totalOdds,
          probability: ourProb,
          confidence: getConfidenceLevel(edge.edgeTotalO),
          reasoning: `${teamName} OVER ${totalsOdds.total || 'TBD'} - ${(edge.edgeTotalO * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
      
      if (edge.edgeTotalU && edge.edgeTotalU >= minEdge && totalsOdds?.priceHome) {
        // For totals, priceHome is typically "Under"
        const totalOdds = totalsOdds.priceHome
        const impliedProb = oddsToImpliedProbability(totalOdds)
        const ourProb = Math.min(0.65, impliedProb * (1 + edge.edgeTotalU))
        
        picks.push({
          gameId: game.id,
          type: 'total',
          pick: 'under',
          team: teamName,
          opponent: null,
          edge: edge.edgeTotalU,
          odds: totalOdds,
          probability: ourProb,
          confidence: getConfidenceLevel(edge.edgeTotalU),
          reasoning: `${teamName} UNDER ${totalsOdds.total || 'TBD'} - ${(edge.edgeTotalU * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
    }
    
    console.log(`✅ Generated ${picks.length} picks from Supabase edges for ${sport}`)
    return picks
    
  } catch (error) {
    console.error('❌ Error generating picks from Supabase:', error)
    return []
  }
}

/**
 * Get confidence level based on edge size
 */
function getConfidenceLevel(edge) {
  if (edge >= 0.10) return 'very_high'  // 10%+ edge
  if (edge >= 0.07) return 'high'       // 7-9% edge
  if (edge >= 0.05) return 'medium'     // 5-6% edge
  if (edge >= 0.03) return 'low'        // 3-4% edge
  return 'very_low'                     // <3% edge
}

/**
 * Get picks for a specific game
 */
export async function getGamePicks(gameId) {
  const allPicks = await generateEditorPicks()
  return allPicks.filter(pick => pick.gameId === gameId)
}

/**
 * Get top picks of the day
 */
export async function getTopPicks(limit = 5) {
  const allPicks = await generateEditorPicks()
  return allPicks.slice(0, limit)
}

/**
 * Convert American odds to implied probability
 */
function oddsToImpliedProbability(americanOdds) {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100)
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  }
}

/**
 * Check if a game has ended
 */
function isGameEnded(status) {
  const endedStatuses = ['final', 'completed', 'postponed', 'cancelled', 'suspended']
  return endedStatuses.includes(status?.toLowerCase())
}
