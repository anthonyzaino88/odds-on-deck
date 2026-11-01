/**
 * Daily ESPN team-performance fetch.
 *
 * Idempotent: writes only present, usable fields. A failed or empty
 * sport/team fetch never overwrites stored records or scoring averages
 * with 0 or null. Per-sport failures do not abort the other sports.
 */

import { createScriptSupabaseClient } from './supabase-script-client.js'
import {
  extractEspnTeamPerformance,
  isTeamSeasonStatsFrozen,
  mergeStatsDataThrough,
  teamPerformanceWritePayload,
} from './team-performance-stats.js'
import { FINAL_GAME_STATUSES } from './game-status.js'

export { FINAL_GAME_STATUSES }

export const TEAM_PERFORMANCE_SPORTS = Object.freeze(['nfl', 'nhl', 'mlb'])

export const MLB_ESPN_IDS = Object.freeze({
  MLB_109: '29',
  MLB_133: '11',
  MLB_144: '15',
  MLB_110: '1',
  MLB_111: '2',
  MLB_112: '16',
  MLB_4: '4',
  MLB_113: '17',
  MLB_114: '5',
  MLB_115: '27',
  MLB_145: '4',
  MLB_116: '6',
  MLB_117: '18',
  MLB_118: '7',
  MLB_108: '3',
  MLB_119: '19',
  MLB_146: '28',
  MLB_158: '8',
  MLB_142: '9',
  MLB_121: '21',
  MLB_147: '10',
  MLB_143: '22',
  MLB_134: '23',
  MLB_135: '25',
  MLB_136: '12',
  MLB_137: '26',
  MLB_138: '24',
  MLB_139: '30',
  MLB_140: '13',
  MLB_141: '14',
  MLB_120: '20',
})

const ESPN_BASE = Object.freeze({
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl',
})

export function resolveEspnTeamId(team) {
  const sport = String(team?.sport || '').toLowerCase()
  const rawId = String(team?.id ?? '')
  if (sport === 'mlb') {
    if (MLB_ESPN_IDS[rawId]) return MLB_ESPN_IDS[rawId]
    const prefixed = rawId.startsWith('MLB_') ? rawId : `MLB_${rawId}`
    if (MLB_ESPN_IDS[prefixed]) return MLB_ESPN_IDS[prefixed]
  }
  if (team?.espnId) return String(team.espnId)
  return rawId.replace(`${sport.toUpperCase()}_`, '')
}

/**
 * Placeholder Team rows (NHL_-1 'TBD', NHL_-2, …) have negative ESPN ids.
 * They are not real clubs and must not be fetched or counted as skips.
 */
export function isPlaceholderTeam(team) {
  if (!team) return false
  const candidates = [team.espnId, resolveEspnTeamId(team)]
  for (const raw of candidates) {
    if (raw == null || raw === '') continue
    const n = Number(raw)
    if (Number.isFinite(n) && n < 0) return true
  }
  return false
}

export function espnTeamUrl(sport, espnId) {
  const base = ESPN_BASE[String(sport || '').toLowerCase()]
  if (!base || !espnId) return null
  return `${base}/teams/${espnId}?enable=record,stats`
}

/**
 * Decide whether this extract should touch the Team row.
 * Failed / empty / all-zero extracts return an empty payload so the
 * existing row is left unchanged.
 */
export function planTeamPerformanceWrite(extracted) {
  if (!extracted) {
    return {
      shouldWrite: false,
      payload: {},
      written: [],
      retained: [],
      reason: 'no_extract',
    }
  }
  const write = teamPerformanceWritePayload(extracted)
  const timestampsWritten = write.freshnessTimestampsWritten
  return {
    shouldWrite: write.written.length > 0,
    payload: write.payload,
    written: write.written,
    retained: write.retained,
    representsFullRefresh: write.representsFullRefresh,
    freshnessTimestampsWritten: timestampsWritten,
    partial: write.written.length > 0 && !timestampsWritten,
    reason: write.written.length > 0 ? null : 'no_usable_fields',
  }
}

export async function fetchEspnTeamPayload(url, {
  fetchImpl = globalThis.fetch,
  headers = { 'User-Agent': 'OddsOnDeck/1.0' },
} = {}) {
  if (!url) return { ok: false, reason: 'missing_url', data: null }
  let response
  try {
    response = await fetchImpl(url, { headers })
  } catch (error) {
    return { ok: false, reason: 'fetch_error', error, data: null }
  }
  if (!response?.ok) {
    return { ok: false, reason: `http_${response?.status || 'error'}`, data: null }
  }
  try {
    return { ok: true, reason: null, data: await response.json() }
  } catch (error) {
    return { ok: false, reason: 'invalid_json', error, data: null }
  }
}

