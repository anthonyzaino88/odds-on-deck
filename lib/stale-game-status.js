/**
 * Sweep games stuck in an active status after their date has passed.
 *
 * Candidates: scheduled / delayed / in_progress whose ET date is more
 * than STALE_DAYS past. Re-check ESPN and set final, postponed,
 * suspended, or not_needed. Rows the feed cannot resolve are reported
 * only. Never deletes. Dry-run is the default; --apply-stale writes.
 *
 * not_needed writes reuse the PR #64 vanish-retire safeguards:
 * daily cap via countNotNeededRetiresSince, per-run cap, hasProtectedPicks,
 * and the :05–:15 ET quiet-period guard.
 */

import { etDateKey } from './game-grade-eligibility.js'
import { parseEspnScore } from './espn-scoreboard.js'
import { canonicalizeMlbAbbr } from './team-mapping.js'
import {
  attachDependents,
  canApplyReconcile,
  etDayStartIso,
  etTodayKey,
  hasProtectedPicks,
  loadReconcileDependents,
  parseGameIdParts,
  rowEtDate,
  shiftEtDate,
} from './game-reconcile.js'
import {
  classifyVendorStatus,
  isDeadStatus,
  isFinalStatus,
} from './game-status.js'
import {
  countNotNeededRetiresSince,
  VANISH_DAILY_MAX_RETIRES,
} from './retire-vanished-games.js'

export const STALE_DAYS = 2
export const STALE_ACTIVE_STATUSES = Object.freeze(['scheduled', 'delayed', 'in_progress'])
export const STALE_APPLY_FLAG = '--apply-stale'
export const STALE_NOT_NEEDED_CAP = VANISH_DAILY_MAX_RETIRES

const ESPN_SPORT_PATH = Object.freeze({
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nhl: 'hockey/nhl',
})

const WRITE_ACTIONS = new Set(['set_final', 'set_postponed', 'set_suspended', 'set_not_needed'])

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

function statusBlob(status) {
  return String(
    status?.type?.name
    || status?.type?.detail
    || status?.type?.description
    || status
    || '',
  ).toLowerCase()
}

function postponedToken(status) {
  return statusBlob(status).includes('postpone')
}

function cancelledToken(status) {
  return /cancel/.test(statusBlob(status))
}

function suspendedToken(status) {
  return statusBlob(status).includes('suspend')
}

export function resolveStaleSource(source, row = {}) {
  const state = String(source?.state || '').toLowerCase()
  if (!source || state === 'unavailable' || state === 'malformed') {
    return { action: 'report', reason: 'source_unavailable' }
  }
  if (state === 'empty_unconfirmed') {
    return { action: 'report', reason: 'empty_fetch_unconfirmed' }
  }
  if (state === 'summary_404') {
    const espnId = String(row.espnGameId || source.espnGameId || '').trim()
    if (!espnId) return { action: 'report', reason: 'unresolved_no_espn_id' }
    return { action: 'set_not_needed', status: 'not_needed', reason: 'source_summary_404' }
  }
  if (state === 'not_on_scoreboard' || state === 'missing') {
    return { action: 'report', reason: 'unresolved_not_on_scoreboard' }
  }

  const status = source.status
  if (isFinalStatus(status)) {
    return {
      action: 'set_final',
      status: 'final',
      reason: 'source_final',
      homeScore: parseEspnScore(source.homeScore, { status }),
      awayScore: parseEspnScore(source.awayScore, { status }),
    }
  }
  if (suspendedToken(status)) {
    return { action: 'set_suspended', status: 'suspended', reason: 'source_suspended' }
  }
  if (postponedToken(status)) {
    return { action: 'set_postponed', status: 'postponed', reason: 'source_postponed' }
  }
  if (cancelledToken(status)) {
    const espnId = String(row.espnGameId || source.espnGameId || '').trim()
    if (!espnId) return { action: 'report', reason: 'unresolved_no_espn_id' }
    return { action: 'set_not_needed', status: 'not_needed', reason: 'source_cancelled' }
  }
  if (isDeadStatus(status) || classifyVendorStatus(status) === 'dead') {
    return { action: 'report', reason: 'unresolved_dead_status' }
  }
  return { action: 'report', reason: 'unresolved_still_active' }
}

