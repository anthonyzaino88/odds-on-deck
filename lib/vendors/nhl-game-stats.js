// Fetch NHL player game statistics from NHL Official API
// Falls back to ESPN API if NHL API fails

import {
  canonicalNhlTeam,
  emptyNhlStatResult,
  extractEspnStatValue,
  isGradeableNhlStatResult,
  matchNhlBoxscorePlayer,
  nhlApiStatValue,
  NHL_GRADE_SOURCES,
} from '../nhl-stat-grade.js'

const NHL_API_BASE = 'https://api-web.nhle.com/v1'
const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Fetch NHL game stats for a completed game.
 * Uses NHL Official API first, then ESPN. A numeric 0 is only returned when
 * the player matched and the stat column exists in a final boxscore.
 *
 * @param {string} espnGameId
 * @param {string} playerName
 * @param {string} propType
 * @param {string|null} gameIdRef
 * @param {{ playerId?: string|number, team?: string }} options
 * @returns {Promise<number|null>}
 */
export async function getPlayerGameStat(espnGameId, playerName, propType, gameIdRef = null, options = {}) {
  const result = await lookupPlayerGameStat(espnGameId, playerName, propType, gameIdRef, options)
  return isGradeableNhlStatResult(result) ? result.value : null
}

/**
 * Structured NHL lookup used by grading. Never treat an unmatched / missing
 * fallback 0 as a final actual.
 */
export async function lookupPlayerGameStat(espnGameId, playerName, propType, gameIdRef = null, options = {}) {
  try {
    console.log(`📊 Fetching NHL stats for game ${espnGameId}, player: ${playerName}, prop: ${propType}`)

    const nhlResult = await fetchFromNHLApi(espnGameId, playerName, propType, gameIdRef, options)
    if (isGradeableNhlStatResult(nhlResult)) {
      return nhlResult
    }

    console.log(`⚠️ NHL API did not yield a gradeable stat, trying ESPN API...`)
    const espnResult = await fetchFromESPNApi(espnGameId, playerName, propType, options)
    if (isGradeableNhlStatResult(espnResult)) {
      return espnResult
    }

    if (espnResult?.gameFinal) return espnResult
    if (nhlResult?.gameFinal) return nhlResult
    return espnResult || nhlResult || emptyNhlStatResult()
  } catch (error) {
    console.error('❌ Error fetching NHL game stats:', error)
    return emptyNhlStatResult()
  }
}

/**
 * Fetch from NHL Official API (api-web.nhle.com)
 */
async function fetchFromNHLApi(espnGameId, playerName, propType, gameIdRef, options = {}) {
  try {
    const nhlGameId = await findNHLGameId(espnGameId, gameIdRef)

    if (!nhlGameId) {
      console.log(`⚠️ Could not find NHL game ID`)
      return emptyNhlStatResult({ source: NHL_GRADE_SOURCES.NHL_API })
    }

    console.log(`🏒 Using NHL API with game ID: ${nhlGameId}`)

    const url = `${NHL_API_BASE}/gamecenter/${nhlGameId}/boxscore`
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`❌ NHL API error: ${response.status}`)
      return emptyNhlStatResult({ source: NHL_GRADE_SOURCES.NHL_API })
    }

    const data = await response.json()

    if (data.gameState !== 'OFF' && data.gameState !== 'FINAL') {
      console.log(`⏳ Game not final yet (state: ${data.gameState})`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        gameFinal: false,
        matchStatus: 'n/a',
      })
    }

    const candidates = nhlPlayersFromBoxscore(data)
    const match = matchNhlBoxscorePlayer(candidates, {
      playerId: options.playerId,
      name: playerName,
      team: options.team,
    })

    if (isPPPProp(propType) && match.status === 'matched') {
      const ppp = await fetchPPPFromPlayByPlay(nhlGameId, match.player)
      if (ppp !== null) {
        console.log(`✅ PPP from play-by-play: ${ppp}`)
        return {
          value: ppp,
          source: NHL_GRADE_SOURCES.NHL_API,
          matchStatus: 'matched',
          statFound: true,
          gameFinal: true,
          team: match.player.team,
          player: match.player.name,
        }
      }
      console.log('⚠️ PPP play-by-play unavailable, falling back to boxscore inference')
    }

    if (match.status !== 'matched') {
      console.warn(`⚠️ Player ${playerName} ${match.status} in NHL API game stats`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        gameFinal: true,
        matchStatus: match.status,
      })
    }

    const stat = nhlApiStatValue(match.player.raw, propType)
    if (stat.statFound) {
      console.log(`✅ ${match.player.name} ${propType}: ${stat.value}`)
    } else {
      console.log(`⚠️ ${match.player.name} matched but ${propType} missing in NHL API`)
    }

    return {
      value: stat.value,
      source: NHL_GRADE_SOURCES.NHL_API,
      matchStatus: 'matched',
      statFound: stat.statFound,
      gameFinal: true,
      team: match.player.team,
      player: match.player.name,
    }
  } catch (error) {
    console.error('❌ NHL API error:', error.message)
    return emptyNhlStatResult({ source: NHL_GRADE_SOURCES.NHL_API })
  }
}

