// NHL Player Props - Generate prop bet recommendations for hockey

import { fetchAllPlayerProps, parsePlayerProps } from './vendors/player-props-odds.js'
import { recordPropPrediction } from './validation.js'
import { calculateQualityScore } from './quality-score.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Generate NHL player prop recommendations using real betting lines from The-Odds-API
 */
export async function generateNHLPlayerProps() {
  try {
    console.log('🏒 Generating NHL player props...')
    
    // Try to fetch REAL odds from The Odds API first
    console.log('📡 Attempting to fetch REAL NHL player props from The Odds API...')
    const realPropsData = await fetchAllPlayerProps('icehockey_nhl')
    
    if (realPropsData && realPropsData.length > 0) {
      console.log(`✅ Found ${realPropsData.length} NHL games with real player props!`)
      const parsedProps = await parseNHLPropsFromAPI(realPropsData)
      console.log(`✅ Generated ${parsedProps.length} NHL props with REAL odds`)
      return parsedProps
    }
    
    // Fallback to estimates if API unavailable
    console.log('⚠️ No real NHL props available, using fallback system')
    return await generateNHLPropsFallback()
    
  } catch (error) {
    console.error('❌ Error fetching real NHL props:', error)
    console.log('⚠️ Falling back to estimates')
    return await generateNHLPropsFallback()
  }
}

/**
 * Parse NHL props from The-Odds-API response
 */
async function parseNHLPropsFromAPI(propsDataArray) {
  const allProps = []
  
  try {
    // Fetch all scheduled NHL games from our database
    const nhlGames = await prisma.game.findMany({
      where: {
        sport: 'nhl',
        status: { in: ['scheduled', 'pre_game'] }
      },
      include: { home: true, away: true }
    })
    
    console.log(`📊 Found ${nhlGames.length} scheduled NHL games in database`)
    
    // Match API props data to our games
    for (const propsData of propsDataArray) {
      // Find matching game by team names
      const matchingGame = nhlGames.find(g =>
        matchTeamNames(g.away.name, propsData.away_team) &&
        matchTeamNames(g.home.name, propsData.home_team)
      )
      
      if (!matchingGame) {
        console.warn(`⚠️ Could not match NHL game: ${propsData.away_team} @ ${propsData.home_team}`)
        continue
      }
      
      // Parse all player props from this game
      const parsedProps = parsePlayerProps(propsData, matchingGame.id)
      
      for (const apiProp of parsedProps) {
        // Map API market to our prop type
        const propType = mapNHLMarketToPropType(apiProp.market)
        if (!propType) {
          continue // Skip unsupported markets
        }
        
        // Determine pick (over/under)
        const pick = apiProp.selection.toLowerCase()
        
        // Calculate probability from odds
        const impliedProb = oddsToImpliedProbability(apiProp.odds)
        
        // Calculate edge (how much better than 50/50)
        const edge = Math.max(0, impliedProb - 0.50)
        
        // Get confidence level
        const confidence = getConfidenceFromEdge(edge)
        
        // Calculate quality score
        const qualityScore = calculateQualityScore({
          probability: impliedProb,
          edge: edge,
          confidence: confidence
        })
        
        // Create prop object
        const prop = {
          id: `nhl-prop-${matchingGame.id}-${apiProp.playerName}-${propType}`,
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
          sport: 'nhl',
          category: 'player_prop',
          bookmaker: apiProp.bookmaker
        }
        
        allProps.push(prop)
        
        // Record prediction for validation
        await recordPropPrediction(prop, 'api_generated')
      }
    }
    
    return allProps
  } catch (error) {
    console.error('Error parsing NHL props from API:', error)
    return []
  }
}

/**
 * Fallback: Generate estimated NHL props when real odds unavailable
 */
