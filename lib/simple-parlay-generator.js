// Simplified Parlay Generator - Works with Supabase data (NO PRISMA)

import { calculateQualityScore } from './quality-score.js'
import { supabase } from './supabase.js'
import { enrichPropsWithTeamContext } from './prop-enrichment.js'

/**
 * Helper: Calculate factorial for combination counting
 */
function factorial(n) {
  if (n <= 1) return 1
  if (n > 170) return Infinity // Prevent overflow
  let result = 1
  for (let i = 2; i <= n; i++) {
    result *= i
  }
  return result
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
        const impliedProb = mlOdds > 0 ? 100 / (mlOdds + 100) : Math.abs(mlOdds) / (Math.abs(mlOdds) + 100)
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
        const impliedProb = mlOdds > 0 ? 100 / (mlOdds + 100) : Math.abs(mlOdds) / (Math.abs(mlOdds) + 100)
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
        const impliedProb = totalOdds > 0 ? 100 / (totalOdds + 100) : Math.abs(totalOdds) / (Math.abs(totalOdds) + 100)
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
          reasoning: `${teamName} OVER ${totalsOdds.total || 'TBD'} - ${(edge.edgeTotalO * 100).toFixed(1)}% edge`,
          gameTime: game.date,
          sport: game.sport
        })
      }
      
      if (edge.edgeTotalU && edge.edgeTotalU >= minEdge && totalsOdds?.priceHome) {
        // For totals, priceHome is typically "Under"
        const totalOdds = totalsOdds.priceHome
        const impliedProb = totalOdds > 0 ? 100 / (totalOdds + 100) : Math.abs(totalOdds) / (Math.abs(totalOdds) + 100)
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
 */
export async function generateSimpleParlays(options = {}) {
  const {
    sport = 'mlb',
    type = 'multi_game',
    legCount = 3,
    minEdge = 0.05,
    maxParlays = 10,
    minConfidence = 'medium',
    filterMode = 'safe', // New: betting strategy
    gameId = null
  } = options

  try {
    console.log(`🎯 Generating ${legCount}-leg ${sport} parlays (${type})${gameId ? ` for game ${gameId}` : ''}...`)

    // Generate picks dynamically from Supabase EdgeSnapshot data
    // TEMPORARILY DISABLED: EdgeSnapshot has schema issues, using props-only mode
    // const picks = await generatePicksFromSupabase(sport, gameId, minEdge)
    const picks = [] // Skip EdgeSnapshot for now, use props only
    
    // Fetch player props from Supabase PlayerPropCache
    // Join with Game table to filter out finished/old games
    let playerProps = []
    try {
      let query = supabase
        .from('PlayerPropCache')
        .select(`
          *,
          game:Game!inner(id, status, date)
        `)
        .eq('isStale', false)
        .gte('expiresAt', new Date().toISOString())
        .in('game.status', ['scheduled', 'in_progress', 'in-progress', 'halftime']) // Only active games
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
          playerId: prop.propId, // Use propId as playerId fallback
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
          opponent: null // Not stored in cache, but can be derived if needed
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
    
    // Enrich props with team context (offensive power, matchups, win probabilities)
    if (playerProps.length > 0) {
      playerProps = await enrichPropsWithTeamContext(playerProps)
      console.log(`✅ Enriched ${playerProps.filter(p => p.teamContext).length}/${playerProps.length} props with team context`)
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
    picks.forEach(pick => {
      const pickConfidenceLevel = confidenceLevels[pick.confidence] || 0
      if (pick.edge >= minEdge && pickConfidenceLevel >= minConfidenceLevel) {
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
            sport: pickSport
          })
        }
      }
    })
    
    // Add player props (filter by sport, confidence, AND team context quality)
    // Props from Supabase already have sport field, so we can use it directly
    let propsConsidered = 0
    let propsFiltered = 0
    let propsWithContext = 0
    
    playerProps.forEach(prop => {
      propsConsidered++
      const propConfidenceLevel = confidenceLevels[prop.confidence] || 0
      if (prop.edge >= minEdge && propConfidenceLevel >= minConfidenceLevel) {
        const propSport = prop.sport || 'mlb' // Should always be set from Supabase
        
        // Check if prop matches requested sport (or 'mixed' allows all)
        if (sport === 'mixed' || propSport === sport) {
          // SMART FILTERING: Apply team context filters for higher quality parlays
          const ctx = prop.teamContext
          let qualityBonus = 0
          
          if (ctx) {
            propsWithContext++
            
            // FOR PARLAYS: Be VERY selective - only include high-quality props
            // We need fewer props to avoid combinatorial explosion
            
            // MINIMUM REQUIREMENTS for parlay inclusion:
            // 1. At least decent offense (rating >= 50) OR very high edge
            if (ctx.offensiveRating < 50 && prop.edge < 0.15) {
              propsFiltered++
              return
            }
            
            // 2. Not facing elite defense (rating >= 40) OR very high edge
            if (ctx.defensiveMatchupRating < 40 && prop.edge < 0.15) {
              propsFiltered++
              return
            }
            
            // 3. Prefer props that meet AT LEAST ONE premium criteria:
            const hasPremiumQuality = 
              ctx.isHotOffense ||      // Hot offense (28+ PPG NFL, 3.5+ GPG NHL)
              ctx.isFavored ||          // Win prob >= 55%
              ctx.isWeakDefense ||      // Opponent allows 26+ PPG NFL, 3.5+ GA NHL
              ctx.isHighScoring ||      // Expected total 48+ NFL, 6.5+ NHL
              prop.edge >= 0.10 ||      // Strong edge (10%+)
              prop.probability >= 0.60  // Very high probability
            
            if (!hasPremiumQuality) {
              propsFiltered++
              return
            }
            
            // Apply quality bonuses for exceptional context
            if (ctx.isHotOffense) qualityBonus += 0.02
            if (ctx.isFavored) qualityBonus += 0.015
            if (ctx.isWeakDefense) qualityBonus += 0.02
            if (ctx.isHighScoring) qualityBonus += 0.015
          } else {
            // No context data - only include if edge/probability is exceptional
            if (prop.edge < 0.12 || prop.probability < 0.55) {
              propsFiltered++
              return
            }
          }
          
          availableBets.push({
            id: `prop-${prop.gameId}-${prop.propId || prop.playerId}-${prop.type}`,
            gameId: prop.gameId,
            betType: 'prop',
            selection: prop.pick,
            odds: prop.odds || -110,
            probability: prop.probability || 0.5,
            edge: prop.edge + qualityBonus,  // Apply quality bonus from team context
            confidence: prop.confidence,
            team: prop.team,
            opponent: prop.opponent,
            playerId: prop.propId || prop.playerId, // Use propId as fallback
            playerName: prop.playerName,
            propType: prop.type,
            threshold: prop.threshold,
            gameTime: prop.gameTime,
            reasoning: prop.reasoning,
            sport: propSport
          })
        }
      }
    })
    
    console.log(`🎯 Smart Prop Filtering:`)
    console.log(`   - Considered: ${propsConsidered} props`)
    console.log(`   - With context: ${propsWithContext} (${Math.round(propsWithContext/propsConsidered*100)}%)`)
    console.log(`   - Filtered out: ${propsFiltered} (bad matchups/offense)`)
    console.log(`   - Accepted: ${propsConsidered - propsFiltered} props`)

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

    console.log(`📊 Found ${filteredBets.length} available bets for sport: ${sport}`)
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

    // PERFORMANCE OPTIMIZATION: Limit bets to top N to prevent combinatorial explosion
    // Dynamic bet limit based on leg count to keep combinations reasonable
    // Target: Keep combinations under ~500k for good performance
    const MAX_BETS_BY_LEGS = {
      3: 100,  // C(100,3) = 161,700 combinations
      4: 60,   // C(60,4) = 487,635 combinations
      5: 35,   // C(35,5) = 324,632 combinations
      6: 25,   // C(25,6) = 177,100 combinations
      7: 20,   // C(20,7) = 77,520 combinations
      8: 15    // C(15,8) = 6,435 combinations
    }
    const MAX_BETS_FOR_COMBINATIONS = MAX_BETS_BY_LEGS[legCount] || 30
    let optimizedBets = filteredBets
    
    if (filteredBets.length > MAX_BETS_FOR_COMBINATIONS) {
      // Sort by quality score and take top N
      optimizedBets = [...filteredBets]
        .sort((a, b) => {
          // Sort by: 1) Quality score, 2) Edge, 3) Probability
          const qualityDiff = (b.qualityScore || 0) - (a.qualityScore || 0)
          if (Math.abs(qualityDiff) > 0.1) return qualityDiff
          
          const edgeDiff = (b.edge || 0) - (a.edge || 0)
          if (Math.abs(edgeDiff) > 0.01) return edgeDiff
          
          return (b.probability || 0.5) - (a.probability || 0.5)
        })
        .slice(0, MAX_BETS_FOR_COMBINATIONS)
      
      console.log(`🎯 Optimized from ${filteredBets.length} to ${optimizedBets.length} bets for performance`)
    }

    // Calculate max combinations for logging
    const maxCombinations = factorial(optimizedBets.length) / (factorial(legCount) * factorial(optimizedBets.length - legCount))
    console.log(`📊 Will generate up to ${Math.min(maxCombinations, 1000000).toLocaleString()} combinations`)

    // Generate combinations using optimized bets
    const combinations = generateCombinations(optimizedBets, legCount)
    console.log(`📊 Generated ${combinations.length} total combinations`)
    
    // Filter by correlation rules (relaxed for small datasets)
    const validCombinations = combinations.length <= 3 ? combinations : filterByCorrelationRules(combinations, type)
    console.log(`📊 ${validCombinations.length} combinations passed correlation filter`)
    
    // Calculate parlay metrics
    const parlays = calculateParlayMetrics(validCombinations)
    
    // FINAL VALIDATION: If single_game with gameId, ensure ALL legs are from that game
    let validatedParlays = parlays
    if (type === 'single_game' && gameId) {
      validatedParlays = parlays.filter(parlay => {
        const allSameGame = parlay.legs.every(leg => leg.gameId === gameId)
        if (!allSameGame) {
          console.warn(`⚠️ Filtered out parlay with mixed games:`, parlay.legs.map(l => l.gameId))
        }
        return allSameGame
      })
      console.log(`✅ After single-game validation: ${validatedParlays.length} parlays`)
    }
    
    // Sort parlays based on filter mode
    let sortedParlays = validatedParlays
    
    // Apply maximum odds limits based on filter mode to keep parlays realistic
    const maxOddsLimits = {
      'safe': 10,        // Max 10x (e.g., +900) - Reasonable favorites
      'balanced': 30,    // Max 30x (e.g., +2900) - Balanced risk/reward
      'value': 50,       // Max 50x (e.g., +4900) - High value hunting
      'homerun': 100     // Max 100x (e.g., +9900) - Big swings, still realistic
    }
    
    const maxOdds = maxOddsLimits[filterMode] || 30
    sortedParlays = sortedParlays.filter(p => p.totalOdds <= maxOdds)
    
    if (filterMode === 'safe') {
      // Safe mode: highest win probability
      sortedParlays = sortedParlays.sort((a, b) => b.probability - a.probability)
    } else if (filterMode === 'balanced') {
      // Balanced mode: highest quality score
      sortedParlays = sortedParlays.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    } else if (filterMode === 'value') {
      // Value mode: highest edge
      sortedParlays = sortedParlays.sort((a, b) => b.edge - a.edge)
    } else if (filterMode === 'homerun') {
      // Home run mode: highest payout (odds)
      sortedParlays = sortedParlays.sort((a, b) => b.totalOdds - a.totalOdds)
    } else {
      // Default: win probability
      sortedParlays = sortedParlays.sort((a, b) => b.probability - a.probability)
    }
    
    sortedParlays = sortedParlays.slice(0, maxParlays)
    
    // Log top parlay stats for debugging
    if (sortedParlays.length > 0) {
      const top = sortedParlays[0]
      console.log(`🏆 Top parlay (${filterMode} mode): ${(top.probability * 100).toFixed(1)}% win, ${(top.edge * 100).toFixed(1)}% edge, ${top.qualityScore?.toFixed(1)} quality, +${Math.round((top.totalOdds - 1) * 100)} odds`)
    }

    console.log(`✅ Generated ${sortedParlays.length} optimized parlays (${filterMode} mode)`)
    return sortedParlays

  } catch (error) {
    console.error('❌ Error generating parlays:', error)
    return []
  }
}