/** Treat ESPN as frozen only when DB finals exceed ESPN gamesPlayed by more than this. */
export const STATS_THROUGH_GAMES_PLAYED_SLACK = 2

/**
 * UTC start of the current regular season. Older Game rows may still
 * have a null season, so date-range remains the season boundary.
 * NHL Oct 1 (wraps Oct–Jun), NFL Sep 1 (wraps Sep–Feb), MLB Mar 20
 * (excludes spring-training finals that would otherwise breach slack
 * in early April).
 */
export function regularSeasonStartUtc(sport, now = new Date()) {
  const key = String(sport || '').toLowerCase()
  const date = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(date.getTime())) return null
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  if (key === 'nhl') return new Date(Date.UTC(month >= 10 ? year : year - 1, 9, 1))
  if (key === 'nfl') return new Date(Date.UTC(month >= 9 ? year : year - 1, 8, 1))
  if (key === 'mlb') return new Date(Date.UTC(month >= 3 ? year : year - 1, 2, 20))
  return null
}

/**
 * One-way frozen-ESPN test. DB behind (or even with) ESPN is fine —
 * fetch-fresh-games often has fewer finals than ESPN gamesPlayed.
 * Only dbFinals − espnGamesPlayed > slack means ESPN numbers are stale.
 */
export function espnGamesPlayedLooksFrozen(espnGamesPlayed, dbFinalsCount, {
  slack = STATS_THROUGH_GAMES_PLAYED_SLACK,
} = {}) {
  if (espnGamesPlayed == null || dbFinalsCount == null) return false
  const espn = Number(espnGamesPlayed)
  const db = Number(dbFinalsCount)
  if (!Number.isFinite(espn) || !Number.isFinite(db)) return false
  return (db - espn) > slack
}

/**
 * Latest final Game.date for this team (home or away) on or after the
 * sport's regular-season start, or null. Lookup failures are non-fatal.
 */
export async function loadLatestFinalGameDate(supabase, team, { now = new Date() } = {}) {
  if (!supabase || !team?.id) return null
  const sport = String(team?.sport || '').toLowerCase()
  const start = regularSeasonStartUtc(sport, now)
  if (!sport || !start) return null
  try {
    const nowIso = (now instanceof Date ? now : new Date(now)).toISOString()
    const { data, error } = await supabase
      .from('Game')
      .select('date')
      .eq('sport', sport)
      .or(`homeId.eq.${team.id},awayId.eq.${team.id}`)
      .in('status', FINAL_GAME_STATUSES)
      .gte('date', start.toISOString())
      .lte('date', nowIso)
      .order('date', { ascending: false })
      .limit(1)
    if (error || !Array.isArray(data) || data.length === 0) return null
    return data[0]?.date || null
  } catch {
    return null
  }
}

/**
 * How many final Games this team has on or after the regular-season start.
 * Accepts null Game.season — older ingest rows may still omit season.
 * Returns null when sport/id/start is missing or the lookup fails.
 */
export async function countTeamSeasonFinals(supabase, team, { now = new Date() } = {}) {
  if (!supabase || !team?.id) return null
  const sport = String(team?.sport || '').toLowerCase()
  const start = regularSeasonStartUtc(sport, now)
  if (!sport || !start) return null
  try {
    const nowIso = (now instanceof Date ? now : new Date(now)).toISOString()
    const { count, error } = await supabase
      .from('Game')
      .select('id', { count: 'exact', head: true })
      .eq('sport', sport)
      .or(`homeId.eq.${team.id},awayId.eq.${team.id}`)
      .in('status', FINAL_GAME_STATUSES)
      .gte('date', start.toISOString())
      .lte('date', nowIso)
    if (error || count == null || !Number.isFinite(Number(count))) return null
    return Number(count)
  } catch {
    return null
  }
}

function withholdFreshnessTimestamps(plan, reason) {
  delete plan.payload.statsCapturedAt
  delete plan.payload.statsDataThrough
  plan.written = (plan.written || []).filter((column) => (
    column !== 'statsCapturedAt' && column !== 'statsDataThrough'
  ))
  const retained = new Set(plan.retained || [])
  retained.add('statsCapturedAt')
  retained.add('statsDataThrough')
  plan.retained = [...retained]
  plan.freshnessTimestampsWritten = false
  plan.partial = plan.written.length > 0
  plan.dataThroughSource = reason
  return plan
}

