// Parlay Generator - Core logic for generating optimized parlays

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Generate optimized parlays based on user preferences
 */
export async function generateParlays(options = {}) {
  const {
    sport = 'mlb',
    type = 'multi_game',
    legCount = 3,
    minEdge = 0.05,
    maxParlays = 10,
    minConfidence = 'medium'
  } = options

  try {
    console.log(`🎯 Generating ${legCount}-leg ${sport} parlays (${type})...`)

    // Get available bets with edges
    const availableBets = await getAvailableBets(sport, minEdge, minConfidence)
    
    if (availableBets.length < legCount) {
      console.log(`⚠️ Not enough bets available (${availableBets.length} < ${legCount})`)
      return []
    }

    // Generate all possible combinations
    const combinations = generateCombinations(availableBets, legCount)
    
    // Filter by correlation rules
    const validCombinations = filterByCorrelationRules(combinations, type)
    
    // Calculate parlay metrics for each combination
    const parlays = await calculateParlayMetrics(validCombinations)
    
    // Sort by expected value and return top parlays
    const sortedParlays = parlays
      .sort((a, b) => b.expectedValue - a.expectedValue)
      .slice(0, maxParlays)

    console.log(`✅ Generated ${sortedParlays.length} optimized parlays`)
    return sortedParlays

  } catch (error) {
    console.error('❌ Error generating parlays:', error)
    return []
  }
}

/**
 * Get available bets with minimum edge and confidence
 */
async function getAvailableBets(sport, minEdge, minConfidence) {
  const bets = []

  // Get game odds
  const games = await prisma.game.findMany({
    where: {
      sport: sport === 'mixed' ? { in: ['mlb', 'nfl'] } : sport,
      status: { in: ['scheduled', 'pre_game', 'pre-game', 'warmup', 'in_progress'] },
      odds: { some: {} }
    },
    include: {
      home: true,
      away: true,
      odds: true,
      edges: true
    }
  })

  // Process each game
  for (const game of games) {
    // Add moneyline bets
    const moneylineBets = await getMoneylineBets(game, minEdge, minConfidence)
    bets.push(...moneylineBets)

    // Add spread bets
    const spreadBets = await getSpreadBets(game, minEdge, minConfidence)
    bets.push(...spreadBets)

    // Add total bets
    const totalBets = await getTotalBets(game, minEdge, minConfidence)
    bets.push(...totalBets)

    // Add player props (MLB only)
    if (game.sport === 'mlb') {
      const propBets = await getPlayerPropBets(game, minEdge, minConfidence)
      bets.push(...propBets)
    }

    // Add editor's picks for this game
    const pickBets = await getEditorPickBets(game, minEdge, minConfidence)
    bets.push(...pickBets)
  }

  return bets
}

/**
 * Get moneyline bets for a game
 */
async function getMoneylineBets(game, minEdge, minConfidence) {
  const bets = []
  
  // Find best moneyline odds
  const homeOdds = game.odds.find(o => o.market === 'h2h' && o.priceHome)
  const awayOdds = game.odds.find(o => o.market === 'h2h' && o.priceAway)
  
  if (homeOdds && homeOdds.priceHome) {
    const edge = game.edges.find(e => e.type === 'moneyline' && e.pick === 'home')
    if (edge && edge.edge >= minEdge && edge.confidence >= minConfidence) {
      bets.push({
        gameId: game.id,
        betType: 'moneyline',
        selection: 'home',
        odds: homeOdds.priceHome,
        probability: edge.probability || (1 / (1 + homeOdds.priceHome / 100)),
        edge: edge.edge,
        confidence: edge.confidence,
        team: game.home.abbr,
        opponent: game.away.abbr,
        gameTime: game.date
      })
    }
  }

  if (awayOdds && awayOdds.priceAway) {
    const edge = game.edges.find(e => e.type === 'moneyline' && e.pick === 'away')
    if (edge && edge.edge >= minEdge && edge.confidence >= minConfidence) {
      bets.push({
        gameId: game.id,
        betType: 'moneyline',
        selection: 'away',
        odds: awayOdds.priceAway,
        probability: edge.probability || (1 / (1 + awayOdds.priceAway / 100)),
        edge: edge.edge,
        confidence: edge.confidence,
        team: game.away.abbr,
        opponent: game.home.abbr,
        gameTime: game.date
      })
    }
  }

  return bets
}

/**
 * Get spread bets for a game
 */
async function getSpreadBets(game, minEdge, minConfidence) {
  const bets = []
  
  const spreadOdds = game.odds.find(o => o.market === 'spreads')
  if (!spreadOdds || !spreadOdds.spread) return bets

  // Home team spread
  const homeEdge = game.edges.find(e => e.type === 'spread' && e.pick === 'home')
  if (homeEdge && homeEdge.edge >= minEdge && homeEdge.confidence >= minConfidence) {
    bets.push({
      gameId: game.id,
      betType: 'spread',
      selection: 'home',
      odds: spreadOdds.priceHome || -110,
      probability: homeEdge.probability || 0.5,
      edge: homeEdge.edge,
      confidence: homeEdge.confidence,
      team: game.home.abbr,
      opponent: game.away.abbr,
      spread: spreadOdds.spread,
      gameTime: game.date
    })
  }

  // Away team spread
  const awayEdge = game.edges.find(e => e.type === 'spread' && e.pick === 'away')
  if (awayEdge && awayEdge.edge >= minEdge && awayEdge.confidence >= minConfidence) {
    bets.push({
      gameId: game.id,
      betType: 'spread',
      selection: 'away',
      odds: spreadOdds.priceAway || -110,
      probability: awayEdge.probability || 0.5,
      edge: awayEdge.edge,
      confidence: awayEdge.confidence,
      team: game.away.abbr,
      opponent: game.home.abbr,
      spread: -spreadOdds.spread,
      gameTime: game.date
    })
  }

  return bets
}

