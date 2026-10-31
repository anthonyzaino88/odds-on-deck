/**
 * Sweep games stuck in an active status after their date has passed.
 *
 * Candidates: scheduled / delayed / in_progress whose ET date is more
 * than STALE_DAYS past. Re-check ESPN and set final, postponed, or
 * not_needed. Rows the feed cannot resolve are reported only.
 * Never deletes. Dry-run is the default; --apply-stale writes.
 */

import { etDateKey } from './game-grade-eligibility.js'
import { parseEspnScore } from './espn-scoreboard.js'
import { canonicalizeMlbAbbr } from './team-mapping.js'
import {
  etTodayKey,
  parseGameIdParts,
  rowEtDate,
  shiftEtDate,
} from './game-reconcile.js'
import {
  classifyVendorStatus,
  isDeadStatus,
  isFinalStatus,
} from './game-status.js'

export const STALE_DAYS = 2
export const STALE_ACTIVE_STATUSES = Object.freeze(['scheduled', 'delayed', 'in_progress'])
export const STALE_APPLY_FLAG = '--apply-stale'

const ESPN_SPORT_PATH = Object.freeze({
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nhl: 'hockey/nhl',
})

const WRITE_ACTIONS = new Set(['set_final', 'set_postponed', 'set_not_needed'])

export function isStaleActiveStatus(status) {
  return STALE_ACTIVE_STATUSES.includes(String(status || '').toLowerCase().trim())
}

export function staleCutoffEt(todayEt, days = STALE_DAYS) {
  return shiftEtDate(todayEt, -Number(days || STALE_DAYS))
}

/** ET date is strictly more than `days` before today (e.g. Oct 28 when today is Oct 31). */
export function isMoreThanDaysPast(dateKey, todayEt, days = STALE_DAYS) {
  const cutoff = staleCutoffEt(todayEt, days)
  return Boolean(dateKey && cutoff && dateKey < cutoff)
}

export function classifyStaleCandidate(row, { todayEt, days = STALE_DAYS } = {}) {
  if (!isStaleActiveStatus(row?.status)) {
    return { candidate: false, reason: 'not_active_status' }
  }
  const date = rowEtDate(row) || etDateKey(row?.date)
  if (!date) return { candidate: false, reason: 'undated' }
  if (!isMoreThanDaysPast(date, todayEt, days)) {
    return { candidate: false, reason: 'not_stale', date }
  }
  return { candidate: true, date }
}

function postponedToken(status) {
  const raw = String(
    status?.type?.name
    || status?.type?.detail
    || status?.type?.description
    || status
    || '',
  ).toLowerCase()
  return raw.includes('postpone')
}

export function resolveStaleSource(source) {
  const state = String(source?.state || '').toLowerCase()
  if (!source || state === 'unavailable' || state === 'malformed') {
    return { action: 'report', reason: 'source_unavailable' }
  }
  if (state === 'missing') {
    return { action: 'set_not_needed', status: 'not_needed', reason: 'missing_from_source' }
  }

  const status = source.status
  if (isFinalStatus(status)) {
    return {
      action: 'set_final',
      status: 'final',
      reason: 'source_final',
      homeScore: parseEspnScore(source.homeScore),
      awayScore: parseEspnScore(source.awayScore),
    }
  }
  if (isDeadStatus(status) || classifyVendorStatus(status) === 'dead') {
    if (postponedToken(status)) {
      return { action: 'set_postponed', status: 'postponed', reason: 'source_postponed' }
    }
    return { action: 'set_not_needed', status: 'not_needed', reason: 'source_cancelled' }
  }
  return { action: 'report', reason: 'unresolved_still_active' }
}

function emptySummary() {
  return {
    candidates: 0,
    setFinal: 0,
    setPostponed: 0,
    setNotNeeded: 0,
    reported: 0,
    unresolved: 0,
  }
}

function makeAction(row, resolved) {
  return {
    id: row.id,
    sport: row.sport,
    status: row.status,
    priorStatus: row.status,
    date: rowEtDate(row) || etDateKey(row?.date),
    action: resolved.action,
    reason: resolved.reason,
    nextStatus: resolved.status || null,
    homeScore: resolved.homeScore,
    awayScore: resolved.awayScore,
  }
}

/**
 * @param {{
 *   dbRows?: object[],
 *   sourceById?: Record<string, { state: string, status?: object|string, homeScore?: *, awayScore?: * }>,
 *   nowEt?: Date | string,
 *   days?: number,
 * }} input
 */
