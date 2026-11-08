import { sanitizedErrorMessage } from './sanitize-error.js'
/**
 * Delete games outside the current MLB/NHL day and NFL week.
 * Odds, EdgeSnapshot, and NFLGameData go first because of foreign keys.
 *
 * Deletes are refused unless this run holds the cleanup lock, the live
 * ET clock is outside :05–:15 at each archive write and each table delete,
 * every Game and Odds page was read without error, and every retained Odds
 * row was copied onto ClosingOdds and read back with the same price, line,
 * and timestamps. Odds deletes use those source ids, not game_id. Date,
 * status, and lastUpdate are read again before EdgeSnapshot, NFLGameData,
 * and Game deletes. The Game delete repeats date, status, and lastUpdate.
 * Any failure, a lost lock, a timed-out call, or a quiet-window hit stops
 * every delete that has not already run.
 *
 * The lock lease is 2 minutes. A 20 second heartbeat runs while the event
 * loop is free, including during a call. A stalled loop can miss those
 * heartbeats, and the lease can then expire during a call. Aborting the
 * HTTP client does not cancel the Postgres statement. On a client timeout
 * the run stops heartbeating and does not release the lock. The lease
 * expires on its own, after the server statement_timeout.
 *
 * This client cannot SET statement_timeout. PostgREST has no session SET,
 * and SET LOCAL in an RPC ends when that RPC returns, so it does not cover
 * the next .from() call. Supabase documents the bound for this path
 * (service_role through the client): service_role has no timeout of its
 * own and inherits authenticator's 8s, and a client query cannot be
 * configured above 60s
 * (https://supabase.com/docs/guides/database/postgres/timeouts). Stock
 * Postgres statement_timeout defaults to 0, which disables the timeout,
 * so that default is not the bound. The lease is longer than the 60s cap.
 */

import os from 'os'
import path from 'path'
import { isOpsWriteQuietPeriod } from './closing-line.js'
import {
  closingCopyMatches,
  closingOddsArchiveId,
  CLOSING_ARCHIVE_CHUNK,
  insertClosingOddsArchive,
  selectRetainedOddsRows,
  toClosingOddsArchiveRow,
} from './odds-history-retention.js'
import { acquireSnapshotPassLock, watchSnapshotLock } from './odds-snapshot.js'

export const CLEANUP_SERVER_ROW_CAP = 1000
export const CLEANUP_PAGE_SIZE = 1000
export const CLEANUP_BATCH_SIZE = 50
/** Longest statement_timeout Supabase allows on a client query. See the file comment. */
export const CLEANUP_SERVER_STATEMENT_TIMEOUT_CAP_MS = 60 * 1000
export const CLEANUP_LOCK_STALE_MS = 2 * 60 * 1000
export const CLEANUP_LOCK_RENEW_MS = 20 * 1000
export const CLEANUP_OPERATION_TIMEOUT_MS = 45 * 1000
export const CLEANUP_MAX_PAGES = 10000
const CLOSING_VERIFY_COLUMNS = 'id, game_id, book, market, price_home, price_away, total, spread, snapshot_at, quoted_at'
const CLOSING_VERIFY_COLUMNS_NO_QUOTE = 'id, game_id, book, market, price_home, price_away, total, spread, snapshot_at'

const GAME_ARCHIVE_COLUMNS = 'id, sport, date, status, lastUpdate, homeScore, awayScore, homeId, awayId, temperature, windSpeed, windDirection, humidity, probableHomePitcherId, probableAwayPitcherId, homeStartingQB, awayStartingQB, mlbGameId, espnGameId'

export function cleanupLockPath() {
  return path.join(os.tmpdir(), 'odds-on-deck-cleanup-old-games')
}

export function acquireCleanupRunLock(options = {}) {
  return acquireSnapshotPassLock({
    persistPath: options.persistPath || cleanupLockPath(),
    filesystem: options.filesystem,
    persist: options.persist !== false,
    staleMs: options.staleMs || CLEANUP_LOCK_STALE_MS,
  })
}

function logLine(log, level, message) {
  const fn = log?.[level] || log?.log
  if (typeof fn === 'function') fn(message)
}

