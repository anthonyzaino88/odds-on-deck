// Fetch player game statistics from ESPN NFL API
//
// Grading adapter: fetchNFLGameStats / getPlayerGameStat keep historical
// behavior (missing category-stat values coerce to 0). They share
// parseEspnNflSummary with the archive path, then toGradingAdapterPlayerMap
// restores the zero-coercion. Archive records keep nulls; do not feed
// archive nulls into grading without that adapter.
//
// A player missing from the ESPN box score returns null → needs_review.
// That is not inferred as DNP: ESPN omits inactives and we have no
// inactive-list check. Leave those for a human.
//
// A player who matched in a final box but has no line in that category
// (e.g. a TE with 0 targets, or a QB with no rushing row) returns 0.
// Matching is exact normalized name or a unique first-name alias only.

import { isEspnNflEventCompleted, parseEspnNflSummary, toGradingAdapterPlayerMap } from '../nfl-box-score-archive.js'
import { normalizeGradePlayerName, uniqueFirstNameAliasMatch } from '../player-name-match.js'

const ESPN_NFL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'

async function loadNflGradingBox(espnGameId) {
  const url = `${ESPN_NFL_BASE}/summary?event=${espnGameId}`
  const response = await fetch(url)

  if (!response.ok) {
    console.error(`❌ ESPN API error: ${response.status} ${response.statusText}`)
    return null
  }

  const data = await response.json()
  const boxscore = data.boxscore
  if (!boxscore || !boxscore.players) {
    console.warn(`⚠️ No player stats available for game ${espnGameId}`)
    return null
  }

  const parsed = parseEspnNflSummary(data)
  return {
    playerStats: toGradingAdapterPlayerMap(parsed),
    gameFinal: isEspnNflEventCompleted(data),
  }
}

/**
 * Fetch box score and player stats for a completed NFL game
 * @param {string} espnGameId - ESPN game ID
 * @returns {Promise<object>} Player stats by name
 */
export async function fetchNFLGameStats(espnGameId) {
  try {
    console.log(`🏈 Fetching stats for NFL game ${espnGameId}...`)

    const loaded = await loadNflGradingBox(espnGameId)
    if (!loaded) return null

    console.log(`✅ Found stats for ${Object.keys(loaded.playerStats).length} players in game ${espnGameId}`)
    return loaded.playerStats
  } catch (error) {
    console.error(`❌ Error fetching NFL game stats for ${espnGameId}:`, error)
    return null
  }
}

export function matchNflBoxscorePlayer(gameStats, playerName) {
  if (!gameStats || !playerName) return null
  if (gameStats[playerName]) return gameStats[playerName]
  const normalized = normalizeGradePlayerName(playerName)
  if (!normalized) return null
  const names = Object.keys(gameStats)
  const exact = names.filter((name) => normalizeGradePlayerName(name) === normalized)
  if (exact.length === 1) return gameStats[exact[0]]
  if (exact.length > 1) return null
  const aliasKey = uniqueFirstNameAliasMatch(names, normalized)
  return aliasKey ? gameStats[aliasKey] : null
}

/**
 * Get a specific player's stat from a game
 * @param {string} espnGameId - ESPN game ID
 * @param {string} playerName - Full player name
 * @param {string} statType - Stat type (passing_yards, rushing_yards, etc.)
 * @returns {Promise<number|null>}
 */
export async function getPlayerGameStat(espnGameId, playerName, statType) {
  try {
    const loaded = await loadNflGradingBox(espnGameId)
    if (!loaded) return null

    const playerData = matchNflBoxscorePlayer(loaded.playerStats, playerName)

    if (!playerData) {
      console.warn(`⚠️ No stats found for ${playerName} in game ${espnGameId}`)
      return null
    }

    // Map prop types to stat fields (support both with and without 'player_' prefix)
    const statMap = {
      'passing_yards': 'passingYards',
      'player_passing_yards': 'passingYards',
      'player_pass_yds': 'passingYards',
      'passing_touchdowns': 'passingTouchdowns',
      'player_passing_touchdowns': 'passingTouchdowns',
      'player_pass_tds': 'passingTouchdowns',
      'passing_completions': 'passingCompletions',
      'player_passing_completions': 'passingCompletions',
      'player_pass_completions': 'passingCompletions',
      'passing_attempts': 'passingAttempts',
      'player_passing_attempts': 'passingAttempts',
      'player_pass_attempts': 'passingAttempts',
      'interceptions': 'interceptions',
      'player_interceptions': 'interceptions',
      'rushing_yards': 'rushingYards',
      'player_rushing_yards': 'rushingYards',
      'player_rush_yds': 'rushingYards',
      'rushing_touchdowns': 'rushingTouchdowns',
      'player_rushing_touchdowns': 'rushingTouchdowns',
      'player_rush_tds': 'rushingTouchdowns',
      'rushing_attempts': 'rushingAttempts',
      'player_rushing_attempts': 'rushingAttempts',
      'player_rush_attempts': 'rushingAttempts',
      'receiving_yards': 'receivingYards',
      'player_receiving_yards': 'receivingYards',
      'player_reception_yds': 'receivingYards',
      'receiving_touchdowns': 'receivingTouchdowns',
      'player_receiving_touchdowns': 'receivingTouchdowns',
      'player_reception_tds': 'receivingTouchdowns',
      'receptions': 'receptions',
      'player_receptions': 'receptions',
      'targets': 'targets',
      'player_targets': 'targets',
      'tackles': 'tackles',
      'player_tackles': 'tackles',
      'sacks': 'sacks',
      'player_sacks': 'sacks',
      'defensive_interceptions': 'defensiveInterceptions',
      'player_defensive_interceptions': 'defensiveInterceptions'
    }

    const statField = statMap[statType]

    if (!statField) {
      console.warn(`⚠️ Unknown NFL stat type: ${statType}`)
      return null
    }

    const value = playerData[statField]

    if (value === undefined || value === null) {
      if (loaded.gameFinal) {
        console.log(`✅ ${playerName} ${statType}: 0 (matched, no ${statField} line in final box)`)
        return 0
      }
      console.warn(`⚠️ Stat ${statField} not available for ${playerName}`)
      return null
    }

    console.log(`✅ ${playerName} ${statType}: ${value}`)
    return value
  } catch (error) {
    console.error(`❌ Error getting NFL stat for ${playerName}:`, error)
    return null
  }
}