function emptySummary() {
  return {
    candidates: 0,
    setFinal: 0,
    setPostponed: 0,
    setSuspended: 0,
    setNotNeeded: 0,
    reported: 0,
    unresolved: 0,
    protected: 0,
    capped: 0,
  }
}

function rowDependents(row) {
  return row?.dependents || {}
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
    dependents: rowDependents(row),
    espnGameId: row.espnGameId || null,
  }
}

function tally(summary, action) {
  if (action.action === 'set_final') summary.setFinal += 1
  else if (action.action === 'set_postponed') summary.setPostponed += 1
  else if (action.action === 'set_suspended') summary.setSuspended += 1
  else if (action.action === 'set_not_needed') summary.setNotNeeded += 1
  else {
    summary.reported += 1
    summary.unresolved += 1
    if (action.reason === 'protected_has_picks') summary.protected += 1
    if (action.reason === 'cap_exceeded') summary.capped += 1
  }
}

/**
 * @param {{
 *   dbRows?: object[],
 *   sourceById?: Record<string, { state: string, status?: object|string, homeScore?: *, awayScore?: * }>,
 *   nowEt?: Date | string,
 *   days?: number,
 *   maxNotNeeded?: number,
 * }} input
 */
export function planStaleStatusSweep({
  dbRows = [],
  sourceById = {},
  nowEt = new Date(),
  days = STALE_DAYS,
  maxNotNeeded = STALE_NOT_NEEDED_CAP,
} = {}) {
  const todayEt = typeof nowEt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nowEt)
    ? nowEt
    : etTodayKey(nowEt)

  const actions = []
  const summary = emptySummary()
  const cap = Number.isInteger(maxNotNeeded) && maxNotNeeded >= 0
    ? maxNotNeeded
    : STALE_NOT_NEEDED_CAP

  for (const row of dbRows || []) {
    const info = classifyStaleCandidate(row, { todayEt, days })
    if (!info.candidate) continue
    summary.candidates += 1
    if (hasProtectedPicks(rowDependents(row))) {
      const action = makeAction(row, { action: 'report', reason: 'protected_has_picks' })
      actions.push(action)
      tally(summary, action)
      continue
    }
    const source = sourceById[row.id] || { state: 'unavailable' }
    const resolved = resolveStaleSource(source, row)
    const action = makeAction(row, resolved)
    actions.push(action)
    tally(summary, action)
  }

  const notNeeded = actions.filter((action) => action.action === 'set_not_needed')
  if (notNeeded.length > cap) {
    let kept = 0
    for (const action of actions) {
      if (action.action !== 'set_not_needed') continue
      if (kept < cap) {
        kept += 1
        continue
      }
      action.action = 'report'
      action.reason = 'cap_exceeded'
      action.nextStatus = null
    }
    summary.setNotNeeded = cap
    summary.reported += notNeeded.length - cap
    summary.unresolved += notNeeded.length - cap
    summary.capped += notNeeded.length - cap
  }

  return { actions, summary, todayEt, days, maxNotNeeded: cap }
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

export function createEspnFetchCache() {
  return new Map()
}

async function cachedJson(url, fetchImpl, cache) {
  if (cache.has(url)) return cache.get(url)
  const pending = fetchJson(url, fetchImpl)
  cache.set(url, pending)
  return pending
}

