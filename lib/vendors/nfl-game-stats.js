import { sanitizedErrorMessage, sanitizeLoggedValue } from '../sanitize-error.js'
// Fetch player game statistics from ESPN NFL API
//
// Grading adapter: fetchNFLGameStats / getPlayerGameStat keep historical
// behavior (missing category-stat values coerce to 0). They share
// parseEspnNflSummary with the archive path, then toGradingAdapterPlayerMap
// restores the zero-coercion. Archive records keep nulls; do not feed
// archive nulls into grading without that adapter.
//
// A player who matched in a final box but has no line in that category
// (e.g. a TE with 0 targets, or a QB with no rushing row) returns 0.
// Matching is exact normalized name or a unique first-name alias only.
//
// A player missing from the ESPN box-score stat tables is resolved from
// the per-event competitor roster (active / didNotPlay / statistics),
// then the athlete eventlog / gamelog matched by eventId. Fail closed:
// missing roster, no log entry, or a fetch error is needs_review.

import { configuredNflSeasonYear, isEspnNflEventCompleted, parseEspnNflSummary, toGradingAdapterPlayerMap } from '../nfl-box-score-archive.js'
import {
  athleteIdOnRoster,
  bothNflEventRostersComplete,
  classifyNflRosterAppearance,
  dedupeRosterAthleteCandidates,
  describeNflEspnBox,
  emptyNflStatResult,
  isGradeableNflStatResult,
  isNflFetchError,
  isNflMissingStatSettleReady,
  matchEventLogByEventId,
  matchGameLogByEventId,
  matchNflRosterPlayer,
  nflAthleteIdNameMatches,
  nflEventFinalAt,
  nflFetchErrorResult,
  nflGameTeamsFrom,
  nflLookupFromMissingPlan,
  nflResolvedTeamOnGame,
  NFL_GRADE_SOURCES,
  parseEspnNflEventRoster,
  parseNumericEspnAthleteId,
  planNflMissingStatFromSources,
  rosterLastNameCandidates,
  warnNflMissingKickoff,
} from '../nfl-stat-grade.js'
import { normalizeGradePlayerName, uniqueFirstNameAliasMatch } from '../player-name-match.js'

const ESPN_NFL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
const ESPN_NFL_CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl'
const ESPN_NFL_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl'

export const NFL_FETCH_DELAY_MS = 350
export const NFL_FETCH_MAX_RETRIES = 3
export const NFL_FETCH_RETRY_AFTER_MAX_MS = 30_000
export const NFL_FETCH_RETRY_AFTER_DEFAULT_MS = 30_000
export const NFL_FETCH_5XX_BACKOFF_MS = Object.freeze([1_000, 2_000, 4_000])
export const NFL_FETCH_RETRY_WAIT_BUDGET_MS = 90_000

export function createNflLookupCache() {
  return {
    summaryByEvent: new Map(),
    rosterByKey: new Map(),
    athleteById: new Map(),
    eventlogByKey: new Map(),
    gamelogByAthlete: new Map(),
    failedUrls: new Map(),
    retryWaitUsedMs: 0,
  }
}

function withBox(result, box, playerName) {
  if (!result) return result
  return { ...result, box: box || result.box || null, playerName: playerName || result.playerName || null }
}

