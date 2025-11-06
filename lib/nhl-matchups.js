// NHL Matchup Analysis - Similar to NFL
// Uses ESPN API for current season stats as fallback when historical data unavailable

import { supabase } from './supabase.js'
import { getGameDetail } from './db-supabase.js'

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Analyze offensive vs defensive matchup for an NHL game
 * Falls back to current season stats if historical matchup data unavailable
 */
export async function analyzeNHLMatchup(gameId) {
  try {
    // Get game using Supabase helper
    const game = await getGameDetail(gameId)
    
    if (!game || game.sport !== 'nhl') {
      throw new Error('Game not found or not an NHL game')
    }
    
    // Try to get historical matchup data first
    const homeOffenseVsAwayDefense = await getMatchupHistory(
      game.homeId, game.awayId
    )
    
    const awayOffenseVsHomeDefense = await getMatchupHistory(
      game.awayId, game.homeId
    )
    
    // If no historical data OR only 1 game (which would just show that game's score), 
    // fetch current season stats from ESPN instead
    let homeAdvantages, awayAdvantages
    
    // Prefer season stats if:
    // 1. No historical matchup data, OR
    // 2. Only 1 historical game (which would just show that single game's score, not a real average)
    const hasEnoughMatchupHistory = homeOffenseVsAwayDefense.length >= 2 && awayOffenseVsHomeDefense.length >= 2
    
    if (!hasEnoughMatchupHistory) {
      // Use season stats instead of single-game matchup
      // This ensures we show actual season averages, not just one game's score
      console.log(`🏒 Fetching season stats for ${game.home.abbr} vs ${game.away.abbr} (${homeOffenseVsAwayDefense.length} vs ${awayOffenseVsHomeDefense.length} matchup games - using season stats)`)
      const homeStats = await fetchTeamSeasonStats(game.homeId, game.home.abbr, game.espnGameId)
      const awayStats = await fetchTeamSeasonStats(game.awayId, game.away.abbr, game.espnGameId)
      
      console.log(`   Home stats:`, homeStats)
      console.log(`   Away stats:`, awayStats)
      
      homeAdvantages = calculateMatchupAdvantagesFromSeasonStats(homeStats, awayStats, 'home')
      awayAdvantages = calculateMatchupAdvantagesFromSeasonStats(awayStats, homeStats, 'away')
    } else {
      // Use historical data (2+ games between these teams)
      console.log(`🏒 Using historical matchup data for ${game.home.abbr} vs ${game.away.abbr} (${homeOffenseVsAwayDefense.length} games)`)
      homeAdvantages = calculateMatchupAdvantages(homeOffenseVsAwayDefense, 'home')
      awayAdvantages = calculateMatchupAdvantages(awayOffenseVsHomeDefense, 'away')
    }
    
    // Get key matchup insights
    const insights = generateMatchupInsights(game, homeAdvantages, awayAdvantages)
    
    return {
      game,
      homeOffenseVsAwayDefense,
      awayOffenseVsHomeDefense,
      advantages: {
        home: homeAdvantages,
        away: awayAdvantages
      },
      insights
    }
    
  } catch (error) {
    console.error('Error analyzing NHL matchup:', error)
    return null
  }
}

/**
 * Get historical matchup data between teams from completed games in database
 * Calculates stats from past games where these teams played each other
 */
async function getMatchupHistory(offenseTeamId, defenseTeamId) {
  try {
    // Get all completed games where offenseTeam played defenseTeam
    // (offenseTeam could be home or away, so check both scenarios)
    const { data: games, error } = await supabase
      .from('Game')
      .select('id, homeId, awayId, homeScore, awayScore, date, status')
      .eq('sport', 'nhl')
      .eq('status', 'final')
      .or(`and(homeId.eq.${offenseTeamId},awayId.eq.${defenseTeamId}),and(homeId.eq.${defenseTeamId},awayId.eq.${offenseTeamId})`)
      .order('date', { ascending: false })
      .limit(10) // Last 10 matchups
    
    if (error) {
      console.error('Error fetching matchup history:', error)
      return []
    }
    
    if (!games || games.length === 0) {
      return []
    }
    
    // Calculate stats for offenseTeam when playing defenseTeam
    const matchupStats = games.map(game => {
      let goals = 0
      let goalsAgainst = 0
      
      if (game.homeId === offenseTeamId) {
        // Offense team was home
        goals = game.homeScore || 0
        goalsAgainst = game.awayScore || 0
      } else {
        // Offense team was away
        goals = game.awayScore || 0
        goalsAgainst = game.homeScore || 0
      }
      
      return {
        gameId: game.id,
        date: game.date,
        goals: goals,
        goalsAgainst: goalsAgainst,
        pointsScored: goals, // For compatibility with NFL format
        totalYards: null, // Not applicable for NHL
        turnovers: null,
        thirdDownPct: null,
        redZonePct: null
      }
    })
    
    console.log(`📊 Found ${matchupStats.length} historical games between teams`)
    return matchupStats
    
  } catch (error) {
    console.error('Error getting NHL matchup history:', error)
    return []
  }
}

