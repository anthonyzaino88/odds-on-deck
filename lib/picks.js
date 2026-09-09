// Editor's Picks — public desk uses the same Published / Pile B bar as
// the homepage board and /validation ROI card. Daily ops scripts still
// process the full ocean; this module only ranks the public list.

import { supabase } from './supabase.js'
import { getBookCount } from './juice-traps.js'
import {
  PUBLISHED_SPORTS,
  PUBLISHED_STATS_PREFILTER,
  rankEditorsPicks,
} from './published-picks.js'
import {
  GAME_LINE_MIN_EDGE,
  GAME_LINE_SPORTS,
  decorateGameLines,
  isGameLineRecord,
  selectGameLines,
} from './game-lines.js'

export { GAME_LINE_MIN_EDGE, GAME_LINE_SPORTS, selectGameLines }

/**
 * Map a PlayerPropCache row (or similar) to the Editor's desk pick shape.
 * Juice-trap detection still sees the market via propType when type is
 * player_prop — same wrap isJuiceTrap already handles.
 */
export function mapCachePropToEditorPick(prop) {
  if (!prop || typeof prop !== 'object') return null
  const market = prop.type && prop.type !== 'player_prop' ? prop.type : (prop.propType || prop.type)
  return {
    gameId: prop.gameId,
    propId: prop.propId,
    type: 'player_prop',
    propType: market,
    pick: prop.pick,
    playerName: prop.playerName,
    team: prop.team,
    threshold: prop.threshold,
    edge: prop.edge || 0,
    odds: prop.odds,
    probability: prop.probability || 0.5,
    confidence: prop.confidence || 'medium',
    qualityScore: prop.qualityScore || 0,
    reasoning: [prop.playerName, (prop.pick || '').toUpperCase(), prop.threshold, String(market || '').replace(/_/g, ' ')].join(' '),
    gameTime: prop.gameTime,
    sport: prop.sport,
    category: prop.category,
    bookmaker: prop.bookmaker,
    projection: prop.projection,
    numBooks: getBookCount(prop),
  }
}

/**
 * Pure Editor's list from cache-shaped rows. Applies the shared Published
 * ranker — MLB + NFL, odds band, edge > 0, QS ≥ 40, no juice traps.
 * Empty or short is honest; never pads.
 */
export function selectEditorPicks(records) {
  const mapped = (Array.isArray(records) ? records : [])
    .filter((record) => !isGameLineRecord(record))
    .map(mapCachePropToEditorPick)
    .filter(Boolean)
  return rankEditorsPicks(mapped)
}

/**
 * Today's Editor's picks — bets we'd take for best ROI.
 * filterMode is accepted for API back-compat and does not loosen the bar.
 */
export async function generateEditorPicks(_filterMode = 'value') {
  try {
    const playerProps = await generatePlayerPropPicks()
    const ranked = selectEditorPicks(playerProps)

    try {
      const { persistPublishedEligibleProps } = await import('./validation.js')
      await persistPublishedEligibleProps(playerProps)
    } catch (error) {
      console.error('Error persisting Published editor picks:', error)
    }

    console.log(`✅ Generated ${ranked.length} editor picks (Published / Pile B) from ${playerProps.length} cache rows`)
    if (ranked.length > 0) {
      const top = ranked[0]
      console.log(`📊 Top pick: ${top.playerName || top.team} ${top.propType} (${((top.edge || 0) * 100).toFixed(1)}% edge, QS ${top.qualityScore || 0})`)
    }

    return ranked
  } catch (error) {
    console.error('Error generating editor picks:', error)
    return []
  }
}

/**
 * Upcoming MLB + NFL cache rows for the public desk. SQL matches the
 * Published prefilter (edge > 0, QS ≥ 40, sports). Juice + odds band
 * still run in JS via rankEditorsPicks / isPublishedEligibleProp.
 * Ops fetch scripts are unchanged and still scan the full ocean.
 */
async function generatePlayerPropPicks() {
  try {
    const now = new Date().toISOString()
    const { data: props, error } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .in('sport', PUBLISHED_SPORTS)
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gt('gameTime', now)
      .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
      .order('edge', { ascending: false })
      .limit(200)

    if (error) {
      console.error('❌ Error fetching player props:', error)
      return []
    }

    if (!props || props.length === 0) {
      console.log('⚠️ No Published-eligible player props in cache')
      return []
    }

    console.log(`Found ${props.length} cache rows after Published SQL prefilter`)
    return props
  } catch (error) {
    console.error('❌ Error generating player prop picks:', error)
    return []
  }
}

/**
 * Game-level ML / totals from EdgeSnapshot. Public sides & totals calls
 * this for MLB + NFL only via generateGameLines. Default minEdge is
 * GAME_LINE_MIN_EDGE (5%). Does not fetch fresh odds — reads stored
 * EdgeSnapshot + Odds rows. Ops scripts are unchanged.
 */