/**
 * Generate all possible combinations of bets
 */
function generateCombinations(bets, legCount) {
  const combinations = []
  
  function backtrack(start, current) {
    if (current.length === legCount) {
      combinations.push([...current])
      return
    }
    
    for (let i = start; i < bets.length; i++) {
      current.push(bets[i])
      backtrack(i + 1, current)
      current.pop()
    }
  }
  
  backtrack(0, [])
  return combinations
}

/**
 * Filter combinations by correlation rules
 */
function filterByCorrelationRules(combinations, type) {
  return combinations.filter(combination => {
    // Check for same game correlation
    const gameIds = combination.map(bet => bet.gameId)
    const uniqueGames = new Set(gameIds)
    
    if (type === 'single_game' && uniqueGames.size > 1) {
      return false
    }
    
    // Check for correlated bets in same game
    for (const gameId of uniqueGames) {
      const gameBets = combination.filter(bet => bet.gameId === gameId)
      if (gameBets.length > 1 && hasCorrelatedBets(gameBets)) {
        return false
      }
    }
    
    // Check for same player correlation
    const playerIds = combination.map(bet => bet.playerId).filter(Boolean)
    const uniquePlayers = new Set(playerIds)
    if (uniquePlayers.size < playerIds.length) {
      return false
    }
    
    return true
  })
}

