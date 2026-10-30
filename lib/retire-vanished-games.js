/**
 * Retire scheduled Game rows that vanished from the source slate
 * fetch-fresh-games just pulled.
 *
 * Unlike the dual-source MLB reconcile planner, this uses only the
 * scoreboard that run already fetched, for every sport, and only for
 * dates that fetch fully covered. Retire means status='not_needed'
 * (same convention as lib/game-reconcile.js). Never deletes.
 */

import {
  DEFAULT_RECONCILE_CAPS,
  applyReconcilePlan,
  attachDependents,
  classifyReconcileCandidate,
  hasProtectedPicks,
  loadReconcileDependents,
  loadReconcileGameRows,
  parseGameIdParts,
  rowEtDate,
  shiftEtDate,
  unorderedPairKey,
} from './game-reconcile.js'
import {
  isDeadStatus,
  isFinalStatus,
  isLiveStatus,
  isPreStartStatus,
} from './game-status.js'

export const VANISH_RETIRE_REASON = 'vanished_from_source'

export function classifyEspnScoreboardPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
    return { state: 'malformed', events: [] }
  }
  return {
    state: payload.events.length ? 'ok' : 'empty',
    events: payload.events,
  }
}

export function espnDateParamToKey(dateParam) {
  const raw = String(dateParam || '').replace(/-/g, '')
  if (!/^\d{8}$/.test(raw)) return null
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

export function attachFetchMeta(games, { fetchState, coverageByDate } = {}) {
  Object.defineProperty(games, 'fetchState', { value: fetchState, enumerable: false })
  Object.defineProperty(games, 'coverageByDate', {
    value: { ...(coverageByDate || {}) },
    enumerable: false,
  })
  return games
}

export function overallFetchState(coverageByDate, mappedCount) {
  if (Number(mappedCount) > 0) return 'ok'
  const states = Object.values(coverageByDate || {})
  if (states.length === 0) return 'unavailable'
  if (states.every((state) => state === 'unavailable' || state === 'malformed')) {
    return 'unavailable'
  }
  if (states.some((state) => state === 'empty' || state === 'ok')) return 'empty'
  return 'unavailable'
}

export function markCoverageUnavailable(coverageByDate) {
  const next = { ...(coverageByDate || {}) }
  for (const date of Object.keys(next)) {
    next[date] = 'unavailable'
  }
  return next
}

function freezeCaps(caps) {
  const maxRetires = Number(caps?.maxRetires)
  const maxPct = Number(caps?.maxPct)
  const minPctCandidates = Number(caps?.minPctCandidates)
  return {
    maxRetires: Number.isFinite(maxRetires) && maxRetires >= 0
      ? maxRetires
      : DEFAULT_RECONCILE_CAPS.maxRetires,
    maxPct: Number.isFinite(maxPct) && maxPct >= 0 ? maxPct : DEFAULT_RECONCILE_CAPS.maxPct,
    minPctCandidates: Number.isFinite(minPctCandidates) && minPctCandidates >= 0
      ? minPctCandidates
      : DEFAULT_RECONCILE_CAPS.minPctCandidates,
  }
}

function hasNumericScore(value) {
  if (value === null || value === undefined || value === '') return false
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

function coverageState(coverageByDate, date) {
  return String(coverageByDate?.[date] || '').toLowerCase() || null
}

function indexFetchedGames(fetchedGames) {
  const byId = new Set()
  const byEspnId = new Set()
  const byDatePair = new Map()
  const countByDate = new Map()
  for (const game of fetchedGames || []) {
    if (game?.id) byId.add(game.id)
    if (game?.espnGameId) byEspnId.add(String(game.espnGameId))
    const date = rowEtDate(game)
    if (date) countByDate.set(date, (countByDate.get(date) || 0) + 1)
    const parts = parseGameIdParts(game?.id)
    if (parts?.date && parts.awayAbbr && parts.homeAbbr) {
      const pair = unorderedPairKey(parts.awayAbbr, parts.homeAbbr)
      const key = `${parts.date}|${pair}`
      const list = byDatePair.get(key) || []
      list.push(game)
      byDatePair.set(key, list)
    }
  }
  return { byId, byEspnId, byDatePair, countByDate }
}

function sourceHasRow(row, index) {
  if (row?.id && index.byId.has(row.id)) return true
  if (row?.espnGameId && index.byEspnId.has(String(row.espnGameId))) return true
  const parts = parseGameIdParts(row?.id)
  const date = rowEtDate(row)
  if (!parts || !date) return false
  const pair = unorderedPairKey(parts.awayAbbr, parts.homeAbbr)
  return Boolean(pair && (index.byDatePair.get(`${date}|${pair}`) || []).length)
}

function adjacentPairHit(row, index) {
  const parts = parseGameIdParts(row?.id)
  const date = rowEtDate(row)
  if (!parts || !date) return false
  const pair = unorderedPairKey(parts.awayAbbr, parts.homeAbbr)
  if (!pair) return false
  for (const offset of [-1, 1]) {
    const adjacent = shiftEtDate(date, offset)
    if (adjacent && (index.byDatePair.get(`${adjacent}|${pair}`) || []).length) return true
  }
  return false
}

function makeAction(row, { action, reason }) {
  const parts = parseGameIdParts(row.id)
  return {
    id: row.id,
    status: row.status,
    priorStatus: row.status,
    date: rowEtDate(row),
    action,
    reason,
    dependents: { ...(row.dependents || {}) },
    orientation: parts ? `${parts.awayAbbr}_at_${parts.homeAbbr}` : null,
    clearOddsApiEventId: action === 'retire_not_needed',
  }
}

/**
 * A date is safe to retire against only when the fetch fully covered it:
 * HTTP 200 + events array (possibly empty). Failed / malformed dates skip.
 * An explicit empty events:[] may retire; a zero mapped count on an `ok`
 * date does not (mapping failure, not a confirmed empty slate).
 */
export function canRetireOnCoveredDate(state, {
  mappedOnDate = 0,
  dbCandidatesOnDate = 0,
} = {}) {
  const coverage = String(state || '').toLowerCase()
  if (coverage === 'empty') return true
  if (coverage === 'ok' && Number(mappedOnDate) > 0) return true
  if (Number(mappedOnDate) === 0 && Number(dbCandidatesOnDate) > 0 && coverage !== 'empty') {
    return false
  }
  return false
}

export function planVanishedFromFetch({
  dbRows = [],
  fetchedGames = [],
  coverageByDate = {},
  caps = DEFAULT_RECONCILE_CAPS,
} = {}) {
  const coveredDates = Object.keys(coverageByDate || {}).sort()
  const actions = []
  const aborts = []
  const summary = {
    candidates: 0,
    retired: 0,
    skipped: 0,
    protected: 0,
    aborted: 0,
    liveOrFinal: 0,
    uncovered: 0,
  }
  const limits = freezeCaps(caps)

  if (coveredDates.length === 0) {
    aborts.push({ reason: 'no_coverage' })
    summary.aborted += 1
    return { actions, aborts, summary, coveredDates, caps: limits }
  }

  const actionableDates = coveredDates.filter((date) => {
    const state = coverageState(coverageByDate, date)
    return state === 'ok' || state === 'empty'
  })
  if (actionableDates.length === 0) {
    aborts.push({ reason: 'source_unavailable' })
    summary.aborted += 1
    return { actions, aborts, summary, coveredDates, caps: limits }
  }

  const fetchedIndex = indexFetchedGames(fetchedGames)
  const classified = []

  for (const row of dbRows || []) {
    const date = rowEtDate(row)
    if (!date || coverageByDate[date] == null) {
      summary.uncovered += 1
      continue
    }
    if (isDeadStatus(row?.status) || isFinalStatus(row?.status) || isLiveStatus(row?.status)) {
      summary.liveOrFinal += 1
      continue
    }
    const window = classifyReconcileCandidate(row, {
      todayEt: coveredDates[0],
      lastFetchedDate: coveredDates[coveredDates.length - 1],
      includePast: true,
      fetchedDates: coveredDates,
    })
    if (!window.candidate) {
      summary.skipped += 1
      continue
    }
    if (!isPreStartStatus(row?.status)) {
      summary.skipped += 1
      continue
    }
    if (hasNumericScore(row?.homeScore) || hasNumericScore(row?.awayScore)) {
      summary.skipped += 1
      continue
    }
    classified.push({ row, date })
  }

  summary.candidates = classified.length
  const byDate = new Map()
  for (const item of classified) {
    const list = byDate.get(item.date) || []
    list.push(item)
    byDate.set(item.date, list)
  }

  for (const date of coveredDates) {
    const items = byDate.get(date) || []
    const state = coverageState(coverageByDate, date)
    if (state === 'unavailable' || state === 'malformed') {
      aborts.push({
        date,
        reason: 'source_unavailable',
        state,
      })
      summary.aborted += 1
      continue
    }
    const mappedOnDate = fetchedIndex.countByDate.get(date) || 0
    if (!canRetireOnCoveredDate(state, {
      mappedOnDate,
      dbCandidatesOnDate: items.length,
    })) {
      if (items.length > 0) {
        aborts.push({
          date,
          reason: 'empty_fetch_unconfirmed',
          state,
          mappedOnDate,
          dbCandidates: items.length,
        })
        summary.aborted += 1
      }
      continue
    }

    for (const item of items) {
      if (sourceHasRow(item.row, fetchedIndex)) continue
      if (adjacentPairHit(item.row, fetchedIndex)) {
        actions.push(makeAction(item.row, { action: 'report', reason: 'date_drift' }))
        summary.skipped += 1
        continue
      }
      if (hasProtectedPicks(item.row.dependents)) {
        actions.push(makeAction(item.row, { action: 'report', reason: 'protected_has_picks' }))
        summary.protected += 1
        continue
      }
      actions.push(makeAction(item.row, {
        action: 'retire_not_needed',
        reason: VANISH_RETIRE_REASON,
      }))
      summary.retired += 1
    }
  }

  const plannedRetires = actions.filter((action) => action.action === 'retire_not_needed')
  let capHit = null
  if (plannedRetires.length > limits.maxRetires) {
    capHit = {
      reason: 'cap_exceeded',
      retires: plannedRetires.length,
      maxRetires: limits.maxRetires,
    }
  } else {
    for (const date of coveredDates) {
      const dateCandidates = (byDate.get(date) || []).length
      if (!dateCandidates || dateCandidates < limits.minPctCandidates) continue
      const dateRetires = plannedRetires.filter((action) => action.date === date).length
      if (dateRetires / dateCandidates > limits.maxPct) {
        capHit = {
          reason: 'cap_exceeded',
          date,
          retires: dateRetires,
          candidates: dateCandidates,
          maxPct: limits.maxPct,
        }
        break
      }
    }
  }

  if (capHit) {
    aborts.push(capHit)
    summary.aborted += 1
    const kept = actions.filter((action) => action.action !== 'retire_not_needed')
    actions.length = 0
    actions.push(...kept)
    summary.retired = 0
  }

  return { actions, aborts, summary, coveredDates, caps: limits }
}

export function formatVanishedRetireLog(action, sport) {
  return `🪦 Retired ${action.id} as not_needed (${action.reason}) — vanished from ${String(sport || '').toUpperCase()} source on ${action.date}`
}

export async function runRetireVanishedFromFetch({
  sport,
  fetchedGames = [],
  coverageByDate = {},
  supabase,
  logger = console,
  now = new Date(),
  apply = true,
  ignoreQuietPeriod = true,
  caps = DEFAULT_RECONCILE_CAPS,
  dbRows,
} = {}) {
  const coveredDates = Object.keys(coverageByDate || {}).sort()
  if (coveredDates.length === 0) {
    logger.log?.(`⏭️  vanish-retire skipped for ${String(sport || '').toUpperCase()} (no date coverage)`)
    return { skipped: 'no_coverage', applied: [], actions: [], aborts: [], summary: { retired: 0 } }
  }

  let rows = dbRows
  if (rows === undefined) {
    if (!supabase) throw new Error('supabase client is required')
    try {
      rows = await loadReconcileGameRows(supabase, { sport, dates: coveredDates })
      const counts = await loadReconcileDependents(supabase, rows.map((row) => row.id))
      rows = attachDependents(rows, counts)
    } catch (error) {
      logger.warn?.(`⏭️  vanish-retire skipped for ${String(sport || '').toUpperCase()}: ${error.message}`)
      return {
        skipped: 'dependents_unavailable',
        error: error.message,
        applied: [],
        actions: [],
        aborts: [{ reason: 'dependents_unavailable' }],
        summary: { retired: 0 },
      }
    }
  }

  const plan = planVanishedFromFetch({
    dbRows: rows,
    fetchedGames,
    coverageByDate,
    caps,
  })

  for (const abort of plan.aborts) {
    logger.warn?.(
      `⏭️  vanish-retire ${abort.reason}${abort.date ? ` ${abort.date}` : ''}`
      + `${abort.state ? ` state=${abort.state}` : ''}`
      + `${abort.mappedOnDate != null ? ` mapped=${abort.mappedOnDate}` : ''}`,
    )
  }

  const retires = plan.actions.filter((action) => action.action === 'retire_not_needed')
  for (const action of plan.actions) {
    if (action.reason === 'protected_has_picks') {
      logger.log?.(`🛡️  Skip ${action.id}: protected PropValidation / ParlayLeg — not retiring`)
    }
  }
  if (!apply) {
    for (const action of retires) {
      logger.log?.(`🔎 would retire ${action.id} as not_needed (${action.reason}) on ${action.date}`)
    }
  }

  const result = {
    sport,
    apply: false,
    dryRun: !apply,
    ...plan,
    applied: [],
    skipped: [],
    errors: [],
  }

  if (!apply || retires.length === 0) {
    if (retires.length === 0 && plan.aborts.length === 0) {
      logger.log?.(`✅ vanish-retire ${String(sport || '').toUpperCase()}: no vanished scheduled games`)
    }
    return result
  }

  const write = await applyReconcilePlan(supabase, plan, { now, logger, ignoreQuietPeriod })
  result.apply = !write.refused
  result.dryRun = false
  result.applied = write.applied
  result.skipped = write.skipped
  result.errors = write.errors
  result.refused = write.refused
  for (const row of write.applied || []) {
    const action = retires.find((item) => item.id === row.id) || {
      id: row.id,
      reason: VANISH_RETIRE_REASON,
      date: '',
    }
    logger.log?.(formatVanishedRetireLog(action, sport))
  }
  logger.log?.(
    `📊 vanish-retire ${String(sport || '').toUpperCase()}: retired=${write.applied?.length || 0}`
    + ` planned=${retires.length} protected=${plan.summary.protected} aborted=${plan.summary.aborted}`,
  )
  return result
}