export async function generatePicksFromSupabase(sport, gameId = null, minEdge = GAME_LINE_MIN_EDGE) {
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
      .in('status', ['scheduled', 'pre-game', 'pre_game', 'warmup'])
    
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
        // Edge = our model prob - market prob, so our prob = market prob + edge
        const ourProb = Math.min(0.85, Math.max(0.25, impliedProb + edge.edgeMlHome))
        
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
          status: game.status,
          sport: game.sport
        })
        console.log(`✅ Added ${homeAbbr} ML pick: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeMlHome * 100).toFixed(1)}% edge`)
      }
      
      if (edge.edgeMlAway && edge.edgeMlAway >= minEdge && h2hOdds?.priceAway) {
        const mlOdds = h2hOdds.priceAway
        const impliedProb = oddsToImpliedProbability(mlOdds)
        const ourProb = Math.min(0.85, Math.max(0.25, impliedProb + edge.edgeMlAway))
        
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
          status: game.status,
          sport: game.sport
        })
        console.log(`✅ Added ${awayAbbr} ML pick: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeMlAway * 100).toFixed(1)}% edge`)
      }
      
      // Total picks
      const totalsOdds = latestOdds['totals']
      if (edge.edgeTotalO && edge.edgeTotalO >= minEdge && totalsOdds?.priceAway) {
        const totalOdds = totalsOdds.priceAway
        const impliedProb = oddsToImpliedProbability(totalOdds)
        const ourProb = Math.min(0.75, Math.max(0.25, impliedProb + edge.edgeTotalO))
        
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
          status: game.status,
          sport: game.sport
        })
        console.log(`✅ Added ${teamName} OVER ${totalsOdds.total}: ${(ourProb * 100).toFixed(1)}% win, ${(edge.edgeTotalO * 100).toFixed(1)}% edge`)
      }
      
      if (edge.edgeTotalU && edge.edgeTotalU >= minEdge && totalsOdds?.priceHome) {
        const totalOdds = totalsOdds.priceHome
        const impliedProb = oddsToImpliedProbability(totalOdds)
        const ourProb = Math.min(0.75, Math.max(0.25, impliedProb + edge.edgeTotalU))
        
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
          status: game.status,
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
 * Public sides & totals shortlist. MLB + NFL only. Reuses
 * generatePicksFromSupabase (EdgeSnapshot + stored Odds). Persists
 * qualifying rows into PropValidation as source=game_line so they can
 * be graded without mixing into Published props ROI.
 */
export async function generateGameLines() {
  try {
    const batches = await Promise.all(
      GAME_LINE_SPORTS.map((sport) => generatePicksFromSupabase(sport, null, GAME_LINE_MIN_EDGE)),
    )
    const lines = selectGameLines(batches.flat())
    try {
      const { persistGameLines } = await import('./validation.js')
      await persistGameLines(lines)
    } catch (error) {
      console.error('Error persisting sides & totals:', error)
    }
    return await attachGameLineInsights(lines)
  } catch (error) {
    console.error('Error generating game lines:', error)
    return []
  }
}

async function attachGameLineInsights(lines) {
  if (!lines.length || !supabase) return decorateGameLines(lines)
  const gameIds = [...new Set(lines.map((line) => line.gameId).filter(Boolean))]
  if (gameIds.length === 0) return decorateGameLines(lines)

  const { data: games, error } = await supabase
    .from('Game')
    .select(`
      id,
      sport,
      home:Team!Game_homeId_fkey(
        abbr, last10Record, homeRecord, awayRecord,
        avgPointsLast10, avgPointsAllowedLast10
      ),
      away:Team!Game_awayId_fkey(
        abbr, last10Record, homeRecord, awayRecord,
        avgPointsLast10, avgPointsAllowedLast10
      )
    `)
    .in('id', gameIds)

  if (error) {
    console.error('Error loading game context for sides & totals:', error)
    return decorateGameLines(lines)
  }

  const gamesMap = {}
  for (const game of games || []) gamesMap[game.id] = game

  const { generateQuickInsight } = await import('./pick-insights.js')
  return decorateGameLines(lines, gamesMap, generateQuickInsight)
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
 * Convert odds to implied probability.
 * Handles both decimal odds (1.01-99) and American odds (+/-).
 */
function oddsToImpliedProbability(odds) {
  if (!odds || odds === 0) return 0.5

  // Detect decimal odds: positive, non-integer, in typical decimal range
  if (odds > 1 && odds < 100 && !Number.isInteger(odds)) {
    return 1 / odds
  }

  // American odds
  if (odds > 0) {
    return 100 / (odds + 100)
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100)
  }
}

/**
 * Check if a game has ended
 */
function isGameEnded(status) {
  const endedStatuses = ['final', 'completed', 'postponed', 'cancelled', 'suspended']
  return endedStatuses.includes(status?.toLowerCase())
}