/**
 * Check if bets in the same game are correlated
 * RELAXED for player props - allows multiple props from same game if different players
 */
function hasCorrelatedBets(gameBets) {
  const betTypes = gameBets.map(bet => bet.betType)
  const selections = gameBets.map(bet => bet.selection)
  
  // Moneyline + spread correlation (game level bets only)
  if (betTypes.includes('moneyline') && betTypes.includes('spread')) {
    return true
  }
  
  // Moneyline + total correlation (game level bets only)
  if (betTypes.includes('moneyline') && betTypes.includes('total')) {
    return true
  }
  
  // For player props, only block if it's the SAME PLAYER
  // (already filtered by line 172-176, so we can be lenient here)
  const playerIds = gameBets.map(bet => bet.playerId).filter(Boolean)
  if (playerIds.length > 0) {
    // If these are player props, they're already filtered for same player
    // So allow multiple props from same game for different players
    return false
  }
  
  // For non-player props (game level bets), block same team multiple times
  const teams = gameBets.map(bet => bet.team).filter(Boolean)
  const uniqueTeams = new Set(teams)
  if (teams.length > 0 && uniqueTeams.size < teams.length) {
    return true
  }
  
  return false
}

/**
 * Calculate parlay metrics for a combination
 */
function calculateParlayMetrics(combinations) {
  const parlays = []
  
  for (const combination of combinations) {
    // Calculate combined probability
    let probability = 1
    for (const bet of combination) {
      probability *= bet.probability
    }
    
    // Calculate combined odds
    let totalOdds = 1
    for (const bet of combination) {
      // bet.odds is already in decimal format from PlayerPropCache (e.g., 1.95)
      // No conversion needed - just multiply directly
      const decimalOdds = bet.odds
      totalOdds *= decimalOdds
    }
    
    // Calculate edge
    const impliedProbability = 1 / totalOdds
    const edge = (probability - impliedProbability) / impliedProbability
    
    // Calculate expected value
    const expectedValue = (probability * (totalOdds - 1)) - ((1 - probability) * 1)
    
    // Determine confidence based on parlay's combined probability (not averaging individual bet confidences)
    // Confidence = how likely is this parlay to hit (based on combined probability)
    const confidence = getConfidenceLevel(probability)
    
    // Calculate quality score for the parlay
    const qualityScore = calculateQualityScore({
      probability: probability,
      edge: edge,
      confidence: confidence
    })
    
    // Determine sport and type
    const gameIds = combination.map(bet => bet.gameId)
    const uniqueGames = new Set(gameIds)
    const sport = combination[0].sport || (combination[0].gameId.includes('KC_at_JAX') || combination[0].gameId.includes('NE_at_BUF') || combination[0].gameId.includes('TEN_at_ARI') || combination[0].gameId.includes('TB_at_SEA') || combination[0].gameId.includes('DET_at_CIN') || combination[0].gameId.includes('WSH_at_LAC') || combination[0].gameId.includes('LV_at_IND') || combination[0].gameId.includes('NYG_at_NO') || combination[0].gameId.includes('DAL_at_NYJ') || combination[0].gameId.includes('MIN_at_CLE') || combination[0].gameId.includes('DEN_at_PHI') || combination[0].gameId.includes('MIA_at_CAR') || combination[0].gameId.includes('SF_at_LAR') || combination[0].gameId.includes('HOU_at_BAL') ? 'nfl' : 'mlb')
    const parlayType = uniqueGames.size === 1 ? 'single_game' : 'multi_game'
    
    parlays.push({
      legs: combination,
      totalOdds: totalOdds,
      probability: probability,
      edge: edge,
      expectedValue: expectedValue,
      confidence: confidence,
      qualityScore: qualityScore,
      sport: sport,
      type: parlayType
    })
  }
  
  return parlays
}