/**
 * Fetch team season stats from ESPN
 * Priority: 1) Direct team endpoint, 2) Game summary endpoint, 3) Database calculation
 * @param {string} teamId - Our database team ID
 * @param {string} teamAbbr - Team abbreviation
 * @param {string} currentGameEspnId - Optional ESPN ID of current game (for fallback)
 */
async function fetchTeamSeasonStats(teamId, teamAbbr, currentGameEspnId = null) {
  try {
    // Remove NHL_ prefix if present to get ESPN team ID
    const espnTeamId = teamId.replace(/^NHL_/, '')
    
    // PRIORITY 1: Try direct team endpoint (no game ID needed!)
    // Based on ESPN API guide: /teams/{team_id}?enable=roster,projection,stats
    const teamStats = await fetchTeamSeasonStatsDirect(espnTeamId, teamAbbr)
    if (teamStats && teamStats.goalsPerGame) {
      console.log(`✅ Fetched team stats directly for ${teamAbbr}`)
      
      // If we have stats but missing shots, try to calculate from recent games OR use any NHL game
      if (!teamStats.shotsPerGame) {
        console.log(`  Calculating shots per game from recent ESPN games for ${teamAbbr}...`)
        const shotsData = await calculateShotsPerGameFromESPN(espnTeamId, teamAbbr)
        if (shotsData.shotsPerGame) {
          teamStats.shotsPerGame = shotsData.shotsPerGame
          teamStats.shotsAgainstPerGame = shotsData.shotsAgainstPerGame
          console.log(`  ✅ Calculated shots per game: ${shotsData.shotsPerGame} (from ${teamAbbr} recent games)`)
        } else {
          // Fallback: Try to get shots from current game or ANY recent NHL game
          console.log(`  ⚠️  No team-specific games found, trying fallback for ${teamAbbr}...`)
          const fallbackShots = await calculateShotsFromAnyRecentGame(espnTeamId, teamAbbr, currentGameEspnId)
          if (fallbackShots.shotsPerGame) {
            teamStats.shotsPerGame = fallbackShots.shotsPerGame
            teamStats.shotsAgainstPerGame = fallbackShots.shotsAgainstPerGame
            console.log(`  ✅ Got shots from fallback: ${fallbackShots.shotsPerGame}`)
          }
        }
      }
      
      return teamStats
    }
    
    // PRIORITY 2: Fallback to game summary endpoint (works but requires game ID)
    console.log(`⚠️  Direct team endpoint failed for ${teamAbbr}, trying game summary...`)
    const summaryStats = await fetchTeamSeasonStatsFromGame(espnTeamId, teamAbbr, currentGameEspnId)
    if (summaryStats && (summaryStats.goalsPerGame || summaryStats.shotsPerGame)) {
      console.log(`✅ Fetched team stats from game summary for ${teamAbbr}`)
      return summaryStats
    }
    
    // PRIORITY 3: Calculate from database
    console.log(`⚠️  ESPN endpoints failed for ${teamAbbr}, calculating from database...`)
    return await calculateStatsFromDatabase(teamId, teamAbbr)
    
  } catch (error) {
    console.error(`Error fetching ESPN stats for ${teamAbbr}:`, error)
    return await calculateStatsFromDatabase(teamId, teamAbbr)
  }
}

/**
 * Fetch team season stats directly from ESPN team endpoint
 * Based on ESPN API guide: /apis/site/v2/sports/hockey/nhl/teams/{team_id}?enable=stats
 * Response structure: data.team.record.items[].stats[] where items[].type === 'total'
 * @param {string} espnTeamId - ESPN team ID
 * @param {string} teamAbbr - Team abbreviation
 */
