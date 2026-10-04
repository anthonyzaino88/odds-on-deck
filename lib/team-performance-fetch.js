/**
 * Daily ESPN team-performance fetch.
 *
 * Idempotent: writes only present, usable fields. A failed or empty
 * sport/team fetch never overwrites stored records or scoring averages
 * with 0 or null. Per-sport failures do not abort the other sports.
 */

import { createScriptSupabaseClient } from './supabase-script-client.js'
import { extractEspnTeamPerformance, teamPerformanceWritePayload } from './team-performance-stats.js'

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
  if (sport === 'mlb' && MLB_ESPN_IDS[team.id]) return MLB_ESPN_IDS[team.id]
  if (team?.espnId) return String(team.espnId)
  return String(team?.id || '').replace(`${sport.toUpperCase()}_`, '')
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
  return {
    shouldWrite: write.written.length > 0,
    payload: write.payload,
    written: write.written,
    retained: write.retained,
    representsFullRefresh: write.representsFullRefresh,
    freshnessTimestampsWritten: write.freshnessTimestampsWritten,
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
  if (!plan.shouldWrite) {
    logger.log?.(`  ⚠️  No usable ESPN fields for ${team?.abbr || team?.id} — existing Team row left unchanged`)
    return { updated: false, overwritten: false, reason: plan.reason, plan }
  }

  const { error } = await supabase.from('Team').update(plan.payload).eq('id', team.id)
  if (error) {
    logger.error?.(`  ❌ Error updating ${team?.abbr || team?.id}:`, error)
    return { updated: false, overwritten: false, reason: 'update_error', error, plan }
  }

  logger.log?.(`  ✅ Wrote present season fields only: ${plan.written.join(', ')}`)
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
  let errors = 0
  let skipped = 0

  for (const team of teams || []) {
    try {
      const result = await fetchAndUpdateTeam(team, {
        supabase,
        fetchImpl,
        extractedAt,
        logger,
      })
      if (result.updated) updated += 1
      else if (result.reason === 'update_error' || String(result.reason || '').startsWith('http_') || result.reason === 'fetch_error') {
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

  return { sport, updated, errors, skipped, aborted: false }
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
    return { results, updated: 0, errors: 1, skipped: 0, fatal: true, exitCode: 1 }
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
        errors: 1,
        skipped: 0,
        aborted: true,
        error,
      })
    }
  }

  const updated = results.reduce((sum, row) => sum + (row.updated || 0), 0)
  const errors = results.reduce((sum, row) => sum + (row.errors || 0), 0)
  const skipped = results.reduce((sum, row) => sum + (row.skipped || 0), 0)

  logger.log?.('\n📊 Team performance summary:')
  for (const row of results) {
    logger.log?.(`   ${String(row.sport).toUpperCase()}: updated=${row.updated} skipped=${row.skipped} errors=${row.errors}${row.aborted ? ' (aborted)' : ''}`)
  }
  logger.log?.(`   ✅ Updated: ${updated}`)
  logger.log?.(`   ⚠️  Skipped (no overwrite): ${skipped}`)
  logger.log?.(`   ❌ Errors: ${errors}`)

  return {
    results,
    updated,
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
