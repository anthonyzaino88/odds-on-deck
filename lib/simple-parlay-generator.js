// Simplified Parlay Generator - Works with Supabase data (NO PRISMA)

import { supabase } from './supabase.js'
import { nflGameLineSnapshotIsPublic, isLegacyNflHeuristicVersion } from './nfl-selection-model.js'
import {
  assembleParlays,
  mapCachePropToParlayBet,
  playerCorrelationKey,
} from './parlay-integrity.js'

/**
 * Convert decimal odds (The Odds API uses decimal odds) to implied probability.
 */
function decimalOddsToImpliedProbability(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return 0
  return 1 / decimalOdds
}

/**
 * Generate picks dynamically from Supabase EdgeSnapshot data
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
    
    console.log(`📊 Found ${games.length} active games`)
    
    // For each game, fetch edges and odds, then generate picks
    for (const game of games) {
      // Fetch latest edge snapshot
      const { data: edges } = await supabase
        .from('EdgeSnapshot')
        .select('*')
        .eq('gameId', game.id)
        .order('ts', { ascending: false })
        .limit(1)
      
      if (!edges || edges.length === 0) continue
      
      const edge = edges[0]

      // Legacy / unvalidated NFL game lines stay out of parlays.
      if (String(game.sport || '').toLowerCase() === 'nfl'
        && (isLegacyNflHeuristicVersion(edge.modelRun) || !nflGameLineSnapshotIsPublic(edge))) {
        continue
      }
      
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
        const impliedProb = decimalOddsToImpliedProbability(mlOdds)
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
          confidence: getConfidenceLevel(ourProb),
          reasoning: `${homeAbbr} ML - ${(edge.edgeMlHome * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
      
      if (edge.edgeMlAway && edge.edgeMlAway >= minEdge && h2hOdds?.priceAway) {
        const mlOdds = h2hOdds.priceAway
        const impliedProb = decimalOddsToImpliedProbability(mlOdds)
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
          confidence: getConfidenceLevel(ourProb),
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
        const impliedProb = decimalOddsToImpliedProbability(totalOdds)
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
          confidence: getConfidenceLevel(ourProb),
          threshold: Number.isFinite(Number(totalsOdds.total)) ? Number(totalsOdds.total) : null,
          reasoning: `${teamName} OVER ${totalsOdds.total || 'TBD'} - ${(edge.edgeTotalO * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
      
      if (edge.edgeTotalU && edge.edgeTotalU >= minEdge && totalsOdds?.priceHome) {
        // For totals, priceHome is typically "Under"
        const totalOdds = totalsOdds.priceHome
        const impliedProb = decimalOddsToImpliedProbability(totalOdds)
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
          confidence: getConfidenceLevel(ourProb),
          threshold: Number.isFinite(Number(totalsOdds.total)) ? Number(totalsOdds.total) : null,
          reasoning: `${teamName} UNDER ${totalsOdds.total || 'TBD'} - ${(edge.edgeTotalU * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
    }
    
    // Sort picks by win probability (highest first)
    picks.sort((a, b) => {
      if (Math.abs((a.probability || 0.5) - (b.probability || 0.5)) > 0.01) {
        return (b.probability || 0.5) - (a.probability || 0.5)
      }
      return b.edge - a.edge
    })
    
    console.log(`✅ Generated ${picks.length} picks from Supabase edges`)
    return picks
    
  } catch (error) {
    console.error('❌ Error generating picks from Supabase:', error)
    return []
  }
}

/**
 * Get confidence level based on probability (how likely to hit)
 * NOT based on edge - edge is about value, confidence is about likelihood
 * 
 * Very High = Very likely to hit (70%+)
 * High = Likely to hit (55-70%)
 * Medium = Moderate chance (45-55%)
 * Low = Lower chance (30-45%)
 * Very Low = Unlikely (<30%)
 */
function getConfidenceLevel(probability) {
  if (probability >= 0.70) return 'very_high'  // 70%+ chance to hit
  if (probability >= 0.55) return 'high'       // 55-70% chance
  if (probability >= 0.45) return 'medium'    // 45-55% chance
  if (probability >= 0.30) return 'low'        // 30-45% chance
  return 'very_low'                             // <30% chance
}

/**
 * Generate optimized parlays using Supabase data only
 * 
 * HONEST EDGE SYSTEM:
 * - Props have edge=0 by default (honest - no fake edges)
 * - Real edge only comes from line shopping (comparing multiple bookmakers)
 * - We use PROBABILITY (vig-adjusted) for ranking, not fake edge
 * - Quality score is based on probability, not inflated edge values
 */
