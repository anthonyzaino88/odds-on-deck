// Player Props Generation
// Generates player prop opportunities for MLB, NFL, and NHL

import dotenv from 'dotenv'
import { prisma } from './db.js'
import { recordPropPrediction } from './validation.js'
import { generateNFLPlayerProps } from './nfl-props.js'
import { generateNHLPlayerProps } from './nhl-props.js'
import { generateSimpleNHLProps } from './nhl-props-simple.js'

// Load environment variables
dotenv.config({ path: '.env.local' })

// Calculate pitcher strikeout threshold based on pitcher stats and opposing team
function calculatePitcherStrikeoutThreshold(pitcher, opposingTeam) {
  // Default threshold
  let threshold = 5.5;
  
  // Adjust based on pitcher K% if available
  if (pitcher.splits && pitcher.splits.length > 0) {
    const recentSplit = pitcher.splits.sort((a, b) => b.season - a.season)[0];
    if (recentSplit && recentSplit.kRate) {
      // League average K% is around 22%
      // Adjust threshold based on how much above/below average
      const kRateAdjustment = (recentSplit.kRate - 0.22) * 10; // 10 is a scaling factor
      threshold += kRateAdjustment;
    }
  } else {
    // Use pitcher name to create deterministic but varied thresholds for demo purposes
    // In production, we would use real stats
    const nameSum = pitcher.fullName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const adjustment = ((nameSum % 10) - 5) * 0.1;
    threshold += adjustment;
  }
  
  // Adjust for opposing team's strikeout tendency
  // This would ideally use team K%, but for now we'll use a simple adjustment
  if (opposingTeam) {
    const teamAdjustments = {
      'LAD': -0.5, 'HOU': -0.5, 'NYY': -0.5, // Good contact teams (lower K%)
      'DET': 0.5, 'OAK': 0.5, 'MIA': 0.5     // High K% teams
    };
    
    threshold += teamAdjustments[opposingTeam.abbr] || 0;
    
    // For demo purposes, use team name to create deterministic but varied thresholds
    const teamNameSum = opposingTeam.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const teamAdjustment = ((teamNameSum % 6) - 3) * 0.1;
    threshold += teamAdjustment;
  }
  
  // Round to nearest 0.5 and ensure reasonable range
  threshold = Math.round(threshold * 2) / 2; // Round to nearest 0.5
  return Math.max(3.5, Math.min(8.5, threshold)); // Cap between 3.5 and 8.5
}

// Calculate pitcher strikeout projection
function calculatePitcherStrikeoutProjection(pitcher, opposingTeam) {
  // Start with the threshold and add a small edge
  const threshold = calculatePitcherStrikeoutThreshold(pitcher, opposingTeam);
  
  // Use pitcher name to create deterministic projection for demo purposes
  // In production, we would use real stats and more sophisticated models
  const nameSum = pitcher.fullName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const projectionOffset = ((nameSum % 10) - 3) * 0.1;
  const projection = threshold + projectionOffset;
  
  // Round to 1 decimal place
  return Math.round(projection * 10) / 10;
}

/**
 * Analyze batter vs pitcher matchup
 * @param {object} batter - Batter player object
 * @param {object} pitcher - Pitcher player object
 * @returns {object} Matchup analysis results
 */
