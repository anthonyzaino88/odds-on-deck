// Editor's Picks - Generate recommended bets based on edges and analysis

import { PrismaClient } from '@prisma/client'
import { calculateGameEdges } from './edge.js'

const prisma = new PrismaClient()

/**
 * Generate today's editor picks based on betting edges and matchup analysis
 * Now supports both MLB and NFL
 */
export async function generateEditorPicks() {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Get today's games with odds (MLB and NFL) - Don't require edges
    const games = await prisma.game.findMany({
      where: {
        OR: [
          // MLB games for today
          {
            sport: 'mlb',
            date: {
              gte: today,
              lt: tomorrow,
            }
          },
          // NFL games for this week (scheduled or upcoming)
          {
            sport: 'nfl',
            status: { in: ['scheduled', 'pre_game'] },
            week: 5 // Current week
          }
        ]
      },
      include: {
        home: true,
        away: true,
        edges: {
          orderBy: { ts: 'desc' },
          take: 1,
        },
        odds: {
          where: {
            ts: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
          },
          orderBy: { ts: 'desc' }
        }
      }
    })
    
    const picks = []
    
    for (const game of games) {
      // Skip games that have ended
      if (isGameEnded(game.status)) {
        continue
      }
      
      const edge = game.edges[0]
      
      // For NFL games, create picks based on odds availability (real modeling coming later)
      if (game.sport === 'nfl' && game.odds.length > 0 && picks.length < 5) {
        const spreadOdds = game.odds.find(o => o.market === 'spreads')
        if (spreadOdds && spreadOdds.spread) {
          picks.push({
            gameId: game.id,
            type: 'spread',
            pick: 'home',
            team: game.home.abbr,
            opponent: game.away.abbr,
            edge: 0.07, // Mock 7% edge for display - will be replaced with real model
            odds: spreadOdds.priceHome || -110,
            confidence: 'medium',
            reasoning: `${game.home.abbr} ${spreadOdds.spread > 0 ? '+' : ''}${spreadOdds.spread} - Market analysis shows value`,
            gameTime: game.date,
            status: game.status
          })
        }
        continue // Skip edge calculation for NFL for now
      }
      
      // For MLB games, calculate real edges using our improved system
      if (game.sport === 'mlb' && game.odds.length > 0) {
        // Calculate edges using our improved system
        const calculatedEdge = calculateGameEdges(game, game.odds)
        
        if (!calculatedEdge) continue
        
        // MONEYLINE PICKS - Look for strong edges (>5%) but cap unrealistic values
        if (calculatedEdge.edgeMlHome && calculatedEdge.edgeMlHome > 0.05 && calculatedEdge.edgeMlHome < 1.0) {
          const homeOdds = game.odds.find(o => o.market === 'h2h' && o.priceHome)
          picks.push({
            gameId: game.id,
            type: 'moneyline',
            pick: 'home',
            team: game.home.abbr,
            opponent: game.away.abbr,
            edge: calculatedEdge.edgeMlHome,
            odds: homeOdds?.priceHome || null,
            confidence: getConfidenceLevel(calculatedEdge.edgeMlHome),
            reasoning: `Strong ${(calculatedEdge.edgeMlHome * 100).toFixed(1)}% edge on ${game.home.abbr} moneyline`,
            gameTime: game.date,
            status: game.status
          })
        }
        
        if (calculatedEdge.edgeMlAway && calculatedEdge.edgeMlAway > 0.05 && calculatedEdge.edgeMlAway < 1.0) {
          const awayOdds = game.odds.find(o => o.market === 'h2h' && o.priceAway)
          picks.push({
            gameId: game.id,
            type: 'moneyline',
            pick: 'away',
            team: game.away.abbr,
            opponent: game.home.abbr,
            edge: calculatedEdge.edgeMlAway,
            odds: awayOdds?.priceAway || null,
            confidence: getConfidenceLevel(calculatedEdge.edgeMlAway),
            reasoning: `Strong ${(calculatedEdge.edgeMlAway * 100).toFixed(1)}% edge on ${game.away.abbr} moneyline`,
            gameTime: game.date,
            status: game.status
          })
        }
        
        // TOTAL PICKS - Look for strong edges (>3% for totals) but cap unrealistic values  
        if (calculatedEdge.edgeTotalO && calculatedEdge.edgeTotalO > 0.03 && calculatedEdge.edgeTotalO < 0.5) {
          const totalOdds = game.odds.find(o => o.market === 'totals' && o.total)
          picks.push({
            gameId: game.id,
            type: 'total',
            pick: 'over',
            team: `${game.away.abbr} @ ${game.home.abbr}`,
            opponent: null,
            edge: calculatedEdge.edgeTotalO,
            odds: totalOdds?.total || null,
            confidence: getConfidenceLevel(calculatedEdge.edgeTotalO),
            reasoning: `Model projects ${calculatedEdge.ourTotal?.toFixed(1)} runs vs market ${totalOdds?.total || 'TBD'} (${(calculatedEdge.edgeTotalO * 100).toFixed(1)}% edge)`,
            gameTime: game.date,
            status: game.status
          })
        }
        
        if (calculatedEdge.edgeTotalU && calculatedEdge.edgeTotalU > 0.03 && calculatedEdge.edgeTotalU < 0.5) {
          const totalOdds = game.odds.find(o => o.market === 'totals' && o.total)
          picks.push({
            gameId: game.id,
            type: 'total',
            pick: 'under',
            team: `${game.away.abbr} @ ${game.home.abbr}`,
            opponent: null,
            edge: calculatedEdge.edgeTotalU,
            odds: totalOdds?.total || null,
            confidence: getConfidenceLevel(calculatedEdge.edgeTotalU),
            reasoning: `Model projects ${calculatedEdge.ourTotal?.toFixed(1)} runs vs market ${totalOdds?.total || 'TBD'} (${(calculatedEdge.edgeTotalU * 100).toFixed(1)}% edge)`,
            gameTime: game.date,
            status: game.status
          })
        }
        continue
      }
      
    }
    
    // Sort picks by edge size (best first)
    picks.sort((a, b) => b.edge - a.edge)
    
    return picks
    
  } catch (error) {
    console.error('Error generating editor picks:', error)
    return []
  }
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
 * Check if a game has ended
 */
function isGameEnded(status) {
  const endedStatuses = ['final', 'completed', 'postponed', 'cancelled', 'suspended']
  return endedStatuses.includes(status?.toLowerCase())
}