export async function generateSimpleParlays(options = {}) {
  const {
    sport = 'mlb',
    type = 'multi_game',
    legCount = 3,
    minEdge = 0, // Default to 0 - don't require fake edge (honest system)
    maxParlays = 10,
    minConfidence = 'low', // Allow all confidence levels, sort by probability instead
    filterMode = 'safe', // Betting strategy
    gameId = null,
    featured = false, // Featured cards: empty is better than juice / contradictory SGPs
  } = options

  try {
    console.log(`🎯 Generating ${legCount}-leg ${sport} parlays (${type})${gameId ? ` for game ${gameId}` : ''}...`)

    // Generate picks dynamically from Supabase EdgeSnapshot data
    // RE-ENABLED: EdgeSnapshot is now working properly
    const picks = await generatePicksFromSupabase(sport, gameId, minEdge)
    
    // Fetch player props from Supabase PlayerPropCache
    let playerProps = []
    try {
      let query = supabase
        .from('PlayerPropCache')
        .select('*')
        .eq('isStale', false)
        .gte('expiresAt', new Date().toISOString())
        .order('qualityScore', { ascending: false })
        .limit(1000)
      
      // Filter by sport if not 'mixed'
      if (sport !== 'mixed' && ['mlb', 'nfl', 'nhl'].includes(sport)) {
        query = query.eq('sport', sport)
      }
      
      // Filter by gameId if provided
      if (gameId) {
        query = query.eq('gameId', gameId)
      }
      
      const { data, error } = await query
      
      if (error) {
        console.error('❌ Error fetching props from Supabase:', error)
        // Fallback to empty array
        playerProps = []
      } else {
        // Transform Supabase data to match expected format
        playerProps = (data || []).map(prop => ({
          propId: prop.propId,
          gameId: prop.gameId,
          playerName: prop.playerName,
          // Identity is the player, not the line. propId is unique per
          // over/under + threshold and must never be used as playerId.
          playerId: playerCorrelationKey({
            playerName: prop.playerName,
            gameId: prop.gameId,
            betType: 'prop',
            type: prop.type,
          }),
          team: prop.team,
          type: prop.type,
          pick: prop.pick,
          threshold: prop.threshold,
          odds: prop.odds,
          probability: prop.probability || 0.5,
          edge: prop.edge || 0,
          confidence: prop.confidence || 'low',
          qualityScore: prop.qualityScore || 0,
          sport: prop.sport,
          category: prop.category,
          reasoning: prop.reasoning,
          projection: prop.projection,
          bookmaker: prop.bookmaker,
          gameTime: prop.gameTime,
          opponent: null
        }))
        console.log(`✅ Fetched ${playerProps.length} props from Supabase${gameId ? ` for game ${gameId}` : ''}`)
        if (gameId && playerProps.length > 0) {
          console.log(`📋 First prop gameId: "${playerProps[0].gameId}"`)
        }
      }
    } catch (error) {
      console.error('❌ Error fetching props:', error)
      playerProps = []
    }
    
    // Confidence level hierarchy
    const confidenceLevels = {
      'very_low': 1,
      'low': 2,
      'medium': 3,
      'high': 4,
      'very_high': 5
    }
    const minConfidenceLevel = confidenceLevels[minConfidence] || 3
    
    // Filter by sport and confidence
    const availableBets = []
    
    // Add picks (picks already have sport field from Supabase)
    // HONEST EDGE SYSTEM: EdgeSnapshot picks may have calculated edges
    // But we still primarily rank by probability for safest picks
    picks.forEach(pick => {
      const pickConfidenceLevel = confidenceLevels[pick.confidence] || 0
      const probability = pick.probability || 0.5
      
      // Filter: Exclude extreme probabilities (bad parlay value)
      // >75% = heavy favorite, <35% = unlikely long shot
      if (probability > 0.75 || probability < 0.35) {
        return // Skip extreme probabilities
      }
      
      // HONEST: Include all picks that meet confidence threshold
      // EdgeSnapshot picks may have real edges from model calculations
      if (pickConfidenceLevel >= minConfidenceLevel) {
        const pickSport = pick.sport || 'mlb' // Should always be set from Supabase
        
        // Check if sport matches requested sport (or 'mixed' allows all)
        if (sport === 'mixed' || pickSport === sport) {
          // Calculate probability from odds if not already set
          const probability = pick.probability || (pick.odds 
            ? (pick.odds > 0 ? 100 / (pick.odds + 100) : Math.abs(pick.odds) / (Math.abs(pick.odds) + 100))
            : 0.5)
          
          availableBets.push({
            id: `pick-${pick.gameId}-${pick.type}-${pick.pick}`,
            gameId: pick.gameId,
            betType: pick.type,
            selection: pick.pick,
            odds: pick.odds || -110,
            probability: probability,
            edge: pick.edge,
            confidence: pick.confidence,
            team: pick.team,
            opponent: pick.opponent,
            gameTime: pick.gameTime,
            reasoning: pick.reasoning,
            sport: pickSport,
            threshold: pick.threshold
          })
        }
      }
    })
    
    // Add player props (filter by sport and confidence)
    // HONEST EDGE SYSTEM: Props have edge=0 (no fake edges)
    // We filter by PROBABILITY (vig-adjusted fair probability) instead
    // 
    // IMPORTANT FILTERS FOR PARLAY QUALITY:
    // 1. Exclude extreme probabilities (>75% or <35%) - terrible parlay value
    // 2. Exclude "Under 0.5" props - these are trap bets (betting player gets ZERO)
    // 3. Require reasonable confidence level
    playerProps.forEach(prop => {
      const propConfidenceLevel = confidenceLevels[prop.confidence] || 0
      const probability = prop.probability || 0.5
      const propType = (prop.type || '').toLowerCase()
      const pick = (prop.pick || '').toLowerCase()
      const threshold = prop.threshold || 0
      
      // Filter 1: Exclude extreme probabilities (bad parlay value)
      // >75% prob = heavy favorite with massive juice (e.g., -300 or worse)
      // <35% prob = long shot unlikely to hit
      if (probability > 0.75 || probability < 0.35) {
        return // Skip extreme probabilities
      }
      
      // Filter 2: Exclude ALL "Under 0.5" props (trap bets)
      // These are bets that a player gets ZERO of something
      // Examples: Under 0.5 assists, Under 0.5 goals, Under 0.5 PPP
      // These are heavily juiced because most players don't score in any given game
      if (threshold === 0.5 && pick === 'under') {
        return // Skip all "Under 0.5" trap bets
      }
      
      // Filter 3: Also exclude Under 1.5 for common stats (still often trap bets)
      // Under 1.5 assists/points at heavy odds is still a trap
      if (threshold === 1.5 && pick === 'under' && probability > 0.70) {
        return // Skip heavily favored Under 1.5 props
      }
      
      // HONEST: Include all props that meet confidence threshold
      // Props with edge=0 are HONEST - they just haven't been line-shopped
      // Use probability for ranking instead of requiring fake edge
      if (propConfidenceLevel >= minConfidenceLevel) {
        const propSport = prop.sport || 'mlb' // Should always be set from Supabase
        
        // Check if prop matches requested sport (or 'mixed' allows all)
        if (sport === 'mixed' || propSport === sport) {
          const bet = mapCachePropToParlayBet(prop)
          if (bet) availableBets.push(bet)
        }
      }
    })

    // Filter by specific gameId if provided (for single_game parlays)
    let filteredBets = availableBets
    if (gameId) {
      console.log(`🔍 Filtering for gameId: "${gameId}"`)
      console.log(`📋 Available gameIds:`, [...new Set(availableBets.map(b => b.gameId))])
      filteredBets = availableBets.filter(bet => bet.gameId === gameId)
      console.log(`🎯 Filtered to ${filteredBets.length} bets for game ${gameId}`)
      if (filteredBets.length === 0) {
        console.warn(`⚠️ No bets found for gameId "${gameId}"`)
      }
    }

    const totalPropsAndPicks = picks.length + playerProps.length
    const filteredOut = totalPropsAndPicks - availableBets.length
    console.log(`📊 Found ${availableBets.length} quality bets (filtered out ${filteredOut} heavy favorites/trap bets)`)
    console.log(`📊 Available bets for sport: ${sport}`)
    console.log(`📊 Available bets breakdown:`)
    const sportBreakdown = filteredBets.reduce((acc, bet) => {
      acc[bet.sport] = (acc[bet.sport] || 0) + 1
      return acc
    }, {})
    console.log(sportBreakdown)
    
    if (filteredBets.length < legCount) {
      console.log(`⚠️ Not enough bets available (${filteredBets.length} < ${legCount})`)
      return []
    }

    const sortedParlays = assembleParlays(filteredBets, {
      legCount,
      type,
      filterMode,
      maxParlays,
      featured,
      gameId,
    })
    
    if (sortedParlays.length > 0) {
      const top = sortedParlays[0]
      console.log(`🏆 Top parlay (${featured ? 'featured' : filterMode} mode): ${(top.probability * 100).toFixed(1)}% win, EV: ${top.expectedValue >= 0 ? '+' : ''}${(top.expectedValue * 100).toFixed(1)}%, quality: ${top.qualityScore?.toFixed(1)}, +${Math.round((top.totalOdds - 1) * 100)} odds`)
    } else if (featured) {
      console.log('✅ Featured: no parlays cleared the quality bar (empty > junk juice / contradictory SGPs)')
    }

    console.log(`✅ Generated ${sortedParlays.length} optimized parlays (${featured ? 'featured' : filterMode} mode)`)
    return sortedParlays

  } catch (error) {
    console.error('❌ Error generating parlays:', error)
    return []
  }
}
