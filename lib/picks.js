// Editor's Picks - Generate recommended bets based on edges and analysis
// Now using Supabase instead of Prisma

import { supabase } from './supabase.js'

/**
 * Generate today's editor picks based on betting edges and matchup analysis
 * Supports MLB, NFL, and NHL - includes both game picks and player props
 */
export async function generateEditorPicks(filterMode = 'safe') {
  try {
    const picks = []
    
    // Generate game-level picks for each sport
    // minEdge of 0.01 (1%) allows totals picks to come through (they have lower edges than ML)
    const mlbPicks = await generatePicksFromSupabase('mlb', null, 0.01)
    const nflPicks = await generatePicksFromSupabase('nfl', null, 0.01)
    const nhlPicks = await generatePicksFromSupabase('nhl', null, 0.01)
    
    // Generate player prop picks
    const playerProps = await generatePlayerPropPicks()
    
    picks.push(...mlbPicks, ...nflPicks, ...nhlPicks, ...playerProps)
    
    // Apply filters based on mode
    let filteredPicks = picks
    if (filterMode === 'safe') {
      // Safe mode: High probability picks - more lenient for moneyline/totals
      filteredPicks = picks.filter(p => {
        const prob = p.probability || 0
        const isGamePick = p.type === 'moneyline' || p.type === 'total'
        // Game picks: 50%+, Player props: 52%+
        return isGamePick ? prob >= 0.50 : prob >= 0.52
      })
    } else if (filterMode === 'balanced') {
      // Balanced mode: Good combination of probability and edge
      filteredPicks = picks.filter(p => {
        const prob = p.probability || 0
        const edge = p.edge || 0
        const qualityScore = p.qualityScore || 0
        const isGamePick = p.type === 'moneyline' || p.type === 'total'
        // Game picks: 48%+ with 3%+ edge, Player props: higher standards
        if (isGamePick) {
          return prob >= 0.48 && edge >= 0.03
        }
        return (prob >= 0.48 && edge >= 0.05) || qualityScore >= 70
      })
    } else if (filterMode === 'value') {
      // Value mode: High edge opportunities
      filteredPicks = picks.filter(p => {
        const edge = p.edge || 0
        const isGamePick = p.type === 'moneyline' || p.type === 'total'
        // Game picks: 5%+ edge, Player props: 10%+ edge
        return isGamePick ? edge >= 0.05 : edge >= 0.10
      })
    }
    // 'all' mode returns everything
    
    // Sort picks by quality score (combines probability and edge optimally)
    filteredPicks.sort((a, b) => {
      const scoreA = calculatePickQuality(a)
      const scoreB = calculatePickQuality(b)
      return scoreB - scoreA
    })
    
    console.log(`✅ Generated ${filteredPicks.length} editor picks (${filterMode} mode) from ${picks.length} total`)
    if (filteredPicks.length > 0) {
      const top = filteredPicks[0]
      console.log(`📊 Top pick: ${top.playerName || top.team} ${top.type} (${((top.probability || 0.5) * 100).toFixed(1)}% win, ${((top.edge || 0) * 100).toFixed(1)}% edge)`)
    }
    
    return filteredPicks
    
  } catch (error) {
    console.error('Error generating editor picks:', error)
    return []
  }
}

/**
 * Generate picks from player props cache - TOP 5 ONLY
 */
async function generatePlayerPropPicks() {
  try {
    // Fetch active player props - ONLY TOP 5 by quality score
    const now = new Date().toISOString()
    const { data: props, error } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.50) // Only props with 50%+ win probability
      .order('qualityScore', { ascending: false })
      .limit(5) // Get only top 5 highest quality props
    
    if (error) {
      console.error('❌ Error fetching player props:', error)
      return []
    }
    
    if (!props || props.length === 0) {
      console.log('⚠️ No active player props found')
      return []
    }
    
    // Transform player props into picks format
    const picks = props.map(prop => ({
      gameId: prop.gameId,
      propId: prop.propId,
      type: 'player_prop',
      propType: prop.type,
      pick: prop.pick,
      playerName: prop.playerName,
      team: prop.team,
      threshold: prop.threshold,
      edge: prop.edge || 0,
      odds: prop.odds,
      probability: prop.probability || 0.5,
      confidence: prop.confidence || 'medium',
      qualityScore: prop.qualityScore || 0,
      reasoning: `${prop.playerName} ${prop.pick?.toUpperCase()} ${prop.threshold} ${(prop.type || '').replace(/_/g, ' ')}`,
      gameTime: prop.gameTime,
      sport: prop.sport,
      category: prop.category,
      bookmaker: prop.bookmaker,
      projection: prop.projection
    }))
    
    console.log(`✅ Found ${picks.length} top player prop picks`)
    return picks
    
  } catch (error) {
    console.error('❌ Error generating player prop picks:', error)
    return []
  }
}

/**
 * Calculate overall pick quality score (0-100)
 * Combines probability and edge with optimal weighting
 */
function calculatePickQuality(pick) {
  const probability = pick.probability || 0.5
  const edge = pick.edge || 0
  const qualityScore = pick.qualityScore || 0
  
  // If we have a pre-calculated quality score (for props), use it
  if (qualityScore > 0) {
    return qualityScore
  }
  
  // For game picks, calculate quality score
  // Formula: Weight probability heavily (70%), edge moderately (30%)
  const probScore = (probability - 0.5) * 200 // Scale 0.5-1.0 to 0-100
  const edgeScore = edge * 100 // Scale 0-1.0 to 0-100
  
  return (probScore * 0.7) + (edgeScore * 0.3)
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
          homeTeam: homeAbbr,
          awayTeam: awayAbbr,
          edge: edge.edgeMlHome,
          odds: mlOdds,
          probability: ourProb,
          confidence: getConfidenceLevel(edge.edgeMlHome),
          reasoning: `${homeAbbr} ML - ${(edge.edgeMlHome * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
        console.log(`✅ Added ${homeAbbr} ML pick: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeMlHome * 100).toFixed(1)}% edge`)
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
          homeTeam: homeAbbr,
          awayTeam: awayAbbr,
          edge: edge.edgeMlAway,
          odds: mlOdds,
          probability: ourProb,
          confidence: getConfidenceLevel(edge.edgeMlAway),
          reasoning: `${awayAbbr} ML - ${(edge.edgeMlAway * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
        console.log(`✅ Added ${awayAbbr} ML pick: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeMlAway * 100).toFixed(1)}% edge`)
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
          threshold: totalsOdds.total,
          homeTeam: homeAbbr,
          awayTeam: awayAbbr,
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
        console.log(`✅ Added ${teamName} OVER ${totalsOdds.total}: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeTotalO * 100).toFixed(1)}% edge`)
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
          threshold: totalsOdds.total,
          homeTeam: homeAbbr,
          awayTeam: awayAbbr,
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
        console.log(`✅ Added ${teamName} UNDER ${totalsOdds.total}: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeTotalU * 100).toFixed(1)}% edge`)
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