async function fetchTeamSeasonStatsDirect(espnTeamId, teamAbbr) {
  try {
    // Try with enable=stats parameter first
    const url = `${ESPN_NHL_BASE}/teams/${espnTeamId}?enable=stats`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.warn(`Direct team endpoint returned ${response.status} for ${teamAbbr}`)
      return null
    }
    
    const data = await response.json()
    
    // Extract stats from response structure: team.record.items[].stats[]
    const team = data.team
    if (!team || !team.record || !team.record.items || !Array.isArray(team.record.items)) {
      console.warn(`Invalid response structure from team endpoint for ${teamAbbr}`)
      return null
    }
    
    // Find the "total" (overall) stats, or use first item
    const overallStats = team.record.items.find(item => item.type === 'total') || team.record.items[0]
    
    if (!overallStats || !overallStats.stats || !Array.isArray(overallStats.stats)) {
      console.warn(`No statistics array found in team endpoint for ${teamAbbr}`)
      return null
    }
    
    // Extract season stats from statistics array
    const extractedStats = {}
    for (const stat of overallStats.stats) {
      const name = stat.name || ''
      
      // ESPN uses "avgPointsFor" for goals per game and "avgPointsAgainst" for goals against
      if (name === 'avgPointsFor') {
        extractedStats.goalsPerGame = parseFloat(stat.value) || null
      } else if (name === 'avgPointsAgainst') {
        extractedStats.goalsAgainstPerGame = parseFloat(stat.value) || null
      } else if (name === 'powerPlayPct') {
        extractedStats.powerPlayPct = parseFloat(stat.value) || null
      } else if (name === 'penaltyKillPct') {
        extractedStats.penaltyKillPct = parseFloat(stat.value) || null
      }
      // Note: Shots per game not available in this endpoint - will use game summary fallback
    }
    
    // Get games played from the stats or database
    const gamesPlayedStat = overallStats.stats.find(s => s.name === 'gamesPlayed')
    const gamesPlayed = gamesPlayedStat ? parseInt(gamesPlayedStat.value) : 0
    
    // If no games played from API, try database
    let finalGamesPlayed = gamesPlayed
    if (!finalGamesPlayed) {
      const teamId = `NHL_${espnTeamId}`
      const { count } = await supabase
        .from('Game')
        .select('*', { count: 'exact', head: true })
        .eq('sport', 'nhl')
        .eq('status', 'final')
        .or(`homeId.eq.${teamId},awayId.eq.${teamId}`)
      finalGamesPlayed = count || 0
    }
    
    // Check if we got any meaningful stats
    const hasStats = extractedStats.goalsPerGame || extractedStats.powerPlayPct
    
    if (!hasStats) {
      console.warn(`No meaningful stats extracted from team endpoint for ${teamAbbr}`)
      return null
    }
    
    return {
      goalsPerGame: extractedStats.goalsPerGame || null,
      shotsPerGame: null, // Not available in team endpoint - use game summary fallback
      powerPlayPct: extractedStats.powerPlayPct || null,
      penaltyKillPct: extractedStats.penaltyKillPct || null,
      goalsAgainstPerGame: extractedStats.goalsAgainstPerGame || null,
      shotsAgainstPerGame: null, // Not available in team endpoint - use game summary fallback
      gamesPlayed: finalGamesPlayed
    }
    
  } catch (error) {
    console.warn(`Error fetching direct team stats for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Fetch team season stats from ESPN game summary endpoint (fallback method)
 * The summary endpoint includes team season averages in the boxscore
 * NOTE: ESPN returns stats for ALL teams in ANY game, so we can use any game!
 * @param {string} espnTeamId - ESPN team ID
 * @param {string} teamAbbr - Team abbreviation
 * @param {string} currentGameEspnId - Optional ESPN ID of current game (can use this!)
 */
async function fetchTeamSeasonStatsFromGame(espnTeamId, teamAbbr, currentGameEspnId = null) {
  try {
    let espnGameIdToUse = null
    
    // Priority 1: Use current game's ESPN ID if provided
    if (currentGameEspnId) {
      espnGameIdToUse = currentGameEspnId
      console.log(`  Using current game ESPN ID: ${currentGameEspnId} for ${teamAbbr}`)
    } else {
      // Priority 2: Get ANY NHL game with ESPN ID from this week
      const today = new Date()
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      
      const { data: anyGame } = await supabase
        .from('Game')
        .select('espnGameId')
        .eq('sport', 'nhl')
        .not('espnGameId', 'is', null)
        .gte('date', weekAgo.toISOString())
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (anyGame && anyGame.espnGameId) {
        espnGameIdToUse = anyGame.espnGameId
        console.log(`  Using any recent game ESPN ID: ${espnGameIdToUse} for ${teamAbbr}`)
      } else {
        // Priority 3: Fetch from ESPN scoreboard directly
        console.log(`  No games with ESPN ID in DB, fetching from ESPN scoreboard for ${teamAbbr}`)
        espnGameIdToUse = await findGameFromESPN(espnTeamId, teamAbbr)
      }
    }
    
    if (!espnGameIdToUse) {
      return null
    }
    
    // Fetch game summary from ESPN to get season stats
    // NOTE: This returns stats for BOTH teams, so we can extract our team's stats
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameIdToUse}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.warn(`  Failed to fetch ESPN summary for ${teamAbbr}: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    const boxscore = data.boxscore
    
    if (!boxscore || !boxscore.teams) {
      console.warn(`  No boxscore data in ESPN response for ${teamAbbr}`)
      return null
    }
    
    // Find our team in the boxscore
    const teamData = boxscore.teams.find(t => 
      t.team?.id === espnTeamId || t.team?.abbreviation === teamAbbr.toUpperCase()
    )
    
    if (!teamData || !teamData.statistics) {
      console.warn(`  Team ${teamAbbr} not found in ESPN boxscore`)
      return null
    }
    
    // Extract season stats from ESPN statistics
    const stats = {}
    for (const stat of teamData.statistics) {
      const name = stat.name?.toLowerCase() || ''
      const value = parseFloat(stat.displayValue) || 0
      
      if (name === 'avggoals' || name === 'goalsforpergame') {
        stats.goalsPerGame = value
      } else if (name === 'avgshots' || name === 'shotspergame') {
        stats.shotsPerGame = value
      } else if (name === 'powerplaypct' || name === 'powerplaypercentage') {
        stats.powerPlayPct = value
      } else if (name === 'penaltykillpct' || name === 'penaltykillpercentage') {
        stats.penaltyKillPct = value
      } else if (name === 'avggoalsagainst' || name === 'goalsagainstpergame') {
        stats.goalsAgainstPerGame = value
      } else if (name === 'avgshotsagainst' || name === 'shotsagainstpergame') {
        stats.shotsAgainstPerGame = value
      }
    }
    
    // Get games played from database
    const teamId = `NHL_${espnTeamId}`
    const { count } = await supabase
      .from('Game')
      .select('*', { count: 'exact', head: true })
      .eq('sport', 'nhl')
      .eq('status', 'final')
      .or(`homeId.eq.${teamId},awayId.eq.${teamId}`)
    
    return {
      goalsPerGame: stats.goalsPerGame || null,
      shotsPerGame: stats.shotsPerGame || null,
      powerPlayPct: stats.powerPlayPct || null,
      penaltyKillPct: stats.penaltyKillPct || null,
      goalsAgainstPerGame: stats.goalsAgainstPerGame || null,
      shotsAgainstPerGame: stats.shotsAgainstPerGame || null,
      gamesPlayed: count || 0
    }
    
  } catch (error) {
    console.warn(`Error fetching team stats from game summary for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Fallback: Get shots from ANY recent NHL game (ESPN returns all teams' stats in any game summary)
 * Since ESPN's game summary includes season stats for all teams, we can use any game
 */
async function calculateShotsFromAnyRecentGame(espnTeamId, teamAbbr, currentGameEspnId = null) {
  try {
    let espnGameId = null
    
    // Try 1: Use current game's ESPN ID if provided (most reliable)
    if (currentGameEspnId) {
      espnGameId = currentGameEspnId
      console.log(`  📋 Using current game ESPN ID: ${espnGameId}`)
    } else {
      // Try 2: Get ANY recent NHL game with ESPN ID from database
      const { data: anyGame } = await supabase
        .from('Game')
        .select('espnGameId')
        .eq('sport', 'nhl')
        .not('espnGameId', 'is', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (anyGame && anyGame.espnGameId) {
        espnGameId = anyGame.espnGameId
        console.log(`  📋 Using game from DB: ${espnGameId}`)
      } else {
        // Try 3: Get from today's scoreboard
        console.log(`  📋 No games in DB, fetching from today's scoreboard...`)
        const scoreboardUrl = `${ESPN_NHL_BASE}/scoreboard`
        const scoreboardResponse = await fetch(scoreboardUrl, {
          headers: { 'User-Agent': 'OddsOnDeck/1.0' }
        })
        
        if (scoreboardResponse.ok) {
          const scoreboardData = await scoreboardResponse.json()
          const events = scoreboardData.events || []
          if (events.length > 0 && events[0].id) {
            espnGameId = events[0].id
            console.log(`  📋 Using game from scoreboard: ${espnGameId}`)
          }
        }
      }
    }
    
    if (!espnGameId) {
      console.warn(`  ⚠️  No games found to get shots data`)
      return { shotsPerGame: null, shotsAgainstPerGame: null }
    }
    
    // Fetch the game summary - ESPN returns stats for ALL teams in any game
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.warn(`  ⚠️  Failed to fetch game summary: ${response.status}`)
      return { shotsPerGame: null, shotsAgainstPerGame: null }
    }
    
    const data = await response.json()
    const boxscore = data.boxscore
    
    if (!boxscore || !boxscore.teams) {
      console.warn(`  ⚠️  No boxscore data in response`)
      return { shotsPerGame: null, shotsAgainstPerGame: null }
    }
    
    // Find our team in the boxscore
    const teamData = boxscore.teams.find(t => {
      const teamId = String(t.team?.id || '')
      const espnId = String(espnTeamId)
      return teamId === espnId || t.team?.abbreviation === teamAbbr.toUpperCase()
    })
    
    if (teamData && teamData.statistics) {
      // Look for season average shots if available, otherwise use game shots
      const shotsStat = teamData.statistics.find(s => 
        s.name === 'shotsTotal' || 
        s.name?.toLowerCase().includes('avgshot') ||
        s.name?.toLowerCase().includes('shotspergame')
      )
      
      if (shotsStat && shotsStat.displayValue) {
        const shots = parseFloat(shotsStat.displayValue) || 0
        if (shots > 0) {
          // Note: This might be a single game's shots, not season average
          // But it's better than null
          console.log(`  ✅ Found shots: ${shots}`)
          return { shotsPerGame: Math.round(shots * 10) / 10, shotsAgainstPerGame: null }
        }
      }
    }
    
    console.warn(`  ⚠️  Team ${teamAbbr} not found or no shots stat in boxscore`)
    return { shotsPerGame: null, shotsAgainstPerGame: null }
  } catch (error) {
    console.warn(`Error getting shots from recent game for ${teamAbbr}:`, error.message)
    return { shotsPerGame: null, shotsAgainstPerGame: null }
  }
}

