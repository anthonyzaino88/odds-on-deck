/**
 * Skip / flag props from ESPN injury snapshots and NHL starting goalies.
 * Does not change Published grading or CLV math — persist/generation only.
 */

import { etDayKey } from './odds-api-budget.js'
import { parseEspnInjuriesPayload, espnInjuriesUrl } from './espn-injuries.js'
import {
  espnNhlScoreboardUrl,
  espnNhlSummaryUrl,
  espnScoreboardTeamAbbrs,
  mergeGoalieRows,
  nhlWebLandingUrl,
  nhlWebScoreUrl,
  parseEspnNhlGoalies,
  parseNhlWebGoalies,
} from './nhl-starting-goalies.js'
import {
  normalizeGradePlayerName,
  uniqueFirstNameAliasMatch,
} from './player-name-match.js'
import { canonicalizeNhlAbbr, resolveSportTeamCode } from './team-mapping.js'

export const INJURY_FETCH_TIMEOUT_MS = 8000
export const INJURY_FETCH_RETRIES = 2
export const INJURY_FETCH_RETRY_MS = 400
export const INJURY_USER_AGENT = 'OddsOnDeck/1.0'

export const INJURY_SKIP_STATUSES = Object.freeze([
  'out', 'o',
  'ir', 'injured reserve', 'injuredreserve',
  'ltir', 'long term injured reserve',
  'doubtful', 'd',
  'pup', 'nfi', 'suspended',
])

export const INJURY_FLAG_STATUSES = Object.freeze([
  'questionable', 'q',
  'day to day', 'day-to-day', 'dtd', 'daytoday',
])

export const GOALIE_PROP_TYPE_RE = /save|goals_against|goalie|record_a_win|to_win|shutout/i
export const NHL_GAME_LINE_TYPE_RE = /^(moneyline|ml|h2h|spread|spreads|total|totals)$/i

export function formatInjuriesStatus(status = 'ok') {
  return `INJURIES_STATUS=${status || 'ok'}`
}

export function isMissingInjuryTableError(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const message = String(error.message || error.details || '')
  return /could not find the table/i.test(message)
    && /InjuryReport|NhlStartingGoalie/i.test(message)
}

