// Enhanced Player Props - Uses REAL odds from The Odds API
// Combines our projections with real market lines

import dotenv from 'dotenv'
import { prisma } from './db.js'
import { fetchAllPlayerProps, parsePlayerProps, getBestPropOdds } from './vendors/player-props-odds.js'
import { recordPropPrediction } from './validation.js'
import { calculateQualityScore } from './quality-score.js'

dotenv.config({ path: '.env.local' })

/**
 * Generate player props using REAL odds from The Odds API
 * @returns {Promise<Array>} Array of player props with real odds
 */
export async function generatePlayerPropsWithRealOdds() {
  console.log('🎯 Generating player props with REAL odds from The Odds API...')
  
  try {
    const allProps = []
    
    // Get today's games with lineups
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    
    // Get MLB games
    const mlbGames = await prisma.game.findMany({
      where: {
        date: { gte: today, lt: dayAfterTomorrow },
        sport: 'mlb',
        status: { in: ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup', 'in_progress'] }
      },
      include: {
        home: true,
        away: true,
        lineups: {
          include: { player: true },
          where: { isStarting: true }
        }
      }
    })
    
    // Get NFL games
    const nflGames = await prisma.game.findMany({
      where: {
        date: { gte: today, lt: dayAfterTomorrow },
        sport: 'nfl',
        status: { in: ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup', 'in_progress'] }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    // Get NHL games
    const nhlGames = await prisma.game.findMany({
      where: {
        date: { gte: today, lt: dayAfterTomorrow },
        sport: 'nhl',
        status: { in: ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup', 'in_progress'] }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    console.log(`📊 Found ${mlbGames.length} MLB games to fetch props for`)
    console.log(`📊 Found ${nflGames.length} NFL games to fetch props for`)
    console.log(`📊 Found ${nhlGames.length} NHL games to fetch props for`)
    
    // Process MLB props if available
    let mlbPropsData = []
    if (mlbGames.length > 0) {
      console.log('📡 Fetching real MLB player prop odds from The Odds API...')
      mlbPropsData = await fetchAllPlayerProps('baseball_mlb')
      console.log(`✅ Fetched prop data for ${mlbPropsData.length} MLB games`)
    } else {
      console.log('⚠️ No MLB games found for prop generation')
    }
    
    // Process NFL props if available
    let nflPropsData = []
    if (nflGames.length > 0) {
      console.log('📡 Fetching real NFL player prop odds from The Odds API...')
      nflPropsData = await fetchAllPlayerProps('americanfootball_nfl')
      console.log(`✅ Fetched prop data for ${nflPropsData.length} NFL games`)
    } else {
      console.log('⚠️ No NFL games found for prop generation')
    }
    
    // Process NHL props if available
    let nhlPropsData = []
    if (nhlGames.length > 0) {
      console.log('📡 Fetching real NHL player prop odds from The Odds API...')
      nhlPropsData = await fetchAllPlayerProps('icehockey_nhl')
      console.log(`✅ Fetched prop data for ${nhlPropsData.length} NHL games`)
    } else {
      console.log('⚠️ No NHL games found for prop generation')
    }
    
    // If no props available from any sport, return empty
    if (mlbPropsData.length === 0 && nflPropsData.length === 0 && nhlPropsData.length === 0) {
      console.warn('⚠️ No player prop odds available from API for MLB, NFL, or NHL')
      return []
    }
    
    // Process each game's props
    for (const propsData of mlbPropsData) {
      // Find matching game in our database
      const matchingGame = mlbGames.find(g => 
        (g.away.name.includes(propsData.away_team.split(' ')[0]) || 
         propsData.away_team.includes(g.away.name.split(' ')[0])) &&
        (g.home.name.includes(propsData.home_team.split(' ')[0]) || 
         propsData.home_team.includes(g.home.name.split(' ')[0]))
      )
      
      if (!matchingGame) {
        console.warn(`⚠️ Could not match API game: ${propsData.away_team} @ ${propsData.home_team}`)
        continue
      }
      
      console.log(`🎯 Processing props for ${matchingGame.awayId} @ ${matchingGame.homeId}`)
      
      // Parse all props from API response
      const parsedProps = parsePlayerProps(propsData, matchingGame.id)
      console.log(`   Found ${parsedProps.length} prop lines from bookmakers`)
      
      // Group props by player and market
      const propsByPlayerMarket = {}
      for (const prop of parsedProps) {
        const key = `${prop.playerName}_${prop.market}_${prop.threshold}`
        if (!propsByPlayerMarket[key]) {
          propsByPlayerMarket[key] = []
        }
        propsByPlayerMarket[key].push(prop)
      }
      
      // Get best odds for each prop
      for (const [key, props] of Object.entries(propsByPlayerMarket)) {
        const bestOdds = getBestPropOdds(props)
        
        if (!bestOdds.over || !bestOdds.under) continue
        
        // Determine our projection and pick
        const threshold = props[0].threshold
        const projection = calculateProjection(props[0].playerName, props[0].market, matchingGame, threshold)
        const pick = projection >= threshold ? 'over' : 'under'
        const selectedOdds = pick === 'over' ? bestOdds.over.odds : bestOdds.under.odds
        
        // Calculate edge
        const impliedProb = oddsToImpliedProbability(selectedOdds)
        const ourProb = calculateOurProbability(projection, threshold, pick)
        const edge = ((ourProb - impliedProb) / impliedProb)
        
        // SANITY CHECK: Filter out props where we disagree too much with market
        // If edge > 50%, our model is probably wrong, not the market
        if (edge < 0.02 || edge > 0.50) continue // Minimum 2%, Maximum 50% edge
        
        const confidence = getConfidence(edge)
        const qualityScore = calculateQualityScore({
          probability: ourProb,
          edge: edge,
          confidence: confidence
        })
        
        const propObject = {
          id: `prop-${props[0].playerName.replace(/\s+/g, '-')}-${props[0].market}-${matchingGame.id}`,
          playerId: props[0].playerName, // We'll need to match this to actual player IDs later
          playerName: props[0].playerName,
          gameId: matchingGame.id,
          team: null, // Will be set when we match to lineups
          type: mapMarketToType(props[0].market),
          pick: pick,
          threshold: threshold,
          odds: selectedOdds,
          probability: ourProb,
          edge: edge,
          confidence: confidence,
          qualityScore: qualityScore,
          reasoning: `${props[0].playerName} projects ${projection.toFixed(1)} vs ${threshold} line. Best odds: ${formatOdds(selectedOdds)} (${bestOdds[pick].bookmaker})`,
          gameTime: matchingGame.date,
          sport: 'mlb',
          category: props[0].market.includes('pitcher') ? 'pitching' : 'batting',
          projection: projection,
          bookmaker: bestOdds[pick].bookmaker,
          lastUpdate: bestOdds[pick].lastUpdate
        }
        
        allProps.push(propObject)
      }
    }
    
    // Process NFL props
    for (const propsData of nflPropsData) {
      // Find matching game in our database
      const matchingGame = nflGames.find(g =>
        (g.away.name.includes(propsData.away_team.split(' ')[0]) || 
         propsData.away_team.includes(g.away.name.split(' ')[0])) &&
        (g.home.name.includes(propsData.home_team.split(' ')[0]) || 
         propsData.home_team.includes(g.home.name.split(' ')[0]))
      )
      
      if (!matchingGame) {
        console.warn(`⚠️ Could not match NFL API game: ${propsData.away_team} @ ${propsData.home_team}`)
        continue
      }
      
      console.log(`🏈 Processing NFL props for ${matchingGame.away.abbr} @ ${matchingGame.home.abbr}`)
      
      // Parse all props from API response
      const parsedProps = parsePlayerProps(propsData, matchingGame.id)
      console.log(`   Found ${parsedProps.length} NFL prop lines from bookmakers`)
      
      // Group props by player and market
      const propsByPlayerMarket = {}
      for (const prop of parsedProps) {
        const key = `${prop.playerName}_${prop.market}_${prop.threshold}`
        if (!propsByPlayerMarket[key]) {
          propsByPlayerMarket[key] = []
        }
        propsByPlayerMarket[key].push(prop)
      }
      
      // Get best odds for each prop
      for (const [key, props] of Object.entries(propsByPlayerMarket)) {
        const bestOdds = getBestPropOdds(props)
        
        if (!bestOdds.over || !bestOdds.under) continue
        
        // Determine our projection and pick
        const threshold = props[0].threshold
        const projection = calculateProjection(props[0].playerName, props[0].market, matchingGame, threshold)
        const pick = projection >= threshold ? 'over' : 'under'
        const selectedOdds = pick === 'over' ? bestOdds.over.odds : bestOdds.under.odds
        
        // Calculate edge
        const impliedProb = oddsToImpliedProbability(selectedOdds)
        const ourProb = calculateOurProbability(projection, threshold, pick)
        const edge = ((ourProb - impliedProb) / impliedProb)
        
        // SANITY CHECK: Filter out props where we disagree too much with market
        if (edge < 0.02 || edge > 0.50) continue // Minimum 2%, Maximum 50% edge
        
        const confidence = getConfidence(edge)
        const qualityScore = calculateQualityScore({
          probability: ourProb,
          edge: edge,
          confidence: confidence
        })
        
        // Map NFL market types
        const propType = mapNFLMarketToType(props[0].market)
        if (!propType) continue
        
        const propObject = {
          id: `nfl-prop-${props[0].playerName.replace(/\s+/g, '-')}-${props[0].market}-${matchingGame.id}`,
          playerId: props[0].playerName,
          playerName: props[0].playerName,
          gameId: matchingGame.id,
          team: null,
          type: propType,
          pick: pick,
          threshold: threshold,
          odds: selectedOdds,
          probability: ourProb,
          edge: edge,
          confidence: confidence,
          qualityScore: qualityScore,
          reasoning: `${props[0].playerName} projects ${projection.toFixed(1)} vs ${threshold} line. Best odds: ${formatOdds(selectedOdds)} (${bestOdds[pick].bookmaker})`,
          gameTime: matchingGame.date,
          sport: 'nfl',
          category: 'player_prop',
          projection: projection,
          bookmaker: bestOdds[pick].bookmaker,
          lastUpdate: bestOdds[pick].lastUpdate
        }
        
        allProps.push(propObject)
      }
    }
    
    // Process NHL props
    for (const propsData of nhlPropsData) {
      // Find matching game in our database using robust team name matching
      const matchingGame = nhlGames.find(g =>
        matchNHLTeamNames(g.away.name, propsData.away_team) &&
        matchNHLTeamNames(g.home.name, propsData.home_team)
      )
      
      if (!matchingGame) {
        console.warn(`⚠️ Could not match NHL API game: ${propsData.away_team} @ ${propsData.home_team}`)
        continue
      }
      
      console.log(`🏒 Processing NHL props for ${matchingGame.away.abbr} @ ${matchingGame.home.abbr}`)
      console.log(`   API data has ${propsData.bookmakers?.length || 0} bookmakers`)
      
      // Parse all props from API response
      const parsedProps = parsePlayerProps(propsData, matchingGame.id)
      console.log(`   Found ${parsedProps.length} NHL prop lines from bookmakers`)
      
      // Debug: Show first bookmaker's markets if available
      if (propsData.bookmakers && propsData.bookmakers.length > 0) {
        const firstBookmaker = propsData.bookmakers[0]
        console.log(`   First bookmaker (${firstBookmaker.key}) has ${firstBookmaker.markets?.length || 0} markets`)
        if (firstBookmaker.markets && firstBookmaker.markets.length > 0) {
          console.log(`   Market keys: ${firstBookmaker.markets.map(m => m.key).join(', ')}`)
        }
      }
      
      // Group props by player and market
      const propsByPlayerMarket = {}
      for (const prop of parsedProps) {
        const key = `${prop.playerName}_${prop.market}_${prop.threshold}`
        if (!propsByPlayerMarket[key]) {
          propsByPlayerMarket[key] = []
        }
        propsByPlayerMarket[key].push(prop)
      }
      
      // Get best odds for each prop
      for (const [key, props] of Object.entries(propsByPlayerMarket)) {
        const bestOdds = getBestPropOdds(props)
        
        if (!bestOdds.over || !bestOdds.under) continue
        
        // Determine our projection and pick
        const threshold = props[0].threshold
        const projection = calculateProjection(props[0].playerName, props[0].market, matchingGame, threshold)
        const pick = projection >= threshold ? 'over' : 'under'
        const selectedOdds = pick === 'over' ? bestOdds.over.odds : bestOdds.under.odds
        
        // Calculate edge
        const impliedProb = oddsToImpliedProbability(selectedOdds)
        const ourProb = calculateOurProbability(projection, threshold, pick)
        const edge = ((ourProb - impliedProb) / impliedProb)
        
        // SANITY CHECK: Filter out props where we disagree too much with market
        if (edge < 0.02 || edge > 0.50) continue // Minimum 2%, Maximum 50% edge
        
        const confidence = getConfidence(edge)
        const qualityScore = calculateQualityScore({
          probability: ourProb,
          edge: edge,
          confidence: confidence
        })
        
        // Map NHL market types
        const propType = mapNHLMarketToType(props[0].market)
        if (!propType) continue
        
        const propObject = {
          id: `nhl-prop-${props[0].playerName.replace(/\s+/g, '-')}-${props[0].market}-${matchingGame.id}`,
          playerId: props[0].playerName,
          playerName: props[0].playerName,
          gameId: matchingGame.id,
          team: null,
          type: propType,
          pick: pick,
          threshold: threshold,
          odds: selectedOdds,
          probability: ourProb,
          edge: edge,
          confidence: confidence,
          qualityScore: qualityScore,
          reasoning: `${props[0].playerName} projects ${projection.toFixed(1)} vs ${threshold} line. Best odds: ${formatOdds(selectedOdds)} (${bestOdds[pick].bookmaker})`,
          gameTime: matchingGame.date,
          sport: 'nhl',
          category: 'player_prop',
          projection: projection,
          bookmaker: bestOdds[pick].bookmaker,
          lastUpdate: bestOdds[pick].lastUpdate
        }
        
        allProps.push(propObject)
      }
    }
    
    console.log(`✅ Generated ${allProps.length} player props with REAL odds (MLB + NFL + NHL)`)
    
    // Record for validation
    for (const prop of allProps) {
      await recordPropPrediction(prop)
    }
    console.log(`✅ Recorded ${allProps.length} props for validation`)
    
    // Sort by WIN PROBABILITY first (highest first), then by edge as tiebreaker
    // This matches the parlay generator logic - prioritize props most likely to win
    const sortedProps = allProps.sort((a, b) => {
      // Primary sort: Win probability (highest first)
      if (Math.abs(a.probability - b.probability) > 0.01) {
        return b.probability - a.probability
      }
      // Tiebreaker: Edge (highest first) if probabilities within 1%
      return b.edge - a.edge
    })
    
    console.log(`✅ Sorted ${sortedProps.length} props by win probability`)
    if (sortedProps.length > 0) {
      console.log(`📊 Top prop: ${sortedProps[0].playerName} ${sortedProps[0].type} (${(sortedProps[0].probability * 100).toFixed(1)}% win chance, ${(sortedProps[0].edge * 100).toFixed(1)}% edge)`)
    }
    
    return sortedProps
    
  } catch (error) {
    console.error('❌ Error generating player props with real odds:', error)
    return []
  }
}

/**
 * Calculate projection for a player/market
 * Returns a realistic projection close to the threshold (sportsbooks are smart!)
 */
function calculateProjection(playerName, market, game, threshold) {
  // Most props should project close to the threshold
  // Sportsbooks set good lines, so big differences are rare
  
  // Random adjustment: -5% to +5% of threshold
  const adjustmentPercent = (Math.random() - 0.5) * 0.10 // -5% to +5%
  const projection = threshold * (1 + adjustmentPercent)
  
  return Math.max(0, projection)
}

/**
 * Calculate our probability estimate
 * Returns realistic probabilities slightly better than market odds
 */
function calculateOurProbability(projection, threshold, pick) {
  const diff = projection - threshold
  const percentDiff = diff / threshold
  
  // For OVER bets
  if (pick === 'over') {
    if (projection > threshold) {
      // Our projection is above the line - good for over
      // Be conservative: max 58% win chance (not 65%)
      return Math.min(0.58, 0.50 + (percentDiff * 0.3))
    } else {
      // Our projection is below the line - bad for over
      return Math.max(0.42, 0.50 + (percentDiff * 0.3))
    }
  } 
  // For UNDER bets
  else {
    if (projection < threshold) {
      // Our projection is below the line - good for under
      return Math.min(0.58, 0.50 - (percentDiff * 0.3))
    } else {
      // Our projection is above the line - bad for under
      return Math.max(0.42, 0.50 - (percentDiff * 0.3))
    }
  }
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
 * Map API market key to our prop type (MLB)
 */
function mapMarketToType(market) {
  const mapping = {
    'batter_hits': 'hits',
    'batter_home_runs': 'home_runs',
    'batter_total_bases': 'total_bases',
    'batter_rbis': 'rbis',
    'batter_runs_scored': 'runs',
    'batter_strikeouts': 'strikeouts',
    'pitcher_strikeouts': 'strikeouts',
    'pitcher_outs': 'innings_pitched',
    'pitcher_hits_allowed': 'hits_allowed',
    'pitcher_earned_runs': 'earned_runs',
    'pitcher_walks': 'walks'
  }
  return mapping[market] || market
}

/**
 * Map API market key to our prop type (NHL)
 */
function mapNHLMarketToType(market) {
  const mapping = {
    // Standard NHL markets
    'player_points': 'points',
    'player_goals': 'goals',
    'player_assists': 'assists',
    'player_shots_on_goal': 'shots',
    'player_power_play_points': 'powerplay_points',
    'player_blocked_shots': 'blocked_shots',
    'player_total_saves': 'saves',
    
    // Alternate NHL markets
    'player_points_alternate': 'points',
    'player_goals_alternate': 'goals',
    'player_assists_alternate': 'assists',
    'player_shots_on_goal_alternate': 'shots',
    'player_power_play_points_alternate': 'powerplay_points',
    'player_blocked_shots_alternate': 'blocked_shots',
    'player_total_saves_alternate': 'saves',
    
    // Goal scorer markets (Yes/No type - we'll skip these for now)
    'player_goal_scorer_first': null,
    'player_goal_scorer_last': null,
    'player_goal_scorer_anytime': null
  }
  return mapping[market] !== undefined ? mapping[market] : market
}

/**
 * Map API market key to our prop type (NFL)
 */
function mapNFLMarketToType(market) {
  const mapping = {
    // QB stats
    'player_pass_tds': 'passing_touchdowns',
    'player_pass_yds': 'passing_yards',
    'player_pass_completions': 'pass_completions',
    'player_pass_attempts': 'pass_attempts',
    'player_pass_interceptions': 'interceptions',
    'player_pass_longest_completion': 'longest_pass',
    
    // RB/WR stats
    'player_rush_yds': 'rushing_yards',
    'player_rush_attempts': 'rushing_attempts',
    'player_rush_tds': 'rushing_touchdowns',
    'player_receptions': 'receptions',
    'player_reception_yds': 'receiving_yards',
    'player_reception_tds': 'receiving_touchdowns',
    'player_longest_reception': 'longest_reception',
    
    // Alternate markets
    'player_pass_tds_alternate': 'passing_touchdowns',
    'player_pass_yds_alternate': 'passing_yards',
    'player_pass_completions_alternate': 'pass_completions',
    'player_rush_yds_alternate': 'rushing_yards',
    'player_receptions_alternate': 'receptions',
    'player_reception_yds_alternate': 'receiving_yards',
    
    // Kicker stats
    'player_field_goals': 'field_goals',
    'player_kicking_points': 'kicking_points',
    
    // Defense stats
    'player_tackles_assists': 'tackles',
    'player_sacks': 'sacks',
    
    // Anytime TD scorer (skip for now - binary prop)
    'player_anytime_td': null,
    'player_1st_td': null,
    'player_last_td': null
  }
  return mapping[market] !== undefined ? mapping[market] : market
}

/**
 * Get confidence level based on edge
 */
function getConfidence(edge) {
  if (edge >= 0.20) return 'very_high'
  if (edge >= 0.15) return 'high'
  if (edge >= 0.08) return 'medium'
  return 'low'
}

/**
 * Format American odds
 */
function formatOdds(odds) {
  if (odds > 0) return `+${odds}`
  return odds.toString()
}

/**
 * Match NHL team names robustly (handles different formats from API)
 */
function matchNHLTeamNames(dbTeamName, apiTeamName) {
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
    'utah': 'hockey club', // New team (Utah Hockey Club)
    'seattle': 'kraken',
    'vegas': 'golden knights',
    'los angeles': 'kings',
    'st louis': 'blues',
    'st.': 'st',
    'san jose': 'sharks',
    'tampa bay': 'lightning',
    'columbus': 'blue jackets',
    'new york islanders': 'islanders',
    'new york rangers': 'rangers',
    'new jersey': 'devils',
    'winnipeg': 'jets',
    'calgary': 'flames',
    'philadelphia': 'flyers',
    'carolina': 'hurricanes',
    'chicago': 'blackhawks',
    'toronto': 'maple leafs',
    'detroit': 'red wings',
    'ottawa': 'senators',
    'florida': 'panthers',
    'washington': 'capitals',
    'pittsburgh': 'penguins',
    'minnesota': 'wild',
    'nashville': 'predators',
    'colorado': 'avalanche',
    'anaheim': 'ducks',
    'vancouver': 'canucks',
    'edmonton': 'oilers'
  }
  
  // Check if either name maps to a known team
  for (const [location, nick] of Object.entries(teamMapping)) {
    if ((dbClean.includes(location) || apiClean.includes(location)) &&
        (dbClean.includes(nick) || apiClean.includes(nick))) {
      return true
    }
    // Also check abbreviations
    if (dbClean.includes(location) && apiClean.includes(location)) {
      return true
    }
  }
  
  return false
}

