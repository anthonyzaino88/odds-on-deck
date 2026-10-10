// Fetch player game statistics from MLB Stats API.
// Empty batting/pitching objects are DNP — never coerce them to 0.

import {
  lookupMlbPlayerStat,
  parseMlbBoxscorePlayers,
  toLegacyMlbPlayerStatsMap,
} from '../mlb-stat-grade.js'

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1'

export async function fetchMlbBoxscoreJson(mlbGameId, fetchImpl = fetch) {
  const url = `${MLB_API_BASE}/game/${mlbGameId}/boxscore`
  const response = await fetchImpl(url)
  if (!response.ok) {
    console.error(`❌ MLB API error: ${response.status} ${response.statusText}`)
    return null
  }
  return response.json()
}

/**
 * Full roster parse (includes bench / empty stat lines).
 * @param {string} mlbGameId
 * @returns {Promise<object|null>} name → player line
 */
export async function fetchParsedMlbBoxscore(mlbGameId, fetchImpl = fetch) {
  try {
    console.log(`📊 Fetching stats for MLB game ${mlbGameId}...`)
    const data = await fetchMlbBoxscoreJson(mlbGameId, fetchImpl)
    if (!data) return null
    const players = parseMlbBoxscorePlayers(data)
    console.log(`✅ Found stats for ${Object.keys(players).length} rostered players in game ${mlbGameId}`)
    return players
  } catch (error) {
    console.error(`❌ Error fetching MLB game stats for ${mlbGameId}:`, error)
    return null
  }
}

/**
 * Name → flat stats for players who have a real batting or pitching line.
 * Bench / empty-object DNP rows are omitted (they used to appear as all 0s).
 */
export async function fetchMLBGameStats(mlbGameId, fetchImpl = fetch) {
  const players = await fetchParsedMlbBoxscore(mlbGameId, fetchImpl)
  if (!players) return null
  return toLegacyMlbPlayerStatsMap(players)
}

/**
 * Structured lookup used by grading. DNP is didNotPlay, not actual 0.
 */
export async function lookupPlayerGameStat(mlbGameId, playerName, statType, options = {}) {
  try {
    const players = options.players || await fetchParsedMlbBoxscore(mlbGameId, options.fetchImpl)
    if (!players) {
      console.warn(`⚠️ No stats found for game ${mlbGameId}`)
      return null
    }
    const result = lookupMlbPlayerStat(players, playerName, statType)
    if (result.didNotPlay) {
      console.log(`⚪ ${playerName} ${statType}: DNP (${result.reason})`)
      return result
    }
    if (!result.statFound) {
      console.warn(`⚠️ Stat ${statType} not available for ${playerName}`)
      return result
    }
    console.log(`✅ ${playerName} ${statType}: ${result.value}`)
    return result
  } catch (error) {
    console.error(`❌ Error getting stat for ${playerName}:`, error)
    return null
  }
}

/**
 * Numeric actual only when the player appeared. DNP / missing → null
 * so callers cannot grade an empty line as 0.
 */
export async function getPlayerGameStat(mlbGameId, playerName, statType, options = {}) {
  const result = await lookupPlayerGameStat(mlbGameId, playerName, statType, options)
  if (!result || result.didNotPlay || result.value == null) return null
  return result.value
}
