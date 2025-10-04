// NFL Player Props - Generate prop bet recommendations for football

import { PrismaClient } from '@prisma/client'
import { fetchESPNTeamRoster } from './vendors/espn-nfl-roster.js'

const prisma = new PrismaClient()

/**
 * Generate NFL player prop recommendations for this week's games
 */
export async function generateNFLPlayerProps() {
  try {
    console.log('🏈 Generating NFL player props with live roster data...')
    
    // Get this week's NFL games
    const games = await prisma.game.findMany({
      where: {
        sport: 'nfl',
        status: { in: ['scheduled', 'pre_game'] }, // Only upcoming games
      },
      include: {
        home: true,
        away: true,
        odds: true
      }
    })
    
    if (games.length === 0) {
      console.log('No NFL games found for this week')
      return []
    }
    
    const props = []
    
    for (const game of games) {
      console.log(`  📊 Analyzing props for ${game.away?.abbr} @ ${game.home?.abbr}`)
      
      // Fetch live roster data for both teams
      const homeRoster = await fetchESPNTeamRoster(game.home?.abbr?.toLowerCase())
      const awayRoster = await fetchESPNTeamRoster(game.away?.abbr?.toLowerCase())
      
      if (!homeRoster || !awayRoster) {
        console.log(`    ⚠️ Could not fetch roster data for ${game.away?.abbr} @ ${game.home?.abbr}`)
        continue
      }
      
      // Analyze QB props
      const homeQB = homeRoster.QB?.[0] // Starting QB
      const awayQB = awayRoster.QB?.[0] // Starting QB
      
      if (homeQB) {
        const qbProps = await analyzeQBProps(homeQB, game, 'home')
        props.push(...qbProps)
      }
      
      if (awayQB) {
        const qbProps = await analyzeQBProps(awayQB, game, 'away')
        props.push(...qbProps)
      }
      
      // Analyze skill position props
      const homeSkillPlayers = [
        ...(homeRoster.RB || []).slice(0, 2), // Top 2 RBs
        ...(homeRoster.WR || []).slice(0, 3), // Top 3 WRs
        ...(homeRoster.TE || []).slice(0, 2)  // Top 2 TEs
      ]
      
      const awaySkillPlayers = [
        ...(awayRoster.RB || []).slice(0, 2), // Top 2 RBs
        ...(awayRoster.WR || []).slice(0, 3), // Top 3 WRs
        ...(awayRoster.TE || []).slice(0, 2)  // Top 2 TEs
      ]
      
      // Analyze home team skill players
      for (const player of homeSkillPlayers) {
        const skillProps = await analyzeSkillPlayerProps(player, game, 'home')
        props.push(...skillProps)
      }
      
      // Analyze away team skill players
      for (const player of awaySkillPlayers) {
        const skillProps = await analyzeSkillPlayerProps(player, game, 'away')
        props.push(...skillProps)
      }
    }
    
    // Filter for high-quality props only
    const filteredProps = props.filter(prop => {
      // Only show props with minimum quality thresholds
      const minEdge = 0.25 // 25% edge minimum for NFL props
      const minConfidence = ['very_high', 'high'] // Only high confidence props
      
      return prop.edge >= minEdge && minConfidence.includes(prop.confidence)
    })
    
    // Sort by edge and confidence
    filteredProps.sort((a, b) => {
      if (a.confidence !== b.confidence) {
        const confidenceOrder = { 'very_high': 5, 'high': 4, 'medium': 3, 'low': 2, 'very_low': 1 }
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence]
      }
      return b.edge - a.edge
    })
    
    console.log(`🏈 Generated ${filteredProps.length} high-quality NFL props (filtered from ${props.length} total)`)
    
    return filteredProps
    
  } catch (error) {
    console.error('Error generating NFL player props:', error)
    return []
  }
}

/**
 * Analyze quarterback prop opportunities
 */
