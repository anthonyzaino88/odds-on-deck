// Advanced NFL Player Props with Matchup Analysis

import { getDefensiveRankings } from './nfl-matchups.js'
import { getGameStarters } from './nfl-roster.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

// Position-specific prop types
export const NFL_PROP_TYPES = {
  QB: [
    'passing_yards',
    'passing_touchdowns',
    'interceptions',
    'rushing_yards',
    'passing_completions'
  ],
  RB: [
    'rushing_yards',
    'rushing_touchdowns',
    'receiving_yards',
    'receptions',
    'rushing_attempts'
  ],
  WR: [
    'receiving_yards',
    'receiving_touchdowns',
    'receptions',
    'longest_reception',
    'receiving_yards_o49_5'
  ],
  TE: [
    'receiving_yards',
    'receiving_touchdowns',
    'receptions',
    'longest_reception'
  ],
  K: [
    'field_goals_made',
    'extra_points_made',
    'longest_field_goal'
  ],
  DEF: [
    'sacks',
    'interceptions',
    'fumble_recoveries',
    'points_allowed',
    'total_tackles'
  ]
}

// Sample player season stats (would come from NFL stats API)
const PLAYER_SEASON_STATS = {
  'patrick_mahomes': {
    position: 'QB',
    gamesPlayed: 12,
    stats: {
      passing_yards: { total: 3423, avg: 285.3, last3: [312, 278, 291] },
      passing_touchdowns: { total: 24, avg: 2.0, last3: [3, 1, 2] },
      interceptions: { total: 8, avg: 0.67, last3: [1, 0, 1] },
      rushing_yards: { total: 184, avg: 15.3, last3: [18, 12, 22] }
    }
  },
  'lamar_jackson': {
    position: 'QB',
    gamesPlayed: 11,
    stats: {
      passing_yards: { total: 2876, avg: 261.5, last3: [298, 245, 267] },
      passing_touchdowns: { total: 18, avg: 1.64, last3: [2, 2, 1] },
      interceptions: { total: 5, avg: 0.45, last3: [0, 1, 0] },
      rushing_yards: { total: 612, avg: 55.6, last3: [62, 48, 71] }
    }
  }
  // Add more players...
}

/**
 * Generate comprehensive NFL player props for upcoming games
 */
export async function generateAdvancedNFLPlayerProps() {
  try {
    console.log('🏈 Generating advanced NFL player props...')
    
    const upcomingGames = await prisma.game.findMany({
      where: {
        sport: 'nfl',
        status: {
          in: ['scheduled', 'in_progress']
        },
        date: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
        }
      },
      include: {
        home: true,
        away: true,
        odds: {
          orderBy: { ts: 'desc' },
          take: 2
        }
      }
    })
    
    if (upcomingGames.length === 0) {
      console.log('No upcoming NFL games found')
      return []
    }
    
    const allProps = []
    const defensiveRankings = await getDefensiveRankings()
    
    for (const game of upcomingGames) {
      try {
        console.log(`  Analyzing props for ${game.away.abbr} @ ${game.home.abbr}...`)
        
        // Get starting lineups
        const starters = await getGameStarters(game.id)
        if (!starters) continue
        
        // Generate props for key positions
        const homeProps = await generateTeamProps(
          game, starters.home, starters.away.team, defensiveRankings, 'home'
        )
        const awayProps = await generateTeamProps(
          game, starters.away, starters.home.team, defensiveRankings, 'away'
        )
        
        allProps.push(...homeProps, ...awayProps)
        
      } catch (error) {
        console.error(`Error generating props for game ${game.id}:`, error.message)
      }
    }
    
    // Store props in database
    await storePlayerProps(allProps)
    
    // Sort by edge and return top props
    const topProps = allProps
      .filter(prop => prop.edge && prop.edge > 0.05) // 5%+ edge
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 20)
    
    console.log(`✅ Generated ${allProps.length} NFL player props, ${topProps.length} with significant edge`)
    return topProps
    
  } catch (error) {
    console.error('Error generating NFL player props:', error)
    return []
  }
}

/**
 * Generate props for a specific team
 */
async function generateTeamProps(game, teamData, opposingTeam, defensiveRankings, side) {
  const props = []
  const { team, starters } = teamData
  
  // Get opposing defense rankings
  const oppDefense = defensiveRankings[opposingTeam.abbr.toLowerCase()] || {}
  
  for (const player of starters) {
    const playerStats = PLAYER_SEASON_STATS[player.fullName.toLowerCase().replace(/\s+/g, '_')]
    if (!playerStats) continue
    
    const propTypes = NFL_PROP_TYPES[player.position] || []
    
    for (const propType of propTypes) {
      const prop = await generatePlayerProp(
        game, player, propType, playerStats, oppDefense, side
      )
      if (prop) props.push(prop)
    }
  }
  
  return props
}

/**
 * Generate individual player prop with projection and edge
 */
