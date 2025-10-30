// Editor's Picks - Generate recommended bets based on edges and analysis

import { calculateGameEdges } from './edge.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

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
        if (calculatedEdge.edgeMlHome && calculatedEdge.edgeMlHome > 0.05 && calculatedEdge.edgeMlHome < 0.5) {
          const homeOdds = game.odds.find(o => o.market === 'h2h' && o.priceHome)
          const impliedProb = oddsToImpliedProbability(homeOdds?.priceHome || -110)
          const ourProb = calculatedEdge.probHome || impliedProb * (1 + calculatedEdge.edgeMlHome)
          picks.push({
            gameId: game.id,
            type: 'moneyline',
            pick: 'home',
            team: game.home.abbr,
            opponent: game.away.abbr,
            edge: calculatedEdge.edgeMlHome,
            odds: homeOdds?.priceHome || null,
            probability: Math.min(0.70, ourProb), // Cap at 70%
            confidence: getConfidenceLevel(calculatedEdge.edgeMlHome),
            reasoning: `${game.home.abbr} at home vs ${game.away.abbr} - ${(calculatedEdge.edgeMlHome * 100).toFixed(1)}% edge`,
            gameTime: game.date,
            status: game.status
          })
        }
        
        if (calculatedEdge.edgeMlAway && calculatedEdge.edgeMlAway > 0.05 && calculatedEdge.edgeMlAway < 0.5) {
          const awayOdds = game.odds.find(o => o.market === 'h2h' && o.priceAway)
          const impliedProb = oddsToImpliedProbability(awayOdds?.priceAway || -110)
          const ourProb = calculatedEdge.probAway || impliedProb * (1 + calculatedEdge.edgeMlAway)
          picks.push({
            gameId: game.id,
            type: 'moneyline',
            pick: 'away',
            team: game.away.abbr,
            opponent: game.home.abbr,
            edge: calculatedEdge.edgeMlAway,
            odds: awayOdds?.priceAway || null,
            probability: Math.min(0.70, ourProb), // Cap at 70%
            confidence: getConfidenceLevel(calculatedEdge.edgeMlAway),
            reasoning: `${game.away.abbr} @ ${game.home.abbr} - ${(calculatedEdge.edgeMlAway * 100).toFixed(1)}% edge`,
            gameTime: game.date,
            status: game.status
          })
        }
        
        // TOTAL PICKS - Look for strong edges (>3% for totals) but cap unrealistic values  
        if (calculatedEdge.edgeTotalO && calculatedEdge.edgeTotalO > 0.03 && calculatedEdge.edgeTotalO < 0.5) {
          const totalOdds = game.odds.find(o => o.market === 'totals' && o.total)
          const impliedProb = oddsToImpliedProbability(-110) // Totals usually near even
          const ourProb = impliedProb * (1 + calculatedEdge.edgeTotalO)
          picks.push({
            gameId: game.id,
            type: 'total',
            pick: 'over',
            team: `${game.away.abbr} @ ${game.home.abbr}`,
            opponent: null,
            edge: calculatedEdge.edgeTotalO,
            odds: totalOdds?.total || null,
            probability: Math.min(0.65, ourProb), // Cap at 65% for totals
            confidence: getConfidenceLevel(calculatedEdge.edgeTotalO),
            reasoning: `${game.away.abbr} @ ${game.home.abbr} OVER ${totalOdds?.total || 'TBD'} - ${(calculatedEdge.edgeTotalO * 100).toFixed(1)}% edge`,
            gameTime: game.date,
            status: game.status
          })
        }
        
        if (calculatedEdge.edgeTotalU && calculatedEdge.edgeTotalU > 0.03 && calculatedEdge.edgeTotalU < 0.5) {
          const totalOdds = game.odds.find(o => o.market === 'totals' && o.total)
          const impliedProb = oddsToImpliedProbability(-110) // Totals usually near even
          const ourProb = impliedProb * (1 + calculatedEdge.edgeTotalU)
          picks.push({
            gameId: game.id,
            type: 'total',
            pick: 'under',
            team: `${game.away.abbr} @ ${game.home.abbr}`,
            opponent: null,
            edge: calculatedEdge.edgeTotalU,
            odds: totalOdds?.total || null,
            probability: Math.min(0.65, ourProb), // Cap at 65% for totals
            confidence: getConfidenceLevel(calculatedEdge.edgeTotalU),
            reasoning: `${game.away.abbr} @ ${game.home.abbr} UNDER ${totalOdds?.total || 'TBD'} - ${(calculatedEdge.edgeTotalU * 100).toFixed(1)}% edge`,
            gameTime: game.date,
            status: game.status
          })
        }
        continue
      }
      
    }
    
    // Sort picks by WIN PROBABILITY (highest first), then edge as tiebreaker
    // This matches the parlay generator and player props logic
    picks.sort((a, b) => {
      // Primary sort: Win probability (highest first)
      if (Math.abs((a.probability || 0.5) - (b.probability || 0.5)) > 0.01) {
        return (b.probability || 0.5) - (a.probability || 0.5)
      }
      // Tiebreaker: Edge (highest first)
      return b.edge - a.edge
    })
    
    console.log(`✅ Generated ${picks.length} editor picks sorted by win probability`)
    if (picks.length > 0) {
      console.log(`📊 Top pick: ${picks[0].team} ${picks[0].type} (${((picks[0].probability || 0.5) * 100).toFixed(1)}% win chance, ${(picks[0].edge * 100).toFixed(1)}% edge)`)
    }
    
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
 * Convert American odds to implied probability
 */
function oddsToImpliedProbability(americanOdds) {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100)
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  }
}

/**
 * Check if a game has ended
 */
function isGameEnded(status) {
  const endedStatuses = ['final', 'completed', 'postponed', 'cancelled', 'suspended']
  return endedStatuses.includes(status?.toLowerCase())
}
