/**
 * Mock Prop Generator - Training Mode
 * 
 * Generates "shadow props" using free APIs for ML training
 * - Uses ESPN/MLB Stats API (free) instead of paid odds
 * - Calculates synthetic odds using statistical models
 * - Validates against actual results
 * - Builds training dataset without API costs
 */

import { prisma } from './db.js'

/**
 * Calculate probability using Poisson distribution
 * (for counting stats: hits, strikeouts, points, etc.)
 */
function poissonProbability(lambda, k) {
  if (k < 0) return 0
  if (lambda === 0) return k === 0 ? 1 : 0
  
  // Calculate factorial
  let factorial = 1
  for (let i = 2; i <= k; i++) {
    factorial *= i
  }
  
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial
}

/**
 * Calculate P(X > threshold) using Poisson
 */
function calculateOverProbability(average, threshold) {
  let underProb = 0
  
  // Sum P(X = 0) to P(X = threshold)
  for (let i = 0; i <= Math.floor(threshold); i++) {
    underProb += poissonProbability(average, i)
  }
  
  return 1 - underProb
}

/**
 * Convert probability to American odds
 */
function probabilityToOdds(probability) {
  if (probability >= 0.5) {
    // Favorite (negative odds)
    return Math.round(-probability / (1 - probability) * 100)
  } else {
    // Underdog (positive odds)
    return Math.round((1 - probability) / probability * 100)
  }
}

/**
 * Get recent player stats (simple moving average)
 * In production, this would fetch from free APIs
 */
async function getPlayerRecentStats(playerName, propType, games = 10) {
  // TODO: Fetch from ESPN/MLB Stats API
  // For now, return mock data structure
  
  // This would be replaced with actual API calls like:
  // - MLB: statsapi.mlb.com
  // - NFL: ESPN API
  // - NHL: NHL API
  
  return {
    gamesPlayed: games,
    average: 1.5, // Replace with actual average
    stdDev: 0.8,  // Standard deviation
    trend: 'stable', // 'improving', 'declining', 'stable'
    last5Games: [2, 1, 2, 0, 1] // Most recent first
  }
}

/**
 * Generate mock props for a specific game
 */
export async function generateMockPropsForGame(game) {
  const mockProps = []
  
  // Get players from both teams
  // In production, fetch from free APIs
  const homePlayers = await getTeamPlayers(game.homeId)
  const awayPlayers = await getTeamPlayers(game.awayId)
  
  const allPlayers = [...homePlayers, ...awayPlayers]
  
  // Common prop types by sport
  const propTypesBySport = {
    mlb: ['hits', 'total_bases', 'strikeouts', 'walks', 'rbis', 'runs_scored'],
    nfl: ['passing_yards', 'passing_touchdowns', 'rushing_yards', 'receptions', 'receiving_yards'],
    nhl: ['points', 'goals', 'assists', 'shots_on_goal', 'blocked_shots']
  }
  
  const propTypes = propTypesBySport[game.sport] || propTypesBySport.mlb
  
  // Generate props for each player
  for (const player of allPlayers.slice(0, 15)) { // Limit to 15 players per game
    for (const propType of propTypes.slice(0, 3)) { // 3 prop types per player
      // Get recent stats
      const stats = await getPlayerRecentStats(player.name, propType)
      
      if (!stats || stats.average === 0) continue
      
      // Calculate threshold (round to nearest .5)
      const threshold = Math.round(stats.average * 2) / 2
      
      // Calculate probability using appropriate distribution
      const probOver = calculateOverProbability(stats.average, threshold)
      const probUnder = 1 - probOver
      
      // Our prediction
      const prediction = probOver > 0.5 ? 'over' : 'under'
      const ourProbability = prediction === 'over' ? probOver : probUnder
      
      // Generate synthetic odds
      const syntheticOdds = probabilityToOdds(ourProbability)
      
      // Calculate confidence (higher for more data, clearer trends)
      let confidence = 'medium'
      if (stats.gamesPlayed >= 10 && Math.abs(ourProbability - 0.5) > 0.15) {
        confidence = 'high'
      } else if (stats.gamesPlayed < 5 || Math.abs(ourProbability - 0.5) < 0.05) {
        confidence = 'low'
      }
      
      // Create mock prop
      mockProps.push({
        gameId: game.id,
        playerName: player.name,
        propType: propType,
        threshold: threshold,
        prediction: prediction,
        expectedValue: stats.average,
        syntheticOdds: syntheticOdds,
        probability: ourProbability,
        confidence: confidence,
        sport: game.sport,
        reasoning: `${player.name} averages ${stats.average.toFixed(1)} over last ${stats.gamesPlayed} games. Threshold: ${threshold}`,
        source: 'mock_generated',
        qualityScore: calculateMockQualityScore(stats, ourProbability, confidence)
      })
    }
  }
  
  return mockProps
}

/**
 * Calculate quality score for mock prop
 */
function calculateMockQualityScore(stats, probability, confidence) {
  const factors = {
    sampleSize: Math.min(stats.gamesPlayed / 20, 1), // 0-1 based on games
    certainty: Math.abs(probability - 0.5) * 2, // 0-1 based on how far from 50/50
    confidence: confidence === 'high' ? 1 : confidence === 'medium' ? 0.65 : 0.35,
    consistency: 1 - (stats.stdDev / (stats.average + 1)) // Lower variance = higher score
  }
  
  // Weighted average
  const score = (
    factors.sampleSize * 0.25 +
    factors.certainty * 0.30 +
    factors.confidence * 0.25 +
    factors.consistency * 0.20
  )
  
  return Math.round(score * 100)
}