async function sleepMs(ms, sleep) {
  if (!ms || ms <= 0) return
  if (typeof sleep === 'function') {
    await sleep(ms)
    return
  }
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRetryableNflStatus(status) {
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

export function retryAfterWaitMs(response, attempt = 0, status = response?.status) {
  if (status === 429) {
    const raw = retryAfterHeaderValue(response)
    let waitMs = NFL_FETCH_RETRY_AFTER_DEFAULT_MS
    if (raw != null && raw !== '') {
      const seconds = Number(raw)
      if (Number.isFinite(seconds) && seconds >= 0) waitMs = seconds * 1000
      else {
        const date = Date.parse(raw)
        if (!Number.isNaN(date)) waitMs = Math.max(0, date - Date.now())
      }
    }
    return Math.min(waitMs, NFL_FETCH_RETRY_AFTER_MAX_MS)
  }
  const steps = NFL_FETCH_5XX_BACKOFF_MS
  const index = Math.min(Math.max(attempt, 0), steps.length - 1)
  return steps[index]
}

function takeRetryWaitMs(options, desiredMs) {
  if (!desiredMs || desiredMs <= 0) return 0
  const budget = options.retryWaitBudgetMs ?? NFL_FETCH_RETRY_WAIT_BUDGET_MS
  const used = Number(options.cache?.retryWaitUsedMs) || 0
  const remaining = Math.max(0, budget - used)
  const waitMs = Math.min(desiredMs, remaining)
  if (options.cache) options.cache.retryWaitUsedMs = used + waitMs
  return waitMs
}

function rememberedFailure(url, options) {
  return options.cache?.failedUrls?.get(url) || null
}

function rememberFailedUrl(url, payload, options) {
  if (!url || !options.cache) return
  if (!options.cache.failedUrls) options.cache.failedUrls = new Map()
  options.cache.failedUrls.set(url, payload)
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

function notifyPersistentFailure(url, payload, options = {}) {
  const status = payload?.status
  console.error(`❌ Persistent fetch failure ${url} status=${status ?? 0} ${payload?.statusText || ''}`.trim())
  rememberFailedUrl(url, payload, options)
  if (status === 429 && typeof options.onPersistentRateLimit === 'function') {
    options.onPersistentRateLimit({ url, status })
  }
}

async function fetchJsonCached(url, cacheMap, cacheKey, options = {}) {
  const remembered = rememberedFailure(url, options)
  if (remembered) return remembered
  if (cacheMap && cacheKey != null && cacheMap.has(cacheKey)) {
    return cacheMap.get(cacheKey)
  }
  const maxRetries = options.maxRetries ?? NFL_FETCH_MAX_RETRIES
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
      const message = sanitizedErrorMessage(error)
      console.error(`❌ Fetch error ${url}: ${message}`)
      lastPayload = failedFetchPayload(0, message)
      if (attempt < maxRetries) {
        const desiredMs = retryAfterWaitMs(null, attempt, 0)
        const waitMs = takeRetryWaitMs(options, desiredMs)
        if (waitMs <= 0 && desiredMs > 0) break
        console.warn(`⚠️ Retrying ${url} after ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
        await sleepMs(waitMs, options.sleep)
        continue
      }
      notifyPersistentFailure(url, lastPayload, options)
      return lastPayload
    }

    if (!response) {
      lastPayload = failedFetchPayload(0, 'empty response')
      notifyPersistentFailure(url, lastPayload, options)
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

    if (isRetryableNflStatus(status) && attempt < maxRetries) {
      const desiredMs = retryAfterWaitMs(response, attempt, status)
      const waitMs = takeRetryWaitMs(options, desiredMs)
      if (waitMs <= 0 && desiredMs > 0) break
      console.warn(`⚠️ Retrying ${url} after ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await sleepMs(waitMs, options.sleep)
      continue
    }

    notifyPersistentFailure(url, lastPayload, options)
    return lastPayload
  }

  notifyPersistentFailure(url, lastPayload, options)
  return lastPayload
}

function espnNflSummaryUrl(espnGameId) {
  return `${ESPN_NFL_BASE}/summary?event=${encodeURIComponent(espnGameId)}`
}

export function espnNflEventRosterUrl(eventId, teamId) {
  const event = encodeURIComponent(eventId)
  const team = encodeURIComponent(teamId)
  return `${ESPN_NFL_CORE}/events/${event}/competitions/${event}/competitors/${team}/roster`
}

export function espnNflAthleteUrl(athleteId, seasonYear) {
  const year = seasonYear || configuredNflSeasonYear()
  return `${ESPN_NFL_CORE}/seasons/${year}/athletes/${encodeURIComponent(athleteId)}`
}

export function espnNflEventLogUrl(athleteId, seasonYear) {
  const year = seasonYear || configuredNflSeasonYear()
  return `${ESPN_NFL_CORE}/seasons/${year}/athletes/${encodeURIComponent(athleteId)}/eventlog`
}

export function espnNflGameLogUrl(athleteId) {
  return `${ESPN_NFL_WEB}/athletes/${encodeURIComponent(athleteId)}/gamelog`
}

const NFL_STAT_MAP = {
  passing_yards: 'passingYards',
  player_passing_yards: 'passingYards',
  player_pass_yds: 'passingYards',
  passing_touchdowns: 'passingTouchdowns',
  player_passing_touchdowns: 'passingTouchdowns',
  player_pass_tds: 'passingTouchdowns',
  passing_completions: 'passingCompletions',
  player_passing_completions: 'passingCompletions',
  player_pass_completions: 'passingCompletions',
  passing_attempts: 'passingAttempts',
  player_passing_attempts: 'passingAttempts',
  player_pass_attempts: 'passingAttempts',
  interceptions: 'interceptions',
  player_interceptions: 'interceptions',
  rushing_yards: 'rushingYards',
  player_rushing_yards: 'rushingYards',
  player_rush_yds: 'rushingYards',
  rushing_touchdowns: 'rushingTouchdowns',
  player_rushing_touchdowns: 'rushingTouchdowns',
  player_rush_tds: 'rushingTouchdowns',
  rushing_attempts: 'rushingAttempts',
  player_rushing_attempts: 'rushingAttempts',
  player_rush_attempts: 'rushingAttempts',
  receiving_yards: 'receivingYards',
  player_receiving_yards: 'receivingYards',
  player_reception_yds: 'receivingYards',
  receiving_touchdowns: 'receivingTouchdowns',
  player_receiving_touchdowns: 'receivingTouchdowns',
  player_reception_tds: 'receivingTouchdowns',
  receptions: 'receptions',
  player_receptions: 'receptions',
  targets: 'targets',
  player_targets: 'targets',
  tackles: 'tackles',
  player_tackles: 'tackles',
  sacks: 'sacks',
  player_sacks: 'sacks',
  defensive_interceptions: 'defensiveInterceptions',
  player_defensive_interceptions: 'defensiveInterceptions',
}

async function loadNflGradingBox(espnGameId, options = {}) {
  const url = espnNflSummaryUrl(espnGameId)
  const summary = await fetchJsonCached(
    url,
    options.cache?.summaryByEvent,
    espnGameId,
    options,
  )
  if (!summary.ok) {
    return { fetchError: true, status: summary.status, statusText: summary.statusText }
  }

  const data = summary.data
  const boxscore = data?.boxscore
  if (!boxscore || !boxscore.players) {
    console.warn(`⚠️ No player stats available for game ${espnGameId}`)
    return {
      fetchError: false,
      playerStats: null,
      gameFinal: isEspnNflEventCompleted(data),
      data,
      box: describeNflEspnBox(data),
    }
  }

  const parsed = parseEspnNflSummary(data)
  return {
    fetchError: false,
    playerStats: toGradingAdapterPlayerMap(parsed),
    gameFinal: isEspnNflEventCompleted(data),
    data,
    box: describeNflEspnBox(data),
    seasonYear: parsed?.season || data?.header?.season?.year,
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
    if (!loaded || loaded.fetchError || !loaded.playerStats) return null

    console.log(`✅ Found stats for ${Object.keys(loaded.playerStats).length} players in game ${espnGameId}`)
    return loaded.playerStats
  } catch (error) {
    console.error(`❌ Error fetching NFL game stats for ${espnGameId}:`, sanitizeLoggedValue(error))
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

function statValueFromPlayer(playerData, statType, gameFinal) {
  const statField = NFL_STAT_MAP[statType]
  if (!statField) {
    console.warn(`⚠️ Unknown NFL stat type: ${statType}`)
    return { value: null, statFound: false, reason: 'unknown_stat' }
  }
  const value = playerData[statField]
  if (value === undefined || value === null) {
    if (gameFinal) {
      return { value: 0, statFound: true, reason: 'appeared' }
    }
    return { value: null, statFound: false, reason: 'stat_not_found' }
  }
  return { value, statFound: true, reason: 'appeared' }
}

async function hydrateRosterNames(parsed, queryName, options) {
  const entries = (parsed.entries || []).map((entry) => ({ ...entry }))
  const alreadyNamed = entries.filter((entry) => entry.name)
  const match = matchNflRosterPlayer(alreadyNamed, {
    name: queryName,
    team: options.team,
    playerId: options.playerId,
  })
  if (
    match.status === 'matched'
    || match.status === 'ambiguous'
    || match.status === 'missing_team'
    || match.status === 'team_mismatch'
    || match.status === 'unverified_id'
    || match.status === 'id_mismatch'
  ) {
    return { fetchError: false, entries, match }
  }

  const candidates = dedupeRosterAthleteCandidates(
    rosterLastNameCandidates(entries, queryName)
      .filter((entry) => !entry.name && entry.athleteRef && entry.playerId),
  )
  const seasonYear = options.seasonYear
  for (const entry of candidates) {
    const athlete = await fetchJsonCached(
      entry.athleteRef.replace(/^http:\/\//, 'https://'),
      options.cache?.athleteById,
      entry.playerId,
      options,
    )
    if (!athlete.ok) {
      return { fetchError: true, status: athlete.status, statusText: athlete.statusText, entries }
    }
    const fullName = athlete.data?.fullName || athlete.data?.displayName || null
    if (fullName) {
      for (const row of entries) {
        if (String(row.playerId || '') === String(entry.playerId)) {
          row.fullName = fullName
          row.name = fullName
        }
      }
    }
  }

  const named = entries.filter((row) => row.name)
  return {
    fetchError: false,
    entries,
    match: matchNflRosterPlayer(named, {
      name: queryName,
      team: options.team,
      playerId: options.playerId,
    }),
  }
}

async function loadEventRoster(eventId, teamId, teamAbbr, options) {
  const cacheKey = `${eventId}:${teamId}`
  const roster = await fetchJsonCached(
    espnNflEventRosterUrl(eventId, teamId),
    options.cache?.rosterByKey,
    cacheKey,
    options,
  )
  if (!roster.ok) {
    return { fetchError: true, status: roster.status, statusText: roster.statusText }
  }
  const data = roster.data
  const entries = data?.entries || data?.items
  if (!Array.isArray(entries) || entries.length === 0) {
    if (options.cache?.rosterByKey) options.cache.rosterByKey.delete(cacheKey)
    return { fetchError: true, status: roster.status, statusText: 'roster unavailable' }
  }
  return {
    fetchError: false,
    parsed: parseEspnNflEventRoster(data, { teamId, teamAbbr }),
  }
}

async function loadPlayerEventAppearance(athleteId, eventId, seasonYear, options) {
  const eventlog = await fetchJsonCached(
    espnNflEventLogUrl(athleteId, seasonYear),
    options.cache?.eventlogByKey,
    `${seasonYear}:${athleteId}`,
    options,
  )
  if (eventlog.ok) {
    const item = matchEventLogByEventId(eventlog.data?.events?.items, eventId)
    if (item) return { fetchError: false, fetched: true, entry: item }
  } else if (isRetryableNflStatus(eventlog.status) || eventlog.status === 0) {
    return { fetchError: true, status: eventlog.status, statusText: eventlog.statusText }
  }

  const gamelog = await fetchJsonCached(
    espnNflGameLogUrl(athleteId),
    options.cache?.gamelogByAthlete,
    athleteId,
    options,
  )
  if (!gamelog.ok) {
    if (eventlog.ok) return { fetchError: false, fetched: true, entry: null }
    if (isRetryableNflStatus(gamelog.status) || gamelog.status === 0) {
      return { fetchError: true, status: gamelog.status, statusText: gamelog.statusText }
    }
    // Permanent 404/403 on both logs: settle as no entry (needs_review),
    // not fetch_error, so the prop does not stay pending forever.
    return { fetchError: false, fetched: true, entry: null }
  }
  const hit = matchGameLogByEventId(gamelog.data?.events, eventId)
  return { fetchError: false, fetched: true, entry: hit }
}

async function resolveMissingFromRoster(espnGameId, playerName, loaded, options = {}) {
  const box = loaded.box || describeNflEspnBox(loaded.data)
  warnNflMissingKickoff(espnGameId, loaded.data, options.game)
  const settleReady = isNflMissingStatSettleReady(
    nflEventFinalAt(loaded.data, options.game),
    options.now || new Date(),
  )
  if (!settleReady) {
    return withBox(nflLookupFromMissingPlan(
      { action: 'hold', reason: 'pending_final_window' },
      { box, playerName, source: NFL_GRADE_SOURCES.ESPN_ROSTER },
    ), box, playerName)
  }

  const homeId = box.homeTeamId
  const awayId = box.awayTeamId
  if (!homeId || !awayId) {
    return withBox(nflLookupFromMissingPlan(
      { action: 'needs_review', reason: 'missing_roster' },
      { box, playerName, gameFinal: true },
    ), box, playerName)
  }

  const homeRoster = await loadEventRoster(espnGameId, homeId, box.homeAbbr, options)
  if (homeRoster.fetchError) {
    return withBox(nflFetchErrorResult({
      source: NFL_GRADE_SOURCES.ESPN_ROSTER,
      status: homeRoster.status,
      statusText: homeRoster.statusText,
    }), box, playerName)
  }
  const awayRoster = await loadEventRoster(espnGameId, awayId, box.awayAbbr, options)
  if (awayRoster.fetchError) {
    return withBox(nflFetchErrorResult({
      source: NFL_GRADE_SOURCES.ESPN_ROSTER,
      status: awayRoster.status,
      statusText: awayRoster.statusText,
    }), box, playerName)
  }

  const seasonYear = loaded.seasonYear || options.seasonYear || configuredNflSeasonYear()
  const homeHydrated = await hydrateRosterNames(homeRoster.parsed, playerName, { ...options, seasonYear })
  if (homeHydrated.fetchError) {
    return withBox(nflFetchErrorResult({
      source: NFL_GRADE_SOURCES.ESPN_ROSTER,
      status: homeHydrated.status,
      statusText: homeHydrated.statusText,
    }), box, playerName)
  }
  const awayHydrated = await hydrateRosterNames(awayRoster.parsed, playerName, { ...options, seasonYear })
  if (awayHydrated.fetchError) {
    return withBox(nflFetchErrorResult({
      source: NFL_GRADE_SOURCES.ESPN_ROSTER,
      status: awayHydrated.status,
      statusText: awayHydrated.statusText,
    }), box, playerName)
  }

  const bothEntries = [...(homeHydrated.entries || []), ...(awayHydrated.entries || [])]
  const claimedId = parseNumericEspnAthleteId(options.playerId)
  const combined = matchNflRosterPlayer(bothEntries, {
    name: playerName,
    team: options.team,
    playerId: claimedId,
  })
  const bothRostersComplete = bothNflEventRostersComplete(homeRoster.parsed, awayRoster.parsed)

  let athleteId = combined.player?.playerId ? String(combined.player.playerId) : claimedId
  let athleteIdVerified = Boolean(
    combined.player
    && nflAthleteIdNameMatches(
      combined.player.fullName || combined.player.name || combined.player.displayName,
      playerName,
    ),
  )

  if (claimedId && combined.status === 'matched' && combined.player && String(combined.player.playerId || '') !== claimedId) {
    return withBox(nflLookupFromMissingPlan(
      { action: 'needs_review', reason: 'id_mismatch' },
      { box, playerName, gameFinal: true },
    ), box, playerName)
  }

  if (claimedId && !athleteIdVerified) {
    const athlete = await fetchJsonCached(
      espnNflAthleteUrl(claimedId, seasonYear),
      options.cache?.athleteById,
      claimedId,
      options,
    )
    if (!athlete.ok) {
      if (isRetryableNflStatus(athlete.status) || athlete.status === 0) {
        return withBox(nflFetchErrorResult({
          source: NFL_GRADE_SOURCES.ESPN_ROSTER,
          status: athlete.status,
          statusText: athlete.statusText,
        }), box, playerName)
      }
    } else if (nflAthleteIdNameMatches(athlete.data?.fullName || athlete.data?.displayName, playerName)) {
      athleteId = claimedId
      athleteIdVerified = true
    }
  }

  if (combined.status === 'matched' && combined.player && !nflResolvedTeamOnGame(
    combined.player.teamAbbr,
    nflGameTeamsFrom(options.game, options.gameTeams),
  )) {
    return withBox(nflLookupFromMissingPlan(
      { action: 'needs_review', reason: 'team_mismatch' },
      { box, playerName, gameFinal: true, team: combined.player.teamAbbr },
    ), box, playerName)
  }

  if (combined.status === 'matched' && !bothRostersComplete) {
    return withBox(nflLookupFromMissingPlan(
      { action: 'needs_review', reason: 'incomplete_roster' },
      { box, playerName, gameFinal: true, team: combined.player?.teamAbbr || null },
    ), box, playerName)
  }

  let logFetched = false
  let logEntry = null
  const rosterAppearance = classifyNflRosterAppearance(combined.player)
  if (combined.status === 'matched' && rosterAppearance.status === 'dressed_unknown_snaps') {
    if (!combined.player.playerId) {
      return withBox(nflLookupFromMissingPlan(
        { action: 'needs_review', reason: 'no_log_entry' },
        { box, playerName, gameFinal: true, team: combined.player.teamAbbr },
      ), box, playerName)
    }
    const log = await loadPlayerEventAppearance(
      combined.player.playerId,
      espnGameId,
      seasonYear,
      options,
    )
    if (log.fetchError) {
      return withBox(nflFetchErrorResult({
        source: NFL_GRADE_SOURCES.ESPN_GAMELOG,
        status: log.status,
        statusText: log.statusText,
      }), box, playerName)
    }
    logFetched = log.fetched
    logEntry = log.entry
  }

  const plan = planNflMissingStatFromSources({
    settleReady: true,
    rosterOk: true,
    rosterMatch: combined.player,
    logFetched,
    logEntry,
    matchStatus: combined.status,
    athleteId,
    athleteIdVerified,
    bothRostersComplete,
    athleteOnEitherRoster: athleteIdOnRoster(bothEntries, athleteId),
  })

  return withBox(nflLookupFromMissingPlan(plan, {
    box,
    playerName,
    team: combined.player?.teamAbbr || null,
    player: combined.player?.name || combined.player?.fullName || playerName,
    source: logFetched ? NFL_GRADE_SOURCES.ESPN_GAMELOG : NFL_GRADE_SOURCES.ESPN_ROSTER,
    gameFinal: true,
  }), box, playerName)
}

/**
 * Structured NFL lookup used by grading and regrade.
 * Numeric 0 is only returned when the player matched in a final box, or
 * the event roster / eventId-matched log confirms they dressed with snaps.
 */
export async function lookupPlayerGameStat(espnGameId, playerName, statType, options = {}) {
  try {
    if (!espnGameId) {
      return emptyNflStatResult({ reason: 'not_in_box', matchStatus: 'unmatched' })
    }

    const loaded = await loadNflGradingBox(espnGameId, options)
    if (loaded.fetchError) {
      return nflFetchErrorResult({
        source: NFL_GRADE_SOURCES.ESPN_BOX,
        status: loaded.status,
        statusText: loaded.statusText,
      })
    }

    const box = loaded.box || describeNflEspnBox(loaded.data)
    const playerData = loaded.playerStats
      ? matchNflBoxscorePlayer(loaded.playerStats, playerName)
      : null

    if (playerData) {
      const stat = statValueFromPlayer(playerData, statType, loaded.gameFinal)
      if (stat.statFound) {
        console.log(`✅ ${playerName} ${statType}: ${stat.value}`)
        return withBox({
          value: stat.value,
          source: NFL_GRADE_SOURCES.ESPN_BOX,
          matchStatus: 'matched',
          statFound: true,
          gameFinal: loaded.gameFinal,
          didNotPlay: false,
          reason: 'appeared',
          player: playerName,
        }, box, playerName)
      }
      return withBox(emptyNflStatResult({
        source: NFL_GRADE_SOURCES.ESPN_BOX,
        matchStatus: 'matched',
        gameFinal: loaded.gameFinal,
        reason: stat.reason,
      }), box, playerName)
    }

    if (!loaded.gameFinal) {
      console.warn(`⚠️ No stats found for ${playerName} in game ${espnGameId}`)
      return withBox(emptyNflStatResult({
        source: NFL_GRADE_SOURCES.ESPN_BOX,
        reason: 'not_in_box',
        matchStatus: 'unmatched',
        gameFinal: false,
      }), box, playerName)
    }

    console.log(`📋 ${playerName} missing from NFL box; checking event roster`)
    return resolveMissingFromRoster(espnGameId, playerName, loaded, options)
  } catch (error) {
    console.error(`❌ Error getting NFL stat for ${playerName}:`, sanitizeLoggedValue(error))
    return nflFetchErrorResult({ statusText: error?.message })
  }
}

/**
 * Get a specific player's stat from a game
 * @param {string} espnGameId - ESPN game ID
 * @param {string} playerName - Full player name
 * @param {string} statType - Stat type (passing_yards, rushing_yards, etc.)
 * @returns {Promise<number|null>}
 */
export async function getPlayerGameStat(espnGameId, playerName, statType, options = {}) {
  const result = await lookupPlayerGameStat(espnGameId, playerName, statType, options)
  return isGradeableNflStatResult(result) ? result.value : null
}

export {
  isGradeableNflStatResult,
  isNflFetchError,
}

export default {
  getPlayerGameStat,
  lookupPlayerGameStat,
  createNflLookupCache,
  fetchNFLGameStats,
  matchNflBoxscorePlayer,
}
