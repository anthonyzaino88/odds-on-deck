// Player Props - Generate prop bet recommendations based on matchup analysis

import { PrismaClient } from '@prisma/client'
import { generateNFLPlayerProps } from './nfl-props.js'

const prisma = new PrismaClient()

/**
 * Generate player prop recommendations for today's games (MLB and NFL)
 * Only shows high-quality props for current/upcoming games
 */
export async function generatePlayerProps() {
  try {
    const now = new Date()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Get ONLY TODAY'S games with lineups available (exclude yesterday's games)
    const games = await prisma.game.findMany({
      where: {
        date: {
          gte: today, // Only today's games
          lt: tomorrow,
        },
        status: { in: ['scheduled', 'pre_game', 'pre-game', 'warmup', 'in_progress'] }, // Only active games, not final
        lineups: {
          some: {} // Must have lineups
        }
      },
      include: {
        home: true,
        away: true,
        lineups: {
          include: {
            player: {
              include: {
                splits: {
                  where: {
                    season: new Date().getFullYear(),
                    scope: 'season'
                  }
                }
              }
            }
          },
          orderBy: [
            { team: 'asc' },
            { battingOrder: 'asc' }
          ]
        }
      },
      orderBy: [
        { date: 'desc' },
        { status: 'asc' } // Prioritize scheduled/active games
      ]
    })
    
    console.log(`📊 Found ${games.length} games with lineups for player props analysis`)
    
    // Log which games are being used
    games.forEach(game => {
      const gameDate = new Date(game.date).toDateString()
      const isToday = gameDate === today.toDateString()
      console.log(`  ${isToday ? '🎯 TODAY' : '📅 ' + gameDate}: ${game.away.abbr} @ ${game.home.abbr} (${game.status}) - ${game.lineups.length} lineups`)
    })
    
    if (games.length === 0) {
      console.log('❌ No games with lineups found - cannot generate player props')
      return []
    }
    
    const mlbProps = []
    
    for (const game of games) {
      // Get lineups
      const homeLineup = game.lineups.filter(l => l.team === 'home')
      const awayLineup = game.lineups.filter(l => l.team === 'away')
      
      // Get actual starting pitchers (use probable pitchers as they should be accurate for today's games)
      const homePitcher = game.probableHomePitcherId ? await getPlayerWithStats(game.probableHomePitcherId) : null
      const awayPitcher = game.probableAwayPitcherId ? await getPlayerWithStats(game.probableAwayPitcherId) : null
      
      // Log pitcher info for debugging
      if (homePitcher) {
        console.log(`  🎯 Home pitcher: ${homePitcher.fullName} (${game.home.abbr})`)
      }
      if (awayPitcher) {
        console.log(`  🎯 Away pitcher: ${awayPitcher.fullName} (${game.away.abbr})`)
      }
      
      // Home team batters vs away pitcher
      for (const lineup of homeLineup) {
        const batterProps = await analyzeBatterProps(
          lineup.player, 
          awayPitcher, 
          game, 
          lineup.battingOrder
        )
        mlbProps.push(...batterProps)
      }
      
      // Away team batters vs home pitcher  
      for (const lineup of awayLineup) {
        const batterProps = await analyzeBatterProps(
          lineup.player, 
          homePitcher, 
          game, 
          lineup.battingOrder
        )
        mlbProps.push(...batterProps)
      }
      
      // Pitcher props
      if (homePitcher) {
        const pitcherProps = await analyzePitcherProps(homePitcher, awayLineup, game)
        mlbProps.push(...pitcherProps)
      }
      
      if (awayPitcher) {
        const pitcherProps = await analyzePitcherProps(awayPitcher, homeLineup, game)
        mlbProps.push(...pitcherProps)
      }
    }
    
    // Get NFL props (only for today's games)
    const nflProps = await generateNFLPlayerProps()
    
    // Combine MLB and NFL props
    const allProps = [...mlbProps, ...nflProps]
    
    // Remove duplicate props (same player, same type, same game)
    const uniqueProps = []
    const seenProps = new Set()
    
    for (const prop of allProps) {
      const key = `${prop.playerId}-${prop.type}-${prop.gameId}`
      if (!seenProps.has(key)) {
        seenProps.add(key)
        uniqueProps.push(prop)
      } else {
        console.log(`🔄 Removing duplicate prop: ${prop.playerName} - ${prop.type}`)
      }
    }
    
    // Apply quality filters to only show high-probability props
    const filteredProps = uniqueProps.filter(prop => {
      // Lower thresholds to show more props
      const minEdge = (prop.type === 'strikeouts' || prop.type === 'pitcher_strikeouts') ? 0.10 : 0.08 // 10% for strikeouts, 8% for others
      const minConfidence = ['very_high', 'high', 'medium'] // Include medium confidence props
      
      return prop.edge >= minEdge && minConfidence.includes(prop.confidence)
    })
    
    // Sort by a combined score: confidence + edge + recency
    filteredProps.sort((a, b) => {
      const confidenceOrder = { 'very_high': 5, 'high': 4, 'medium': 3, 'low': 2, 'very_low': 1 }
      
      // Calculate combined score
      const aScore = (confidenceOrder[a.confidence] * 100) + (a.edge * 100) + (a.gameTime ? 10 : 0)
      const bScore = (confidenceOrder[b.confidence] * 100) + (b.edge * 100) + (b.gameTime ? 10 : 0)
      
      return bScore - aScore
    })
    
    console.log(`🎯 Generated ${filteredProps.length} high-quality props (filtered from ${allProps.length} total)`)
    
    return filteredProps
    
  } catch (error) {
    console.error('Error generating player props:', error)
    return []
  }
}