/**
 * Fetch shots per game by calculating from recent completed games via ESPN
 * This is a fallback since ESPN doesn't provide season average shots in their endpoints
 */
async function calculateShotsPerGameFromESPN(espnTeamId, teamAbbr) {
  try {
    console.log(`  📊 Calculating shots for ${teamAbbr} (ESPN ID: ${espnTeamId})...`)
    
    // Get recent completed games with ESPN IDs from our database
    const currentYear = new Date().getFullYear()
    const seasonStart = new Date(currentYear, 8, 1)
    
    const { data: games, error } = await supabase
      .from('Game')
      .select('espnGameId, homeId, awayId')
      .eq('sport', 'nhl')
      .eq('status', 'final')
      .or(`homeId.eq.NHL_${espnTeamId},awayId.eq.NHL_${espnTeamId}`)
      .not('espnGameId', 'is', null)
      .gte('date', seasonStart.toISOString())
      .order('date', { ascending: false })
      .limit(10) // Sample last 10 games for performance
    
    if (error) {
      console.warn(`  ❌ Database error fetching games for ${teamAbbr}:`, error.message)
      return { shotsPerGame: null, shotsAgainstPerGame: null }
    }
    
    if (!games || games.length === 0) {
      console.warn(`  ⚠️  No completed games with ESPN IDs found for ${teamAbbr}`)
      return { shotsPerGame: null, shotsAgainstPerGame: null }
    }
    
    console.log(`  📋 Found ${games.length} completed games for ${teamAbbr}`)
    
    let totalShots = 0
    let totalShotsAgainst = 0
    let gamesWithShots = 0
    
    // Fetch shots from each game via ESPN
    for (const game of games) {
      try {
        const url = `${ESPN_NHL_BASE}/summary?event=${game.espnGameId}`
        const response = await fetch(url, {
          headers: { 'User-Agent': 'OddsOnDeck/1.0' }
        })
        
        if (!response.ok) {
          console.warn(`  ⚠️  Failed to fetch game ${game.espnGameId}: ${response.status}`)
          continue
        }
        
        const data = await response.json()
        const boxscore = data.boxscore
        
        if (!boxscore || !boxscore.teams) {
          console.warn(`  ⚠️  No boxscore data for game ${game.espnGameId}`)
          continue
        }
        
        // Find our team in the boxscore
        // ESPN team IDs can be strings or numbers, so convert both for comparison
        const teamData = boxscore.teams.find(t => {
          const teamId = String(t.team?.id || '')
          const espnId = String(espnTeamId)
          const teamIdMatch = teamId === espnId
          const abbrMatch = t.team?.abbreviation === teamAbbr.toUpperCase()
          return teamIdMatch || abbrMatch
        })
        
        if (teamData && teamData.statistics) {
          const shotsStat = teamData.statistics.find(s => s.name === 'shotsTotal')
          if (shotsStat && shotsStat.displayValue) {
            const shots = parseInt(shotsStat.displayValue) || 0
            if (shots > 0) {
              totalShots += shots
              gamesWithShots++
              console.log(`  ✅ Game ${game.espnGameId}: ${shots} shots`)
            }
          }
          
          // Get opponent shots (shots against)
          const opponentData = boxscore.teams.find(t => {
            const teamId = String(t.team?.id || '')
            const espnId = String(espnTeamId)
            const teamIdMatch = teamId !== espnId
            const abbrMatch = t.team?.abbreviation !== teamAbbr.toUpperCase()
            return teamIdMatch && abbrMatch
          })
          if (opponentData && opponentData.statistics) {
            const opponentShotsStat = opponentData.statistics.find(s => s.name === 'shotsTotal')
            if (opponentShotsStat && opponentShotsStat.displayValue) {
              const opponentShots = parseInt(opponentShotsStat.displayValue) || 0
              totalShotsAgainst += opponentShots
            }
          }
        } else {
          console.warn(`  ⚠️  Team ${teamAbbr} not found in boxscore for game ${game.espnGameId}`)
        }
      } catch (error) {
        console.warn(`  ⚠️  Error processing game ${game.espnGameId}:`, error.message)
        continue
      }
    }
    
    const shotsPerGame = gamesWithShots > 0 ? (totalShots / gamesWithShots) : null
    const shotsAgainstPerGame = gamesWithShots > 0 ? (totalShotsAgainst / gamesWithShots) : null
    
    if (shotsPerGame) {
      console.log(`  ✅ Calculated: ${shotsPerGame.toFixed(1)} shots/game (from ${gamesWithShots} games)`)
    } else {
      console.warn(`  ❌ Could not calculate shots - processed ${gamesWithShots} games`)
    }
    
    return {
      shotsPerGame: shotsPerGame ? Math.round(shotsPerGame * 10) / 10 : null,
      shotsAgainstPerGame: shotsAgainstPerGame ? Math.round(shotsAgainstPerGame * 10) / 10 : null
    }
  } catch (error) {
    console.error(`❌ Error calculating shots from ESPN for ${teamAbbr}:`, error.message)
    return { shotsPerGame: null, shotsAgainstPerGame: null }
  }
}

