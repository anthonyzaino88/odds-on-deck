import { sanitizedErrorMessage, sanitizeLoggedValue } from './sanitize-error.js'
// NFL Player Props - Generate prop bet recommendations for football

import { fetchAllPlayerProps, parsePlayerProps } from './vendors/player-props-odds.js'
import { recordPropPrediction } from './validation.js'
import { calculateQualityScore } from './quality-score.js'
import {
  evaluateEventRosterEligibility,
  formatEventLabel,
  loadEventRosterPlayers,
  logEventRosterSkip,
} from './event-roster-eligibility.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Generate NFL player prop recommendations using real betting lines from The-Odds-API
 */
export async function generateNFLPlayerProps() {
  try {
    console.log('🏈 Generating NFL player props...')
    
    // Try to fetch REAL odds from The Odds API first
    console.log('📡 Attempting to fetch REAL NFL player props from The Odds API...')
    const realPropsData = await fetchAllPlayerProps('americanfootball_nfl')
    
    if (realPropsData && realPropsData.length > 0) {
      console.log(`✅ Found ${realPropsData.length} NFL games with real player props!`)
      const parsedProps = await parseNFLPropsFromAPI(realPropsData)
      console.log(`✅ Generated ${parsedProps.length} NFL props with REAL odds`)
      return parsedProps
    }
    
    // Fallback to estimates if API unavailable
    console.log('⚠️ No real NFL props available, using fallback system')
    return await generateNFLPropsFallback()
    
  } catch (error) {
    console.error('❌ Error fetching real NFL props:', sanitizeLoggedValue(error))
    console.log('⚠️ Falling back to estimates')
    return await generateNFLPropsFallback()
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
    console.error(`Error analyzing QB props for ${qb.fullName}:`, sanitizeLoggedValue(error))
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
    console.error(`Error analyzing skill player props for ${player.fullName}:`, sanitizeLoggedValue(error))
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

/**
 * Helper functions for the new NFL props system
 */

// Generate mock projection based on stat type and player name
function generateMockProjection(statType, playerName) {
  // This is temporary until we have real player stats
  // In a real implementation, you'd fetch historical stats and calculate projections
  
  const baseProjections = {
    'passing_yards': 250,
    'passing_touchdowns': 1.5,
    'passing_completions': 20,
    'passing_attempts': 30,
    'passing_interceptions': 0.8,
    'rushing_yards': 60,
    'rushing_attempts': 12,
    'receptions': 4,
    'receiving_yards': 50,
    'touchdowns': 0.6,
    'anytime_touchdown': 0.4
  }
  
  const base = baseProjections[statType] || 50
  const variation = (Math.random() - 0.5) * (base * 0.4) // ±20% variation
  
  return Math.max(0, base + variation)
}

// Get opponent team from game ID
function getOpponentTeam(gameId, team) {
  // Parse game ID like "NE_at_BUF_2025-10-06"
  const parts = gameId.split('_at_')
  if (parts.length === 2) {
    const away = parts[0]
    const home = parts[1].split('_')[0]
    return team === away ? home : away
  }
  return 'Unknown'
}

// Get week from game ID
function getWeekFromGameId(gameId) {
  // Extract date and calculate week
  const dateMatch = gameId.match(/(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) {
    const date = new Date(dateMatch[1])
    const seasonStart = new Date('2025-09-07') // NFL season start
    const week = Math.ceil((date - seasonStart) / (7 * 24 * 60 * 60 * 1000))
    return Math.max(1, week)
  }
  return 1
}

// Get confidence from edge
function getConfidenceFromEdge(edge) {
  if (edge >= 0.15) return 'very_high'
  if (edge >= 0.10) return 'high'
  if (edge >= 0.05) return 'medium'
  if (edge >= 0.02) return 'low'
  return 'very_low'
}

/**
 * Get known NFL players for teams (fallback when roster API fails)
 */
function getKnownPlayer(teamAbbr, position) {
  const knownPlayers = {
    'BUF': {
      'QB': { name: 'Josh Allen' },
      'RB': { name: 'James Cook' },
      'WR': { name: 'Stefon Diggs' }
    },
    'NE': {
      'QB': { name: 'Mac Jones' },
      'RB': { name: 'Rhamondre Stevenson' },
      'WR': { name: 'Kendrick Bourne' }
    },
    'KC-NFL': {
      'QB': { name: 'Patrick Mahomes' },
      'RB': { name: 'Isiah Pacheco' },
      'WR': { name: 'Travis Kelce' }
    },
    'KC': {
      'QB': { name: 'Patrick Mahomes' },
      'RB': { name: 'Isiah Pacheco' },
      'WR': { name: 'Travis Kelce' }
    },
    'JAX': {
      'QB': { name: 'Trevor Lawrence' },
      'RB': { name: 'Travis Etienne' },
      'WR': { name: 'Calvin Ridley' }
    },
    'DET': {
      'QB': { name: 'Jared Goff' },
      'RB': { name: 'Jahmyr Gibbs' },
      'WR': { name: 'Amon-Ra St. Brown' }
    },
    'CIN': {
      'QB': { name: 'Joe Burrow' },
      'RB': { name: 'Joe Mixon' },
      'WR': { name: 'Ja\'Marr Chase' }
    },
    'SEA': {
      'QB': { name: 'Geno Smith' },
      'RB': { name: 'Kenneth Walker III' },
      'WR': { name: 'DK Metcalf' }
    },
    'ARI': {
      'QB': { name: 'Kyler Murray' },
      'RB': { name: 'James Conner' },
      'WR': { name: 'Marquise Brown' }
    },
    'TB': {
      'QB': { name: 'Baker Mayfield' },
      'RB': { name: 'Rachaad White' },
      'WR': { name: 'Mike Evans' }
    },
    'TEN': {
      'QB': { name: 'Will Levis' },
      'RB': { name: 'Derrick Henry' },
      'WR': { name: 'DeAndre Hopkins' }
    },
    'WSH': {
      'QB': { name: 'Sam Howell' },
      'RB': { name: 'Brian Robinson Jr.' },
      'WR': { name: 'Terry McLaurin' }
    },
    'LAC': {
      'QB': { name: 'Justin Herbert' },
      'RB': { name: 'Austin Ekeler' },
      'WR': { name: 'Keenan Allen' }
    }
  }
  
  return knownPlayers[teamAbbr]?.[position] || null
}

/**
 * Parse NFL props from The Odds API response
 * Similar to MLB parsing but for NFL prop markets
 */
async function parseNFLPropsFromAPI(propsDataArray) {
  const allProps = []
  const rosterCache = new Map()
  const rosterPace = { lastFetchAt: null }
  
  try {
    // Get NFL games from database
    const nflGames = await prisma.game.findMany({
      where: {
        sport: 'nfl',
        status: { in: ['scheduled', 'pre_game'] }
      },
      include: { home: true, away: true }
    })
    
    for (const propsData of propsDataArray) {
      // Find matching game using team name matching
      const matchingGame = nflGames.find(g => 
        matchTeamNames(g.away.name, propsData.away_team) &&
        matchTeamNames(g.home.name, propsData.home_team)
      )
      
      if (!matchingGame) {
        console.warn(`⚠️ Could not match NFL game: ${propsData.away_team} @ ${propsData.home_team}`)
        continue
      }
      
      console.log(`🎯 Processing NFL props for ${matchingGame.away.abbr} @ ${matchingGame.home.abbr}`)
      const eventRoster = await loadEventRosterPlayers(matchingGame, {
        sport: 'nfl',
        cache: rosterCache,
        pace: rosterPace,
      })
      const eventLabel = formatEventLabel(matchingGame)
      
      // Parse props from API response
      const parsedProps = parsePlayerProps(propsData, matchingGame.id)
      
      // Convert to our format
      for (const apiProp of parsedProps) {
        const rosterDecision = evaluateEventRosterEligibility({
          playerName: apiProp.playerName,
          players: eventRoster.players,
          rosterAvailable: eventRoster.ok,
        })
        if (!rosterDecision.ok) {
          logEventRosterSkip({
            playerName: apiProp.playerName,
            event: eventLabel,
            reason: rosterDecision.reason,
          })
          continue
        }

        // Map API market names to our prop types
        const propType = mapNFLMarketToPropType(apiProp.market)
        if (!propType) continue
        
        // Determine pick based on our analysis
        const pick = apiProp.selection.toLowerCase() // 'over' or 'under'
        
        // Calculate implied probability from odds
        const impliedProb = oddsToImpliedProbability(apiProp.odds)
        
        // Calculate our edge (simple for now, can enhance later)
        const edge = Math.max(0, impliedProb - 0.50)
        
        // Calculate quality score
        const confidence = getConfidenceFromEdge(edge)
        const qualityScore = calculateQualityScore({
          probability: impliedProb,
          edge: edge,
          confidence: confidence
        })
        
        const prop = {
          id: `nfl-prop-${matchingGame.id}-${apiProp.playerName}-${propType}`,
          gameId: matchingGame.id,
          playerName: apiProp.playerName,
          team: determinePlayerTeam(apiProp.playerName, matchingGame),
          type: propType,
          pick: pick,
          threshold: apiProp.threshold,
          odds: apiProp.odds,
          probability: impliedProb,
          edge: edge,
          confidence: confidence,
          qualityScore: qualityScore,
          reasoning: `${apiProp.playerName} ${propType} ${pick} ${apiProp.threshold} from ${apiProp.bookmaker}`,
          gameTime: matchingGame.date,
          sport: 'nfl',
          category: 'player_prop',
          bookmaker: apiProp.bookmaker,
          sourceMarket: apiProp.market,
        }
        
        allProps.push(prop)
        
        // Record for validation
        try {
          await recordPropPrediction(prop, 'api_generated')
        } catch (err) {
          console.error('Error recording NFL prop:', sanitizeLoggedValue(err))
        }
      }
    }
    
    console.log(`✅ Parsed ${allProps.length} NFL props from API`)
    return allProps
    
  } catch (error) {
    console.error('Error parsing NFL props from API:', sanitizeLoggedValue(error))
    return []
  }
}

/**
 * Match team names between database and API
 * Handles variations like "Los Angeles Rams" vs "LA Rams" vs "Rams"
 */
function matchTeamNames(dbTeamName, apiTeamName) {
  const normalize = (name) => name.toLowerCase().trim()
  
  const dbName = normalize(dbTeamName)
  const apiName = normalize(apiTeamName)
  
  // Exact match
  if (dbName === apiName) return true
  
  // API name contains DB name (e.g., "Arizona Cardinals" contains "cardinals")
  if (apiName.includes(dbName.split(' ').pop())) return true
  
  // DB name contains API name parts
  if (dbName.includes(apiName.split(' ').pop())) return true
  
  // Handle city+team name matching
  const dbParts = dbName.split(' ')
  const apiParts = apiName.split(' ')
  
  // Check if team nickname matches (last word usually)
  const dbTeamNick = dbParts[dbParts.length - 1]
  const apiTeamNick = apiParts[apiParts.length - 1]
  
  if (dbTeamNick === apiTeamNick) return true
  
  // Handle special cases
  const teamMapping = {
    'rams': ['los angeles rams', 'la rams'],
    'chargers': ['los angeles chargers', 'la chargers'],
    'raiders': ['las vegas raiders', 'lv raiders'],
    'patriots': ['new england patriots', 'ne patriots'],
    'buccaneers': ['tampa bay buccaneers', 'tb buccaneers'],
    'packers': ['green bay packers', 'gb packers'],
    '49ers': ['san francisco 49ers', 'sf 49ers'],
    'giants': ['new york giants', 'ny giants', 'nyg giants'],
    'jets': ['new york jets', 'ny jets', 'nyj jets']
  }
  
  for (const [nick, variations] of Object.entries(teamMapping)) {
    if ((dbName.includes(nick) || apiName.includes(nick)) &&
        (variations.some(v => dbName.includes(v.replace(/\s+/g, ' ')) || apiName.includes(v.replace(/\s+/g, ' '))))) {
      return true
    }
  }
  
  return false
}

/**
 * Map NFL API market names to our prop type names
 */
function mapNFLMarketToPropType(marketKey) {
  const marketMap = {
    'player_pass_yds': 'passing_yards',
    'player_pass_tds': 'passing_touchdowns',
    'player_pass_completions': 'passing_completions',
    'player_pass_attempts': 'passing_attempts',
    'player_pass_interceptions': 'passing_interceptions',
    'player_rush_yds': 'rushing_yards',
    'player_rush_attempts': 'rushing_attempts',
    'player_rush_tds': 'rushing_touchdowns',
    'player_receptions': 'receptions',
    'player_reception_yds': 'receiving_yards',
    'player_reception_tds': 'receiving_touchdowns',
    'player_kicking_points': 'kicking_points'
  }
  const key = String(marketKey || '').toLowerCase().trim()
  const main = key.endsWith('_alternate') ? key.slice(0, -'_alternate'.length) : key
  return marketMap[main] || marketMap[key] || null
}

/**
 * Determine which team a player is on
 */
function determinePlayerTeam(playerName, game) {
  // This is a simple heuristic - in production you'd want to match against rosters
  // For now, return home team abbr (will be correct ~50% of the time)
  return game.home.abbr
}

/**
 * Convert American odds to implied probability
 */
function oddsToImpliedProbability(odds) {
  if (odds > 0) {
    return 100 / (odds + 100)
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100)
  }
}

/**
 * Fallback NFL props generation using real team data and realistic projections
 */
async function generateNFLPropsFallback() {
  try {
    console.log('🏈 Generating NFL props using fallback system...')
    
    // Get this week's NFL games
    const games = await prisma.game.findMany({
      where: {
        sport: 'nfl',
        status: { in: ['scheduled', 'pre_game'] },
      },
      include: {
        home: true,
        away: true,
      }
    })
    
    if (games.length === 0) {
      console.log('No NFL games found for this week')
      return []
    }
    
    const props = []
    
    for (const game of games) {
      console.log(`  📊 Analyzing props for ${game.away?.abbr} @ ${game.home?.abbr}`)
      
      // Try to get real roster data first, fallback to generic if not available
      const gameProps = await generateGameNFLPropsWithRealNames(game)
      props.push(...gameProps)
    }
    
    // Filter for high-quality props only
    const filteredProps = props.filter(prop => {
      const minEdge = 0.05 // 5% edge minimum
      const minConfidence = ['very_high', 'high', 'medium']
      
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
    
    console.log(`🏈 Generated ${filteredProps.length} NFL props using fallback system`)
    return filteredProps
    
  } catch (error) {
    console.error('Error generating NFL props fallback:', sanitizeLoggedValue(error))
    return []
  }
}

/**
 * Generate NFL props for a specific game using real player names when possible
 */
async function generateGameNFLPropsWithRealNames(game) {
  try {
    const eventRoster = await loadEventRosterPlayers(game, { sport: 'nfl' })
    if (!eventRoster.ok) {
      logEventRosterSkip({
        playerName: '(unresolved)',
        event: formatEventLabel(game),
        reason: eventRoster.reason || 'roster_unavailable',
      })
      return []
    }

    console.log(`    ✅ Using real roster data for ${game.away?.abbr} @ ${game.home?.abbr}`)
    return await generateGameNFLPropsWithRosters(game, eventRoster.players)
  } catch (error) {
    logEventRosterSkip({
      playerName: '(unresolved)',
      event: formatEventLabel(game),
      reason: 'roster_unavailable',
    })
    console.log(`    ⚠️ Error fetching rosters, skipping game props: ${sanitizedErrorMessage(error)}`)
    return []
  }
}

function firstEligibleRosterPlayer(players, teamAbbr, positions) {
  const team = String(teamAbbr || '').toUpperCase()
  const allowed = new Set(positions)
  return (players || []).find((player) => {
    if (team && String(player.team || '').toUpperCase() !== team) return false
    if (allowed.size && !allowed.has(String(player.position || '').toUpperCase())) return false
    const decision = evaluateEventRosterEligibility({
      playerName: player.name,
      players,
      rosterAvailable: true,
    })
    return decision.ok
  }) || null
}

/**
 * Generate NFL props using real roster data
 */
async function generateGameNFLPropsWithRosters(game, rosterPlayers) {
  const homeQB = firstEligibleRosterPlayer(rosterPlayers, game.home?.abbr, ['QB'])
  const homeRB1 = firstEligibleRosterPlayer(rosterPlayers, game.home?.abbr, ['RB', 'FB'])
  const homeWR1 = firstEligibleRosterPlayer(rosterPlayers, game.home?.abbr, ['WR'])
  const awayQB = firstEligibleRosterPlayer(rosterPlayers, game.away?.abbr, ['QB'])
  const awayRB1 = firstEligibleRosterPlayer(rosterPlayers, game.away?.abbr, ['RB', 'FB'])
  const awayWR1 = firstEligibleRosterPlayer(rosterPlayers, game.away?.abbr, ['WR'])
  
  const players = [
    homeQB && {
      playerName: homeQB.name,
      team: game.home?.abbr,
      position: 'QB',
      projections: {
        passing_yards: 240 + Math.random() * 60,
        passing_touchdowns: 1.5 + Math.random() * 1.0,
        rushing_yards: 15 + Math.random() * 25,
        passing_interceptions: 0.5 + Math.random() * 0.8
      }
    },
    homeRB1 && {
      playerName: homeRB1.name,
      team: game.home?.abbr,
      position: 'RB',
      projections: {
        rushing_yards: 70 + Math.random() * 50,
        rushing_attempts: 15 + Math.random() * 8,
        receptions: 2 + Math.random() * 4,
        receiving_yards: 20 + Math.random() * 30,
        touchdowns: 0.6 + Math.random() * 0.8
      }
    },
    homeWR1 && {
      playerName: homeWR1.name,
      team: game.home?.abbr,
      position: 'WR',
      projections: {
        receptions: 5 + Math.random() * 4,
        receiving_yards: 70 + Math.random() * 50,
        touchdowns: 0.5 + Math.random() * 0.8
      }
    },
    awayQB && {
      playerName: awayQB.name,
      team: game.away?.abbr,
      position: 'QB',
      projections: {
        passing_yards: 230 + Math.random() * 60,
        passing_touchdowns: 1.4 + Math.random() * 1.0,
        rushing_yards: 12 + Math.random() * 25,
        passing_interceptions: 0.6 + Math.random() * 0.8
      }
    },
    awayRB1 && {
      playerName: awayRB1.name,
      team: game.away?.abbr,
      position: 'RB',
      projections: {
        rushing_yards: 65 + Math.random() * 50,
        rushing_attempts: 14 + Math.random() * 8,
        receptions: 2 + Math.random() * 4,
        receiving_yards: 18 + Math.random() * 30,
        touchdowns: 0.5 + Math.random() * 0.8
      }
    },
    awayWR1 && {
      playerName: awayWR1.name,
      team: game.away?.abbr,
      position: 'WR',
      projections: {
        receptions: 4 + Math.random() * 4,
        receiving_yards: 65 + Math.random() * 50,
        touchdowns: 0.4 + Math.random() * 0.8
      }
    }
  ].filter(Boolean)
  
  return generatePropsFromPlayers(players, game)
}

/**
 * Do not invent props from stale known-player names. That path is how
 * a free agent (or any player not on this event's ESPN roster) reached
 * Published. If ESPN roster data is missing, skip — same fail-safe as
 * persist. The Odds API path still emits book lines after a roster check.
 */
async function generateGameNFLPropsFallback(game) {
  logEventRosterSkip({
    playerName: '(unresolved)',
    event: formatEventLabel(game),
    reason: 'roster_unavailable',
  })
  return []
}

/**
 * Generate props from a list of players
 */
function generatePropsFromPlayers(players, game) {
  const props = []
  
  // Generate props for each player
  for (const player of players) {
    for (const [statType, projection] of Object.entries(player.projections)) {
      // Define realistic thresholds
      const thresholds = {
        passing_yards: 250.5,
        passing_touchdowns: 1.5,
        rushing_yards: 65.5,
        rushing_attempts: 15.5,
        receptions: 4.5,
        receiving_yards: 65.5,
        touchdowns: 0.5,
        passing_interceptions: 0.5
      }
      
      const threshold = thresholds[statType]
      if (!threshold) continue
      
      // Calculate edge based on projection vs threshold
      const edge = Math.abs(projection - threshold) / threshold
      
      // Only include props with meaningful edges
      if (edge >= 0.05) { // 5% edge minimum
        const pick = projection >= threshold ? 'over' : 'under'
        const odds = -110 // Standard prop odds
        
        // Calculate probability based on projection vs threshold
        // For over bets: higher projection = higher probability
        // For under bets: lower projection = higher probability
        let probability
        if (pick === 'over') {
          // If projection is well above threshold, high probability
          probability = Math.min(0.85, Math.max(0.15, 0.5 + (projection - threshold) / (threshold * 2)))
        } else {
          // If projection is well below threshold, high probability
          probability = Math.min(0.85, Math.max(0.15, 0.5 + (threshold - projection) / (threshold * 2)))
        }
        
        props.push({
          gameId: game.id,
          playerId: player.playerName,
          playerName: player.playerName,
          team: player.team,
          opponent: player.team === game.home?.abbr ? game.away?.abbr : game.home?.abbr,
          type: statType,
          pick: pick,
          threshold: threshold,
          projection: projection,
          probability: probability,
          odds: odds,
          edge: edge,
          confidence: getConfidenceFromEdge(edge),
          reasoning: `${player.position} projects ${projection.toFixed(1)} ${statType.replace(/_/g, ' ')} vs ${threshold} threshold`,
          gameTime: game.date,
          week: getWeekFromGameId(game.id),
          sport: 'nfl',  // Add sport field
          category: 'player_prop'  // Add category field
        })
      }
    }
  }
  
  return props
}