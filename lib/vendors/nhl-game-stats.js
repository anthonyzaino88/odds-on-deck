// Fetch NHL player game statistics from NHL Official API
// Falls back to ESPN API if NHL API fails

import {
  canonicalNhlTeam,
  describeNhlApiBox,
  describeNhlEspnBox,
  emptyNhlStatResult,
  espnToiRaw,
  extractEspnStatValue,
  isGradeableNhlStatResult,
  isNhlFetchError,
  matchNhlBoxscorePlayer,
  nhlApiStatValue,
  nhlDidNotPlayFromToi,
  nhlFetchErrorResult,
  NHL_GRADE_SOURCES,
  parseNhlToiSeconds,
} from '../nhl-stat-grade.js'

const NHL_API_BASE = 'https://api-web.nhle.com/v1'
const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

export const NHL_FETCH_MAX_RETRIES = 3
export const NHL_FETCH_RETRY_AFTER_DEFAULT_MS = 60_000

export function createNhlLookupCache() {
  return {
    nhlGameIdByRef: new Map(),
    nhlScheduleByDate: new Map(),
    nhlBoxscoreById: new Map(),
    nhlPlayByPlayById: new Map(),
    espnSummaryByEvent: new Map(),
  }
}

function withBox(result, box, playerName) {
  if (!result) return result
  return { ...result, box: box || result.box || null, playerName: playerName || result.playerName || null }
}

function localizedNhlName(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.default || value.en || ''
}

export function nhlApiPlayerDisplayName(player) {
  const first = localizedNhlName(player?.firstName)
  const last = localizedNhlName(player?.lastName)
  if (first && last) return `${first} ${last}`
  return localizedNhlName(player?.name) || ''
}

async function sleepMs(ms, sleep) {
  if (!ms || ms <= 0) return
  if (typeof sleep === 'function') {
    await sleep(ms)
    return
  }
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRetryableNhlStatus(status) {
  return status === 429 || (status >= 500 && status <= 599)
}

function retryAfterHeaderValue(response) {
  if (!response) return null
  if (typeof response.headers?.get === 'function') {
    return response.headers.get('retry-after') || response.headers.get('Retry-After')
  }
  const headers = response.headers || {}
  return headers['retry-after'] ?? headers['Retry-After'] ?? null
}

export function retryAfterWaitMs(response, attempt = 0) {
  const raw = retryAfterHeaderValue(response)
  if (raw != null && raw !== '') {
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const date = Date.parse(raw)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  }
  return NHL_FETCH_RETRY_AFTER_DEFAULT_MS * (2 ** attempt)
}

function failedFetchPayload(status, statusText) {
  return {
    ok: false,
    status: status ?? 0,
    statusText: statusText || '',
    data: null,
    fetchError: true,
  }
}

function notifyPersistentRateLimit(url, status, options = {}) {
  if (status !== 429) return
  if (typeof options.onPersistentRateLimit === 'function') {
    options.onPersistentRateLimit({ url, status })
  }
}

async function fetchJsonCached(url, cacheMap, cacheKey, options = {}) {
  if (cacheMap && cacheKey != null && cacheMap.has(cacheKey)) {
    return cacheMap.get(cacheKey)
  }
  const maxRetries = options.maxRetries ?? NHL_FETCH_MAX_RETRIES
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : fetch
  let lastPayload = failedFetchPayload(0, 'fetch failed')

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt === 0) {
      await sleepMs(options.fetchDelayMs, options.sleep)
    }
    let response
    try {
      response = await fetchImpl(url)
    } catch (error) {
      const message = error?.message || String(error)
      console.error(`❌ Fetch error ${url}: ${message}`)
      lastPayload = failedFetchPayload(0, message)
      if (attempt < maxRetries) {
        const waitMs = retryAfterWaitMs(null, attempt)
        console.warn(`⚠️ Retrying ${url} after ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
        await sleepMs(waitMs, options.sleep)
        continue
      }
      return lastPayload
    }

    const status = response.status
    const statusText = response.statusText || ''
    if (response.ok) {
      const payload = {
        ok: true,
        status,
        statusText,
        data: await response.json(),
        fetchError: false,
      }
      if (cacheMap && cacheKey != null) cacheMap.set(cacheKey, payload)
      return payload
    }

    lastPayload = failedFetchPayload(status, statusText)
    console.error(`❌ ${url} returned ${status} ${statusText}`.trim())

    if (isRetryableNhlStatus(status) && attempt < maxRetries) {
      const waitMs = retryAfterWaitMs(response, attempt)
      console.warn(`⚠️ Retrying ${url} after ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await sleepMs(waitMs, options.sleep)
      continue
    }

    if (status === 429) notifyPersistentRateLimit(url, status, options)
    return lastPayload
  }

  if (lastPayload.status === 429) notifyPersistentRateLimit(url, lastPayload.status, options)
  return lastPayload
}

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

    if (isNhlFetchError(nhlResult) && !espnResult?.gameFinal) {
      return nhlResult
    }
    if (espnResult?.gameFinal) return espnResult
    if (nhlResult?.gameFinal) return nhlResult
    if (isNhlFetchError(espnResult)) return espnResult
    if (isNhlFetchError(nhlResult)) return nhlResult
    return espnResult || nhlResult || emptyNhlStatResult()
  } catch (error) {
    console.error('❌ Error fetching NHL game stats:', error)
    return nhlFetchErrorResult()
  }
}