/**
 * Fallback: Calculate stats from completed games in database
 */
async function calculateStatsFromDatabase(teamId, teamAbbr) {
  try {
    const currentYear = new Date().getFullYear()
    const seasonStart = new Date(currentYear, 8, 1)
    const seasonEnd = new Date(currentYear + 1, 5, 30)
    
    const { data: games, error } = await supabase
      .from('Game')
      .select('id, homeId, awayId, homeScore, awayScore, status, date')
      .eq('sport', 'nhl')
      .eq('status', 'final')
      .or(`homeId.eq.${teamId},awayId.eq.${teamId}`)
      .gte('date', seasonStart.toISOString())
      .lte('date', seasonEnd.toISOString())
      .order('date', { ascending: false })
      .limit(82)
    
    if (error || !games || games.length === 0) {
      return getEmptyStats()
    }
    
    let totalGoals = 0
    let totalGoalsAgainst = 0
    
    games.forEach(game => {
      if (game.homeId === teamId) {
        totalGoals += game.homeScore || 0
        totalGoalsAgainst += game.awayScore || 0
      } else {
        totalGoals += game.awayScore || 0
        totalGoalsAgainst += game.homeScore || 0
      }
    })
    
    const goalsPerGame = games.length > 0 ? (totalGoals / games.length) : 0
    const goalsAgainstPerGame = games.length > 0 ? (totalGoalsAgainst / games.length) : 0
    
    // Try to get shots from ESPN if we have ESPN IDs
    const espnTeamId = teamId.replace(/^NHL_/, '')
    const shotsData = await calculateShotsPerGameFromESPN(espnTeamId, teamAbbr)
    
    return {
      goalsPerGame: goalsPerGame > 0 ? goalsPerGame : null,
      shotsPerGame: shotsData.shotsPerGame,
      powerPlayPct: null,
      penaltyKillPct: null,
      goalsAgainstPerGame: goalsAgainstPerGame > 0 ? goalsAgainstPerGame : null,
      shotsAgainstPerGame: shotsData.shotsAgainstPerGame,
      gamesPlayed: games.length
    }
  } catch (error) {
    console.error(`Error calculating stats from database for ${teamAbbr}:`, error)
    return getEmptyStats()
  }
}