function nhlPlayersFromBoxscore(data) {
  const sides = [
    [data.playerByGameStats?.homeTeam, data.homeTeam?.abbrev],
    [data.playerByGameStats?.awayTeam, data.awayTeam?.abbrev],
  ]
  const players = []
  for (const [teamStats, team] of sides) {
    if (!teamStats) continue
    for (const pos of ['forwards', 'defense', 'goalies']) {
      for (const player of teamStats[pos] || []) {
        players.push({
          id: player.playerId != null ? String(player.playerId) : null,
          name: player.name?.default || '',
          team,
          raw: player,
        })
      }
    }
  }
  return players
}

// Team abbreviation mapping (our format -> NHL API format)
const TEAM_ABBREV_MAP = {
  'NJ': 'NJD',    // New Jersey Devils
  'LA': 'LAK',    // Los Angeles Kings  
  'SJ': 'SJS',    // San Jose Sharks
  'TB': 'TBL',    // Tampa Bay Lightning
  'WAS': 'WSH',   // Washington Capitals
  'CBJ': 'CBJ',   // Columbus Blue Jackets (same)
  'VGK': 'VGK',   // Vegas Golden Knights (same)
}

/**
 * Convert our team abbreviation to NHL API format
 */
function toNHLAbbrev(abbrev) {
  return canonicalNhlTeam(abbrev) || TEAM_ABBREV_MAP[abbrev] || abbrev
}

/**
 * Find NHL game ID from ESPN game ID or our internal format
 */
async function findNHLGameId(espnGameId, gameIdRef) {
  try {
    // If gameIdRef is provided (format: AWAY_at_HOME_YYYY-MM-DD), use it
    if (gameIdRef && gameIdRef.includes('_at_')) {
      const parts = gameIdRef.split('_at_')
      const awayTeam = toNHLAbbrev(parts[0])
      const [homeTeamRaw, dateStr] = parts[1].split('_')
      const homeTeam = toNHLAbbrev(homeTeamRaw)
      
      console.log(`   Looking for: ${awayTeam} at ${homeTeam} on ${dateStr}`)
      
      // Fetch schedule for that date
      const scheduleUrl = `${NHL_API_BASE}/schedule/${dateStr}`
      const response = await fetch(scheduleUrl)
      
      if (response.ok) {
        const data = await response.json()
        
        for (const day of data.gameWeek || []) {
          for (const game of day.games || []) {
            if (game.awayTeam?.abbrev === awayTeam && game.homeTeam?.abbrev === homeTeam) {
              return game.id
            }
          }
        }
      }
    }
    
    return null
  } catch (error) {
    console.error('Error finding NHL game ID:', error.message)
    return null
  }
}

/**
 * Fall back to ESPN API
 */
async function fetchFromESPNApi(espnGameId, playerName, propType, options = {}) {
  try {
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`❌ ESPN NHL API error: ${response.status} ${response.statusText}`)
      return emptyNhlStatResult({ source: NHL_GRADE_SOURCES.ESPN_FALLBACK })
    }

    const data = await response.json()

    const gameStatus = data.header?.competitions?.[0]?.status?.type?.name
    if (gameStatus !== 'STATUS_FINAL') {
      console.log(`⏳ Game not final yet (status: ${gameStatus})`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
        gameFinal: false,
        matchStatus: 'n/a',
      })
    }

    const boxscore = data.boxscore
    if (!boxscore) {
      console.error('❌ No boxscore data available')
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
        gameFinal: true,
        matchStatus: 'unmatched',
      })
    }

    const entries = espnPlayersFromBoxscore(boxscore)
    const identities = dedupeNhlPlayers(entries)
    const match = matchNhlBoxscorePlayer(identities, {
      playerId: options.playerId,
      name: playerName,
      team: options.team,
    })

    if (match.status !== 'matched') {
      console.warn(`⚠️ Player ${playerName} ${match.status} in ESPN game stats`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
        gameFinal: true,
        matchStatus: match.status,
      })
    }

    const playerEntries = entries.filter((entry) => sameNhlPlayer(entry, match.player))
    let stat = { value: null, statFound: false }
    for (const entry of playerEntries) {
      stat = extractEspnStatValue(entry.raw, propType, entry.labels)
      if (stat.statFound) break
    }

    if (stat.statFound) {
      console.log(`✅ ${match.player.name} ${propType}: ${stat.value}`)
    } else {
      console.log(`⚠️ ${match.player.name} matched but ${propType} missing in ESPN boxscore`)
    }

    return {
      value: stat.value,
      source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
      matchStatus: 'matched',
      statFound: stat.statFound,
      gameFinal: true,
      team: match.player.team,
      player: match.player.name,
    }
  } catch (error) {
    console.error('❌ Error fetching ESPN NHL game stats:', error)
    return emptyNhlStatResult({ source: NHL_GRADE_SOURCES.ESPN_FALLBACK })
  }
}