async function generatePlayerProp(game, player, propType, playerStats, oppDefense, side) {
  try {
    const stats = playerStats.stats[propType]
    if (!stats) return null
    
    // Base projection from season average
    let projection = stats.avg
    
    // Adjust for recent form (last 3 games)
    if (stats.last3 && stats.last3.length > 0) {
      const recentAvg = stats.last3.reduce((sum, val) => sum + val, 0) / stats.last3.length
      const formFactor = recentAvg / stats.avg
      projection *= (0.7 + 0.3 * formFactor) // Weight recent form 30%
    }
    
    // Adjust for matchup difficulty
    const matchupAdjustment = getMatchupAdjustment(propType, oppDefense, player.position)
    projection *= matchupAdjustment
    
    // Adjust for home/away
    const homeAdjustment = side === 'home' ? 1.02 : 0.98 // Small home field advantage
    projection *= homeAdjustment
    
    // Get market line (mock for now, would come from odds API)
    const marketLine = getMarketLine(propType, projection)
    
    // Calculate edge
    const edge = Math.max(0, (projection - marketLine) / marketLine)
    
    // Determine confidence
    const confidence = getConfidence(edge, stats.last3?.length || 0, matchupAdjustment)
    
    return {
      playerId: player.id,
      playerName: player.fullName,
      position: player.position,
      team: side === 'home' ? game.home.abbr : game.away.abbr,
      gameId: game.id,
      propType,
      threshold: marketLine,
      projection: Math.round(projection * 10) / 10,
      edge: Math.round(edge * 1000) / 10, // Convert to percentage with 1 decimal
      confidence,
      vsDefenseRank: getDefenseRank(propType, oppDefense),
      playerAverage: stats.avg,
      recentForm: stats.last3 ? stats.last3.reduce((sum, val) => sum + val, 0) / stats.last3.length : null,
      book: 'DraftKings',
      matchupAdjustment: Math.round(matchupAdjustment * 100) / 100
    }
    
  } catch (error) {
    console.error(`Error generating prop for ${player.fullName} ${propType}:`, error.message)
    return null
  }
}

/**
 * Get matchup adjustment factor based on opposing defense
 */
function getMatchupAdjustment(propType, oppDefense, position) {
  let baseAdjustment = 1.0
  
  if (propType.includes('passing')) {
    // Better pass defense = lower projections
    const passDefRank = oppDefense.passDefense || 16
    baseAdjustment = 1.0 + (16 - passDefRank) * 0.015 // ±24% range
  } else if (propType.includes('rushing')) {
    const rushDefRank = oppDefense.rushDefense || 16
    baseAdjustment = 1.0 + (16 - rushDefRank) * 0.02 // ±32% range
  } else if (propType.includes('receiving')) {
    const passDefRank = oppDefense.passDefense || 16
    baseAdjustment = 1.0 + (16 - passDefRank) * 0.012 // ±19% range
  }
  
  // Clamp between 0.7 and 1.3
  return Math.max(0.7, Math.min(1.3, baseAdjustment))
}

/**
 * Get mock market line (would come from sportsbook API)
 */
function getMarketLine(propType, projection) {
  // Add some variance to create betting opportunities
  const variance = 0.9 + Math.random() * 0.2 // ±10% variance
  let line = projection * variance
  
  // Round to common betting increments
  if (propType.includes('yards')) {
    line = Math.round(line / 5) * 5 + 0.5 // Round to X.5
  } else if (propType.includes('touchdown') || propType.includes('interception')) {
    line = Math.round(line * 2) / 2 // Round to 0.5 increments
  } else {
    line = Math.round(line * 2) / 2
  }
  
  return line
}

/**
 * Determine confidence level
 */
function getConfidence(edge, recentGamesSample, matchupAdjustment) {
  let confidence = 'low'
  
  if (edge > 0.15 && recentGamesSample >= 3 && matchupAdjustment > 1.05) {
    confidence = 'very_high'
  } else if (edge > 0.10 && recentGamesSample >= 2) {
    confidence = 'high'
  } else if (edge > 0.05) {
    confidence = 'medium'
  }
  
  return confidence
}

/**
 * Get defense rank for specific prop type
 */
function getDefenseRank(propType, oppDefense) {
  if (propType.includes('passing')) return oppDefense.passDefense
  if (propType.includes('rushing')) return oppDefense.rushDefense
  if (propType.includes('receiving')) return oppDefense.passDefense
  return null
}

/**
 * Store player props in database
 */
async function storePlayerProps(props) {
  try {
    for (const prop of props) {
      await prisma.nFLPlayerProp.upsert({
        where: {
          id: `${prop.gameId}_${prop.playerId}_${prop.propType}`
        },
        update: {
          threshold: prop.threshold,
          projection: prop.projection,
          edge: prop.edge / 100, // Store as decimal
          confidence: prop.confidence,
          vsDefenseRank: prop.vsDefenseRank,
          playerAverage: prop.playerAverage,
          recentForm: prop.recentForm,
          book: prop.book
        },
        create: {
          id: `${prop.gameId}_${prop.playerId}_${prop.propType}`,
          playerId: prop.playerId,
          gameId: prop.gameId,
          propType: prop.propType,
          threshold: prop.threshold,
          projection: prop.projection,
          edge: prop.edge / 100,
          confidence: prop.confidence,
          vsDefenseRank: prop.vsDefenseRank,
          playerAverage: prop.playerAverage,
          recentForm: prop.recentForm,
          book: prop.book
        }
      })
    }
    
    console.log(`💾 Stored ${props.length} NFL player props in database`)
    
  } catch (error) {
    console.error('Error storing player props:', error)
  }
}

/**
 * Get top NFL player props with edge
 */
export async function getTopNFLPlayerProps(limit = 10) {
  try {
    const props = await prisma.nFLPlayerProp.findMany({
      where: {
        edge: { gt: 0.05 } // 5%+ edge
      },
      include: {
        player: true,
        game: {
          include: {
            home: true,
            away: true
          }
        }
      },
      orderBy: [
        { edge: 'desc' },
        { confidence: 'desc' }
      ],
      take: limit
    })
    
    return props.map(prop => ({
      ...prop,
      edge: prop.edge * 100, // Convert back to percentage
      gameInfo: `${prop.game.away.abbr} @ ${prop.game.home.abbr}`
    }))
    
  } catch (error) {
    console.error('Error getting top NFL player props:', error)
    return []
  }
}

export default {
  generateAdvancedNFLPlayerProps,
  getTopNFLPlayerProps,
  NFL_PROP_TYPES
}