export function planStaleStatusSweep({
  dbRows = [],
  sourceById = {},
  nowEt = new Date(),
  days = STALE_DAYS,
} = {}) {
  const todayEt = typeof nowEt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nowEt)
    ? nowEt
    : etTodayKey(nowEt)

  const actions = []
  const summary = emptySummary()

  for (const row of dbRows || []) {
    const info = classifyStaleCandidate(row, { todayEt, days })
    if (!info.candidate) continue
    summary.candidates += 1
    const source = sourceById[row.id] || { state: 'unavailable' }
    const resolved = resolveStaleSource(source)
    const action = makeAction(row, resolved)
    actions.push(action)
    if (action.action === 'set_final') summary.setFinal += 1
    else if (action.action === 'set_postponed') summary.setPostponed += 1
    else if (action.action === 'set_not_needed') summary.setNotNeeded += 1
    else {
      summary.reported += 1
      summary.unresolved += 1
    }
  }

  return { actions, summary, todayEt, days }
}

export function formatStalePlanTable(actions = []) {
  const header = ['id', 'sport', 'status', 'date', 'action', 'reason']
  const rows = actions.map((action) => (
    [action.id, action.sport, action.status, action.date, action.action, action.reason].join('\t')
  ))
  return [header.join('\t'), ...rows].join('\n')
}

function espnDateParam(dateStr) {
  return String(dateStr || '').replace(/-/g, '')
}

export function mapEspnSweepEvent(event) {
  const competition = event?.competitions?.[0]
  const competitors = competition?.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0]
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1]
  return {
    espnGameId: event?.id != null ? String(event.id) : '',
    homeAbbr: home?.team?.abbreviation || home?.team?.abbr || '',
    awayAbbr: away?.team?.abbreviation || away?.team?.abbr || '',
    status: event?.status || competition?.status,
    homeScore: home?.score,
    awayScore: away?.score,
  }
}

export function mapEspnSweepSummary(payload) {
  const header = payload?.header
  const competition = header?.competitions?.[0] || payload?.competitions?.[0]
  if (!competition && !header) return { state: 'malformed' }
  const competitors = competition?.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0]
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1]
  return {
    state: 'ok',
    espnGameId: header?.id != null ? String(header.id) : '',
    status: competition?.status || header?.competitions?.[0]?.status,
    homeScore: home?.score,
    awayScore: away?.score,
  }
}

function indexSweepEvents(events) {
  const byEspnId = new Map()
  const byPair = new Map()
  for (const event of events || []) {
    const mapped = mapEspnSweepEvent(event)
    if (mapped.espnGameId) byEspnId.set(mapped.espnGameId, mapped)
    const away = canonicalizeMlbAbbr(mapped.awayAbbr)
    const home = canonicalizeMlbAbbr(mapped.homeAbbr)
    if (away && home) byPair.set(`${away}_at_${home}`, mapped)
  }
  return { byEspnId, byPair }
}

function rowPairKey(row) {
  const parts = parseGameIdParts(row?.id)
  if (!parts) return ''
  return `${parts.awayAbbr}_at_${parts.homeAbbr}`
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'OddsOnDeck/1.0' } })
  if (!response.ok) {
    return { state: 'unavailable', statusCode: response.status }
  }
  try {
    return { state: 'ok', data: await response.json() }
  } catch {
    return { state: 'malformed' }
  }
}

export async function fetchStaleSources(rows, { fetchImpl = fetch, logger = console } = {}) {
  const sourceById = {}
  const bySportDate = new Map()
  for (const row of rows || []) {
    const date = rowEtDate(row)
    const sport = String(row.sport || '').toLowerCase()
    if (!date || !ESPN_SPORT_PATH[sport]) {
      sourceById[row.id] = { state: 'unavailable' }
      continue
    }
    const key = `${sport}|${date}`
    const list = bySportDate.get(key) || []
    list.push(row)
    bySportDate.set(key, list)
  }

  for (const [key, group] of bySportDate.entries()) {
    const [sport, date] = key.split('|')
    const path = ESPN_SPORT_PATH[sport]
    const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDateParam(date)}`
    let board
    try {
      board = await fetchJson(url, fetchImpl)
    } catch (error) {
      logger.warn?.(`stale_source_unavailable ${sport} ${date} ${error.message}`)
      for (const row of group) sourceById[row.id] = { state: 'unavailable' }
      continue
    }
    if (board.state !== 'ok' || !board.data || !Array.isArray(board.data.events)) {
      const state = board.state === 'ok' ? 'malformed' : board.state
      for (const row of group) sourceById[row.id] = { state }
      continue
    }

    const index = indexSweepEvents(board.data.events)
    const missing = []
    for (const row of group) {
      const espnId = String(row.espnGameId || '').trim()
      const hit = (espnId && index.byEspnId.get(espnId)) || index.byPair.get(rowPairKey(row))
      if (hit) {
        sourceById[row.id] = { state: 'ok', ...hit }
      } else {
        missing.push(row)
      }
    }

    for (const row of missing) {
      const espnId = String(row.espnGameId || '').trim()
      if (!espnId) {
        sourceById[row.id] = { state: 'missing' }
        continue
      }
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(espnId)}`
      try {
        const summary = await fetchJson(summaryUrl, fetchImpl)
        if (summary.state !== 'ok' || !summary.data) {
          sourceById[row.id] = { state: summary.statusCode === 404 ? 'missing' : (summary.state || 'unavailable') }
          continue
        }
        const mapped = mapEspnSweepSummary(summary.data)
        sourceById[row.id] = mapped.state === 'ok' ? mapped : { state: mapped.state || 'missing' }
      } catch (error) {
        logger.warn?.(`stale_source_unavailable summary ${row.id} ${error.message}`)
        sourceById[row.id] = { state: 'unavailable' }
      }
    }
  }

  return sourceById
}