/**
 * Fetch from NHL Official API (api-web.nhle.com)
 */
async function fetchFromNHLApi(espnGameId, playerName, propType, gameIdRef, options = {}) {
  try {
    const found = await findNHLGameId(espnGameId, gameIdRef, options)
    if (found?.fetchError) {
      return nhlFetchErrorResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        status: found.status,
        statusText: found.statusText,
      })
    }

    const nhlGameId = found?.nhlGameId
    if (!nhlGameId) {
      console.log(`⚠️ Could not find NHL game ID`)
      return emptyNhlStatResult({ source: NHL_GRADE_SOURCES.NHL_API })
    }

    console.log(`🏒 Using NHL API with game ID: ${nhlGameId}`)

    const url = `${NHL_API_BASE}/gamecenter/${nhlGameId}/boxscore`
    const box = await fetchJsonCached(
      url,
      options.cache?.nhlBoxscoreById,
      nhlGameId,
      options,
    )

    if (!box.ok) {
      console.error(`❌ NHL boxscore error: ${box.status}`)
      return nhlFetchErrorResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        status: box.status,
        statusText: box.statusText,
      })
    }

    const data = box.data
    const boxIdentity = describeNhlApiBox(data)

    if (data.gameState !== 'OFF' && data.gameState !== 'FINAL') {
      console.log(`⏳ Game not final yet (state: ${data.gameState})`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        gameFinal: false,
        matchStatus: 'n/a',
      })
    }

    const pbp = await fetchJsonCached(
      `${NHL_API_BASE}/gamecenter/${nhlGameId}/play-by-play`,
      options.cache?.nhlPlayByPlayById,
      nhlGameId,
      options,
    )
    if (!pbp.ok) {
      console.error(`❌ NHL play-by-play error: ${pbp.status}`)
      return nhlFetchErrorResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        status: pbp.status,
        statusText: pbp.statusText,
      })
    }
    if (!Array.isArray(pbp.data?.rosterSpots) || pbp.data.rosterSpots.length === 0) {
      console.warn(`⚠️ NHL play-by-play rosterSpots unavailable`)
      return withBox(emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        gameFinal: true,
        matchStatus: 'unmatched',
      }), boxIdentity, playerName)
    }

    const candidates = nhlPlayersFromRosterAndBoxscore(pbp.data, data)
    const match = matchNhlBoxscorePlayer(candidates, {
      playerId: options.playerId,
      name: playerName,
      team: options.team,
    })

    if (isPPPProp(propType) && match.status === 'matched') {
      const ppp = await fetchPPPFromPlayByPlay(nhlGameId, match.player, options)
      if (ppp !== null) {
        console.log(`✅ PPP from play-by-play: ${ppp}`)
        return withBox({
          value: ppp,
          source: NHL_GRADE_SOURCES.NHL_API,
          matchStatus: 'matched',
          statFound: true,
          gameFinal: true,
          team: match.player.team,
          player: match.player.name,
        }, boxIdentity, playerName)
      }
      console.log('⚠️ PPP play-by-play unavailable, falling back to boxscore inference')
    }

    if (match.status !== 'matched') {
      console.warn(`⚠️ Player ${playerName} ${match.status} in NHL API game stats`)
      return withBox(emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        gameFinal: true,
        matchStatus: match.status,
      }), boxIdentity, playerName)
    }

    if (nhlDidNotPlayFromToi(match.player.raw?.toi)) {
      console.log(`⚪ ${match.player.name} DNP (0 TOI)`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.NHL_API,
        gameFinal: true,
        matchStatus: 'matched',
        didNotPlay: true,
        reason: 'zero_toi',
        team: match.player.team,
        player: match.player.name,
      })
    }

    const stat = nhlApiStatValue(match.player.raw, propType)
    if (stat.statFound) {
      console.log(`✅ ${match.player.name} ${propType}: ${stat.value}`)
    } else {
      console.log(`⚠️ ${match.player.name} matched but ${propType} missing in NHL API`)
    }

    return withBox({
      value: stat.value,
      source: NHL_GRADE_SOURCES.NHL_API,
      matchStatus: 'matched',
      statFound: stat.statFound,
      gameFinal: true,
      didNotPlay: false,
      team: match.player.team,
      player: match.player.name,
    }, boxIdentity, playerName)
  } catch (error) {
    console.error('❌ NHL API error:', error.message)
    return nhlFetchErrorResult({ source: NHL_GRADE_SOURCES.NHL_API, statusText: error.message })
  }
}