export async function fetchStaleSources(rows, {
  fetchImpl = fetch,
  logger = console,
  cache = null,
} = {}) {
  const sourceById = {}
  const requestCache = cache || createEspnFetchCache()
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
      board = await cachedJson(url, fetchImpl, requestCache)
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

    if (board.data.events.length === 0 && group.length > 0) {
      for (const row of group) sourceById[row.id] = { state: 'empty_unconfirmed' }
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
        sourceById[row.id] = { state: 'not_on_scoreboard' }
        continue
      }
      const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(espnId)}`
      try {
        const summary = await cachedJson(summaryUrl, fetchImpl, requestCache)
        if (summary.statusCode === 404) {
          sourceById[row.id] = { state: 'summary_404', espnGameId: espnId }
          continue
        }
        if (summary.state !== 'ok' || !summary.data) {
          sourceById[row.id] = { state: summary.state || 'unavailable' }
          continue
        }
        const mapped = mapEspnSweepSummary(summary.data)
        sourceById[row.id] = mapped.state === 'ok' ? mapped : { state: mapped.state || 'unavailable' }
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
  ignoreQuietPeriod = false,
  alreadyToday = undefined,
} = {}) {
  if (!ignoreQuietPeriod && !canApplyReconcile(now)) {
    logger.warn?.('Refuse --apply-stale during ops quiet window (:05–:15 ET)')
    return {
      refused: true,
      reason: 'ops_quiet_period',
      applied: [],
      skipped: [],
      errors: [],
      deleteCalled: false,
    }
  }

  const applied = []
  const skipped = []
  const errors = []
  const writes = (plan?.actions || []).filter((action) => WRITE_ACTIONS.has(action.action))
  const notNeededWrites = writes.filter((action) => action.action === 'set_not_needed')

  let dailyAlready = alreadyToday
  let blockNotNeeded = false
  if (notNeededWrites.length > 0 && dailyAlready === undefined) {
    try {
      const dayStart = etDayStartIso(etTodayKey(now))
      if (!supabase || !dayStart) {
        throw new Error('retire_count_unavailable: missing client or day start')
      }
      dailyAlready = await countNotNeededRetiresSince(supabase, dayStart)
    } catch (error) {
      logger.warn?.(`stale sweep skipped not_needed writes: ${error.message}`)
      blockNotNeeded = true
    }
  }

  const remaining = Math.max(0, STALE_NOT_NEEDED_CAP - Number(dailyAlready || 0))
  let notNeededWritten = 0

  for (const action of writes) {
    if (hasProtectedPicks(action.dependents)) {
      skipped.push({ id: action.id, reason: 'protected_has_picks' })
      continue
    }
    if (action.action === 'set_not_needed') {
      if (blockNotNeeded) {
        skipped.push({ id: action.id, reason: 'retire_count_unavailable' })
        continue
      }
      if (notNeededWritten >= remaining || notNeededWritten >= STALE_NOT_NEEDED_CAP) {
        skipped.push({ id: action.id, reason: 'daily_cap_exceeded' })
        continue
      }
    }
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
      if (action.action === 'set_not_needed') notNeededWritten += 1
    } catch (error) {
      logger.error?.(`stale update error ${action.id}: ${error.message}`)
      errors.push({ id: action.id, error: error.message })
    }
  }

  return { applied, skipped, errors, deleteCalled: false, refused: false }
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
  espnCache = undefined,
  ignoreQuietPeriod = false,
} = {}) {
  const todayEt = etTodayKey(now)
  let rows = dbRows
  if (rows === undefined) {
    if (!supabase) throw new Error('supabase client is required')
    rows = await loadStaleGameRows(supabase, { nowEt: todayEt, days })
    try {
      const counts = await loadReconcileDependents(supabase, rows.map((row) => row.id))
      rows = attachDependents(rows, counts)
    } catch (error) {
      logger.warn?.(`stale sweep dependents unavailable: ${error.message}`)
    }
  }

  const candidates = (rows || []).filter((row) => classifyStaleCandidate(row, {
    todayEt,
    days,
  }).candidate)

  const cache = espnCache || createEspnFetchCache()
  const sources = sourceById === undefined
    ? await fetchStaleSources(candidates, { fetchImpl, logger, cache })
    : sourceById

  const plan = planStaleStatusSweep({
    dbRows: candidates,
    sourceById: sources,
    nowEt: todayEt,
    days,
  })

  logger.log?.(formatStalePlanTable(plan.actions))
  const summary = plan.summary
  logger.log?.(
    `stale sweep: candidates=${summary.candidates} final=${summary.setFinal} postponed=${summary.setPostponed} suspended=${summary.setSuspended} not_needed=${summary.setNotNeeded} protected=${summary.protected} unresolved=${summary.unresolved} dryRun=${!apply}`,
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

  const write = await applyStaleStatusPlan(supabase, plan, { now, logger, ignoreQuietPeriod })
  result.apply = !write.refused
  result.dryRun = Boolean(write.refused)
  result.applied = write.applied
  result.skipped = write.skipped
  result.errors = write.errors
  result.refused = write.refused
  result.reason = write.reason
  return { ...result, exitCode: write.errors.length || write.refused ? 1 : 0 }
}