/**
 * Try to find a game from ESPN API for a team
 * Returns ANY game from today's scoreboard (since ESPN returns stats for all teams in any game)
 */
async function findGameFromESPN(espnTeamId, teamAbbr) {
  try {
    // Get today's scoreboard - we can use ANY game since ESPN returns stats for all teams
    const url = `${ESPN_NHL_BASE}/scoreboard`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.warn(`ESPN scoreboard returned ${response.status}`)
      return null
    }
    
    const data = await response.json()
    const events = data.events || []
    
    if (events.length === 0) {
      console.warn('No games found in ESPN scoreboard')
      return null
    }
    
    // Priority: Try to find a game with this specific team
    for (const event of events) {
      const competition = event.competitions?.[0]
      const competitors = competition?.competitors || []
      
      for (const comp of competitors) {
        if (comp.team?.id === espnTeamId || comp.team?.abbreviation === teamAbbr.toUpperCase()) {
          console.log(`Found game ${event.id} with ${teamAbbr} in ESPN scoreboard`)
          return event.id
        }
      }
    }
    
    // Fallback: Use the first game (ESPN returns stats for all teams in any game)
    if (events[0]?.id) {
      console.log(`Using first game from scoreboard (${events[0].id}) - ESPN returns stats for all teams`)
      return events[0].id
    }
    
    return null
  } catch (error) {
    console.error(`Error finding game from ESPN for ${teamAbbr}:`, error)
    return null
  }
}