function espnPlayersFromBoxscore(boxscore) {
  const entries = []
  for (const team of boxscore.players || []) {
    const teamAbbr = team.team?.abbreviation || team.team?.shortDisplayName
    for (const statCategory of team.statistics || []) {
      const labels = statCategory.labels || []
      for (const athlete of statCategory.athletes || []) {
        const name = athlete.athlete?.displayName || athlete.athlete?.fullName
        if (!name) continue
        entries.push({
          id: athlete.athlete?.id != null ? String(athlete.athlete.id) : null,
          name,
          team: teamAbbr,
          raw: athlete,
          labels,
        })
      }
    }
  }
  return entries
}

function sameNhlPlayer(a, b) {
  if (a?.id && b?.id) return String(a.id) === String(b.id)
  return Boolean(
    a && b
    && a.name
    && b.name
    && matchNhlBoxscorePlayer([a], { name: b.name, team: b.team }).status === 'matched',
  )
}

function dedupeNhlPlayers(players) {
  const seen = new Map()
  for (const player of players) {
    const key = player.id
      || `${player.name || ''}|${canonicalNhlTeam(player.team)}`
    if (!seen.has(key)) seen.set(key, player)
  }
  return [...seen.values()]
}

export default {
  getPlayerGameStat,
  lookupPlayerGameStat,
}

/**
 * Determine if prop is PPP
 */
function isPPPProp(propType) {
  const p = propType.toLowerCase()
  return p.includes('power_play_point')
}

/**
 * Fetch PPP from play-by-play (exact: goals + assists on PP goals)
 * 
 * NHL API structure:
 *   situationCode: "ABCD" where A=away goalie(0/1), B=away skaters, C=home skaters, D=home goalie(0/1)
 *   details.scoringPlayerId, assist1PlayerId, assist2PlayerId = player IDs (not names)
 *   details.eventOwnerTeamId = scoring team ID
 *
 * We build a playerId→name map from the roster, then check each PP goal for our player.
 */
async function fetchPPPFromPlayByPlay(nhlGameId, matchedPlayer) {
  try {
    const targetId = matchedPlayer?.id != null ? String(matchedPlayer.id) : null
    if (!targetId) return null

    const [pbpRes, boxRes] = await Promise.all([
      fetch(`${NHL_API_BASE}/gamecenter/${nhlGameId}/play-by-play`),
      fetch(`${NHL_API_BASE}/gamecenter/${nhlGameId}/boxscore`)
    ])

    if (!pbpRes.ok || !boxRes.ok) {
      console.warn(`⚠️ Play-by-play or boxscore fetch failed`)
      return null
    }

    const [pbpData, boxData] = await Promise.all([pbpRes.json(), boxRes.json()])
    const plays = pbpData?.plays || []
    if (!Array.isArray(plays) || plays.length === 0) return null

    const homeTeamId = pbpData?.homeTeam?.id || boxData?.homeTeam?.id
    const awayTeamId = pbpData?.awayTeam?.id || boxData?.awayTeam?.id

    let ppp = 0
    for (const play of plays) {
      if ((play.typeDescKey || '').toLowerCase() !== 'goal') continue

      const sc = play.situationCode || ''
      if (sc.length < 4) continue

      const awaySkaters = parseInt(sc[1])
      const homeSkaters = parseInt(sc[2])
      if (isNaN(awaySkaters) || isNaN(homeSkaters)) continue

      const scoringTeamId = play.details?.eventOwnerTeamId
      const isHomePP = homeSkaters > awaySkaters && scoringTeamId === homeTeamId
      const isAwayPP = awaySkaters > homeSkaters && scoringTeamId === awayTeamId
      if (!isHomePP && !isAwayPP) continue

      const involvedIds = [
        play.details?.scoringPlayerId,
        play.details?.assist1PlayerId,
        play.details?.assist2PlayerId
      ].filter(Boolean)

      if (involvedIds.some((pid) => String(pid) === targetId)) {
        ppp += 1
      }
    }

    return ppp
  } catch (e) {
    console.warn(`⚠️ Play-by-play PPP error: ${e.message}`)
    return null
  }
}