function nhlBoxscorePlayersById(data) {
  const byId = new Map()
  const sides = [
    [data.playerByGameStats?.homeTeam, data.homeTeam?.abbrev],
    [data.playerByGameStats?.awayTeam, data.awayTeam?.abbrev],
  ]
  for (const [teamStats, team] of sides) {
    if (!teamStats) continue
    for (const pos of ['forwards', 'defense', 'goalies']) {
      for (const player of teamStats[pos] || []) {
        if (player.playerId == null) continue
        byId.set(String(player.playerId), { player, team })
      }
    }
  }
  return byId
}

function nhlTeamAbbrevById(...sources) {
  const map = new Map()
  for (const source of sources) {
    if (source?.homeTeam?.id != null) {
      map.set(String(source.homeTeam.id), source.homeTeam.abbrev)
    }
    if (source?.awayTeam?.id != null) {
      map.set(String(source.awayTeam.id), source.awayTeam.abbrev)
    }
  }
  return map
}

function nhlPlayersFromRosterAndBoxscore(pbpData, boxData) {
  const boxById = nhlBoxscorePlayersById(boxData)
  const teamById = nhlTeamAbbrevById(pbpData, boxData)
  const players = []
  for (const spot of pbpData.rosterSpots || []) {
    const id = spot.playerId != null ? String(spot.playerId) : null
    if (!id) continue
    const boxed = boxById.get(id)
    if (!boxed) continue
    const name = nhlApiPlayerDisplayName(spot)
    if (!name) continue
    players.push({
      id,
      name,
      team: teamById.get(String(spot.teamId)) || boxed.team,
      raw: boxed.player,
    })
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
async function findNHLGameId(espnGameId, gameIdRef, options = {}) {
  try {
    if (options.cache?.nhlGameIdByRef?.has(gameIdRef)) {
      return {
        nhlGameId: options.cache.nhlGameIdByRef.get(gameIdRef),
        fetchError: false,
      }
    }

    let nhlGameId = null
    if (gameIdRef && gameIdRef.includes('_at_')) {
      const parts = gameIdRef.split('_at_')
      const awayTeam = toNHLAbbrev(parts[0])
      const [homeTeamRaw, dateStr] = parts[1].split('_')
      const homeTeam = toNHLAbbrev(homeTeamRaw)

      console.log(`   Looking for: ${awayTeam} at ${homeTeam} on ${dateStr}`)

      const scheduleUrl = `${NHL_API_BASE}/schedule/${dateStr}`
      const schedule = await fetchJsonCached(
        scheduleUrl,
        options.cache?.nhlScheduleByDate,
        dateStr,
        options,
      )

      if (!schedule.ok) {
        console.error(`❌ NHL schedule ${scheduleUrl} returned ${schedule.status} ${schedule.statusText || ''}`.trim())
        return {
          nhlGameId: null,
          fetchError: true,
          status: schedule.status,
          statusText: schedule.statusText,
        }
      }

      for (const day of schedule.data?.gameWeek || []) {
        for (const game of day.games || []) {
          if (game.awayTeam?.abbrev === awayTeam && game.homeTeam?.abbrev === homeTeam) {
            nhlGameId = game.id
            break
          }
        }
        if (nhlGameId) break
      }

      // Cache a miss only after a 200 with no matching game.
      if (options.cache?.nhlGameIdByRef && gameIdRef) {
        options.cache.nhlGameIdByRef.set(gameIdRef, nhlGameId)
      }
    }

    return { nhlGameId, fetchError: false }
  } catch (error) {
    console.error('Error finding NHL game ID:', error.message)
    return { nhlGameId: null, fetchError: true, statusText: error.message }
  }
}

/**
 * Fall back to ESPN API
 */
async function fetchFromESPNApi(espnGameId, playerName, propType, options = {}) {
  try {
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const summary = await fetchJsonCached(
      url,
      options.cache?.espnSummaryByEvent,
      espnGameId,
      options,
    )

    if (!summary.ok) {
      console.error(`❌ ESPN NHL API error: ${summary.status} ${summary.statusText}`)
      return nhlFetchErrorResult({
        source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
        status: summary.status,
        statusText: summary.statusText,
      })
    }

    const data = summary.data
    const boxIdentity = describeNhlEspnBox(data)

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
      return withBox(emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
        gameFinal: true,
        matchStatus: match.status,
      }), boxIdentity, playerName)
    }

    const playerEntries = entries.filter((entry) => sameNhlPlayer(entry, match.player))
    let toiSeconds = null
    for (const entry of playerEntries) {
      const toiRaw = espnToiRaw(entry.raw?.stats, entry.labels)
      const seconds = parseNhlToiSeconds(toiRaw)
      if (seconds == null) continue
      toiSeconds = toiSeconds == null ? seconds : Math.max(toiSeconds, seconds)
    }
    if (toiSeconds === 0) {
      console.log(`⚪ ${match.player.name} DNP (0 TOI)`)
      return emptyNhlStatResult({
        source: NHL_GRADE_SOURCES.ESPN_FALLBACK,
        gameFinal: true,
        matchStatus: 'matched',
        didNotPlay: true,
        reason: 'zero_toi',
        team: match.player.team,
        player: match.player.name,
      })
    }

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
      didNotPlay: false,
      team: match.player.team,
      player: match.player.name,
    }
  } catch (error) {
    console.error('❌ Error fetching ESPN NHL game stats:', error)
    return nhlFetchErrorResult({ source: NHL_GRADE_SOURCES.ESPN_FALLBACK, statusText: error?.message })
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
  createNhlLookupCache,
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
async function fetchPPPFromPlayByPlay(nhlGameId, matchedPlayer, options = {}) {
  try {
    const targetId = matchedPlayer?.id != null ? String(matchedPlayer.id) : null
    if (!targetId) return null

    const [pbp, box] = await Promise.all([
      fetchJsonCached(
        `${NHL_API_BASE}/gamecenter/${nhlGameId}/play-by-play`,
        options.cache?.nhlPlayByPlayById,
        nhlGameId,
        options,
      ),
      fetchJsonCached(
        `${NHL_API_BASE}/gamecenter/${nhlGameId}/boxscore`,
        options.cache?.nhlBoxscoreById,
        nhlGameId,
        options,
      ),
    ])

    if (!pbp.ok || !box.ok) {
      console.warn(`⚠️ Play-by-play or boxscore fetch failed`)
      return null
    }

    const pbpData = pbp.data
    const boxData = box.data
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