function analyzeBatterVsPitcher(batter, pitcher) {
  // Default result
  const result = {
    advantage: 'neutral',
    confidence: 'medium',
    hitsEdge: 0,
    hitsPick: 'over',
    hitsReasoning: null,
    totalBasesEdge: 0,
    totalBasesPick: 'over',
    rbisEdge: 0,
    rbisPick: 'over'
  };
  
  // If no pitcher, return default
  if (!pitcher) {
    return result;
  }
  
  // Check for platoon advantage (L vs R, R vs L)
  if (batter.bats && pitcher.throws) {
    // Switch hitter always has slight advantage
    if (batter.bats === 'S') {
      result.advantage = 'batter';
      result.hitsEdge = 0.02;
      result.totalBasesEdge = 0.03;
      result.hitsReasoning = `${batter.fullName} (switch) has the platoon advantage against ${pitcher.throws}-handed ${pitcher.fullName}`;
    } 
    // Left batter vs right pitcher (advantage)
    else if (batter.bats === 'L' && pitcher.throws === 'R') {
      result.advantage = 'batter';
      result.hitsEdge = 0.03;
      result.totalBasesEdge = 0.04;
      result.hitsReasoning = `${batter.fullName} (L) has the platoon advantage against ${pitcher.fullName} (R)`;
    }
    // Right batter vs left pitcher (advantage)
    else if (batter.bats === 'R' && pitcher.throws === 'L') {
      result.advantage = 'batter';
      result.hitsEdge = 0.025;
      result.totalBasesEdge = 0.035;
      result.hitsReasoning = `${batter.fullName} (R) has the platoon advantage against ${pitcher.fullName} (L)`;
    }
    // Same handedness (disadvantage)
    else {
      result.advantage = 'pitcher';
      result.hitsEdge = -0.02;
      result.totalBasesEdge = -0.03;
      result.hitsPick = 'under';
      result.totalBasesPick = 'under';
      result.hitsReasoning = `${batter.fullName} (${batter.bats}) faces a tough matchup against same-handed ${pitcher.fullName} (${pitcher.throws})`;
    }
  }
  
  // Check for specific pitcher stats that might affect the matchup
  if (pitcher.splits && pitcher.splits.length > 0) {
    const recentSplit = pitcher.splits.sort((a, b) => b.season - a.season)[0];
    
    // High strikeout pitcher
    if (recentSplit.kRate && recentSplit.kRate > 0.25) {
      result.hitsEdge -= 0.02;
      result.totalBasesEdge -= 0.03;
      if (result.hitsReasoning) {
        result.hitsReasoning += `. ${pitcher.fullName} has a high K% of ${(recentSplit.kRate * 100).toFixed(1)}%`;
      } else {
        result.hitsReasoning = `${pitcher.fullName} has a high K% of ${(recentSplit.kRate * 100).toFixed(1)}%`;
      }
    }
    
    // Low strikeout pitcher
    if (recentSplit.kRate && recentSplit.kRate < 0.18) {
      result.hitsEdge += 0.02;
      result.totalBasesEdge += 0.02;
      if (result.hitsReasoning) {
        result.hitsReasoning += `. ${pitcher.fullName} has a low K% of ${(recentSplit.kRate * 100).toFixed(1)}%`;
      } else {
        result.hitsReasoning = `${pitcher.fullName} has a low K% of ${(recentSplit.kRate * 100).toFixed(1)}%`;
      }
    }
  }
  
  // Check for specific batter stats
  if (batter.splits && batter.splits.length > 0) {
    const recentSplit = batter.splits.sort((a, b) => b.season - a.season)[0];
    
    // High wOBA batter
    if (recentSplit.wOBA && recentSplit.wOBA > 0.350) {
      result.hitsEdge += 0.02;
      result.totalBasesEdge += 0.03;
      result.rbisEdge += 0.03;
      if (result.hitsReasoning) {
        result.hitsReasoning += `. ${batter.fullName} has a strong wOBA of ${recentSplit.wOBA.toFixed(3)}`;
      } else {
        result.hitsReasoning = `${batter.fullName} has a strong wOBA of ${recentSplit.wOBA.toFixed(3)}`;
      }
    }
    
    // High ISO (power) batter
    if (recentSplit.ISO && recentSplit.ISO > 0.200) {
      result.totalBasesEdge += 0.04;
      result.rbisEdge += 0.03;
      if (result.hitsReasoning) {
        result.hitsReasoning += `. ${batter.fullName} shows good power with ISO of ${recentSplit.ISO.toFixed(3)}`;
      } else {
        result.hitsReasoning = `${batter.fullName} shows good power with ISO of ${recentSplit.ISO.toFixed(3)}`;
      }
    }
  }
  
  // Set confidence based on the amount of data we have
  if ((batter.splits && batter.splits.length > 0) && (pitcher.splits && pitcher.splits.length > 0)) {
    result.confidence = 'high';
  } else if (batter.splits || pitcher.splits) {
    result.confidence = 'medium';
  } else {
    result.confidence = 'low';
  }
  
  return result;
}

