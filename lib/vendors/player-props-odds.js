// Vendor layer for player prop odds - uses The Odds API /events endpoint
// Documentation: https://the-odds-api.com/sports-odds-data/betting-markets.html#player-props-api-markets

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

/**
 * Rate limiting configuration
 * 200ms delay = 5 requests/second (API limit is ~10/sec)
 * This provides a safe buffer to prevent 429 rate limit errors
 */
const RATE_LIMIT_DELAY_MS = 200

/**
 * MLB Player Prop Markets
 */
const MLB_PROP_MARKETS = [
  // Batting props
  'batter_hits',
  'batter_home_runs',
  'batter_total_bases',
  'batter_rbis',
  'batter_runs_scored',
  'batter_strikeouts',
  'batter_walks',
  // 'batter_stolen_bases', // Removed - low volume, hard to predict
  // Pitching props
  'pitcher_strikeouts',
  'pitcher_outs',
  'pitcher_hits_allowed',
  'pitcher_earned_runs',
  'pitcher_walks'
].join(',')

/**
 * NFL Player Prop Markets
 */
const NFL_PROP_MARKETS = [
  'player_pass_yds',
  'player_pass_tds',
  'player_pass_completions',
  'player_pass_attempts',
  'player_pass_interceptions',
  'player_rush_yds',
  'player_rush_attempts',
  'player_rush_tds',
  'player_receptions',
  'player_reception_yds',
  'player_reception_tds',
  'player_kicking_points'
].join(',')

/**
 * NHL Player Prop Markets
 */
const NHL_PROP_MARKETS = [
  'player_points',
  'player_goals',
  'player_assists',
  'player_shots_on_goal',
  'player_power_play_points',
  'player_blocked_shots',
  'player_total_saves',
  // Alternate markets
  'player_points_alternate',
  'player_goals_alternate',
  'player_assists_alternate',
  'player_shots_on_goal_alternate'
].join(',')

/**
 * Fetch player props for a specific event
 * @param {string} sport - Sport key (baseball_mlb, americanfootball_nfl, etc.)
 * @param {string} eventId - The event ID from /events endpoint
 * @returns {Promise<object>} Event data with player prop odds
 */
export async function fetchEventPlayerProps(sport, eventId) {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    console.warn('⚠️ ODDS_API_KEY not configured')
    return null
  }

  try {
    // Determine which markets to fetch based on sport
    const markets = sport === 'baseball_mlb' ? MLB_PROP_MARKETS : 
                    sport === 'americanfootball_nfl' ? NFL_PROP_MARKETS :
                    sport === 'icehockey_nhl' ? NHL_PROP_MARKETS :
                    MLB_PROP_MARKETS // default to MLB

    const url = `${ODDS_API_BASE}/sports/${sport}/events/${eventId}/odds?regions=us&markets=${markets}&oddsFormat=american&apiKey=${apiKey}`
    
    console.log(`📊 Fetching player props for event ${eventId}...`)
    
    const res = await fetch(url, { 
      cache: 'no-store',
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      if (res.status === 422) {
        console.warn(`⚠️ Player props not available for event ${eventId}`)
        return null
      }
      console.error(`❌ Player props API error: ${res.status}`)
      return null
    }
    
    const data = await res.json()
    console.log(`✅ Fetched player props for ${data.home_team} vs ${data.away_team}`)
    
    return data
    
  } catch (error) {
    console.error('❌ Failed to fetch player props:', error.message)
    return null
  }
}

/**
 * Fetch player props for all events of a sport
 * @param {string} sport - Sport key (baseball_mlb, americanfootball_nfl)
 * @returns {Promise<Array>} Array of events with player prop odds
 */
export async function fetchAllPlayerProps(sport = 'baseball_mlb') {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    console.warn('⚠️ ODDS_API_KEY not configured')
    return []
  }

  // Note: Player props use a different endpoint (/events/{id}/odds) than game odds
  // So we don't check the same usage manager - this is separate data

  try {
    // First, get all events
    console.log(`📋 Fetching ${sport} events...`)
    const eventsUrl = `${ODDS_API_BASE}/sports/${sport}/events?apiKey=${apiKey}`
    const eventsRes = await fetch(eventsUrl, { cache: 'no-store' })
    
    if (!eventsRes.ok) {
      console.error(`❌ Failed to fetch events: ${eventsRes.status}`)
      return []
    }
    
    const events = await eventsRes.json()
    console.log(`📋 Found ${events.length} ${sport} events`)
    
    // Fetch player props for each event WITH RATE LIMITING
    // This prevents 429 (Too Many Requests) errors
    console.log(`⏱️  Fetching props with ${RATE_LIMIT_DELAY_MS}ms delay between requests...`)
    const propsResults = []
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      
      // Fetch props for this event
      const props = await fetchEventPlayerProps(sport, event.id)
      propsResults.push(props)
      
      // Rate limit: wait before next request (except for last one)
      if (i < events.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS))
      }
    }
    
    // Filter out null results
    const validProps = propsResults.filter(p => p !== null)
    
    console.log(`✅ Fetched player props for ${validProps.length} ${sport} games`)
    return validProps
    
  } catch (error) {
    console.error('❌ Failed to fetch all player props:', error.message)
    return []
  }
}

/**
 * Parse player props from API response into our format
 * @param {object} eventData - Event data with bookmakers and markets
 * @param {string} gameId - Our internal game ID
 * @returns {Array} Array of parsed player props
 */
export function parsePlayerProps(eventData, gameId) {
  const props = []
  
  if (!eventData || !eventData.bookmakers || eventData.bookmakers.length === 0) {
    return props
  }

  // Get the best odds across all bookmakers
  for (const bookmaker of eventData.bookmakers) {
    for (const market of bookmaker.markets) {
      // Parse each outcome in the market
      for (const outcome of market.outcomes) {
        const prop = {
          gameId: gameId,
          playerName: outcome.description, // Player name
          market: market.key, // e.g., "batter_hits", "pitcher_strikeouts"
          selection: outcome.name, // "Over" or "Under"
          threshold: outcome.point, // The line (e.g., 1.5 hits)
          odds: outcome.price, // American odds
          bookmaker: bookmaker.key,
          lastUpdate: new Date(bookmaker.last_update)
        }
        
        props.push(prop)
      }
    }
  }
  
  console.log(`📊 Parsed ${props.length} player props from ${eventData.home_team} vs ${eventData.away_team}`)
  return props
}

/**
 * Get best odds for a specific player prop across all bookmakers
 * @param {Array} props - Array of props for same player/market/threshold
 * @returns {object} Prop with best odds for Over and Under
 */
export function getBestPropOdds(props) {
  if (!props || props.length === 0) return null
  
  // Group by selection (Over/Under)
  const overProps = props.filter(p => p.selection === 'Over')
  const underProps = props.filter(p => p.selection === 'Under')
  
  // Get best Over odds (highest for positive, least negative for negative)
  const bestOver = overProps.reduce((best, current) => {
    if (!best) return current
    return current.odds > best.odds ? current : best
  }, null)
  
  // Get best Under odds
  const bestUnder = underProps.reduce((best, current) => {
    if (!best) return current
    return current.odds > best.odds ? current : best
  }, null)
  
  return {
    over: bestOver,
    under: bestUnder
  }
}