async function analyzeQBProps(qb, game, team) {
  const props = []
  
  try {
    // Mock QB projections based on experience and position
    // In a real implementation, this would use historical stats and matchup data
    const basePassYards = 250 + (qb.experience * 5) // More experience = slightly better
    const projectedPassYards = basePassYards + (Math.random() - 0.5) * 100
    const projectedPassTDs = 1.8 + (Math.random() - 0.5) * 1.0
    const projectedRushYards = 10 + (Math.random() - 0.5) * 30
    
    // PASSING YARDS PROPS
    if (projectedPassYards >= 265) {
      props.push({
        gameId: game.id,
        playerId: qb.espnId || qb.name,
        playerName: qb.name,
        team: team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'passing_yards',
        pick: 'over',
        threshold: 250.5,
        projection: projectedPassYards,
        edge: Math.max(0, (projectedPassYards - 250.5) / 250.5),
        confidence: getNFLPropConfidence(projectedPassYards - 250.5),
        reasoning: `Projects ${projectedPassYards.toFixed(0)} passing yards vs ${team === 'home' ? game.away.abbr : game.home.abbr} defense`,
        gameTime: game.date,
        week: game.week
      })
    }
    
    // PASSING TDs PROPS
    if (projectedPassTDs >= 2.3) {
      props.push({
        gameId: game.id,
        playerId: qb.id,
        playerName: qb.fullName,
        team: team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'passing_tds',
        pick: 'over',
        threshold: 1.5,
        projection: projectedPassTDs,
        edge: Math.max(0, (projectedPassTDs - 1.5) / 1.5),
        confidence: getNFLPropConfidence(projectedPassTDs - 1.5),
        reasoning: `Projects ${projectedPassTDs.toFixed(1)} passing TDs in favorable matchup`,
        gameTime: game.date,
        week: game.week
      })
    }
    
    // RUSHING YARDS PROPS (for mobile QBs)
    if (projectedRushYards >= 25) {
      props.push({
        gameId: game.id,
        playerId: qb.id,
        playerName: qb.fullName,
        team: team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'rushing_yards',
        pick: 'over',
        threshold: 20.5,
        projection: projectedRushYards,
        edge: Math.max(0, (projectedRushYards - 20.5) / 20.5),
        confidence: getNFLPropConfidence(projectedRushYards - 20.5),
        reasoning: `Mobile QB projects ${projectedRushYards.toFixed(0)} rushing yards`,
        gameTime: game.date,
        week: game.week
      })
    }
    
  } catch (error) {
    console.error(`Error analyzing QB props for ${qb.fullName}:`, error)
  }
  
  return props
}

/**
 * Analyze skill position player props
 */
async function analyzeSkillPlayerProps(player, game, team) {
  const props = []
  
  try {
    // Mock projections based on position and experience (would use real stats)
    let projections = {}
    
    switch (player.position) {
      case 'RB':
        projections = {
          rushYards: 70 + (player.experience * 3) + Math.random() * 60,
          rushTDs: 0.6 + (player.experience * 0.1) + Math.random() * 0.7,
          receptions: 2 + (player.experience * 0.2) + Math.random() * 4,
          recYards: 20 + (player.experience * 2) + Math.random() * 30
        }
        break
        
      case 'WR':
        projections = {
          receptions: 4 + (player.experience * 0.3) + Math.random() * 4,
          recYards: 60 + (player.experience * 3) + Math.random() * 50,
          recTDs: 0.6 + Math.random() * 0.8
        }
        break
        
      case 'TE':
        projections = {
          receptions: 3 + (player.experience * 0.2) + Math.random() * 3,
          recYards: 40 + (player.experience * 2) + Math.random() * 35,
          recTDs: 0.4 + Math.random() * 0.6
        }
        break
    }
    
    // Generate props based on projections
    Object.entries(projections).forEach(([statType, projection]) => {
      const threshold = getThreshold(statType, player.position)
      if (projection >= threshold * 1.15) { // 15% edge minimum
        props.push({
          gameId: game.id,
          playerId: player.espnId || player.name,
          playerName: player.name,
          team: team === 'home' ? game.home.abbr : game.away.abbr,
          opponent: team === 'home' ? game.away.abbr : game.home.abbr,
          type: statType,
          pick: 'over',
          threshold: threshold,
          projection: projection,
          edge: Math.max(0, (projection - threshold) / threshold),
          confidence: getNFLPropConfidence(projection - threshold),
          reasoning: `${player.position} projects ${projection.toFixed(1)} ${statType.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
          gameTime: game.date,
          week: game.week
        })
      }
    })
    
  } catch (error) {
    console.error(`Error analyzing skill player props for ${player.fullName}:`, error)
  }
  
  return props
}

/**
 * Get typical prop thresholds by stat type and position
 */
function getThreshold(statType, position) {
  const thresholds = {
    'rushYards': { 'RB': 65.5, 'QB': 20.5 },
    'rushTDs': { 'RB': 0.5, 'QB': 0.5 },
    'receptions': { 'RB': 3.5, 'WR': 5.5, 'TE': 3.5 },
    'recYards': { 'RB': 25.5, 'WR': 65.5, 'TE': 45.5 },
    'recTDs': { 'RB': 0.5, 'WR': 0.5, 'TE': 0.5 }
  }
  
  return thresholds[statType]?.[position] || 0
}

/**
 * Get confidence level for NFL props
 */
function getNFLPropConfidence(edge) {
  if (edge >= 20) return 'very_high'  // 20+ over threshold
  if (edge >= 15) return 'high'       // 15+ over threshold
  if (edge >= 10) return 'medium'     // 10+ over threshold
  if (edge >= 5) return 'low'         // 5+ over threshold
  return 'very_low'                   // <5 over threshold
}

/**
 * Get top NFL props
 */
export async function getTopNFLProps(limit = 10) {
  const allProps = await generateNFLPlayerProps()
  return allProps.slice(0, limit)
}