export async function fetchAndUpdateTeam(team, {
  supabase,
  fetchImpl = globalThis.fetch,
  extractedAt = new Date(),
  logger = console,
} = {}) {
  const sport = String(team?.sport || '').toLowerCase()
  const espnId = resolveEspnTeamId(team)
  const url = espnTeamUrl(sport, espnId)
  const fetched = await fetchEspnTeamPayload(url, { fetchImpl })
  if (!fetched.ok) {
    logger.error?.(`  ❌ ESPN fetch failed for ${team?.abbr || team?.id}: ${fetched.reason}`)
    return { updated: false, overwritten: false, reason: fetched.reason }
  }

  const extracted = extractEspnTeamPerformance(fetched.data, sport, { extractedAt })
  const plan = planTeamPerformanceWrite(extracted)
  // Frozen seasons (MLB postseason / completed regular season) may take
  // statsDataThrough from DB finals even when ESPN still sends previousEvent.
  // In-season, a stalled ESPN date must still trip the 7-day stale gate.
  // When ESPN omits previousEvent (NHL and NFL team endpoints), derive
  // statsDataThrough from the latest same-sport regular-season final.
  // Withhold timestamps only when DB finals exceed ESPN gamesPlayed by
  // more than 2 (frozen ESPN). DB-behind (null season, incomplete Game
  // table) still writes statsCapturedAt and does not invent dataThrough.
  const seasonFrozen = plan.shouldWrite && isTeamSeasonStatsFrozen(sport, {
    record: plan.payload.last10Record ?? team?.last10Record,
    gamesPlayed: plan.payload.gamesPlayed ?? team?.gamesPlayed,
    espnData: fetched.data,
    season: plan.payload.season ?? team?.season,
  })
  const timestampsOnPayload = Boolean(plan.payload?.statsCapturedAt)
  const missingEspnThrough = !plan.payload?.statsDataThrough
  if (seasonFrozen) {
    const latestFinal = await loadLatestFinalGameDate(supabase, team, { now: extractedAt })
    const merged = mergeStatsDataThrough(plan.payload.statsDataThrough, latestFinal, { now: extractedAt })
    if (merged && merged !== plan.payload.statsDataThrough) {
      plan.payload.statsDataThrough = merged
      plan.dataThroughSource = 'db_final_game'
      if (!plan.written.includes('statsDataThrough')) {
        plan.written = [...plan.written, 'statsDataThrough']
      }
      plan.retained = (plan.retained || []).filter((column) => column !== 'statsDataThrough')
    }
  } else if (timestampsOnPayload && missingEspnThrough) {
    const espnGamesPlayed = plan.payload.gamesPlayed ?? extracted?.meta?.gamesPlayed ?? team?.gamesPlayed
    const dbFinals = await countTeamSeasonFinals(supabase, team, { now: extractedAt })
    if (espnGamesPlayedLooksFrozen(espnGamesPlayed, dbFinals)) {
      withholdFreshnessTimestamps(plan, 'games_played_mismatch')
      logger.log?.(`  ⚠️  ${team?.abbr || team?.id}: ESPN gamesPlayed=${espnGamesPlayed} vs DB finals=${dbFinals} — withholding timestamps`)
    } else {
      const latestFinal = await loadLatestFinalGameDate(supabase, team, { now: extractedAt })
      const merged = mergeStatsDataThrough(plan.payload.statsDataThrough, latestFinal, { now: extractedAt })
      if (merged && merged !== plan.payload.statsDataThrough) {
        plan.payload.statsDataThrough = merged
        plan.dataThroughSource = 'db_final_game'
        if (!plan.written.includes('statsDataThrough')) {
          plan.written = [...plan.written, 'statsDataThrough']
        }
        plan.retained = (plan.retained || []).filter((column) => column !== 'statsDataThrough')
      }
    }
  }
  if (!plan.shouldWrite) {
    logger.log?.(`  ⚠️  No usable ESPN fields for ${team?.abbr || team?.id} — existing Team row left unchanged`)
    return { updated: false, overwritten: false, reason: plan.reason, plan }
  }

  const { data, error } = await supabase.from('Team').update(plan.payload).eq('id', team.id).select('id')
  if (error) {
    logger.error?.(`  ❌ Error updating ${team?.abbr || team?.id}:`, error)
    return { updated: false, overwritten: false, reason: 'update_error', error, plan }
  }
  if (!Array.isArray(data) || data.length === 0) {
    logger.error?.(`  ❌ Team update matched 0 rows for ${team?.abbr || team?.id} (id=${team?.id})`)
    return { updated: false, overwritten: false, reason: 'update_no_rows', plan }
  }

  if (plan.partial) {
    logger.log?.(`  ⚠️  Partial write (no timestamps) for ${team?.abbr || team?.id}: ${plan.written.join(', ')}`)
  } else {
    logger.log?.(`  ✅ Wrote present season fields only: ${plan.written.join(', ')}`)
  }
  return { updated: true, overwritten: false, reason: null, plan }
}