function getEmptyStats() {
  return {
    goalsPerGame: null,
    shotsPerGame: null,
    powerPlayPct: null,
    penaltyKillPct: null,
    goalsAgainstPerGame: null,
    shotsAgainstPerGame: null,
    gamesPlayed: 0
  }
}

/**
 * Calculate matchup advantages from current season stats
 * (Fallback when historical matchup data unavailable)
 */
function calculateMatchupAdvantagesFromSeasonStats(offenseStats, defenseStats, side) {
  if (!offenseStats || !defenseStats) {
    return {
      goalsAvg: null,
      shotsAvg: null,
      powerPlayPct: null,
      penaltyKillPct: null,
      gamesAnalyzed: 0,
      trend: 'no_data',
      efficiency: null
    }
  }
  
  // Check if we actually have any stats
  const hasAnyStats = offenseStats.goalsPerGame != null || 
                      offenseStats.shotsPerGame != null ||
                      offenseStats.powerPlayPct != null ||
                      offenseStats.penaltyKillPct != null
  
  // Ensure gamesPlayed is a number (default to 1 if we have stats but no gamesPlayed)
  const gamesPlayed = offenseStats.gamesPlayed || (hasAnyStats ? 1 : 0)
  
  return {
    goalsAvg: offenseStats.goalsPerGame ? offenseStats.goalsPerGame.toFixed(2) : null,
    shotsAvg: offenseStats.shotsPerGame ? Math.round(offenseStats.shotsPerGame) : null,
    powerPlayPct: offenseStats.powerPlayPct ? Math.round(offenseStats.powerPlayPct) : null,
    penaltyKillPct: offenseStats.penaltyKillPct ? Math.round(offenseStats.penaltyKillPct) : null,
    goalsAgainstAvg: defenseStats.goalsAgainstPerGame ? defenseStats.goalsAgainstPerGame.toFixed(2) : null,
    gamesAnalyzed: hasAnyStats ? gamesPlayed : 0, // Only show games analyzed if we have stats
    trend: 'stable',
    efficiency: calculateEfficiencyScore(offenseStats.goalsPerGame, offenseStats.shotsPerGame)
  }
}