/**
 * Get team players (stub - would fetch from free API)
 */
async function getTeamPlayers(teamId) {
  // TODO: Fetch from ESPN/MLB Stats API
  // For now, return empty array
  return []
  
  // In production, this would:
  // 1. Fetch team roster from free API
  // 2. Filter to active players
  // 3. Return player objects with IDs and names
}

/**
 * Generate mock props for all today's games
 */
export async function generateAllMockProps() {
  console.log('🧪 Generating mock props for training...')
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  // Get today's games
  const games = await prisma.game.findMany({
    where: {
      date: {
        gte: today,
        lt: tomorrow
      },
      status: { in: ['scheduled', 'pre-game', 'pre_game'] }
    },
    include: {
      home: true,
      away: true
    }
  })
  
  console.log(`📊 Found ${games.length} games for mock prop generation`)
  
  let allMockProps = []
  
  for (const game of games) {
    try {
      const gameProps = await generateMockPropsForGame(game)
      allMockProps = [...allMockProps, ...gameProps]
      console.log(`   ✅ Generated ${gameProps.length} mock props for ${game.away.abbr} @ ${game.home.abbr}`)
    } catch (error) {
      console.error(`   ❌ Error generating props for game ${game.id}:`, error.message)
    }
  }
  
  // Save to database
  let saved = 0
  for (const prop of allMockProps) {
    try {
      await prisma.mockPropValidation.create({
        data: {
          propId: `mock-${prop.gameId}-${prop.playerName}-${prop.propType}`.replace(/\s+/g, '-'),
          gameIdRef: prop.gameId,
          playerName: prop.playerName,
          propType: prop.propType,
          threshold: prop.threshold,
          prediction: prop.prediction,
          expectedValue: prop.expectedValue,
          syntheticOdds: prop.syntheticOdds,
          probability: prop.probability,
          confidence: prop.confidence,
          qualityScore: prop.qualityScore,
          sport: prop.sport,
          status: 'pending',
          source: 'mock_generated',
          reasoning: prop.reasoning
        }
      })
      saved++
    } catch (error) {
      if (!error.message.includes('Unique constraint')) {
        console.error(`Error saving mock prop:`, error.message)
      }
    }
  }
  
  console.log(`✅ Saved ${saved} mock props to database`)
  
  return {
    success: true,
    generated: allMockProps.length,
    saved: saved,
    games: games.length
  }
}

/**
 * Validate completed mock props
 */
export async function validateCompletedMockProps() {
  console.log('🔍 Validating completed mock props...')
  
  // Import stat fetchers
  const { getPlayerGameStat: getMLBStat } = await import('./vendors/mlb-game-stats.js')
  const { getPlayerGameStat: getNFLStat } = await import('./vendors/nfl-game-stats.js')
  const { getPlayerGameStat: getNHLStat } = await import('./vendors/nhl-game-stats.js')
  
  // Get pending mock props
  const pendingProps = await prisma.mockPropValidation.findMany({
    where: { status: 'pending' }
  })
  
  console.log(`📊 Found ${pendingProps.length} pending mock props`)
  
  let validated = 0
  
  for (const prop of pendingProps) {
    try {
      // Get game
      const game = await prisma.game.findUnique({
        where: { id: prop.gameIdRef }
      })
      
      if (!game) continue
      
      // Check if game is final
      const gameDate = new Date(game.date)
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(23, 59, 59, 999)
      
      const isFinal = 
        ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
        (gameDate < yesterday)
      
      if (!isFinal) continue
      
      // Fetch actual stat
      let actualValue = null
      
      if (prop.sport === 'mlb' && game.mlbGameId) {
        actualValue = await getMLBStat(game.mlbGameId, prop.playerName, prop.propType)
      } else if (prop.sport === 'nfl' && game.espnGameId) {
        actualValue = await getNFLStat(game.espnGameId, prop.playerName, prop.propType)
      } else if (prop.sport === 'nhl' && game.espnGameId) {
        actualValue = await getNHLStat(game.espnGameId, prop.playerName, prop.propType)
      }
      
      if (actualValue === null || actualValue === undefined) {
        await prisma.mockPropValidation.update({
          where: { id: prop.id },
          data: {
            status: 'needs_review',
            notes: 'Stat not available from API',
            validatedAt: new Date()
          }
        })
        validated++
        continue
      }
      
      // Calculate result
      let result = 'incorrect'
      if (actualValue === prop.threshold) {
        result = 'push'
      } else if (
        (prop.prediction === 'over' && actualValue > prop.threshold) ||
        (prop.prediction === 'under' && actualValue < prop.threshold)
      ) {
        result = 'correct'
      }
      
      // Update mock prop
      await prisma.mockPropValidation.update({
        where: { id: prop.id },
        data: {
          actualValue,
          result,
          status: 'completed',
          validatedAt: new Date(),
          notes: `Expected: ${prop.expectedValue.toFixed(1)}, Actual: ${actualValue}`
        }
      })
      
      validated++
    } catch (error) {
      console.error(`Error validating mock prop ${prop.id}:`, error.message)
    }
  }
  
  console.log(`✅ Validated ${validated} mock props`)
  
  return {
    success: true,
    validated: validated
  }
}