async function generateNHLPropsFallback() {
  const props = []
  
  try {
    console.log('📊 Generating estimated NHL props...')
    
    const nhlGames = await prisma.game.findMany({
      where: {
        sport: 'nhl',
        status: { in: ['scheduled', 'pre_game'] }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    console.log(`Found ${nhlGames.length} upcoming NHL games`)
    
    // Generate estimated props for each game
    for (const game of nhlGames) {
      // For now, create a few sample props per game
      // In production, this would use historical stats and matchup data
      
      // Sample forwards (would be fetched from rosters)
      const samplePlayers = [
        { name: 'Connor McDavid', team: 'home', position: 'C' },
        { name: 'Nathan MacKinnon', team: 'away', position: 'C' }
      ]
      
      for (const player of samplePlayers) {
        // Goals prop
        props.push({
          id: `nhl-prop-${game.id}-${player.name}-goals`,
          gameId: game.id,
          playerName: player.name,
          team: player.team === 'home' ? game.home.abbr : game.away.abbr,
          type: 'goals',
          pick: 'over',
          threshold: 0.5,
          odds: -110,
          probability: 0.52,
          edge: 0.02,
          confidence: 'low',
          qualityScore: 45,
          reasoning: `Estimated: ${player.name} to score`,
          gameTime: game.date,
          sport: 'nhl',
          category: 'player_prop',
          bookmaker: 'Estimated'
        })
        
        // Points prop
        props.push({
          id: `nhl-prop-${game.id}-${player.name}-points`,
          gameId: game.id,
          playerName: player.name,
          team: player.team === 'home' ? game.home.abbr : game.away.abbr,
          type: 'points',
          pick: 'over',
          threshold: 0.5,
          odds: -110,
          probability: 0.53,
          edge: 0.03,
          confidence: 'low',
          qualityScore: 48,
          reasoning: `Estimated: ${player.name} to record a point`,
          gameTime: game.date,
          sport: 'nhl',
          category: 'player_prop',
          bookmaker: 'Estimated'
        })
      }
    }
    
    console.log(`📊 Generated ${props.length} estimated NHL props`)
    return props
    
  } catch (error) {
    console.error('Error generating NHL props fallback:', error)
    return []
  }
}

/**
 * Match team names from database to API (handles different formats)
 */
function matchTeamNames(dbTeamName, apiTeamName) {
  // Normalize: lowercase, remove periods, extra spaces
  const normalize = (name) => name.toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ')
  const dbName = normalize(dbTeamName)
  const apiName = normalize(apiTeamName)
  
  // Direct match
  if (dbName === apiName) return true
  
  // Remove common prefixes that might differ
  const removePrefix = (name) => {
    const prefixes = ['the ']
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        name = name.substring(prefix.length)
      }
    }
    return name
  }
  
  const dbClean = removePrefix(dbName)
  const apiClean = removePrefix(apiName)
  
  if (dbClean === apiClean) return true
  
  // Get last word (usually the team nickname)
  const dbParts = dbClean.split(' ')
  const apiParts = apiClean.split(' ')
  const dbTeamNick = dbParts[dbParts.length - 1]
  const apiTeamNick = apiParts[apiParts.length - 1]
  
  // Match on team nickname
  if (dbTeamNick === apiTeamNick) return true
  
  // NHL-specific team mapping (handle special cases)
  const teamMapping = {
    'montreal': 'canadiens',
    'montréal': 'canadiens',
    'utah': 'mammoth', // New team
    'seattle': 'kraken',
    'vegas': 'golden knights',
    'los angeles': 'kings',
    'st louis': 'blues',
    'san jose': 'sharks',
    'tampa bay': 'lightning',
    'columbus': 'blue jackets',
    'new york islanders': 'islanders',
    'new york rangers': 'rangers',
    'new jersey': 'devils'
  }
  
  // Check if either name maps to a known team
  for (const [location, nick] of Object.entries(teamMapping)) {
    if ((dbClean.includes(location) || apiClean.includes(location)) &&
        (dbClean.includes(nick) || apiClean.includes(nick))) {
      return true
    }
  }
  
  return false
}

/**
 * Map API market name to our internal prop type
 */
function mapNHLMarketToPropType(market) {
  const marketMap = {
    'player_points': 'points',
    'player_goals': 'goals',
    'player_assists': 'assists',
    'player_shots_on_goal': 'shots',
    'player_power_play_points': 'powerplay_points',
    'player_blocked_shots': 'blocked_shots',
    'player_saves': 'saves' // for goalies
  }
  
  return marketMap[market] || null
}

/**
 * Determine which team a player belongs to
 */
function determinePlayerTeam(playerName, game) {
  // In production, this would query the roster
  // For now, we'll make an educated guess or return 'Unknown'
  return game.home.abbr // Placeholder
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
 * Get confidence level from edge
 */
function getConfidenceFromEdge(edge) {
  if (edge >= 0.10) return 'high'
  if (edge >= 0.05) return 'medium'
  return 'low'
}

export default {
  generateNHLPlayerProps
}