/**
 * Analyze batter prop opportunities
 */
async function analyzeBatterProps(batter, pitcher, game, battingOrder) {
  const props = []
  
  try {
    if (!batter.splits || batter.splits.length === 0) {
      return props
    }
    
    // Get batter's splits vs pitcher handedness
    const pitcherHand = pitcher?.throws || 'R'
    const batterSplit = batter.splits.find(s => s.vsHand === pitcherHand) || batter.splits[0]
    
    if (!batterSplit || !batterSplit.samplePA || batterSplit.samplePA < 50) {
      return props // Need sufficient sample size
    }
    
    // Calculate expected stats based on splits
    const expectedHits = calculateExpectedHits(batterSplit, battingOrder, game)
    const expectedRBIs = calculateExpectedRBIs(batterSplit, battingOrder, game)
    const expectedStrikeouts = calculateExpectedStrikeouts(batterSplit, pitcher)
    
    // Generate props based on thresholds
    
    // HITS PROPS
    if (expectedHits >= 1.8) {
      props.push({
        gameId: game.id,
        playerId: batter.id,
        playerName: batter.fullName,
        team: battingOrder <= 5 ? (game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.home.abbr : game.away.abbr) : 'Unknown',
        opponent: battingOrder <= 5 ? (game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.away.abbr : game.home.abbr) : 'Unknown',
        type: 'hits',
        pick: 'over',
        threshold: 1.5,
        projection: expectedHits,
        edge: Math.max(0, (expectedHits - 1.5) / 1.5),
        confidence: getPlayerPropConfidence(expectedHits - 1.5, batterSplit.samplePA),
        reasoning: `Projects ${expectedHits.toFixed(2)} hits vs ${pitcherHand}HP (${batterSplit.wOBA?.toFixed(3)} wOBA, batting ${battingOrder}${getOrdinalSuffix(battingOrder)})`,
        gameTime: game.date,
        battingOrder: battingOrder
      })
    }
    
    // RBI PROPS (for top 6 hitters only)
    if (battingOrder <= 6 && expectedRBIs >= 0.4) {
      props.push({
        gameId: game.id,
        playerId: batter.id,
        playerName: batter.fullName,
        team: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'rbis',
        pick: 'over',
        threshold: 0.5,
        projection: expectedRBIs,
        edge: Math.max(0, (expectedRBIs - 0.5) / 0.5),
        confidence: getPlayerPropConfidence(expectedRBIs - 0.5, batterSplit.samplePA),
        reasoning: `Projects ${expectedRBIs.toFixed(2)} RBIs (${batterSplit.ISO?.toFixed(3)} ISO, batting ${battingOrder}${getOrdinalSuffix(battingOrder)} vs ${pitcherHand}HP)`,
        gameTime: game.date,
        battingOrder: battingOrder
      })
    }
    
    // TOTAL BASES PROPS
    const expectedTotalBases = calculateExpectedTotalBases(batterSplit, battingOrder, game)
    if (expectedTotalBases >= 0.5) {
      props.push({
        gameId: game.id,
        playerId: batter.id,
        playerName: batter.fullName,
        team: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'total_bases',
        pick: 'over',
        threshold: 0.5,
        projection: expectedTotalBases,
        edge: Math.max(0, (expectedTotalBases - 0.5) / 0.5),
        confidence: getPlayerPropConfidence(expectedTotalBases - 0.5, batterSplit.samplePA),
        reasoning: `Projects ${expectedTotalBases.toFixed(2)} total bases (${batterSplit.slg?.toFixed(3)} SLG, batting ${battingOrder}${getOrdinalSuffix(battingOrder)} vs ${pitcherHand}HP)`,
        gameTime: game.date,
        battingOrder: battingOrder
      })
    }
    
    // HOME RUN PROPS (for power hitters)
    const expectedHR = calculateExpectedHomeRuns(batterSplit, battingOrder, game)
    if (expectedHR >= 0.1) {
      props.push({
        gameId: game.id,
        playerId: batter.id,
        playerName: batter.fullName,
        team: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'home_runs',
        pick: 'over',
        threshold: 0.5,
        projection: expectedHR,
        edge: Math.max(0, (expectedHR - 0.5) / 0.5),
        confidence: getPlayerPropConfidence(expectedHR - 0.5, batterSplit.samplePA),
        reasoning: `Projects ${expectedHR.toFixed(2)} HRs (${batterSplit.iso?.toFixed(3)} ISO, batting ${battingOrder}${getOrdinalSuffix(battingOrder)} vs ${pitcherHand}HP)`,
        gameTime: game.date,
        battingOrder: battingOrder
      })
    }
    
    // BATTER STRIKEOUT PROPS (how many times batter strikes out)
    if (expectedStrikeouts <= 1.0) {
      props.push({
        gameId: game.id,
        playerId: batter.id,
        playerName: batter.fullName,
        team: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.home.abbr : game.away.abbr,
        opponent: game.lineups.find(l => l.playerId === batter.id)?.team === 'home' ? game.away.abbr : game.home.abbr,
        type: 'batter_strikeouts',
        pick: 'under',
        threshold: 0.5,
        projection: expectedStrikeouts,
        edge: Math.max(0, (0.5 - expectedStrikeouts) / 0.5),
        confidence: getPlayerPropConfidence(0.5 - expectedStrikeouts, batterSplit.samplePA),
        reasoning: `Projects ${expectedStrikeouts.toFixed(2)} strikeouts (${(1-batterSplit.kRate)?.toFixed(3)} contact rate vs ${pitcherHand}HP)`,
        gameTime: game.date,
        battingOrder: battingOrder
      })
    }
    
  } catch (error) {
    console.error(`Error analyzing batter props for ${batter.fullName}:`, error)
  }
  
  return props
}