export async function fetchTeamPerformanceForSport(sport, {
  supabase,
  fetchImpl = globalThis.fetch,
  extractedAt = new Date(),
  delayMs = 100,
  logger = console,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const { data: teams, error } = await supabase
    .from('Team')
    .select('*')
    .eq('sport', sport)
    .order('abbr')

  if (error) {
    logger.error?.(`❌ ${sport.toUpperCase()} team list failed:`, error)
    return { sport, updated: 0, errors: 1, skipped: 0, aborted: false, error }
  }

  let updated = 0
  let partial = 0
  let errors = 0
  let skipped = 0

  for (const team of teams || []) {
    if (isPlaceholderTeam(team)) continue
    try {
      const result = await fetchAndUpdateTeam(team, {
        supabase,
        fetchImpl,
        extractedAt,
        logger,
      })
      if (result.updated) {
        if (result.plan?.partial || !result.plan?.freshnessTimestampsWritten) partial += 1
        else updated += 1
      } else if (
        result.reason === 'update_error'
        || result.reason === 'update_no_rows'
        || String(result.reason || '').startsWith('http_')
        || result.reason === 'fetch_error'
      ) {
        errors += 1
      } else {
        skipped += 1
      }
      if (delayMs > 0) await sleep(delayMs)
    } catch (error) {
      logger.error?.(`  ❌ Error processing ${team?.abbr || team?.id}:`, error.message)
      errors += 1
    }
  }

  return { sport, updated, partial, errors, skipped, aborted: false }
}

/**
 * Run every requested sport independently. One sport's API outage
 * cannot abort the others.
 */
export async function fetchTeamPerformanceForSports({
  supabase,
  sports = TEAM_PERFORMANCE_SPORTS,
  fetchImpl = globalThis.fetch,
  extractedAt = new Date(),
  delayMs = 100,
  logger = console,
  sleep,
} = {}) {
  const results = []
  let fatal = false

  if (!supabase) {
    logger.error?.('❌ Missing Supabase client')
    return { results, updated: 0, partial: 0, errors: 1, skipped: 0, fatal: true, exitCode: 1 }
  }

  for (const sport of sports) {
    try {
      const result = await fetchTeamPerformanceForSport(sport, {
        supabase,
        fetchImpl,
        extractedAt,
        delayMs,
        logger,
        sleep,
      })
      results.push(result)
    } catch (error) {
      logger.error?.(`❌ ${String(sport).toUpperCase()} fetch aborted:`, error.message)
      results.push({
        sport,
        updated: 0,
        partial: 0,
        errors: 1,
        skipped: 0,
        aborted: true,
        error,
      })
    }
  }

  const updated = results.reduce((sum, row) => sum + (row.updated || 0), 0)
  const partial = results.reduce((sum, row) => sum + (row.partial || 0), 0)
  const errors = results.reduce((sum, row) => sum + (row.errors || 0), 0)
  const skipped = results.reduce((sum, row) => sum + (row.skipped || 0), 0)

  logger.log?.('\n📊 Team performance summary:')
  for (const row of results) {
    logger.log?.(`   ${String(row.sport).toUpperCase()}: updated=${row.updated} partial=${row.partial || 0} skipped=${row.skipped} errors=${row.errors}${row.aborted ? ' (aborted)' : ''}`)
  }
  logger.log?.(`   ✅ Updated (timestamps written): ${updated}`)
  logger.log?.(`   ⚠️  Partial (fields written, no timestamps): ${partial}`)
  logger.log?.(`   ⚠️  Skipped (no overwrite): ${skipped}`)
  logger.log?.(`   ❌ Errors: ${errors}`)

  return {
    results,
    updated,
    partial,
    errors,
    skipped,
    fatal,
    exitCode: fatal ? 1 : 0,
  }
}

export async function runFetchTeamPerformanceData({
  createClient = createScriptSupabaseClient,
  env = process.env,
  ...options
} = {}) {
  const supabase = createClient(env)
  return fetchTeamPerformanceForSports({ supabase, ...options })
}
