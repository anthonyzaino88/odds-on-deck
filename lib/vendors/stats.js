// Vendor layer for MLB stats data - easily swappable for different providers

import { createGameId, getTeamName, MLB_TEAM_NAMES } from '../team-mapping.js'

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1'

// Simple in-memory cache for the MVP
const cache = new Map()

// Helper function to get team abbreviation from team name
function getTeamAbbreviation(teamName) {
  return MLB_TEAM_NAMES[teamName] || teamName.substring(0, 3).toUpperCase()
}
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCached(key) {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  return null
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
}

function getLocalDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function fetchSchedule(dateOrOptions = null) {
  // Handle both old string format and new options object format
  let dateStr, noCache = false
  let startDate, endDate
  
  if (typeof dateOrOptions === 'string') {
    dateStr = dateOrOptions
  } else if (typeof dateOrOptions === 'object' && dateOrOptions !== null) {
    dateStr = dateOrOptions.useLocalDate ? getLocalDateString() : new Date().toISOString().split('T')[0]
    noCache = dateOrOptions.noCache || false
  } else {
    dateStr = getLocalDateString()
  }
  
  // Just use a single date (today) - the API returns all games scheduled for that local date
  startDate = dateStr
  endDate = dateStr
  
  const cacheKey = `schedule_${startDate}_to_${endDate}`
  
  const cached = noCache ? null : getCached(cacheKey)
  if (cached) return cached
  
  try {
    // Use the 2-day range for the API call
    const url = `${MLB_API_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher,teams`
    console.log(`📡 Fetching MLB schedule: ${startDate} to ${endDate}`)
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    const games = mapScheduleData(data)
    
    console.log(`✅ Mapped ${games.length} MLB games total`)
    games.forEach(g => console.log(`   - ${g.id}`))
    
    setCache(cacheKey, games)
    return games
  } catch (error) {
    console.error('Failed to fetch schedule:', error)
    return []
  }
}

function mapScheduleData(apiData) {
  const games = []
  
  if (!apiData.dates || apiData.dates.length === 0) {
    return games
  }
  
  for (const dateEntry of apiData.dates) {
    console.log(`📅 Processing date: ${dateEntry.date} with ${dateEntry.games.length} games`)
    for (const game of dateEntry.games) {
      // Create consistent game ID using team names and date
      // Use the date from the API's dates array (local date) instead of UTC gameDate
      const gameDate = dateEntry.date
      const awayTeamName = getTeamName(game.teams.away.team.abbreviation) || game.teams.away.team.name
      const homeTeamName = getTeamName(game.teams.home.team.abbreviation) || game.teams.home.team.name
      const gameId = createGameId(awayTeamName, homeTeamName, gameDate)
      
      console.log(`  🏟️ ${game.teams.away.team.name} @ ${game.teams.home.team.name} → ${gameId}`)
      
      const mappedGame = {
        id: gameId,
        mlbGameId: game.gamePk?.toString(), // Store MLB's gamePk for lineup fetching (as string)
        date: new Date(game.gameDate),
        status: game.status.detailedState.toLowerCase().replace(' ', '_'),
        home: {
          id: game.teams.home.team.id.toString(),
          name: game.teams.home.team.name,
          abbr: game.teams.home.team.abbreviation || getTeamAbbreviation(game.teams.home.team.name)
        },
        away: {
          id: game.teams.away.team.id.toString(),
          name: game.teams.away.team.name,
          abbr: game.teams.away.team.abbreviation || getTeamAbbreviation(game.teams.away.team.name)
        },
        probablePitchers: {
          home: game.teams.home.probablePitcher ? {
            id: game.teams.home.probablePitcher.id.toString(),
            fullName: game.teams.home.probablePitcher.fullName,
            throws: game.teams.home.probablePitcher.pitchHand?.code || 
                   game.teams.home.probablePitcher.throws || 
                   getPitcherHandedness(game.teams.home.probablePitcher.fullName) || 'R' // Default to right
          } : null,
          away: game.teams.away.probablePitcher ? {
            id: game.teams.away.probablePitcher.id.toString(),
            fullName: game.teams.away.probablePitcher.fullName,
            throws: game.teams.away.probablePitcher.pitchHand?.code || 
                   game.teams.away.probablePitcher.throws || 
                   getPitcherHandedness(game.teams.away.probablePitcher.fullName) || 'R' // Default to right
          } : null
        }
      }
      
      games.push(mappedGame)
    }
  }
  
  return games
}