function compactStatus(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function injurySkipReason(status) {
  const token = compactStatus(status)
  const tight = token.replace(/\s+/g, '')
  if (INJURY_SKIP_STATUSES.includes(token) || INJURY_SKIP_STATUSES.includes(tight)) {
    if (tight === 'ir' || token.includes('injured reserve')) return 'injury:ir'
    if (tight === 'd' || token === 'doubtful') return 'injury:doubtful'
    if (tight === 'ltir' || token.includes('ltir')) return 'injury:ir'
    return 'injury:out'
  }
  return null
}

export function injuryFlagReason(status) {
  const token = compactStatus(status)
  const tight = token.replace(/\s+/g, '')
  if (INJURY_FLAG_STATUSES.includes(token) || INJURY_FLAG_STATUSES.includes(tight)) {
    return 'injury:questionable'
  }
  return null
}

export function isNhlGoaliePropType(propType) {
  return GOALIE_PROP_TYPE_RE.test(String(propType || ''))
}

export function isNhlGameLineProp(prop) {
  if (String(prop?.source || '').toLowerCase() === 'game_line') return true
  return NHL_GAME_LINE_TYPE_RE.test(String(prop?.type || prop?.propType || ''))
}

export function emptyInjurySnapshot(overrides = {}) {
  return {
    asOfDate: null,
    injuries: [],
    goalies: [],
    tableMissing: false,
    ...overrides,
  }
}

function namesMatch(left, right) {
  const a = normalizeGradePlayerName(left)
  const b = normalizeGradePlayerName(right)
  if (!a || !b) return false
  if (a === b) return true
  return uniqueFirstNameAliasMatch([right], a) != null
}

function propTeamAbbr(prop) {
  const sport = String(prop?.sport || '').toLowerCase()
  return resolveSportTeamCode(
    sport,
    prop?.team || prop?.teamAbbr || prop?.playerTeam || '',
  )
}

function findInjury(prop, injuries) {
  const sport = String(prop?.sport || '').toLowerCase()
  if (sport !== 'nfl' && sport !== 'nhl') return null
  const team = propTeamAbbr(prop)
  const name = prop?.playerName
  return (injuries || []).find((row) => {
    if (String(row.sport || '').toLowerCase() !== sport) return false
    if (team && row.teamAbbr && team !== row.teamAbbr) return false
    return namesMatch(name, row.playerName)
  }) || null
}

function findGoalie(prop, goalies) {
  const team = canonicalizeNhlAbbr(propTeamAbbr(prop))
    || canonicalizeNhlAbbr(prop?.teamAbbr)
  if (team) {
    const hit = (goalies || []).find((row) => canonicalizeNhlAbbr(row.teamAbbr) === team)
    if (hit) return hit
  }
  return (goalies || []).find((row) => namesMatch(prop?.playerName, row.playerName)) || null
}

/**
 * Filter props: skip Out/IR/Doubtful and NHL backup goalies;
 * flag Questionable and unconfirmed starters.
 */
function nhlGameLineTeams(prop) {
  return [...new Set([
    canonicalizeNhlAbbr(prop?.homeTeam || prop?.homeAbbr),
    canonicalizeNhlAbbr(prop?.awayTeam || prop?.awayAbbr),
    canonicalizeNhlAbbr(prop?.team || prop?.teamAbbr),
  ].filter(Boolean))]
}

export function applyInjuryAvailability(props, snapshot = emptyInjurySnapshot()) {
  if (snapshot.tableMissing) {
    return { kept: [...(props || [])], skipped: [], flagged: [] }
  }
  const injuries = snapshot.injuries || []
  const goalies = snapshot.goalies || []
  const kept = []
  const skipped = []
  const flagged = []

  for (const prop of props || []) {
    const flags = [...(prop.availabilityFlags || [])]
    const injury = findInjury(prop, injuries)
    if (injury) {
      const skip = injurySkipReason(injury.status || injury.statusCode)
      if (skip) {
        skipped.push({ prop, reason: skip, playerName: prop.playerName })
        continue
      }
      const flag = injuryFlagReason(injury.status || injury.statusCode)
      if (flag) flags.push(flag)
    }

    const sport = String(prop?.sport || '').toLowerCase()
    if (sport === 'nhl' && isNhlGoaliePropType(prop?.type || prop?.propType)) {
      const starter = findGoalie(prop, goalies)
      if (starter) {
        if (!namesMatch(prop.playerName, starter.playerName)) {
          skipped.push({
            prop,
            reason: 'starter:backup',
            playerName: prop.playerName,
          })
          continue
        }
        if (!starter.confirmed) flags.push('starter:unconfirmed')
      } else {
        flags.push('starter:unconfirmed')
      }
    } else if (sport === 'nhl' && isNhlGameLineProp(prop)) {
      const teams = nhlGameLineTeams(prop)
      const lookup = (abbr) => (goalies || []).find((row) => canonicalizeNhlAbbr(row.teamAbbr) === abbr)
      const sides = teams.length ? teams.map(lookup) : (goalies || [])
      if (!sides.length || sides.some((row) => !row || !row.confirmed)) {
        flags.push('starter:unconfirmed')
      }
    }

    const uniqueFlags = [...new Set(flags)]
    const next = uniqueFlags.length
      ? { ...prop, availabilityFlags: uniqueFlags }
      : prop
    kept.push(next)
    if (uniqueFlags.length) {
      flagged.push({ prop: next, flags: uniqueFlags })
    }
  }

  return { kept, skipped, flagged }
}

async function readTable(client, table, asOfDate) {
  let query = client.from(table).select('*')
  if (asOfDate && typeof query?.eq === 'function') {
    query = query.eq('asOfDate', asOfDate)
  }
  const result = await query
  if (result?.error) return { rows: [], error: result.error }
  return { rows: Array.isArray(result.data) ? result.data : [], error: null }
}

export async function loadInjurySnapshot({
  supabase: client,
  asOfDate,
  now = new Date(),
  log = console,
} = {}) {
  const day = asOfDate || etDayKey(now)
  const snapshot = emptyInjurySnapshot({ asOfDate: day })
  if (!client?.from) return snapshot

  const injuries = await readTable(client, 'InjuryReport', day)
  if (isMissingInjuryTableError(injuries.error)) {
    snapshot.tableMissing = true
    ;(log.warn || log.log)?.('⚠️ InjuryReport table missing — skip injury/starter filter (apply 009_injury_report.sql)')
    return snapshot
  }
  if (injuries.error) {
    ;(log.warn || log.log)?.(`⚠️ InjuryReport load failed: ${injuries.error.message}`)
  } else {
    snapshot.injuries = (injuries.rows || []).filter((row) => !day || row.asOfDate === day)
  }

  const goalies = await readTable(client, 'NhlStartingGoalie', day)
  if (isMissingInjuryTableError(goalies.error)) {
    snapshot.tableMissing = true
    ;(log.warn || log.log)?.('⚠️ NhlStartingGoalie table missing — skip starter filter (apply 009_injury_report.sql)')
    return snapshot
  }
  if (goalies.error) {
    ;(log.warn || log.log)?.(`⚠️ NhlStartingGoalie load failed: ${goalies.error.message}`)
  } else {
    snapshot.goalies = (goalies.rows || []).filter((row) => !day || row.asOfDate === day)
  }
  return snapshot
}

export async function persistInjurySnapshot(snapshot, {
  supabase: client,
  log = console,
} = {}) {
  if (!client?.from) {
    ;(log.warn || log.log)?.('⚠️ Injury persist skipped (no supabase client)')
    return { persisted: false, tableMissing: false }
  }
  const injuries = snapshot.injuries || []
  const goalies = snapshot.goalies || []
  if (injuries.length) {
    const { error } = await client.from('InjuryReport').upsert(injuries, { onConflict: 'id' })
    if (isMissingInjuryTableError(error)) {
      ;(log.warn || log.log)?.('⚠️ InjuryReport table missing — not persisted (apply 009_injury_report.sql)')
      return { persisted: false, tableMissing: true }
    }
    if (error) {
      ;(log.warn || log.log)?.(`⚠️ InjuryReport upsert failed: ${error.message}`)
      return { persisted: false, tableMissing: false, error }
    }
  }
  if (goalies.length) {
    const { error } = await client.from('NhlStartingGoalie').upsert(goalies, { onConflict: 'id' })
    if (isMissingInjuryTableError(error)) {
      ;(log.warn || log.log)?.('⚠️ NhlStartingGoalie table missing — not persisted (apply 009_injury_report.sql)')
      return { persisted: false, tableMissing: true }
    }
    if (error) {
      ;(log.warn || log.log)?.(`⚠️ NhlStartingGoalie upsert failed: ${error.message}`)
      return { persisted: false, tableMissing: false, error }
    }
  }
  return { persisted: true, tableMissing: false }
}

function sleep(ms, sleepImpl) {
  const wait = sleepImpl || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  return wait(ms)
}

export async function fetchJsonWithRetry(url, {
  fetchImpl = fetch,
  timeoutMs = INJURY_FETCH_TIMEOUT_MS,
  retries = INJURY_FETCH_RETRIES,
  retryMs = INJURY_FETCH_RETRY_MS,
  sleepImpl,
} = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': INJURY_USER_AGENT },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(retryMs * (attempt + 1), sleepImpl)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error(`fetch failed: ${url}`)
}

async function tryFetch(label, url, errors, options) {
  try {
    return await fetchJsonWithRetry(url, options)
  } catch (error) {
    errors.push({ label, message: error.message || String(error) })
    return null
  }
}

function summarizeStatus({ nflOk, nhlOk, rowCount, errors, tableMissing }) {
  if (!nflOk && !nhlOk && rowCount === 0) return 'failed'
  if (tableMissing || !nflOk || !nhlOk || errors.length) return 'partial'
  return 'ok'
}

export async function runFetchInjuries({
  fetchImpl = fetch,
  supabase: client,
  now = new Date(),
  log = console,
  sleepImpl,
  timeoutMs = INJURY_FETCH_TIMEOUT_MS,
  retries = INJURY_FETCH_RETRIES,
} = {}) {
  const asOfDate = etDayKey(now)
  const fetchOpts = { fetchImpl, timeoutMs, retries, sleepImpl }
  const errors = []

  const nflPayload = await tryFetch('espn-nfl-injuries', espnInjuriesUrl('nfl'), errors, fetchOpts)
  const nhlPayload = await tryFetch('espn-nhl-injuries', espnInjuriesUrl('nhl'), errors, fetchOpts)
  const espnBoard = await tryFetch('espn-nhl-scoreboard', espnNhlScoreboardUrl(asOfDate), errors, fetchOpts)

  const nflInjuries = nflPayload
    ? parseEspnInjuriesPayload(nflPayload, { sport: 'nfl', asOfDate, now })
    : []
  const nhlInjuries = nhlPayload
    ? parseEspnInjuriesPayload(nhlPayload, { sport: 'nhl', asOfDate, now })
    : []
  let espnGoalies = espnBoard
    ? parseEspnNhlGoalies(espnBoard, { asOfDate, now })
    : []

  const espnEvents = (espnBoard?.events || []).slice(0, 16)
  for (const event of espnEvents) {
    const eventId = event?.id != null ? String(event.id) : ''
    const have = espnGoalies.filter((row) => row.espnEventId === eventId).length
    if (have >= 2 || !eventId) continue
    const summary = await tryFetch(
      `espn-nhl-summary-${eventId}`,
      espnNhlSummaryUrl(eventId),
      errors,
      fetchOpts,
    )
    if (summary) {
      espnGoalies = mergeGoalieRows(
        parseEspnNhlGoalies(summary, { asOfDate, now }),
        espnGoalies,
      )
    }
  }

  const espnTeamCount = new Set(espnGoalies.map((row) => row.teamAbbr).filter(Boolean)).size
  const boardTeamCount = espnScoreboardTeamAbbrs(espnBoard).length
  const needNhlFallback = espnTeamCount === 0 || (boardTeamCount > 0 && espnTeamCount < boardTeamCount)

  let nhlGoalies = []
  if (needNhlFallback) {
    const scorePayload = await tryFetch('nhl-web-score', nhlWebScoreUrl(asOfDate), errors, fetchOpts)
    nhlGoalies = scorePayload
      ? parseNhlWebGoalies(scorePayload, { asOfDate, now, source: 'nhl' })
      : []
    const gameIds = [...new Set(
      (scorePayload?.games || [])
        .map((game) => game?.id)
        .filter(Boolean)
        .slice(0, 16),
    )]
    for (const id of gameIds) {
      const landing = await tryFetch(`nhl-web-landing-${id}`, nhlWebLandingUrl(id), errors, fetchOpts)
      if (landing) {
        nhlGoalies = mergeGoalieRows(
          parseNhlWebGoalies(landing, { asOfDate, now, source: 'nhl' }),
          nhlGoalies,
        )
      }
    }
  }

  const goalies = mergeGoalieRows(espnGoalies, nhlGoalies)
  const snapshot = {
    asOfDate,
    injuries: [...nflInjuries, ...nhlInjuries],
    goalies,
    tableMissing: false,
  }

  const persist = await persistInjurySnapshot(snapshot, { supabase: client, log })
  if (persist.tableMissing) snapshot.tableMissing = true

  const nflOk = Boolean(nflPayload)
  const nhlOk = Boolean(nhlPayload)
  const status = summarizeStatus({
    nflOk,
    nhlOk,
    rowCount: snapshot.injuries.length + snapshot.goalies.length,
    errors,
    tableMissing: snapshot.tableMissing,
  })

  const counts = {
    nflInjuries: nflInjuries.length,
    nhlInjuries: nhlInjuries.length,
    goalies: goalies.length,
    errors: errors.length,
  }

  log.log?.(formatInjuriesStatus(status))
  log.log?.(`INJURIES_NFL=${counts.nflInjuries} INJURIES_NHL=${counts.nhlInjuries} STARTERS_NHL=${counts.goalies}`)
  if (status !== 'ok') {
    log.log?.(`⚠️ ${formatInjuriesStatus(status)} — treat as WARN in routine reports (exit 0)`)
  }
  for (const err of errors) {
    log.log?.(`⚠️ ${err.label}: ${err.message}`)
  }

  return {
    exitCode: 0,
    status,
    snapshot,
    counts,
    errors,
    persisted: persist.persisted,
    tableMissing: snapshot.tableMissing,
  }
}
