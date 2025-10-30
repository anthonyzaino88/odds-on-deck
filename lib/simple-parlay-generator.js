// Simplified Parlay Generator - Works with existing data structure

import { getAllData } from './data-manager.js'
import { calculateQualityScore } from './quality-score.js'

/**
 * Generate optimized parlays using existing picks and props
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

    // Get all available data
    const { picks, playerProps } = await getAllData()
    
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
    
    // Add picks (filter by sport)
    picks.forEach(pick => {
      const pickConfidenceLevel = confidenceLevels[pick.confidence] || 0
      if (pick.edge >= minEdge && pickConfidenceLevel >= minConfidenceLevel) {
        // Check if pick matches the requested sport
        let pickSport = 'mlb'; // Default to MLB
        
        // Check for NFL game IDs
        if (pick.gameId.includes('NE_at_BUF') || pick.gameId.includes('KC_at_JAX') || 
            pick.gameId.includes('TEN_at_ARI') || pick.gameId.includes('TB_at_SEA') || 
            pick.gameId.includes('DET_at_CIN') || pick.gameId.includes('WSH_at_LAC') || 
            pick.gameId.includes('LV_at_IND') || pick.gameId.includes('NYG_at_NO') || 
            pick.gameId.includes('DAL_at_NYJ') || pick.gameId.includes('MIN_at_CLE') || 
            pick.gameId.includes('DEN_at_PHI') || pick.gameId.includes('MIA_at_CAR') || 
            pick.gameId.includes('SF_at_LAR') || pick.gameId.includes('HOU_at_BAL')) {
          pickSport = 'nfl';
        }
        
        // Check for NHL game IDs
        else if (pick.gameId.includes('NHL_') || pick.gameId.includes('_at_') && 
                (pick.gameId.includes('NYR') || pick.gameId.includes('BOS') || 
                 pick.gameId.includes('TOR') || pick.gameId.includes('MTL') || 
                 pick.gameId.includes('OTT') || pick.gameId.includes('BUF') || 
                 pick.gameId.includes('DET') || pick.gameId.includes('FLA') || 
                 pick.gameId.includes('TBL') || pick.gameId.includes('CAR') || 
                 pick.gameId.includes('WSH') || pick.gameId.includes('PIT') || 
                 pick.gameId.includes('CBJ') || pick.gameId.includes('NJD') || 
                 pick.gameId.includes('NYI') || pick.gameId.includes('CHI') || 
                 pick.gameId.includes('NSH') || pick.gameId.includes('STL') || 
                 pick.gameId.includes('WPG') || pick.gameId.includes('MIN') || 
                 pick.gameId.includes('COL') || pick.gameId.includes('DAL') || 
                 pick.gameId.includes('VGK') || pick.gameId.includes('EDM') || 
                 pick.gameId.includes('CGY') || pick.gameId.includes('VAN') || 
                 pick.gameId.includes('ANA') || pick.gameId.includes('LAK') || 
                 pick.gameId.includes('SJS') || pick.gameId.includes('SEA') || 
                 pick.gameId.includes('UTA'))) {
          pickSport = 'nhl';
        }
        
        // Check if sport matches requested sport
        if (sport === 'mixed' || pickSport === sport) {
          availableBets.push({
            id: `pick-${pick.gameId}-${pick.type}-${pick.pick}`,
            gameId: pick.gameId,
            betType: pick.type,
            selection: pick.pick,
            odds: pick.odds || -110,
            probability: 1 / (1 + (pick.odds || -110) / 100),
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
    
    // Add player props (filter by sport)
    playerProps.forEach(prop => {
      const propConfidenceLevel = confidenceLevels[prop.confidence] || 0
      if (prop.edge >= minEdge && propConfidenceLevel >= minConfidenceLevel) {
        // Check if prop matches the requested sport
        let propSport = prop.sport || 'mlb'; // Use prop.sport if available
        
        // If prop.sport is not available, determine from gameId
        if (!prop.sport) {
          // Check for NFL game IDs
          if (prop.gameId.includes('NE_at_BUF') || prop.gameId.includes('KC_at_JAX') || 
              prop.gameId.includes('TEN_at_ARI') || prop.gameId.includes('TB_at_SEA') || 
              prop.gameId.includes('DET_at_CIN') || prop.gameId.includes('WSH_at_LAC') || 
              prop.gameId.includes('LV_at_IND') || prop.gameId.includes('NYG_at_NO') || 
              prop.gameId.includes('DAL_at_NYJ') || prop.gameId.includes('MIN_at_CLE') || 
              prop.gameId.includes('DEN_at_PHI') || prop.gameId.includes('MIA_at_CAR') || 
              prop.gameId.includes('SF_at_LAR') || prop.gameId.includes('HOU_at_BAL')) {
            propSport = 'nfl';
          }
          
          // Check for NHL game IDs
          else if (prop.gameId.includes('NHL_') || prop.gameId.includes('_at_') && 
                  (prop.gameId.includes('NYR') || prop.gameId.includes('BOS') || 
                   prop.gameId.includes('TOR') || prop.gameId.includes('MTL') || 
                   prop.gameId.includes('OTT') || prop.gameId.includes('BUF') || 
                   prop.gameId.includes('DET') || prop.gameId.includes('FLA') || 
                   prop.gameId.includes('TBL') || prop.gameId.includes('CAR') || 
                   prop.gameId.includes('WSH') || prop.gameId.includes('PIT') || 
                   prop.gameId.includes('CBJ') || prop.gameId.includes('NJD') || 
                   prop.gameId.includes('NYI') || prop.gameId.includes('CHI') || 
                   prop.gameId.includes('NSH') || prop.gameId.includes('STL') || 
                   prop.gameId.includes('WPG') || prop.gameId.includes('MIN') || 
                   prop.gameId.includes('COL') || prop.gameId.includes('DAL') || 
                   prop.gameId.includes('VGK') || prop.gameId.includes('EDM') || 
                   prop.gameId.includes('CGY') || prop.gameId.includes('VAN') || 
                   prop.gameId.includes('ANA') || prop.gameId.includes('LAK') || 
                   prop.gameId.includes('SJS') || prop.gameId.includes('SEA') || 
                   prop.gameId.includes('UTA'))) {
            propSport = 'nhl';
          }
        }
        
        if (sport === 'mixed' || propSport === sport) {
          availableBets.push({
            id: `prop-${prop.gameId}-${prop.playerId}-${prop.type}`,
            gameId: prop.gameId,
            betType: 'prop',
            selection: prop.pick,
            odds: prop.odds || -110,
            probability: prop.probability || 0.5, // Use proper probability field
            edge: prop.edge,
            confidence: prop.confidence,
            team: prop.team,
            opponent: prop.opponent,
            playerId: prop.playerId,
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

    // Generate combinations using filtered bets
    const combinations = generateCombinations(filteredBets, legCount)
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
      const decimalOdds = bet.odds > 0 ? (bet.odds / 100) + 1 : (100 / Math.abs(bet.odds)) + 1
      totalOdds *= decimalOdds
    }
    
    // Calculate edge
    const impliedProbability = 1 / totalOdds
    const edge = (probability - impliedProbability) / impliedProbability
    
    // Calculate expected value
    const expectedValue = (probability * (totalOdds - 1)) - ((1 - probability) * 1)
    
    // Determine confidence
    const avgConfidence = combination.reduce((sum, bet) => {
      const confValues = { 'very_high': 5, 'high': 4, 'medium': 3, 'low': 2, 'very_low': 1 }
      return sum + (confValues[bet.confidence] || 3)
    }, 0) / combination.length
    
    const confidence = avgConfidence >= 4 ? 'high' : avgConfidence >= 3 ? 'medium' : 'low'
    
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