export async function fetchTeams() {
  const cacheKey = 'teams'
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    const url = `${MLB_API_BASE}/teams?sportId=1`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    const teams = data.teams.map(team => ({
      id: team.id.toString(),
      name: team.name,
      abbr: team.abbreviation,
      sport: 'mlb',
      parkFactor: getParkFactor(team.abbreviation) // Static for MVP
    }))
    
    setCache(cacheKey, teams)
    return teams
  } catch (error) {
    console.error('Failed to fetch teams:', error)
    return []
  }
}

/**
 * Fetch starting lineup for a specific game using MLB gameId (gamePk)
 */
export async function fetchGameLineup(mlbGameId) {
  const cacheKey = `lineup_${mlbGameId}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    const url = `${MLB_API_BASE}/game/${mlbGameId}/boxscore`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    const lineups = mapLineupData(data)
    
    setCache(cacheKey, lineups)
    return lineups
  } catch (error) {
    console.error('Error fetching game lineup:', error)
    return { home: [], away: [] }
  }
}

/**
 * Fetch live game data including scores, inning, and game state
 */
export async function fetchLiveGameData(mlbGameId, bypassCache = false) {
  const cacheKey = `live_${mlbGameId}`
  if (!bypassCache) {
    const cached = getCached(cacheKey, 30) // Cache for 30 seconds for live data
    if (cached) return cached
  }
  
  try {
    const url = `${MLB_API_BASE}/game/${mlbGameId}/linescore`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    const liveData = mapLiveGameData(data)
    
    setCache(cacheKey, liveData, 30) // Cache for 30 seconds
    return liveData
  } catch (error) {
    console.error('Error fetching live game data:', error)
    return null
  }
}

/**
 * Fetch detailed player stats including vs L/R splits
 */
export async function fetchPlayerStats(playerId, season = new Date().getFullYear()) {
  const cacheKey = `stats_${playerId}_${season}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    const url = `${MLB_API_BASE}/people/${playerId}/stats?stats=statSplits&season=${season}&sitCodes=vr,vl`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    const stats = mapPlayerStatsData(data)
    
    setCache(cacheKey, stats)
    return stats
  } catch (error) {
    console.error('Error fetching player stats:', error)
    return null
  }
}