/**
 * Get total bets for a game
 */
async function getTotalBets(game, minEdge, minConfidence) {
  const bets = []
  
  const totalOdds = game.odds.find(o => o.market === 'totals')
  if (!totalOdds || !totalOdds.total) return bets

  // Over bet
  const overEdge = game.edges.find(e => e.type === 'total' && e.pick === 'over')
  if (overEdge && overEdge.edge >= minEdge && overEdge.confidence >= minConfidence) {
    bets.push({
      gameId: game.id,
      betType: 'total',
      selection: 'over',
      odds: totalOdds.priceHome || -110,
      probability: overEdge.probability || 0.5,
      edge: overEdge.edge,
      confidence: overEdge.confidence,
      team: `${game.away.abbr} @ ${game.home.abbr}`,
      total: totalOdds.total,
      gameTime: game.date
    })
  }

  // Under bet
  const underEdge = game.edges.find(e => e.type === 'total' && e.pick === 'under')
  if (underEdge && underEdge.edge >= minEdge && underEdge.confidence >= minConfidence) {
    bets.push({
      gameId: game.id,
      betType: 'total',
      selection: 'under',
      odds: totalOdds.priceAway || -110,
      probability: underEdge.probability || 0.5,
      edge: underEdge.edge,
      confidence: underEdge.confidence,
      team: `${game.away.abbr} @ ${game.home.abbr}`,
      total: totalOdds.total,
      gameTime: game.date
    })
  }

  return bets
}

/**
 * Get player prop bets for a game
 */
async function getPlayerPropBets(game, minEdge, minConfidence) {
  const bets = []
  
  const props = await prisma.playerProp.findMany({
    where: {
      gameId: game.id,
      edge: { gte: minEdge },
      confidence: { gte: minConfidence }
    },
    include: {
      player: true
    }
  })

  for (const prop of props) {
    bets.push({
      gameId: game.id,
      betType: 'prop',
      selection: prop.pick,
      odds: prop.odds,
      probability: prop.projection,
      edge: prop.edge,
      confidence: prop.confidence,
      team: prop.team,
      opponent: prop.opponent,
      playerId: prop.playerId,
      playerName: prop.playerName,
      propType: prop.propType,
      threshold: prop.propValue,
      gameTime: game.date
    })
  }

  return bets
}

/**
 * Get editor's pick bets for a game
 */
async function getEditorPickBets(game, minEdge, minConfidence) {
  const bets = []
  
  const picks = await prisma.edgeSnapshot.findMany({
    where: {
      gameId: game.id,
      edge: { gte: minEdge },
      confidence: { gte: minConfidence }
    }
  })

  for (const pick of picks) {
    bets.push({
      gameId: game.id,
      betType: pick.type,
      selection: pick.pick,
      odds: pick.odds || -110, // Default odds if not available
      probability: pick.probability || 0.5,
      edge: pick.edge,
      confidence: pick.confidence,
      team: pick.team,
      opponent: pick.opponent,
      gameTime: game.date
    })
  }

  return bets
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
 */
function hasCorrelatedBets(gameBets) {
  const betTypes = gameBets.map(bet => bet.betType)
  const selections = gameBets.map(bet => bet.selection)
  
  // Moneyline + spread correlation
  if (betTypes.includes('moneyline') && betTypes.includes('spread')) {
    return true
  }
  
  // Moneyline + total correlation
  if (betTypes.includes('moneyline') && betTypes.includes('total')) {
    return true
  }
  
  // Same team multiple bets
  const teams = gameBets.map(bet => bet.team)
  const uniqueTeams = new Set(teams)
  if (uniqueTeams.size < teams.length) {
    return true
  }
  
  return false
}

/**
 * Calculate parlay metrics for a combination
 */
async function calculateParlayMetrics(combinations) {
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
    
    parlays.push({
      legs: combination,
      totalOdds: totalOdds,
      probability: probability,
      edge: edge,
      expectedValue: expectedValue,
      confidence: confidence,
      sport: combination[0].sport || 'mlb',
      type: uniqueGames.size === 1 ? 'single_game' : 'multi_game'
    })
  }
  
  return parlays
}

/**
 * Save parlay to database
 */
export async function saveParlay(parlayData) {
  try {
    const parlay = await prisma.parlay.create({
      data: {
        sport: parlayData.sport,
        type: parlayData.type,
        legCount: parlayData.legs.length,
        totalOdds: parlayData.totalOdds,
        probability: parlayData.probability,
        edge: parlayData.edge,
        expectedValue: parlayData.expectedValue,
        confidence: parlayData.confidence,
        legs: {
          create: parlayData.legs.map((leg, index) => ({
            gameId: leg.gameId,
            betType: leg.betType,
            selection: leg.selection,
            odds: leg.odds,
            probability: leg.probability,
            edge: leg.edge,
            confidence: leg.confidence,
            playerId: leg.playerId,
            propType: leg.propType,
            threshold: leg.threshold,
            legOrder: index + 1
          }))
        }
      },
      include: {
        legs: {
          include: {
            game: {
              include: {
                home: true,
                away: true
              }
            },
            player: true
          }
        }
      }
    })
    
    return parlay
  } catch (error) {
    console.error('❌ Error saving parlay:', error)
    return null
  }
}

/**
 * Get parlay history
 */
export async function getParlayHistory(limit = 50) {
  try {
    const parlays = await prisma.parlay.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        legs: {
          include: {
            game: {
              include: {
                home: true,
                away: true
              }
            },
            player: true
          }
        }
      }
    })
    
    return parlays
  } catch (error) {
    console.error('❌ Error fetching parlay history:', error)
    return []
  }
}