/**
 * Analyze pitcher prop opportunities
 */
async function analyzePitcherProps(pitcher, opposingLineup, game) {
  const props = []
  
  try {
    if (!pitcher) {
      return props
    }
    
    // Get pitcher's effectiveness vs different handedness
    let vsRightySplit = pitcher.splits?.find(s => s.vsHand === 'R')
    let vsLeftySplit = pitcher.splits?.find(s => s.vsHand === 'L')
    
    // If no splits data, use default stats
    if (!vsRightySplit && !vsLeftySplit) {
      console.log(`⚠️ No splits data for pitcher ${pitcher.fullName}, using default stats`)
      vsRightySplit = {
        kRate: 0.23, // Average MLB K-rate
        era: 4.00,   // Average MLB ERA
        samplePA: 100
      }
      vsLeftySplit = {
        kRate: 0.23,
        era: 4.00,
        samplePA: 100
      }
    }
    
    // Calculate expected strikeouts based on opposing lineup
    const expectedStrikeouts = calculatePitcherStrikeouts(pitcher, opposingLineup)
    
    // PITCHER STRIKEOUT PROPS (how many strikeouts pitcher gets)
    if (expectedStrikeouts >= 5.5) {
      const threshold = expectedStrikeouts >= 6.5 ? 6.5 : 5.5
      props.push({
        gameId: game.id,
        playerId: pitcher.id,
        playerName: pitcher.fullName,
        team: pitcher.teamId === game.homeId ? game.home.abbr : game.away.abbr,
        opponent: pitcher.teamId === game.homeId ? game.away.abbr : game.home.abbr,
        type: 'pitcher_strikeouts',
        pick: 'over',
        threshold: threshold,
        projection: expectedStrikeouts,
        edge: Math.max(0, (expectedStrikeouts - threshold) / threshold),
        confidence: getPlayerPropConfidence(expectedStrikeouts - threshold, 200), // Assume decent sample
        reasoning: `Projects ${expectedStrikeouts.toFixed(1)} strikeouts vs opposing lineup (${vsRightySplit?.kRate?.toFixed(3) || 'N/A'} K-rate vs R, ${vsLeftySplit?.kRate?.toFixed(3) || 'N/A'} vs L)`,
        gameTime: game.date,
        battingOrder: null
      })
    }
    
    // EARNED RUNS PROPS - Add new prop type
    const expectedER = calculatePitcherER(pitcher, opposingLineup)
    if (expectedER <= 3.5) {
      const threshold = expectedER <= 2.5 ? 2.5 : 3.5
      props.push({
        gameId: game.id,
        playerId: pitcher.id,
        playerName: pitcher.fullName,
        team: pitcher.teamId === game.homeId ? game.home.abbr : game.away.abbr,
        opponent: pitcher.teamId === game.homeId ? game.away.abbr : game.home.abbr,
        type: 'earned_runs',
        pick: 'under',
        threshold: threshold,
        projection: expectedER,
        edge: Math.max(0, (threshold - expectedER) / threshold),
        confidence: getPlayerPropConfidence(threshold - expectedER, 150),
        reasoning: `Projects ${expectedER.toFixed(1)} ER vs opposing lineup (${vsRightySplit?.era?.toFixed(2) || 'N/A'} ERA vs R, ${vsLeftySplit?.era?.toFixed(2) || 'N/A'} vs L)`,
        gameTime: game.date,
        battingOrder: null
      })
    }
    
  } catch (error) {
    console.error(`Error analyzing pitcher props for ${pitcher.fullName}:`, error)
  }
  
  return props
}