export async function fetchPlayer(playerId) {
  const cacheKey = `player_${playerId}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    const url = `${MLB_API_BASE}/people/${playerId}?hydrate=stats(group=[hitting,pitching],type=[season,advanced])`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    if (!data.people || data.people.length === 0) {
      return null
    }
    
    const player = mapPlayerData(data.people[0])
    setCache(cacheKey, player)
    return player
  } catch (error) {
    console.error(`Failed to fetch player ${playerId}:`, error)
    return null
  }
}

/**
 * Fetch current team roster (optionally hydrated with person details)
 */
export async function fetchTeamRoster(teamId, season = new Date().getFullYear()) {
  try {
    const url = `${MLB_API_BASE}/teams/${teamId}/roster?season=${season}&hydrate=person`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    const data = await res.json()
    if (!data.roster) return []
    return data.roster.map(entry => ({
      id: entry.person?.id?.toString() || entry.personId?.toString(),
      fullName: entry.person?.fullName || entry.personFullName || 'Unknown',
      bats: entry.person?.batSide?.code || null,
      throws: entry.person?.pitchHand?.code || null,
      isPitcher: (entry.position?.abbreviation || entry.position?.code) === 'P' || entry.position?.code === '1'
    })).filter(p => p.id)
  } catch (error) {
    console.error(`Failed to fetch roster for team ${teamId}:`, error)
    return []
  }
}

/**
 * Fetch recent form data for a team (last 10 games, home/away records)
 */
export async function fetchTeamRecentForm(teamId, season = new Date().getFullYear()) {
  const cacheKey = `recent_form_${teamId}_${season}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    // Get team's recent games
    const url = `${MLB_API_BASE}/teams/${teamId}/stats?season=${season}&stats=season&group=hitting,pitching`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`MLB API error: ${res.status}`)
    }
    
    const data = await res.json()
    
    // Get recent games for last 10 games analysis
    const recentGamesUrl = `${MLB_API_BASE}/teams/${teamId}/schedule?season=${season}&sportId=1&hydrate=game(content(editorial(recap))),decisions,person,stats,team,linescore(matchup,runners)`
    const recentRes = await fetch(recentGamesUrl, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    let recentForm = {
      last10Record: null,
      avgRunsLast10: null,
      avgRunsAllowedLast10: null,
      homeRecord: null,
      awayRecord: null
    }
    
    if (recentRes.ok) {
      const recentData = await recentRes.json()
      recentForm = calculateRecentForm(recentData, teamId)
    }
    
    const result = {
      ...recentForm,
      // Add season stats if available
      seasonStats: data.stats || []
    }
    
    setCache(cacheKey, result)
    return result
  } catch (error) {
    console.error(`Failed to fetch recent form for team ${teamId}:`, error)
    return {
      last10Record: null,
      avgRunsLast10: null,
      avgRunsAllowedLast10: null,
      homeRecord: null,
      awayRecord: null
    }
  }
}

/**
 * Fetch weather data for a game (mock implementation for MVP)
 */
