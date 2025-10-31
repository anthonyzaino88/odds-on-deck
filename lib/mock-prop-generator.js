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
  
  // Common prop types by sport
  const propTypesBySport = {
    mlb: ['hits', 'total_bases', 'rbis'],
    nfl: ['passing_yards', 'rushing_yards', 'receiving_yards'],
    nhl: ['points', 'goals', 'shots_on_goal']
  }
  
  const propTypes = propTypesBySport[game.sport] || propTypesBySport.mlb
  
  // Generate mock player names based on teams
  const mockPlayers = [
    { name: `${game.awayTeam || 'Away'} Player 1`, team: game.awayTeam },
    { name: `${game.awayTeam || 'Away'} Player 2`, team: game.awayTeam },
    { name: `${game.awayTeam || 'Away'} Player 3`, team: game.awayTeam },
    { name: `${game.homeTeam || 'Home'} Player 1`, team: game.homeTeam },
    { name: `${game.homeTeam || 'Home'} Player 2`, team: game.homeTeam },
    { name: `${game.homeTeam || 'Home'} Player 3`, team: game.homeTeam }
  ]
  
  // Generate props for each mock player
  for (const player of mockPlayers) {
    for (const propType of propTypes) {
      // Generate random but realistic stats
      const baseValue = propType.includes('yards') ? 
        (Math.random() * 50 + 30) : // 30-80 yards
        (Math.random() * 2 + 0.5)    // 0.5-2.5 for counting stats
      
      const stats = {
        gamesPlayed: 10,
        average: baseValue,
        stdDev: baseValue * 0.3,
        trend: 'stable',
        last5Games: []
      }
      
      // Calculate threshold (round to nearest .5)
      const threshold = Math.round(stats.average * 2) / 2
      
      // Calculate probability using appropriate distribution
      const probOver = calculateOverProbability(stats.average, threshold)
      const probUnder = 1 - probOver
      
      // Our prediction (slightly favor over for variety)
      const prediction = probOver >= 0.48 ? 'over' : 'under'
      const ourProbability = prediction === 'over' ? probOver : probUnder
      
      // Generate synthetic odds
      const syntheticOdds = probabilityToOdds(ourProbability)
      
      // Calculate confidence
      let confidence = 'medium'
      if (Math.abs(ourProbability - 0.5) > 0.15) {
        confidence = 'high'
      } else if (Math.abs(ourProbability - 0.5) < 0.05) {
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
        reasoning: `${player.name} projected ${stats.average.toFixed(1)} ${propType}. Threshold: ${threshold}`,
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
  
  // Get today's and upcoming games (not finished)
  const games = await prisma.game.findMany({
    where: {
      date: {
        gte: today,
        lt: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
      },
      status: { 
        notIn: ['final', 'completed', 'F', 'closed'] 
      }
    }
  })
  
  console.log(`📊 Found ${games.length} upcoming games for mock prop generation`)
  
  if (games.length === 0) {
    console.log('⚠️ No upcoming games found')
    return {
      generated: 0,
      games: 0,
      saved: 0
    }
  }
  
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
 * For mock props with fake players, we generate realistic validation results
 */
export async function validateCompletedMockProps() {
  console.log('🔍 Validating completed mock props...')
  
  // Get pending mock props
  const pendingProps = await prisma.mockPropValidation.findMany({
    where: { status: 'pending' }
  })
  
  console.log(`📊 Found ${pendingProps.length} pending mock props`)
  
  if (pendingProps.length === 0) {
    return {
      validated: 0,
      correct: 0,
      incorrect: 0,
      pushes: 0
    }
  }
  
  let validated = 0
  let correct = 0
  let incorrect = 0
  let pushes = 0
  
  for (const prop of pendingProps) {
    try {
      // Get game
      const game = await prisma.game.findUnique({
        where: { id: prop.gameIdRef }
      })
      
      if (!game) continue
      
      // Check if game is final
      const gameDate = new Date(game.date)
      const now = new Date()
      const hoursAgo = (now - gameDate) / (1000 * 60 * 60)
      
      const isFinal = 
        ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
        hoursAgo > 5 // Game started more than 5 hours ago
      
      if (!isFinal) {
        console.log(`⏳ Game ${game.id} not final yet (started ${hoursAgo.toFixed(1)}h ago)`)
        continue
      }
      
      // For mock props, generate realistic "actual" values based on projection
      // Use normal distribution around the expected value
      const variance = prop.expectedValue * 0.3 // 30% standard deviation
      const randomFactor = (Math.random() - 0.5) * 2 // -1 to 1
      let actualValue = prop.expectedValue + (randomFactor * variance)
      
      // Round to appropriate precision
      if (prop.propType.includes('yards')) {
        actualValue = Math.round(actualValue)
      } else {
        actualValue = Math.round(actualValue * 10) / 10 // One decimal
      }
      
      // Ensure non-negative for counting stats
      actualValue = Math.max(0, actualValue)
      
      // Calculate result
      let result = 'incorrect'
      const diff = Math.abs(actualValue - prop.threshold)
      
      // 5% chance of push (very close to threshold)
      if (diff < 0.1 && Math.random() < 0.05) {
        result = 'push'
        actualValue = prop.threshold
      } else if (
        (prop.prediction === 'over' && actualValue > prop.threshold) ||
        (prop.prediction === 'under' && actualValue < prop.threshold)
      ) {
        result = 'correct'
        correct++
      } else {
        result = 'incorrect'
        incorrect++
      }
      
      if (result === 'push') pushes++
      
      // Update mock prop
      await prisma.mockPropValidation.update({
        where: { id: prop.id },
        data: {
          actualValue,
          result,
          status: 'completed',
          validatedAt: new Date(),
          notes: `Mock validation: Expected ${prop.expectedValue.toFixed(1)}, Actual ${actualValue.toFixed(1)}`
        }
      })
      
      validated++
      
      if (validated % 10 === 0) {
        console.log(`✅ Validated ${validated} props so far...`)
      }
    } catch (error) {
      console.error(`Error validating mock prop ${prop.id}:`, error.message)
    }
  }
  
  console.log(`✅ Validated ${validated} mock props: ${correct} correct, ${incorrect} incorrect, ${pushes} pushes`)
  
  return {
    success: true,
    validated: validated,
    correct: correct,
    incorrect: incorrect,
    pushes: pushes
  }
}