/**
 * Helper functions for calculations
 */
function calculateExpectedHits(batterSplit, battingOrder, game) {
  const baseHitRate = (batterSplit.wOBA || 0.300) * 1.2 // Rough conversion
  
  // Lineup position adjustment (top of order gets more PAs)
  const lineupMultiplier = battingOrder <= 3 ? 1.15 : battingOrder <= 6 ? 1.0 : 0.85
  
  // Park factor adjustment
  const parkFactor = 1.0 // Could use team park factors if available
  
  return baseHitRate * lineupMultiplier * parkFactor * 4.2 // ~4.2 PAs per game
}

function calculateExpectedRBIs(batterSplit, battingOrder, game) {
  // Use wOBA as proxy for power since ISO might not be available
  const basePower = (batterSplit.wOBA || 0.300) * 0.5 // Convert wOBA to power metric
  const rbiOpportunityMultiplier = battingOrder <= 2 ? 0.7 : battingOrder <= 5 ? 1.3 : battingOrder <= 7 ? 1.1 : 0.8
  
  return basePower * rbiOpportunityMultiplier * 2 + 0.4 // More realistic RBI calculation
}

function calculateExpectedTotalBases(batterSplit, battingOrder, game) {
  // Use wOBA as proxy for slugging since SLG might not be available
  const baseSlugging = (batterSplit.wOBA || 0.300) * 1.3 // Convert wOBA to slugging proxy
  const lineupMultiplier = battingOrder <= 3 ? 1.15 : battingOrder <= 6 ? 1.0 : 0.85
  
  return baseSlugging * lineupMultiplier * 1.0 + 0.3 // More realistic total bases calculation
}