export async function fetchGameWeather(mlbGameId, gameDate) {
  const cacheKey = `weather_${mlbGameId}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    // For MVP, we'll use a mock weather service
    // In production, you'd integrate with a real weather API like OpenWeatherMap
    const mockWeather = generateMockWeather(gameDate)
    
    setCache(cacheKey, mockWeather)
    return mockWeather
  } catch (error) {
    console.error(`Failed to fetch weather for game ${mlbGameId}:`, error)
    return {
      temperature: null,
      windSpeed: null,
      windDirection: null,
      humidity: null,
      precipitation: null
    }
  }
}

/**
 * Generate mock weather data for MVP (replace with real weather API)
 */
function generateMockWeather(gameDate) {
  const month = new Date(gameDate).getMonth()
  const hour = new Date(gameDate).getHours()
  
  // Seasonal temperature ranges
  const tempRanges = {
    0: [25, 45],   // January
    1: [30, 50],   // February
    2: [40, 65],   // March
    3: [50, 75],   // April
    4: [60, 85],   // May
    5: [70, 95],   // June
    6: [75, 100],  // July
    7: [70, 95],   // August
    8: [60, 85],   // September
    9: [45, 70],   // October
    10: [35, 55],  // November
    11: [25, 45]   // December
  }
  
  const [minTemp, maxTemp] = tempRanges[month] || [60, 80]
  const temperature = Math.round(minTemp + Math.random() * (maxTemp - minTemp))
  
  // Wind conditions
  const windSpeed = Math.round(3 + Math.random() * 12) // 3-15 mph
  const windDirections = ['in', 'out', 'cross', 'calm']
  const windDirection = windDirections[Math.floor(Math.random() * windDirections.length)]
  
  // Humidity (higher in summer)
  const baseHumidity = month >= 5 && month <= 8 ? 60 : 45
  const humidity = Math.round(baseHumidity + Math.random() * 25)
  
  // Precipitation chance (lower in dome stadiums, higher in summer)
  const precipitation = Math.random() < 0.15 ? Math.round(Math.random() * 0.5 * 10) / 10 : 0
  
  return {
    temperature,
    windSpeed,
    windDirection,
    humidity,
    precipitation
  }
}

/**
 * Calculate recent form from team schedule data
 */
function calculateRecentForm(scheduleData, teamId) {
  try {
    const games = scheduleData.dates?.flatMap(date => date.games) || []
    const teamGames = games.filter(game => 
      game.teams?.home?.team?.id?.toString() === teamId.toString() || 
      game.teams?.away?.team?.id?.toString() === teamId.toString()
    )
    
    // Sort by date (most recent first)
    teamGames.sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
    
    // Last 10 games
    const last10Games = teamGames.slice(0, 10)
    const last10Wins = last10Games.filter(game => {
      const isHome = game.teams.home.team.id.toString() === teamId.toString()
      return (isHome && game.teams.home.isWinner) || (!isHome && game.teams.away.isWinner)
    }).length
    
    // Calculate runs scored/allowed in last 10
    let totalRunsScored = 0
    let totalRunsAllowed = 0
    
    last10Games.forEach(game => {
      const isHome = game.teams.home.team.id.toString() === teamId.toString()
      const teamRuns = isHome ? game.teams.home.score : game.teams.away.score
      const opponentRuns = isHome ? game.teams.away.score : game.teams.home.score
      
      totalRunsScored += teamRuns || 0
      totalRunsAllowed += opponentRuns || 0
    })
    
    // Home/Away records (all season)
    const homeGames = teamGames.filter(game => game.teams.home.team.id.toString() === teamId.toString())
    const awayGames = teamGames.filter(game => game.teams.away.team.id.toString() === teamId.toString())
    
    const homeWins = homeGames.filter(game => game.teams.home.isWinner).length
    const awayWins = awayGames.filter(game => game.teams.away.isWinner).length
    
    return {
      last10Record: `${last10Wins}-${10 - last10Wins}`,
      avgRunsLast10: last10Games.length > 0 ? (totalRunsScored / last10Games.length).toFixed(1) : null,
      avgRunsAllowedLast10: last10Games.length > 0 ? (totalRunsAllowed / last10Games.length).toFixed(1) : null,
      homeRecord: `${homeWins}-${homeGames.length - homeWins}`,
      awayRecord: `${awayWins}-${awayGames.length - awayWins}`
    }
  } catch (error) {
    console.error('Error calculating recent form:', error)
    return {
      last10Record: null,
      avgRunsLast10: null,
      avgRunsAllowedLast10: null,
      homeRecord: null,
      awayRecord: null
    }
  }
}

/**
 * Map linescore data to live game format
 */
function mapLiveGameData(linescoreData) {
  try {
    // Map the status correctly
    let status = 'Unknown'
    
    // Check multiple status fields
    const gameState = linescoreData.status?.codedGameState || linescoreData.status?.abstractGameState
    const detailedState = linescoreData.status?.detailedState
    
    if (gameState === 'F' || detailedState === 'Final') {
      status = 'final'
    } else if (gameState === 'I' || detailedState === 'In Progress') {
      status = 'in_progress'
    } else if (gameState === 'P' || detailedState === 'Pre-Game') {
      status = 'pre_game'
    } else if (gameState === 'S' || detailedState === 'Scheduled') {
      status = 'scheduled'
    } else if (gameState === 'D' || detailedState === 'Postponed') {
      status = 'postponed'
    } else if (gameState === 'W' || detailedState === 'Warmup') {
      status = 'warmup'
    } else {
      // Fallback: check if game has actually started
      const currentInning = linescoreData.currentInning
      const homeScore = linescoreData.teams?.home?.runs || 0
      const awayScore = linescoreData.teams?.away?.runs || 0
      
      if (currentInning && currentInning >= 9) {
        status = 'final'
      } else if (currentInning && currentInning > 0) {
        status = 'in_progress'
      } else if (homeScore > 0 || awayScore > 0) {
        status = 'in_progress'
      } else {
        // No inning data and no scores - game hasn't started
        status = 'scheduled'
      }
    }
    
    // The linescore API has a different structure
    return {
      homeScore: linescoreData.teams?.home?.runs || 0,
      awayScore: linescoreData.teams?.away?.runs || 0,
      inning: linescoreData.currentInning || null,
      inningHalf: linescoreData.inningHalf || null,
      outs: linescoreData.outs || null,
      balls: linescoreData.balls || null,
      strikes: linescoreData.strikes || null,
      status: status,
      lastPlay: null, // Not available in linescore API
      lastUpdate: new Date(),
      
      // Baserunners (if available from offense)
      runnerOn1st: linescoreData.offense?.first?.id?.toString() || null,
      runnerOn2nd: linescoreData.offense?.second?.id?.toString() || null,
      runnerOn3rd: linescoreData.offense?.third?.id?.toString() || null,
      
      // Current batter/pitcher (if available from offense/defense)
      currentBatterId: linescoreData.offense?.batter?.id?.toString() || null,
      currentPitcherId: linescoreData.defense?.pitcher?.id?.toString() || null,
    }
  } catch (error) {
    console.error('Error mapping live game data:', error)
    return null
  }
}

/**
 * Map boxscore data to lineup format
 */
function mapLineupData(boxscoreData) {
  const lineups = { home: [], away: [] }
  
  try {
    const teams = boxscoreData.teams
    
    // Extract home team batting order
    if (teams.home && teams.home.battingOrder) {
      lineups.home = teams.home.battingOrder.map((playerId, index) => {
        const playerInfo = teams.home.players[`ID${playerId}`] || {}
        return {
          id: playerId.toString(),
          fullName: playerInfo.person?.fullName || 'Unknown',
          bats: playerInfo.person?.batSide?.code || null,
          throws: playerInfo.person?.pitchHand?.code || null,
          isPitcher: playerInfo.person?.primaryPosition?.code === '1',
          battingOrder: index + 1
        }
      })
    }
    
    // Extract away team batting order
    if (teams.away && teams.away.battingOrder) {
      lineups.away = teams.away.battingOrder.map((playerId, index) => {
        const playerInfo = teams.away.players[`ID${playerId}`] || {}
        return {
          id: playerId.toString(),
          fullName: playerInfo.person?.fullName || 'Unknown',
          bats: playerInfo.person?.batSide?.code || null,
          throws: playerInfo.person?.pitchHand?.code || null,
          isPitcher: playerInfo.person?.primaryPosition?.code === '1',
          battingOrder: index + 1
        }
      })
    }
  } catch (error) {
    console.error('Error mapping lineup data:', error)
  }
  
  return lineups
}

/**
 * Map player stats data including splits
 */
function mapPlayerStatsData(statsData) {
  const splits = []
  
  try {
    if (statsData.stats && statsData.stats.length > 0) {
      for (const stat of statsData.stats) {
        if (stat.splits) {
          for (const split of stat.splits) {
            const splitData = {
              season: split.season || new Date().getFullYear(),
              vsHand: split.split?.code === 'vr' ? 'R' : split.split?.code === 'vl' ? 'L' : 'R', // vr = vs righties, vl = vs lefties
              scope: 'season',
              samplePA: split.stat?.plateAppearances || 0
            }
            
            // Map hitting stats
            if (split.stat) {
              splitData.wOBA = calculateWOBA(split.stat)
              splitData.ISO = (split.stat.sluggingPct || 0) - (split.stat.avg || 0)
              splitData.kRate = split.stat.strikeOuts / Math.max(split.stat.plateAppearances, 1)
              splitData.bbRate = split.stat.baseOnBalls / Math.max(split.stat.plateAppearances, 1)
              splitData.xwOBA = splitData.wOBA // Using wOBA as proxy for xwOBA in MVP
            }
            
            splits.push(splitData)
          }
        }
      }
    }
  } catch (error) {
    console.error('Error mapping player stats:', error)
  }
  
  return splits
}

/**
 * Calculate wOBA from basic stats (simplified version)
 */
function calculateWOBA(stats) {
  const pa = stats.plateAppearances || 0
  if (pa === 0) return 0
  
  // Simplified wOBA calculation using available stats
  const singles = (stats.hits || 0) - (stats.doubles || 0) - (stats.triples || 0) - (stats.homeRuns || 0)
  const bb = stats.baseOnBalls || 0
  const hbp = stats.hitByPitch || 0
  const doubles = stats.doubles || 0
  const triples = stats.triples || 0
  const hr = stats.homeRuns || 0
  
  // Standard wOBA weights (approximate)
  const wOBA = (0.690 * bb + 0.722 * hbp + 0.888 * singles + 1.271 * doubles + 1.616 * triples + 2.101 * hr) / pa
  
  return Math.max(0, Math.min(1, wOBA)) // Keep between 0 and 1
}

function mapPlayerData(apiPlayer) {
  return {
    id: apiPlayer.id.toString(),
    fullName: apiPlayer.fullName,
    bats: apiPlayer.batSide?.code || null,
    throws: apiPlayer.pitchHand?.code || null,
    isPitcher: apiPlayer.primaryPosition?.code === '1',
    // Add basic stats if available
    stats: apiPlayer.stats || []
  }
}

// Static pitcher handedness lookup for common pitchers
function getPitcherHandedness(pitcherName) {
  const knownLefties = [
    'Cole Ragans', 'Yusei Kikuchi', 'Tarik Skubal', 'Jesus Luzardo',
    'Tyler Anderson', 'Jose Quintana', 'Jordan Montgomery', 'Patrick Sandoval',
    'Framber Valdez', 'Carlos Rodon', 'Rich Hill', 'Martin Perez',
    'MacKenzie Gore', 'Eduardo Rodriguez', 'Reid Detmers', 'Andrew Heaney',
    'Matt Boyd', 'Danny Duffy', 'Steven Matz', 'Wade Miley'
  ]
  
  const knownRighties = [
    'Gerrit Cole', 'Shane Bieber', 'Aaron Nola', 'Zac Gallen',
    'Pablo Lopez', 'George Kirby', 'Logan Gilbert', 'Freddy Peralta',
    'Corbin Burnes', 'Dylan Cease', 'Reynaldo Lopez', 'Tanner Houck',
    'Michael McGreevy', 'Jameson Taillon', 'Yoshinobu Yamamoto',
    'Walker Buehler', 'Tyler Glasnow', 'Spencer Strider', 'Zack Wheeler',
    'Cristopher Sanchez', 'Ranger Suarez', 'Christopher Bassitt'
  ]
  
  if (knownLefties.some(name => pitcherName.includes(name))) {
    return 'L'
  }
  if (knownRighties.some(name => pitcherName.includes(name))) {
    return 'R'
  }
  
  return null // Unknown
}

// Static park factors for MVP (in reality would come from data service)
function getParkFactor(teamAbbr) {
  const parkFactors = {
    'COL': 1.15, // Coors Field
    'BOS': 1.08, // Fenway Park
    'TEX': 1.06, // Globe Life Field
    'CIN': 1.05, // Great American Ball Park
    'BAL': 1.04, // Oriole Park
    'NYY': 1.03, // Yankee Stadium
    'MIN': 1.02, // Target Field
    'HOU': 0.98, // Minute Maid Park
    'LAA': 0.97, // Angel Stadium
    'TB': 0.96,  // Tropicana Field
    'SD': 0.95,  // Petco Park
    'SEA': 0.94, // T-Mobile Park
    'OAK': 0.93, // Oakland Coliseum
    'MIA': 0.92, // loanDepot park
  }
  
  return parkFactors[teamAbbr] || 1.00 // Default neutral
}