function scheduleWindows(started) {
  const today = new Date(started.getFullYear(), started.getMonth(), started.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayOfWeek = started.getDay()
  const weekStart = new Date(today)
  if (dayOfWeek !== 0) weekStart.setDate(today.getDate() - dayOfWeek)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  weekEnd.setHours(23, 59, 59, 999)
  return { today, tomorrow, weekStart, weekEnd }
}

function withAbort(query, signal) {
  if (signal && query && typeof query.abortSignal === 'function') return query.abortSignal(signal)
  return query
}

function sameClock(left, right) {
  if (left == null && right == null) return true
  const a = left instanceof Date ? left.getTime() : Date.parse(left)
  const b = right instanceof Date ? right.getTime() : Date.parse(right)
  return Number.isFinite(a) && a === b
}

function outsideCleanupWindow(game, windows) {
  const date = game?.date instanceof Date ? game.date.toISOString() : String(game?.date || '')
  if (!date) return false
  const sport = String(game?.sport || '').toLowerCase()
  if (sport === 'nfl') {
    return date < windows.weekStart.toISOString() || date >= windows.weekEnd.toISOString()
  }
  return date < windows.today.toISOString() || date >= windows.tomorrow.toISOString()
}

async function countRows(supabase, table, apply, awaitOp = (fn) => fn(), idColumn = 'id') {
  const result = await awaitOp((signal) => {
    let query = supabase.from(table).select(idColumn, { count: 'exact', head: true })
    query = apply(query) || query
    return withAbort(query, signal)
  })
  const { count, error } = result || {}
  if (error) return { count: null, error }
  if (!Number.isFinite(count)) return { count: null, error: new Error(`${table} count missing`) }
  return { count, error: null }
}

async function countIdChunks(supabase, table, ids, pageSize, awaitOp) {
  let total = 0
  for (let i = 0; i < ids.length; i += pageSize) {
    const chunk = ids.slice(i, i + pageSize)
    const counted = await countRows(
      supabase,
      table,
      (query) => query.in('id', chunk),
      awaitOp,
    )
    if (counted.error || !Number.isFinite(counted.count)) return counted
    total += counted.count
  }
  return { count: total, error: null }
}

async function readKeyset(supabase, table, columns, apply, pageSize, options = {}) {
  const beat = options.beat
  const awaitOp = options.awaitOp || ((fn) => fn())
  const idColumn = options.idColumn || 'id'
  const counted = await countRows(supabase, table, apply, awaitOp, idColumn)
  if (counted.error || !Number.isFinite(counted.count)) {
    return { rows: null, error: counted.error || new Error(`${table} count missing`) }
  }
  let requested = Math.min(pageSize, CLEANUP_SERVER_ROW_CAP)
  const rows = []
  const seen = new Set()
  let cursor = null
  for (let page = 0; page < CLEANUP_MAX_PAGES; page += 1) {
    if (typeof beat === 'function' && beat() === false) {
      return { rows: null, error: new Error('lost cleanup lock'), reason: 'lock' }
    }
    const result = await awaitOp((signal) => {
      let query = supabase.from(table).select(columns)
      query = apply(query) || query
      if (cursor != null) query = query.gt(idColumn, cursor)
      query = query.order(idColumn, { ascending: true })
      return withAbort(query, signal).limit(requested)
    })
    const { data, error } = result || {}
    if (error) return { rows: null, error }
    const batch = Array.isArray(data) ? data : []
    if (batch.length === 0) {
      if (rows.length !== counted.count) {
        return { rows: null, error: new Error(`${table} read ended early (${rows.length}/${counted.count})`) }
      }
      return { rows, error: null }
    }
    for (const row of batch) {
      const id = row?.[idColumn]
      if (id == null || seen.has(id)) {
        return { rows: null, error: new Error(`incomplete ${table} read`) }
      }
      seen.add(id)
      rows.push(row)
    }
    if (rows.length === counted.count) return { rows, error: null }
    // A short page is a lower server cap. Keep the keyset going at that size.
    if (batch.length < requested) requested = batch.length
    cursor = batch[batch.length - 1][idColumn]
  }
  return { rows: null, error: new Error(`${table} read exceeded page cap`) }
}

async function verifyIds(supabase, table, ids, pageSize, options) {
  const unique = [...new Set(ids.filter((id) => id != null))]
  const seen = new Set()
  for (let i = 0; i < unique.length; i += pageSize) {
    const chunk = unique.slice(i, i + pageSize)
    const read = await readKeyset(
      supabase,
      table,
      'id',
      (query) => query.in('id', chunk),
      pageSize,
      options,
    )
    if (read.reason === 'lock') return { ok: false, found: seen.size, expected: unique.length, error: read.error, reason: 'lock' }
    if (read.error || !read.rows) {
      return { ok: false, found: seen.size, expected: unique.length, error: read.error }
    }
    for (const row of read.rows) {
      if (chunk.includes(row.id)) seen.add(row.id)
    }
  }
  return {
    ok: seen.size === unique.length,
    found: seen.size,
    expected: unique.length,
    error: seen.size === unique.length
      ? null
      : new Error(`${table} verify found ${seen.size} of ${unique.length}`),
  }
}

async function verifyClosingCopies(supabase, sources, pageSize, quoteWritten, options) {
  const columns = quoteWritten ? CLOSING_VERIFY_COLUMNS : CLOSING_VERIFY_COLUMNS_NO_QUOTE
  const pending = new Map(sources.map((source) => [closingOddsArchiveId(source.id), source]))
  const ids = [...pending.keys()]
  for (let i = 0; i < ids.length; i += pageSize) {
    const chunk = ids.slice(i, i + pageSize)
    const read = await readKeyset(
      supabase,
      'ClosingOdds',
      columns,
      (query) => query.in('id', chunk),
      pageSize,
      options,
    )
    if (read.reason === 'lock') return { ok: false, reason: 'lock', error: read.error }
    if (read.error || !read.rows) return { ok: false, reason: 'odds-archive', error: read.error }
    for (const stored of read.rows) {
      const source = pending.get(stored.id)
      if (!source || !closingCopyMatches(source, stored, { quoteWritten })) {
        return {
          ok: false,
          reason: 'odds-archive',
          error: new Error(`ClosingOdds ${stored?.id || 'row'} does not match the source odds`),
        }
      }
      pending.delete(stored.id)
    }
  }
  if (pending.size > 0) {
    return {
      ok: false,
      reason: 'odds-archive',
      error: new Error(`ClosingOdds verify missing ${pending.size} row(s)`),
    }
  }
  return { ok: true, reason: null, error: null }
}

function archiveGameRow(game) {
  return {
    id: game.id,
    sport: game.sport,
    date: game.date,
    home_team: game.homeId || 'UNK',
    away_team: game.awayId || 'UNK',
    home_score: game.homeScore,
    away_score: game.awayScore,
    status: game.status,
    weather_temp: game.temperature,
    weather_wind: game.windSpeed,
    weather_dir: game.windDirection,
    weather_humid: game.humidity,
    home_pitcher: game.probableHomePitcherId,
    away_pitcher: game.probableAwayPitcherId,
    home_qb: game.homeStartingQB,
    away_qb: game.awayStartingQB,
    mlb_game_id: game.mlbGameId,
    espn_game_id: game.espnGameId,
  }
}

/**
 * @returns {Promise<{ status: string, exitCode: number, deletedGames: number, reason: string | null }>}
 */
export async function runCleanupOldGames({
  supabase,
  now = () => new Date(),
  acquireLock = acquireCleanupRunLock,
  log = console,
  pageSize = CLEANUP_PAGE_SIZE,
  batchSize = CLEANUP_BATCH_SIZE,
  archiveChunkSize = CLOSING_ARCHIVE_CHUNK,
  renewEveryMs = CLEANUP_LOCK_RENEW_MS,
  operationTimeoutMs = CLEANUP_OPERATION_TIMEOUT_MS,
} = {}) {
  if (CLEANUP_LOCK_STALE_MS <= CLEANUP_SERVER_STATEMENT_TIMEOUT_CAP_MS) {
    throw new Error('cleanup lock lease must be longer than the server statement timeout cap')
  }
  const lock = acquireLock()
  if (!lock?.acquired) {
    logLine(log, 'log', 'Cleanup lock is held. Not reading or deleting.')
    return { status: 'locked', exitCode: 0, deletedGames: 0, reason: 'lock' }
  }

  let deletedGames = 0
  let retainedCount = 0
  let unknownCount = 0
  let lockEligibleCount = 0
  let archiveGrowth = 0
  let stopReason = null
  let leaveLockHeld = false
  let currentAbort = null
  let wakeAbort = null
  let stopRenewal = () => {}
  const lose = (reason) => {
    if (stopReason) return
    stopReason = reason
    if (reason === 'timeout') {
      // The SQL can still be running. Stop heartbeats and keep the lease.
      leaveLockHeld = true
      stopRenewal()
    }
    currentAbort?.abort()
    wakeAbort?.()
  }
  stopRenewal = watchSnapshotLock(lock, {
    intervalMs: renewEveryMs,
    onLost: () => lose('lock'),
  })
  const beat = () => {
    if (stopReason) return false
    if (typeof lock.heartbeat !== 'function') return true
    if (lock.heartbeat() === false) {
      lose('lock')
      return false
    }
    return true
  }
  async function awaitOp(make) {
    if (stopReason) {
      const error = new Error(stopReason === 'timeout' ? 'cleanup operation timed out' : 'lost cleanup lock')
      error.reason = stopReason
      throw error
    }
    const controller = new AbortController()
    currentAbort = controller
    let timer
    const aborted = new Promise((resolve) => {
      wakeAbort = () => resolve({ aborted: true, reason: stopReason || 'lock' })
      // Stops this process from waiting. abortSignal does not cancel the SQL.
      timer = setTimeout(() => {
        lose('timeout')
        resolve({ aborted: true, reason: 'timeout' })
      }, operationTimeoutMs)
    })
    const work = Promise.resolve()
      .then(() => make(controller.signal))
      .then((value) => {
        if (stopReason || controller.signal.aborted) {
          return { aborted: true, reason: stopReason || 'timeout' }
        }
        return { aborted: false, value }
      })
      .catch((error) => {
        if (stopReason) return { aborted: true, reason: stopReason }
        throw error
      })
    try {
      const outcome = await Promise.race([work, aborted])
      if (outcome.aborted) {
        const reason = stopReason || outcome.reason || 'lock'
        if (!stopReason) stopReason = reason
        const error = new Error(reason === 'timeout' ? 'cleanup operation timed out' : 'lost cleanup lock')
        error.reason = reason
        throw error
      }
      return outcome.value
    } finally {
      clearTimeout(timer)
      if (currentAbort === controller) currentAbort = null
    }
  }
  const pageOptions = { beat, awaitOp }
  const halted = (reason) => {
    if (reason !== 'lock' && reason !== 'timeout') return null
    return { status: 'failed', exitCode: 1, deletedGames, reason }
  }
  const gateWrite = () => {
    if (stopReason === 'timeout' || stopReason === 'lock' || beat() === false) {
      const reason = stopReason === 'timeout' ? 'timeout' : 'lock'
      logLine(
        log,
        'error',
        reason === 'timeout'
          ? 'A cleanup call exceeded the operation timeout. Stopping later writes and deletes.'
          : 'Lost the cleanup lock. Stopping later writes and deletes.',
      )
      return { status: 'failed', exitCode: 1, deletedGames, reason }
    }
    if (isOpsWriteQuietPeriod(now())) {
      logLine(log, 'log', 'ET quiet window (:05–:15) before a write. Stopping later writes and deletes.')
      return { status: 'quiet', exitCode: 0, deletedGames, reason: 'quiet' }
    }
    return null
  }

  try {
    const started = now()
    if (isOpsWriteQuietPeriod(now())) {
      logLine(log, 'log', 'ET quiet window (:05–:15). Not reading or deleting.')
      return { status: 'quiet', exitCode: 0, deletedGames: 0, reason: 'quiet' }
    }

    const windows = scheduleWindows(started)
    const { today, tomorrow, weekStart, weekEnd } = windows
    logLine(log, 'log', '🧹 CLEANUP OLD GAMES')
    logLine(log, 'log', `MLB/NHL outside ${today.toISOString()} – ${tomorrow.toISOString()}`)
    logLine(log, 'log', `NFL outside ${weekStart.toISOString()} – ${weekEnd.toISOString()}`)

    const specs = [
      { sport: 'mlb', filter: `date.lt.${today.toISOString()},date.gte.${tomorrow.toISOString()}` },
      { sport: 'nhl', filter: `date.lt.${today.toISOString()},date.gte.${tomorrow.toISOString()}` },
      { sport: 'nfl', filter: `date.lt.${weekStart.toISOString()},date.gte.${weekEnd.toISOString()}` },
    ]

    const oldGames = []
    for (const spec of specs) {
      const read = await readKeyset(
        supabase,
        'Game',
        'id, date, sport',
        (query) => query.eq('sport', spec.sport).or(spec.filter),
        pageSize,
        pageOptions,
      )
      const discoveryStop = halted(read.reason)
      if (discoveryStop) return discoveryStop
      if (read.error || !read.rows) {
        logLine(log, 'error', `Game read failed for ${spec.sport}: ${sanitizedErrorMessage(read.error) || 'no rows'}. Not deleting.`)
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'game-read' }
      }
      oldGames.push(...read.rows.filter((game) => game?.id))
    }

    if (oldGames.length === 0) {
      logLine(log, 'log', 'No old games to clean up.')
      return { status: 'empty', exitCode: 0, deletedGames: 0, reason: null }
    }

    const ready = []
    for (let i = 0; i < oldGames.length; i += batchSize) {
      const batch = oldGames.slice(i, i + batchSize).map((game) => game.id)
      const full = await readKeyset(
        supabase,
        'Game',
        GAME_ARCHIVE_COLUMNS,
        (query) => query.in('id', batch),
        pageSize,
        pageOptions,
      )
      const fullStop = halted(full.reason)
      if (fullStop) return fullStop
      if (full.error || !full.rows || full.rows.length !== batch.length) {
        logLine(log, 'error', `Full Game read failed for a batch (${full.rows?.length ?? 0}/${batch.length}). Not deleting.`)
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'game-read' }
      }
      if (full.rows.some((game) => !Number.isFinite(Date.parse(game?.date)))) {
        logLine(log, 'error', 'A game start does not parse. Not deleting.')
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'retention' }
      }

      const gameRows = full.rows.map(archiveGameRow)
      for (let offset = 0; offset < gameRows.length; offset += archiveChunkSize) {
        const refused = gateWrite()
        if (refused) return refused
        const { error: archErr } = await awaitOp((signal) => withAbort(supabase.from('ArchivedGame'), signal)
          .upsert(gameRows.slice(offset, offset + archiveChunkSize), { onConflict: 'id' }))
        if (archErr) {
          logLine(log, 'error', `Archive games error: ${sanitizedErrorMessage(archErr)}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'game-archive' }
        }
      }
      const gamesVerified = await verifyIds(supabase, 'ArchivedGame', batch, pageSize, pageOptions)
      const gamesStop = halted(gamesVerified.reason)
      if (gamesStop) return gamesStop
      if (!gamesVerified.ok) {
        logLine(log, 'error', `ArchivedGame verify ${gamesVerified.found}/${gamesVerified.expected}. Not deleting.`)
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'game-archive' }
      }

      const odds = await readKeyset(
        supabase,
        'Odds',
        '*',
        (query) => query.in('gameId', batch),
        pageSize,
        pageOptions,
      )
      const oddsStop = halted(odds.reason)
      if (oddsStop) return oddsStop
      if (odds.error || !odds.rows) {
        logLine(log, 'error', `Odds read failed: ${sanitizedErrorMessage(odds.error) || 'no rows'}. Not deleting.`)
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-read' }
      }
      const seenOdds = new Set()
      for (const row of odds.rows) {
        if (row?.id == null || seenOdds.has(row.id)) {
          logLine(log, 'error', 'Odds read returned a missing or duplicate id. Not deleting.')
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-read' }
        }
        seenOdds.add(row.id)
      }

      const plan = selectRetainedOddsRows(odds.rows, full.rows)
      if (plan.blockedGameIds.length > 0) {
        logLine(log, 'error', `Retention blocked games ${plan.blockedGameIds.join(', ')}. Not deleting.`)
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'retention' }
      }
      retainedCount += plan.counts?.retained || 0
      unknownCount += plan.counts?.quoteTimeUnknown || 0
      lockEligibleCount += plan.counts?.lockEligible || 0
      const flagged = plan.rejected.filter((item) => item.reason === 'quote_after_capture')
      if (flagged.length > 0) {
        logLine(log, 'log', `Flagged ${flagged.length} odds row(s) with quote time after capture.`)
      }
      if (plan.unknownQuote?.length > 0) {
        logLine(log, 'log', `Flagged ${plan.unknownQuote.length} odds row(s) quote-time-unknown. They stay in the archive and are not lock-eligible.`)
      }

      const sportFor = (gameId) => full.rows.find((game) => game.id === gameId)?.sport || 'unknown'
      const closingRows = []
      const retainedSources = []
      for (const row of plan.rows) {
        const archived = toClosingOddsArchiveRow(row, sportFor(row.gameId))
        if (!archived?.id) {
          logLine(log, 'error', 'Retained odds row has no archive id. Not deleting.')
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        closingRows.push(archived)
        retainedSources.push(row)
      }
      let quoteWritten = true
      if (closingRows.length > 0) {
        const archiveIds = closingRows.map((row) => row.id)
        const beforeArchive = await countIdChunks(supabase, 'ClosingOdds', archiveIds, pageSize, awaitOp)
        if (beforeArchive.error || !Number.isFinite(beforeArchive.count)) {
          logLine(log, 'error', `ClosingOdds count failed before archive: ${sanitizedErrorMessage(beforeArchive.error) || 'no count'}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        const archived = await insertClosingOddsArchive(supabase, closingRows, {
          chunkSize: archiveChunkSize,
          beforeWrite: () => gateWrite(),
          runWrite: (fn) => awaitOp((signal) => fn(signal)),
        })
        const afterArchive = await countIdChunks(supabase, 'ClosingOdds', archiveIds, pageSize, awaitOp)
        if (afterArchive.error || !Number.isFinite(afterArchive.count)) {
          logLine(log, 'error', `ClosingOdds count failed after archive: ${sanitizedErrorMessage(afterArchive.error) || 'no count'}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        archiveGrowth += afterArchive.count - beforeArchive.count
        if (!archived.ok || archived.ids.length !== closingRows.length) {
          if (archived.reason === 'quiet') {
            return { status: 'quiet', exitCode: 0, deletedGames: 0, reason: 'quiet' }
          }
          const archiveStop = halted(archived.reason)
          if (archiveStop) return archiveStop
          logLine(log, 'error', `Archive odds history error: ${sanitizedErrorMessage(archived.error) || 'short write'}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        quoteWritten = archived.wroteQuoteTime
        const verified = await verifyClosingCopies(supabase, retainedSources, pageSize, quoteWritten, pageOptions)
        if (!verified.ok) {
          const verifyStop = halted(verified.reason)
          if (verifyStop) return verifyStop
          logLine(log, 'error', `ClosingOdds verify failed: ${sanitizedErrorMessage(verified.error) || 'mismatch'}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        const quoteNote = quoteWritten ? 'with quoted_at' : 'without quoted_at (column missing)'
        logLine(log, 'log', `Archived ${closingRows.length} lock/close odds rows ${quoteNote}`)
      }
      ready.push({
        gameIds: batch,
        oddsIds: [...seenOdds],
        games: full.rows.map((game) => ({
          id: game.id,
          sport: game.sport,
          date: game.date,
          status: game.status,
          lastUpdate: game.lastUpdate ?? null,
        })),
      })
    }

    async function deletePresentIds(table, idColumn, filterColumn, filterIds) {
      if (!filterIds.length) return null
      const refused = gateWrite()
      if (refused) return refused
      const read = await readKeyset(
        supabase,
        table,
        idColumn,
        (query) => query.in(filterColumn, filterIds),
        pageSize,
        { ...pageOptions, idColumn },
      )
      const stop = halted(read.reason)
      if (stop) return stop
      if (read.error || !read.rows) {
        logLine(log, 'error', `${table} re-read failed: ${sanitizedErrorMessage(read.error) || 'no rows'}. Stopping later deletes.`)
        return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
      }
      const ids = read.rows.map((row) => row[idColumn]).filter((id) => id != null)
      for (let offset = 0; offset < ids.length; offset += pageSize) {
        const refusedChunk = gateWrite()
        if (refusedChunk) return refusedChunk
        const chunk = ids.slice(offset, offset + pageSize)
        const deleted = await awaitOp((signal) => withAbort(
          supabase.from(table).delete().in(idColumn, chunk),
          signal,
        ).select('*', { count: 'exact', head: true }))
        if (deleted?.error) {
          logLine(log, 'error', `Error deleting ${table}: ${sanitizedErrorMessage(deleted.error)}. Stopping later deletes.`)
          return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
        }
      }
      return null
    }

    for (const batch of ready) {
      for (let offset = 0; offset < batch.oddsIds.length; offset += pageSize) {
        const refused = gateWrite()
        if (refused) return refused
        const idChunk = batch.oddsIds.slice(offset, offset + pageSize)
        const deleted = await awaitOp((signal) => withAbort(
          supabase.from('Odds').delete().in('id', idChunk),
          signal,
        ).select('*', { count: 'exact', head: true }))
        if (deleted?.error) {
          logLine(log, 'error', `Error deleting Odds: ${sanitizedErrorMessage(deleted.error)}. Stopping later deletes.`)
          return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
        }
      }

      const refused = gateWrite()
      if (refused) return refused
      const fresh = await readKeyset(
        supabase,
        'Game',
        'id, date, sport, status, lastUpdate',
        (query) => query.in('id', batch.gameIds),
        pageSize,
        pageOptions,
      )
      const freshStop = halted(fresh.reason)
      if (freshStop) return freshStop
      if (fresh.error || !fresh.rows) {
        logLine(log, 'error', `Game re-read failed: ${sanitizedErrorMessage(fresh.error) || 'no rows'}. Stopping later deletes.`)
        return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
      }
      const freshById = new Map(fresh.rows.map((game) => [game.id, game]))
      const stillOld = []
      for (const original of batch.games) {
        const game = freshById.get(original.id)
        const changed = !game
          || !sameClock(game.date, original.date)
          || String(game.status || '') !== String(original.status || '')
          || !sameClock(game.lastUpdate, original.lastUpdate)
          || !outsideCleanupWindow(game, windows)
        if (changed) {
          logLine(log, 'log', `Skipping ${original.id}: date, status, or lastUpdate changed before the non-odds delete.`)
          continue
        }
        stillOld.push(original.id)
      }

      const edgeStop = await deletePresentIds('EdgeSnapshot', 'id', 'gameId', stillOld)
      if (edgeStop) return edgeStop
      const nflStop = await deletePresentIds('NFLGameData', 'gameId', 'gameId', stillOld)
      if (nflStop) return nflStop
      for (const original of batch.games) {
        if (!stillOld.includes(original.id)) continue
        const gameRefused = gateWrite()
        if (gameRefused) return gameRefused
        const deleted = await awaitOp((signal) => {
          let query = supabase.from('Game').delete().eq('id', original.id)
          query = original.date == null ? query.is('date', null) : query.eq('date', original.date)
          query = original.status == null ? query.is('status', null) : query.eq('status', original.status)
          query = original.lastUpdate == null ? query.is('lastUpdate', null) : query.eq('lastUpdate', original.lastUpdate)
          return withAbort(query, signal).select('*', { count: 'exact', head: true })
        })
        if (deleted?.error) {
          logLine(log, 'error', `Error deleting Game: ${sanitizedErrorMessage(deleted.error)}. Stopping later deletes.`)
          return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
        }
        if (!Number.isFinite(deleted?.count)) {
          logLine(log, 'error', 'Game delete did not report a count. Stopping later deletes.')
          return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
        }
        deletedGames += deleted.count
        if (deleted.count === 0) {
          logLine(log, 'log', `Game ${original.id} no longer matched date, status, and lastUpdate. Left in place.`)
        }
      }
    }

    logLine(log, 'log', `Cleanup complete. Deleted ${deletedGames} old games.`)
    return { status: 'ok', exitCode: 0, deletedGames, reason: null }
  } catch (error) {
    const reason = error?.reason === 'lock' || error?.reason === 'timeout' ? error.reason : 'throw'
    logLine(log, 'error', `Cleanup failed: ${sanitizedErrorMessage(error) || error}. Not continuing deletes.`)
    return { status: 'failed', exitCode: 1, deletedGames, reason }
  } finally {
    logLine(
      log,
      'log',
      `Retained ${retainedCount} odds rows (${unknownCount} quote-time-unknown, not lock-eligible; ${lockEligibleCount} lock-eligible). Quote-time-unknown history stays until Anthony approves deleting it.`,
    )
    logLine(log, 'log', `ClosingOdds archive grew by ${archiveGrowth} row(s) observed this run.`)
    stopRenewal()
    if (leaveLockHeld) {
      logLine(log, 'error', 'Client timed out. Heartbeats stopped. The cleanup lock stays until the lease expires so the server statement can finish.')
    } else {
      lock.release?.()
    }
  }
}