/**
 * Calculate matchup advantages based on historical data
 */
function calculateMatchupAdvantages(matchupHistory, side) {
  if (!matchupHistory || matchupHistory.length === 0) {
    return {
      goalsAvg: null,
      shotsAvg: null,
      powerPlayPct: null,
      penaltyKillPct: null,
      gamesAnalyzed: 0,
      trend: 'no_data',
      efficiency: null
    }
  }
  
  const stats = matchupHistory.reduce((acc, game) => {
    acc.goals += game.goals || 0
    acc.goalsAgainst += game.goalsAgainst || 0
    acc.validGames += 1
    return acc
  }, {
    goals: 0,
    goalsAgainst: 0,
    validGames: 0
  })
  
  const avgGoals = stats.goals / stats.validGames
  const avgGoalsAgainst = stats.goalsAgainst / stats.validGames
  
  // Determine trend (compare recent vs older games)
  const recentGames = matchupHistory.slice(0, Math.min(3, matchupHistory.length))
  const olderGames = matchupHistory.slice(3)
  
  let trend = 'stable'
  if (recentGames.length > 0 && olderGames.length > 0) {
    const recentAvgGoals = recentGames.reduce((sum, g) => sum + (g.goals || 0), 0) / recentGames.length
    const olderAvgGoals = olderGames.reduce((sum, g) => sum + (g.goals || 0), 0) / olderGames.length
    
    if (recentAvgGoals > olderAvgGoals * 1.15) trend = 'improving'
    else if (recentAvgGoals < olderAvgGoals * 0.85) trend = 'declining'
  }
  
  return {
    goalsAvg: avgGoals.toFixed(2),
    shotsAvg: null, // Not available from basic game data
    powerPlayPct: null, // Would need detailed game stats
    penaltyKillPct: null, // Would need detailed game stats
    goalsAgainstAvg: avgGoalsAgainst.toFixed(2),
    gamesAnalyzed: stats.validGames,
    trend,
    efficiency: calculateEfficiencyScore(avgGoals, null) // Shots not available
  }
}

/**
 * Calculate efficiency score (0-100)
 */
function calculateEfficiencyScore(goals, shots) {
  // Efficiency requires both goals and shots to calculate shooting percentage
  // If shots are not available, we can't calculate efficiency
  if (!goals || goals === 0 || !shots || shots === 0) return null
  
  // Goals per shot percentage (shooting percentage)
  const goalsPerShot = (goals / shots) * 100
  
  // NHL average shooting percentage is roughly 9-10%
  // We'll normalize: 9.5% = 50 efficiency points
  const relativeEfficiency = (goalsPerShot / 9.5) * 50
  
  // Clamp between 0 and 100
  const finalScore = Math.max(0, Math.min(100, relativeEfficiency))
  return Math.round(finalScore)
}

/**
 * Generate matchup insights
 */
function generateMatchupInsights(game, homeAdvantages, awayAdvantages) {
  const insights = []
  
  if (homeAdvantages.gamesAnalyzed === 0 && awayAdvantages.gamesAnalyzed === 0) {
    insights.push({
      type: 'warning',
      category: 'data_availability',
      message: 'Showing current season stats (historical matchup data unavailable)',
      confidence: 'medium'
    })
  }
  
  // Efficiency insights
  if (homeAdvantages.efficiency && awayAdvantages.efficiency) {
    if (homeAdvantages.efficiency > awayAdvantages.efficiency + 15) {
      insights.push({
        type: 'advantage',
        team: 'home',
        category: 'offensive_efficiency',
        message: `${game.home.abbr} has superior offensive efficiency`,
        confidence: 'medium'
      })
    } else if (awayAdvantages.efficiency > homeAdvantages.efficiency + 15) {
      insights.push({
        type: 'advantage',
        team: 'away',
        category: 'offensive_efficiency',
        message: `${game.away.abbr} has superior offensive efficiency`,
        confidence: 'medium'
      })
    }
  }
  
  return insights
}