// Calculate batter hits threshold based on player stats and batting order
function calculateBatterHitsThreshold(player, battingOrder, matchupResult = {}) {
  // Default threshold
  let threshold = 1.5;
  
  // Adjust based on batting order
  if (battingOrder <= 3) {
    // Top of the order gets slightly higher threshold
    threshold += 0.1;
  } else if (battingOrder >= 7) {
    // Bottom of the order gets slightly lower threshold
    threshold -= 0.1;
  }
  
  // Adjust based on player stats if available
  if (player.splits && player.splits.length > 0) {
    const recentSplit = player.splits.sort((a, b) => b.season - a.season)[0];
    if (recentSplit && recentSplit.wOBA) {
      // League average wOBA is around .320
      // Adjust threshold based on how much above/below average
      const wobaAdjustment = (recentSplit.wOBA - 0.320) * 2; // 2 is a scaling factor
      threshold += wobaAdjustment;
    }
  } else {
    // Use player name to create deterministic but varied thresholds for demo purposes
    const nameSum = player.fullName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const adjustment = ((nameSum % 10) - 5) * 0.05;
    threshold += adjustment;
  }
  
  // Apply matchup adjustment if available
  if (matchupResult && matchupResult.advantage) {
    if (matchupResult.advantage === 'batter') {
      threshold += 0.1;
    } else if (matchupResult.advantage === 'pitcher') {
      threshold -= 0.1;
    }
  }
  
  // Round to nearest 0.5 and ensure reasonable range
  threshold = Math.round(threshold * 2) / 2; // Round to nearest 0.5
  return Math.max(0.5, Math.min(2.5, threshold)); // Cap between 0.5 and 2.5
}

// Calculate batter hits projection
function calculateBatterHitsProjection(player, battingOrder, matchupResult = {}) {
  // Start with the threshold and add a small edge
  const threshold = calculateBatterHitsThreshold(player, battingOrder, matchupResult);
  
  // Base projection
  let projection = threshold + 0.2;
  
  // Use player name to create deterministic projection for demo purposes
  const nameSum = player.fullName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const projectionOffset = ((nameSum % 10) - 3) * 0.05;
  projection += projectionOffset;
  
  // Apply matchup adjustment if available
  if (matchupResult && matchupResult.hitsEdge) {
    projection += matchupResult.hitsEdge * 2; // Scale the edge to projection
  }
  
  // Round to 1 decimal place
  return Math.round(projection * 10) / 10;
}

export async function generatePlayerProps() {
  console.log('🎯 Generating player props for MLB, NFL, and NHL...')
  
  try {
    const allProps = []
    
    // Generate MLB props
    console.log('⚾ Generating MLB player props...')
    try {
      const mlbProps = await generateMLBPlayerProps()
      allProps.push(...mlbProps)
      console.log(`✅ Generated ${mlbProps.length} MLB props`)
    } catch (error) {
      console.error('❌ Error generating MLB props:', error)
    }
    
    // Generate NFL props
    console.log('🏈 Generating NFL player props...')
    try {
      const nflProps = await generateNFLPlayerProps()
      allProps.push(...nflProps)
      console.log(`✅ Generated ${nflProps.length} NFL props`)
    } catch (error) {
      console.error('❌ Error generating NFL props:', error)
    }
    
    // Generate NHL props
    console.log('🏒 Generating NHL player props...')
    try {
      // Try to use real NHL props first
      let nhlProps = await generateNHLPlayerProps()
      
      // If no props were generated, fall back to simple props
      if (!nhlProps || nhlProps.length === 0) {
        console.log('⚠️ No real NHL props available, using simple test props')
        nhlProps = await generateSimpleNHLProps()
      }
      
      allProps.push(...nhlProps)
      console.log(`✅ Generated ${nhlProps.length} NHL props`)
    } catch (error) {
      console.error('❌ Error generating NHL props:', error)
      // Try simple props as fallback
      try {
        console.log('⚠️ Falling back to simple NHL props')
        const simpleProps = await generateSimpleNHLProps()
        allProps.push(...simpleProps)
        console.log(`✅ Generated ${simpleProps.length} simple NHL props`)
      } catch (fallbackError) {
        console.error('❌ Error generating simple NHL props:', fallbackError)
      }
    }
    
    console.log(`🎯 Total props generated: ${allProps.length} (MLB + NFL + NHL)`)
    return allProps
    
  } catch (error) {
    console.error('Error in generatePlayerProps:', error)
    return []
  }
}

/**
 * Generate MLB player props (extracted from main function)
 */
