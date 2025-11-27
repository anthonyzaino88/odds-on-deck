// Simple NHL Props Generator
// This is a simplified version that generates NHL props for testing

import { recordPropPrediction } from './validation.js'
import { calculateQualityScore } from './quality-score.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Generate simple NHL player props for testing
 */
export async function generateSimpleNHLProps() {
  try {
    console.log('🏒 Generating simple NHL player props for testing...')
    
    const props = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(23, 59, 59, 999)
    
    // Get NHL games
    const games = await prisma.game.findMany({
      where: {
        date: { gte: today, lt: tomorrow },
        sport: 'nhl',
        status: { in: ['scheduled', 'pre-game', 'pre_game', 'in_progress'] }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    console.log(`Found ${games.length} NHL games for prop generation`)
    
    // Sample NHL players (would come from roster in production)
    const samplePlayers = [
      { name: 'Connor McDavid', position: 'C' },
      { name: 'Nathan MacKinnon', position: 'C' },
      { name: 'Auston Matthews', position: 'C' },
      { name: 'Leon Draisaitl', position: 'C' },
      { name: 'Cale Makar', position: 'D' },
      { name: 'Sidney Crosby', position: 'C' },
      { name: 'David Pastrnak', position: 'RW' },
      { name: 'Nikita Kucherov', position: 'RW' },
      { name: 'Artemi Panarin', position: 'LW' },
      { name: 'Mikko Rantanen', position: 'RW' }
    ]
    
    // Generate props for each game
    for (const game of games) {
      console.log(`Generating props for ${game.away.name} @ ${game.home.name}`)
      
      // Assign players to teams (simplified)
      const homePlayers = samplePlayers.slice(0, 5)
      const awayPlayers = samplePlayers.slice(5)
      
      // Generate props for home team players
      for (const player of homePlayers) {
        // Points prop
        const pointsProps = generatePlayerProp(player, game, 'points', 1.5, game.home.abbr)
        props.push(pointsProps)
        
        // Goals prop
        const goalsProps = generatePlayerProp(player, game, 'goals', 0.5, game.home.abbr)
        props.push(goalsProps)
        
        // Shots prop
        const shotsProps = generatePlayerProp(player, game, 'shots', 2.5, game.home.abbr)
        props.push(shotsProps)
      }
      
      // Generate props for away team players
      for (const player of awayPlayers) {
        // Points prop
        const pointsProps = generatePlayerProp(player, game, 'points', 1.5, game.away.abbr)
        props.push(pointsProps)
        
        // Goals prop
        const goalsProps = generatePlayerProp(player, game, 'goals', 0.5, game.away.abbr)
        props.push(goalsProps)
        
        // Shots prop
        const shotsProps = generatePlayerProp(player, game, 'shots', 2.5, game.away.abbr)
        props.push(shotsProps)
      }
    }
    
    // Record props for validation
    for (const prop of props) {
      await recordPropPrediction(prop, 'system_generated')
    }
    
    console.log(`✅ Generated ${props.length} NHL props`)
    return props
    
  } catch (error) {
    console.error('Error generating simple NHL props:', error)
    return []
  }
}

/**
 * Generate a single player prop
 */
function generatePlayerProp(player, game, propType, threshold, teamAbbr) {
  // HONEST: Use market-implied probability, no fake edge
  // Real edge requires line shopping or player projections
  const probability = 0.50 // Market implied (no edge assumption)
  const edge = 0 // HONEST: No fake edge without real data
  const confidence = 'low' // Without data, confidence is low
  
  // Calculate odds
  const odds = edge > 0.10 ? -120 : -110
  
  // Calculate quality score
  const qualityScore = calculateQualityScore({
    probability,
    edge,
    confidence
  })
  
  return {
    id: `nhl-${game.id}-${player.name}-${propType}`,
    gameId: game.id,
    playerName: player.name,
    team: teamAbbr,
    type: propType,
    pick: 'over',
    threshold,
    odds,
    probability,
    edge,
    confidence,
    qualityScore,
    reasoning: `${player.name} ${propType} over ${threshold}`,
    gameTime: game.date,
    sport: 'nhl',
    category: 'player_prop',
    bookmaker: 'Test'
  }
}

/**
 * Get confidence level based on edge
 */
function getConfidenceLevel(edge) {
  if (edge >= 0.15) return 'high'
  if (edge >= 0.08) return 'medium'
  return 'low'
}

export default {
  generateSimpleNHLProps
}
