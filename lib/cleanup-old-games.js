/**
 * Delete games outside the current MLB/NHL day and NFL week.
 * Odds, EdgeSnapshot, and NFLGameData go first because of foreign keys.
 *
 * Deletes are refused unless this run holds the cleanup lock, the live
 * ET clock is outside :05–:15 at each archive write and each table delete,
 * every Game and Odds page was read without error, and every retained Odds
 * row was copied onto ClosingOdds and read back with the same price, line,
 * and timestamps. Odds deletes use those source ids, not game_id. Any
 * failure or a quiet-window hit stops every delete that has not already run.
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
import { acquireSnapshotPassLock } from './odds-snapshot.js'

export const CLEANUP_SERVER_ROW_CAP = 1000
export const CLEANUP_PAGE_SIZE = 1000
export const CLEANUP_BATCH_SIZE = 50
export const CLEANUP_LOCK_STALE_MS = 2 * 60 * 1000
export const CLEANUP_MAX_PAGES = 10000
const CLOSING_VERIFY_COLUMNS = 'id, game_id, book, market, price_home, price_away, total, spread, snapshot_at, quoted_at'
const CLOSING_VERIFY_COLUMNS_NO_QUOTE = 'id, game_id, book, market, price_home, price_away, total, spread, snapshot_at'

const GAME_ARCHIVE_COLUMNS = 'id, sport, date, status, homeScore, awayScore, homeId, awayId, temperature, windSpeed, windDirection, humidity, probableHomePitcherId, probableAwayPitcherId, homeStartingQB, awayStartingQB, mlbGameId, espnGameId'

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

async function countRows(supabase, table, apply) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
  query = apply(query) || query
  const { count, error } = await query
  if (error) return { count: null, error }
  if (!Number.isFinite(count)) return { count: null, error: new Error(`${table} count missing`) }
  return { count, error: null }
}

async function readKeyset(supabase, table, columns, apply, pageSize, beat) {
  const counted = await countRows(supabase, table, apply)
  if (counted.error || !Number.isFinite(counted.count)) {
    return { rows: null, error: counted.error || new Error(`${table} count missing`) }
  }
  const requested = Math.min(pageSize, CLEANUP_SERVER_ROW_CAP)
  const rows = []
  const seen = new Set()
  let cursor = null
  for (let page = 0; page < CLEANUP_MAX_PAGES; page += 1) {
    if (typeof beat === 'function' && beat() === false) {
      return { rows: null, error: new Error('lost cleanup lock'), reason: 'lock' }
    }
    let query = supabase.from(table).select(columns)
    query = apply(query) || query
    if (cursor != null) query = query.gt('id', cursor)
    const { data, error } = await query.order('id', { ascending: true }).limit(requested)
    if (error) return { rows: null, error }
    const batch = Array.isArray(data) ? data : []
    if (batch.length === 0) {
      if (rows.length !== counted.count) {
        return { rows: null, error: new Error(`${table} read ended early (${rows.length}/${counted.count})`) }
      }
      return { rows, error: null }
    }
    for (const row of batch) {
      const id = row?.id
      if (id == null || seen.has(id)) {
        return { rows: null, error: new Error(`incomplete ${table} read`) }
      }
      seen.add(id)
      rows.push(row)
    }
    const belowServerCap = batch.length < requested && batch.length < CLEANUP_SERVER_ROW_CAP
    if (belowServerCap) {
      if (rows.length !== counted.count) {
        return { rows: null, error: new Error(`${table} read ended early (${rows.length}/${counted.count})`) }
      }
      return { rows, error: null }
    }
    cursor = batch[batch.length - 1].id
  }
  return { rows: null, error: new Error(`${table} read exceeded page cap`) }
}

async function verifyIds(supabase, table, ids, pageSize, beat) {
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
      beat,
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

async function verifyClosingCopies(supabase, sources, pageSize, quoteWritten, beat) {
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
      beat,
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
} = {}) {
  const lock = acquireLock()
  if (!lock?.acquired) {
    logLine(log, 'log', 'Cleanup lock is held. Not reading or deleting.')
    return { status: 'locked', exitCode: 0, deletedGames: 0, reason: 'lock' }
  }

  let deletedGames = 0
  const beat = () => (typeof lock.heartbeat === 'function' ? lock.heartbeat() : true)
  const gateWrite = () => {
    if (beat() === false) {
      logLine(log, 'error', 'Lost the cleanup lock. Stopping later writes and deletes.')
      return { status: 'failed', exitCode: 1, deletedGames, reason: 'lock' }
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

    const { today, tomorrow, weekStart, weekEnd } = scheduleWindows(started)
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
        beat,
      )
      if (read.reason === 'lock') {
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'lock' }
      }
      if (read.error || !read.rows) {
        logLine(log, 'error', `Game read failed for ${spec.sport}: ${read.error?.message || 'no rows'}. Not deleting.`)
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
        beat,
      )
      if (full.reason === 'lock') {
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'lock' }
      }
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
        const { error: archErr } = await supabase
          .from('ArchivedGame')
          .upsert(gameRows.slice(offset, offset + archiveChunkSize), { onConflict: 'id' })
        if (archErr) {
          logLine(log, 'error', `Archive games error: ${archErr.message}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'game-archive' }
        }
      }
      const gamesVerified = await verifyIds(supabase, 'ArchivedGame', batch, pageSize, beat)
      if (gamesVerified.reason === 'lock') {
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'lock' }
      }
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
        beat,
      )
      if (odds.reason === 'lock') {
        return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'lock' }
      }
      if (odds.error || !odds.rows) {
        logLine(log, 'error', `Odds read failed: ${odds.error?.message || 'no rows'}. Not deleting.`)
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
      const flagged = plan.rejected.filter((item) => item.reason === 'quote_after_capture')
      if (flagged.length > 0) {
        logLine(log, 'log', `Flagged ${flagged.length} odds row(s) with quote time after capture.`)
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
        const archived = await insertClosingOddsArchive(supabase, closingRows, {
          chunkSize: archiveChunkSize,
          beforeWrite: () => gateWrite(),
        })
        if (!archived.ok || archived.ids.length !== closingRows.length) {
          if (archived.reason === 'quiet') {
            return { status: 'quiet', exitCode: 0, deletedGames: 0, reason: 'quiet' }
          }
          if (archived.reason === 'lock') {
            return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'lock' }
          }
          logLine(log, 'error', `Archive odds history error: ${archived.error?.message || 'short write'}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        quoteWritten = archived.wroteQuoteTime
        const verified = await verifyClosingCopies(supabase, retainedSources, pageSize, quoteWritten, beat)
        if (!verified.ok) {
          if (verified.reason === 'lock') {
            return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'lock' }
          }
          logLine(log, 'error', `ClosingOdds verify failed: ${verified.error?.message || 'mismatch'}. Not deleting.`)
          return { status: 'failed', exitCode: 1, deletedGames: 0, reason: 'odds-archive' }
        }
        const quoteNote = quoteWritten ? 'with quoted_at' : 'without quoted_at (column missing)'
        logLine(log, 'log', `Archived ${closingRows.length} lock/close odds rows ${quoteNote}`)
      }
      ready.push({ gameIds: batch, oddsIds: [...seenOdds] })
    }

    const laterDeletes = [
      ['EdgeSnapshot', 'gameId', 'gameIds'],
      ['NFLGameData', 'gameId', 'gameIds'],
      ['Game', 'id', 'gameIds'],
    ]
    for (const batch of ready) {
      for (let offset = 0; offset < batch.oddsIds.length; offset += pageSize) {
        const refused = gateWrite()
        if (refused) return refused
        const idChunk = batch.oddsIds.slice(offset, offset + pageSize)
        const deleted = await supabase
          .from('Odds')
          .delete()
          .in('id', idChunk)
          .select('*', { count: 'exact', head: true })
        if (deleted?.error) {
          logLine(log, 'error', `Error deleting Odds: ${deleted.error.message}. Stopping later deletes.`)
          return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
        }
      }
      for (const [table, column, key] of laterDeletes) {
        const refused = gateWrite()
        if (refused) return refused
        const deleted = await supabase
          .from(table)
          .delete()
          .in(column, batch[key])
          .select('*', { count: 'exact', head: true })
        if (deleted?.error) {
          logLine(log, 'error', `Error deleting ${table}: ${deleted.error.message}. Stopping later deletes.`)
          return { status: 'failed', exitCode: 1, deletedGames, reason: 'delete' }
        }
        if (table === 'Game') {
          if (Number.isFinite(deleted?.count)) deletedGames += deleted.count
          else if (Array.isArray(deleted?.data)) deletedGames += deleted.data.length
          else deletedGames += batch.gameIds.length
        }
      }
    }

    logLine(log, 'log', `Cleanup complete. Deleted ${deletedGames} old games.`)
    return { status: 'ok', exitCode: 0, deletedGames, reason: null }
  } catch (error) {
    logLine(log, 'error', `Cleanup failed: ${error?.message || error}. Not continuing deletes.`)
    return { status: 'failed', exitCode: 1, deletedGames, reason: 'throw' }
  } finally {
    lock.release?.()
  }
}