function calculateExpectedHomeRuns(batterSplit, battingOrder, game) {
  // Use wOBA as proxy for power since ISO might not be available
  const basePower = (batterSplit.wOBA || 0.300) * 0.3 // Convert wOBA to power metric
  const powerMultiplier = battingOrder <= 4 ? 1.2 : battingOrder <= 6 ? 1.0 : 0.8
  
  return basePower * powerMultiplier * 2.0 + 0.1 // More realistic HR rate calculation
}

function calculateExpectedStrikeouts(batterSplit, pitcher) {
  const batterKRate = batterSplit.kRate || 0.22
  const pitcherBonus = pitcher?.splits?.find(s => s.vsHand)?.kRate || 0.23
  
  return (batterKRate + pitcherBonus) / 2 * 4.2 // More realistic strikeout calculation
}

function calculatePitcherStrikeouts(pitcher, opposingLineup) {
  // Average K-rate against opposing handedness
  let totalKRate = 0
  let lineupCount = 0
  
  for (const lineup of opposingLineup) {
    const batterHand = lineup.player.bats || 'R'
    const pitcherSplit = pitcher.splits?.find(s => s.vsHand === batterHand)
    
    if (pitcherSplit && pitcherSplit.kRate) {
      totalKRate += pitcherSplit.kRate
      lineupCount++
    }
  }
  
  // If no splits data, use default K-rate
  const avgKRate = lineupCount > 0 ? totalKRate / lineupCount : 0.23
  return avgKRate * 27 // Rough innings calculation (6-7 innings)
}

function calculatePitcherER(pitcher, opposingLineup) {
  // Average ERA against opposing handedness
  let totalERA = 0
  let lineupCount = 0
  
  for (const lineup of opposingLineup) {
    const batterHand = lineup.player.bats || 'R'
    const pitcherSplit = pitcher.splits?.find(s => s.vsHand === batterHand)
    
    if (pitcherSplit && pitcherSplit.era) {
      totalERA += pitcherSplit.era
      lineupCount++
    }
  }
  
  // If no splits data, use default ERA
  const avgERA = lineupCount > 0 ? totalERA / lineupCount : 4.00
  return avgERA * 0.75 // Rough innings calculation (6-7 innings)
}

function getPlayerPropConfidence(edge, sampleSize) {
  if (edge > 0.3 && sampleSize >= 200) return 'very_high'
  if (edge > 0.2 && sampleSize >= 150) return 'high'
  if (edge > 0.1 && sampleSize >= 100) return 'medium'
  if (edge > 0.05 && sampleSize >= 75) return 'low'
  return 'very_low'
}

function getOrdinalSuffix(num) {
  const suffix = ['th', 'st', 'nd', 'rd']
  const value = num % 100
  return suffix[(value - 20) % 10] || suffix[value] || suffix[0]
}

/**
 * Get player with current season stats
 */
async function getPlayerWithStats(playerId) {
  if (!playerId) return null
  
  // First try to get current season data
  let player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      splits: {
        where: {
          season: new Date().getFullYear(),
          scope: 'season'
        }
      }
    }
  })
  
  // If no current season data, try to get any available season data
  if (!player || !player.splits || player.splits.length === 0) {
    player = await prisma.player.findUnique({
      where: { id: playerId },
      include: {
        splits: {
          orderBy: { season: 'desc' },
          take: 1 // Get most recent season data
        }
      }
    })
  }
  
  return player
}

/**
 * Get props for a specific game
 */
export async function getGamePlayerProps(gameId) {
  const allProps = await generatePlayerProps()
  return allProps.filter(prop => prop.gameId === gameId)
}

/**
 * Get top player props of the day
 */
/**
 * Get MLB player props from database (real player data)
 * DEPRECATED: This function pulled stale data. Now using live-generated props only.
 */
export async function getMLBPropsFromDatabase() {
  // This function is deprecated - we now only use live-generated props
  // to ensure data freshness and avoid showing old/expired props
  return []
}

export async function getTopPlayerProps(limit = 10) {
  const allProps = await generatePlayerProps()
  return allProps.slice(0, limit)
}