async function generateMLBPlayerProps() {
  const props = []
  
  try {
    // Get today's games with lineups - use a 2-day window for consistency
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    
    // First, get all games in the date range
    const gamesInRange = await prisma.game.findMany({
      where: {
        date: {
          gte: today,
          lt: dayAfterTomorrow,
        },
        sport: 'mlb'
      },
      select: { id: true, status: true, date: true }
    })

    console.log(`Found ${gamesInRange.length} MLB games in date range`)
    console.log('Games:', gamesInRange.map(g => `${g.id} (${g.status})`))

    // Filter for games with valid status
    const validGames = gamesInRange.filter(game =>
      ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'in_progress'].includes(game.status)
    )

    console.log(`Found ${validGames.length} games with valid status`)

    // Get games with their lineups and probable pitchers
    const games = []
    for (const game of validGames) {
      const fullGame = await prisma.game.findUnique({
        where: { id: game.id },
        include: {
          home: true,
          away: true,
          probableHomePitcher: true,
          probableAwayPitcher: true,
          lineups: {
            include: {
              player: true
            },
            where: {
              isStarting: true,
              battingOrder: { not: null }
            },
            orderBy: [
              { team: 'asc' },
              { battingOrder: 'asc' }
            ]
          }
        }
      })

      if (fullGame && fullGame.lineups.length > 0) {
        games.push(fullGame)
      }
    }

    console.log(`Found ${games.length} games with lineups`)
    
    console.log(`📊 Found ${games.length} games with lineups`)
    console.log(`Games found:`, games.map(g => ({ id: g.id, status: g.status, lineups: g.lineups.length })))

    // Debug: Check all games in database for comparison
    const allGames = await prisma.game.findMany({
      where: { sport: 'mlb' },
      select: { id: true, status: true, date: true }
    })
    console.log(`Total MLB games in DB: ${allGames.length}`)
    allGames.forEach(game => {
      const gameDate = new Date(game.date)
      const inRange = gameDate >= today && gameDate < dayAfterTomorrow
      console.log(`  ${game.id}: ${game.status} - ${gameDate.toISOString()} - in range: ${inRange}`)
    })
    
    for (const game of games) {
      console.log(`🎯 Generating props for ${game.away.abbr} @ ${game.home.abbr}`)
      
      // Generate props for starting pitchers
      if (game.probableHomePitcher) {
        const pitcher = game.probableHomePitcher;
        console.log(`Pitcher (Home): ${pitcher.fullName}, ID: ${pitcher.id}, Team: home`)
        
        // Generate pitching props
        const pitchingProps = [
          {
            id: `prop-${pitcher.id}-strikeouts-${game.id}`,
            playerId: pitcher.id,
            playerName: pitcher.fullName,
            gameId: game.id,
            team: 'home',
            type: 'strikeouts',
            pick: 'over',
            threshold: calculatePitcherStrikeoutThreshold(pitcher, game.away),
            odds: -115,
            probability: 0.53,
            edge: 0.07,
            confidence: 'medium',
            reasoning: `${pitcher.fullName} has good K potential against this lineup`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'pitching',
            projection: calculatePitcherStrikeoutProjection(pitcher, game.away)
          },
          {
            id: `prop-${pitcher.id}-earned_runs-${game.id}`,
            playerId: pitcher.id,
            playerName: pitcher.fullName,
            gameId: game.id,
            team: 'home',
            type: 'earned_runs',
            pick: 'under',
            threshold: 2.5,
            odds: -130,
            probability: 0.57,
            edge: 0.06,
            confidence: 'medium',
            reasoning: `${pitcher.fullName} has been effective recently`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'pitching',
            projection: 2.1
          },
          {
            id: `prop-${pitcher.id}-innings-${game.id}`,
            playerId: pitcher.id,
            playerName: pitcher.fullName,
            gameId: game.id,
            team: 'home',
            type: 'innings_pitched',
            pick: 'over',
            threshold: 5.5,
            odds: -110,
            probability: 0.52,
            edge: 0.04,
            confidence: 'medium',
            reasoning: `${pitcher.fullName} should have good length in this matchup`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'pitching',
            projection: 5.8
          }
        ]
        
        props.push(...pitchingProps)
      }
      
      if (game.probableAwayPitcher) {
        const pitcher = game.probableAwayPitcher;
        console.log(`Pitcher (Away): ${pitcher.fullName}, ID: ${pitcher.id}, Team: away`)
        
        // Generate pitching props
        const pitchingProps = [
          {
            id: `prop-${pitcher.id}-strikeouts-${game.id}`,
            playerId: pitcher.id,
            playerName: pitcher.fullName,
            gameId: game.id,
            team: 'away',
            type: 'strikeouts',
            pick: 'over',
            threshold: calculatePitcherStrikeoutThreshold(pitcher, game.home),
            odds: -115,
            probability: 0.53,
            edge: 0.07,
            confidence: 'medium',
            reasoning: `${pitcher.fullName} has good K potential against this lineup`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'pitching',
            projection: calculatePitcherStrikeoutProjection(pitcher, game.home)
          },
          {
            id: `prop-${pitcher.id}-earned_runs-${game.id}`,
            playerId: pitcher.id,
            playerName: pitcher.fullName,
            gameId: game.id,
            team: 'away',
            type: 'earned_runs',
            pick: 'under',
            threshold: 2.5,
            odds: -130,
            probability: 0.57,
            edge: 0.06,
            confidence: 'medium',
            reasoning: `${pitcher.fullName} has been effective recently`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'pitching',
            projection: 2.1
          },
          {
            id: `prop-${pitcher.id}-innings-${game.id}`,
            playerId: pitcher.id,
            playerName: pitcher.fullName,
            gameId: game.id,
            team: 'away',
            type: 'innings_pitched',
            pick: 'over',
            threshold: 5.5,
            odds: -110,
            probability: 0.52,
            edge: 0.04,
            confidence: 'medium',
            reasoning: `${pitcher.fullName} should have good length in this matchup`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'pitching',
            projection: 5.8
          }
        ]
        
        props.push(...pitchingProps)
      }
      
      // Generate props for starting players
      for (const lineup of game.lineups) {
        const player = lineup.player
        
        // Skip pitchers for hitting props
        if (player.isPitcher) continue
        
        // Debug player data
        console.log(`Player: ${player.fullName}, ID: ${player.id}, Team: ${lineup.team}, Batting: ${lineup.battingOrder}`)
        
        // Get the opposing pitcher for matchup analysis
        const opposingPitcher = lineup.team === 'home' ? game.probableAwayPitcher : game.probableHomePitcher;
        
        // Analyze batter vs pitcher matchup
        const matchupResult = analyzeBatterVsPitcher(player, opposingPitcher);
        
        // Generate common MLB player props with matchup adjustments
        const playerProps = [
          {
            id: `prop-${player.id}-hits-${game.id}`,
            playerId: player.id,
            playerName: player.fullName,
            gameId: game.id,
            team: lineup.team,
            type: 'hits',
            pick: matchupResult.hitsPick || 'over',
            threshold: calculateBatterHitsThreshold(player, lineup.battingOrder, matchupResult),
            odds: -110,
            probability: 0.52 + (matchupResult.hitsEdge || 0),
            edge: 0.08 + (matchupResult.hitsEdge || 0),
            confidence: matchupResult.confidence || 'medium',
            reasoning: matchupResult.hitsReasoning || `${player.fullName} has been hitting well recently`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'batting',
            projection: calculateBatterHitsProjection(player, lineup.battingOrder, matchupResult)
          },
          {
            id: `prop-${player.id}-total-bases-${game.id}`,
            playerId: player.id,
            playerName: player.fullName,
            gameId: game.id,
            team: lineup.team,
            type: 'total_bases',
            pick: matchupResult.totalBasesPick || 'over',
            threshold: 1.5,
            odds: -105,
            probability: 0.51 + (matchupResult.totalBasesEdge || 0),
            edge: 0.06 + (matchupResult.totalBasesEdge || 0),
            confidence: matchupResult.confidence || 'medium',
            reasoning: `${player.fullName} has power potential${matchupResult.hitsReasoning ? ' and ' + matchupResult.hitsReasoning.toLowerCase() : ''}`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'batting',
            projection: 2.1 + (matchupResult.totalBasesEdge ? matchupResult.totalBasesEdge * 3 : 0)
          },
          {
            id: `prop-${player.id}-rbis-${game.id}`,
            playerId: player.id,
            playerName: player.fullName,
            gameId: game.id,
            team: lineup.team,
            type: 'rbis',
            pick: matchupResult.rbisPick || 'over',
            threshold: 0.5,
            odds: -120,
            probability: 0.55 + (matchupResult.rbisEdge || 0),
            edge: 0.05 + (matchupResult.rbisEdge || 0),
            confidence: matchupResult.confidence || 'medium',
            reasoning: `${player.fullName} in good RBI position${lineup.battingOrder <= 5 ? ' batting in the heart of the order' : ''}${matchupResult.hitsReasoning ? ' and ' + matchupResult.hitsReasoning.toLowerCase() : ''}`,
            gameTime: game.date,
            sport: 'mlb',
            category: 'batting',
            projection: 0.8 + (matchupResult.rbisEdge ? matchupResult.rbisEdge * 2 : 0) + (lineup.battingOrder <= 5 ? 0.2 : 0)
          }
        ]
        
        props.push(...playerProps)
      }
    }
    
    console.log(`✅ Generated ${props.length} player props`)
    
    // Record props for validation
    try {
      for (const prop of props) {
        await recordPropPrediction(prop);
      }
      console.log(`✅ Recorded ${props.length} props for validation`);
    } catch (error) {
      console.error('Error recording props for validation:', error);
    }
    
    return props
    
  } catch (error) {
    console.error('❌ Error generating MLB player props:', error)
    return []
  }
}