export async function loadStaleGameRows(supabase, { nowEt, days = STALE_DAYS, sports = ['mlb', 'nfl', 'nhl'] } = {}) {
  const todayEt = typeof nowEt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nowEt)
    ? nowEt
    : etTodayKey(nowEt)
  const cutoff = staleCutoffEt(todayEt, days)
  if (!cutoff) return []
  const { data, error } = await supabase
    .from('Game')
    .select('id, sport, date, status, homeScore, awayScore, espnGameId, homeId, awayId')
    .in('sport', sports)
    .in('status', [...STALE_ACTIVE_STATUSES])
    .lt('date', `${todayEt}T23:59:59.999Z`)
  if (error) throw new Error(`stale Game load failed: ${error.message}`)
  return (data || []).filter((row) => classifyStaleCandidate(row, { todayEt, days }).candidate)
}

export async function applyStaleStatusPlan(supabase, plan, {
  now = new Date(),
  logger = console,
} = {}) {
  const applied = []
  const skipped = []
  const errors = []
  const writes = (plan?.actions || []).filter((action) => WRITE_ACTIONS.has(action.action))

  for (const action of writes) {
    const payload = {
      status: action.nextStatus,
      lastUpdate: new Date(now).toISOString(),
    }
    if (action.action === 'set_final') {
      if (action.homeScore != null) payload.homeScore = action.homeScore
      if (action.awayScore != null) payload.awayScore = action.awayScore
    }
    try {
      const result = await supabase
        .from('Game')
        .update(payload)
        .eq('id', action.id)
        .eq('status', action.priorStatus)
        .select('id')
      if (result?.error) {
        logger.error?.(`stale update error ${action.id}: ${result.error.message}`)
        errors.push({ id: action.id, error: result.error.message })
        continue
      }
      if (!result?.data?.length) {
        logger.warn?.(`skipped_changed_concurrently ${action.id}`)
        skipped.push({ id: action.id, reason: 'skipped_changed_concurrently' })
        continue
      }
      applied.push({ id: action.id, status: action.nextStatus })
    } catch (error) {
      logger.error?.(`stale update error ${action.id}: ${error.message}`)
      errors.push({ id: action.id, error: error.message })
    }
  }

  return { applied, skipped, errors, deleteCalled: false }
}

export async function runStaleStatusSweep({
  apply = false,
  now = new Date(),
  days = STALE_DAYS,
  supabase,
  fetchImpl = fetch,
  logger = console,
  dbRows = undefined,
  sourceById = undefined,
} = {}) {
  const todayEt = etTodayKey(now)
  let rows = dbRows
  if (rows === undefined) {
    if (!supabase) throw new Error('supabase client is required')
    rows = await loadStaleGameRows(supabase, { nowEt: todayEt, days })
  }

  const sources = sourceById === undefined
    ? await fetchStaleSources(rows, { fetchImpl, logger })
    : sourceById

  const plan = planStaleStatusSweep({
    dbRows: rows,
    sourceById: sources,
    nowEt: todayEt,
    days,
  })

  logger.log?.(formatStalePlanTable(plan.actions))
  const summary = plan.summary
  logger.log?.(
    `stale sweep: candidates=${summary.candidates} final=${summary.setFinal} postponed=${summary.setPostponed} not_needed=${summary.setNotNeeded} unresolved=${summary.unresolved} dryRun=${!apply}`,
  )

  const result = {
    apply: false,
    dryRun: !apply,
    ...plan,
    applied: [],
    skipped: [],
    errors: [],
  }

  if (!apply) return { ...result, exitCode: 0 }

  const write = await applyStaleStatusPlan(supabase, plan, { now, logger })
  result.apply = true
  result.dryRun = false
  result.applied = write.applied
  result.skipped = write.skipped
  result.errors = write.errors
  return { ...result, exitCode: write.errors.length ? 1 : 0 }
}
