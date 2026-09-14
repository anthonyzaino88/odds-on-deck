/**
 * Safe PlayerPropCache cleanup: archive first, delete only verified versions.
 *
 * Candidate reads use an explicit column list, conservative keyset pages,
 * and bounded retries. The candidate cutoff is fixed for the whole run.
 * Abort the entire delete phase if any archive read/write fails.
 * Overlapping stale/expired/past-game candidates are deduped. Deletes
 * match id + the exact DB fetchedAt string so a refresh between capture
 * and delete is left alone.
 */

import { ArchiveWriteError, appendJsonlVerified, resolvePropLinesDir, stableHash } from './local-archive.js'
import { mapPropCacheToArchiveRow, propCacheVersionSnapshot } from './prop-line-archive.js'

/** Conservative default. 500-row `select(*)` offset pages 504'd in morning ops. */
export const DEFAULT_CLEANUP_PAGE_SIZE = 50
export const MAX_CLEANUP_PAGE_SIZE = 200
export const CLEANUP_PAGE_SIZE = DEFAULT_CLEANUP_PAGE_SIZE
export const DEFAULT_CLEANUP_READ_ATTEMPTS = 4
export const DEFAULT_CLEANUP_RETRY_BASE_MS = 250
export const DEFAULT_CLEANUP_RETRY_MAX_MS = 4000

/**
 * Columns required for archive mapping, odds-format provenance, filters,
 * and id+fetchedAt concurrency protection. `reasoning` is omitted on
 * purpose (large unused text). Quote-time columns are not on this table.
 */
export const PLAYER_PROP_CACHE_CLEANUP_COLUMNS = [
  'id',
  'propId',
  'gameId',
  'playerName',
  'team',
  'type',
  'pick',
  'threshold',
  'odds',
  'probability',
  'edge',
  'confidence',
  'qualityScore',
  'numBooks',
  'sport',
  'projection',
  'bookmaker',
  'gameTime',
  'fetchedAt',
  'expiresAt',
  'isStale',
]

export const PROP_LINE_ARCHIVE_CONTRACT_FIELDS = [
  'schema_version',
  'prop_id',
  'cache_id',
  'game_id',
  'sport',
  'player_name',
  'team',
  'prop_type',
  'pick',
  'threshold',
  'odds',
  'odds_format',
  'probability',
  'edge',
  'confidence',
  'quality_score',
  'bookmaker',
  'projection',
  'game_time',
  'num_books',
  'quote_ts',
  'quote_ts_status',
  'fetched_at',
  'archived_at',
  'expires_at',
  'is_stale',
]

export class CleanupReadError extends ArchiveWriteError {
  constructor(message, extra = {}) {
    super(message, extra)
    this.name = 'CleanupReadError'
  }
}

export const DEFAULT_CLEANUP_FILTERS = (nowIso) => {
  if (!nowIso) throw new Error('cleanup cutoff nowIso is required and must stay fixed for the run')
  return [
    { name: 'expired', op: 'lt', col: 'expiresAt', val: nowIso },
    { name: 'stale', op: 'eq', col: 'isStale', val: true },
    { name: 'past_game', op: 'lt', col: 'gameTime', val: nowIso },
  ]
}

export function clampCleanupPageSize(value, fallback = DEFAULT_CLEANUP_PAGE_SIZE) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) return fallback
  return Math.min(n, MAX_CLEANUP_PAGE_SIZE)
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function sanitizeCleanupLog(message) {
  return String(message ?? '')
    .replace(/apikey=[^&\s]+/gi, 'apikey=***')
    .replace(/authorization:\s*bearer\s+\S+/gi, 'authorization: Bearer ***')
    .replace(/Bearer\s+\S+/g, 'Bearer ***')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .slice(0, 300)
}

export function describeCleanupReadError(err, extras = {}) {
  // Classify error text and HTTP status together. Do not reuse a retryable
  // flag computed before the response status was attached (503/504 with
  // generic "Request failed" must still retry).
  const status = extras.status ?? err?.status ?? err?.statusCode ?? err?.httpStatus ?? err?.cause?.status ?? null
  const code = extras.code ?? err?.code ?? err?.error_code ?? err?.cause?.code ?? null
  const combined = {
    name: extras.name ?? err?.name ?? null,
    message: extras.message ?? err?.message ?? err?.details ?? String(err),
    details: err?.details,
    code,
    status,
    statusCode: status,
    httpStatus: status,
    cause: err?.cause,
  }
  return {
    name: combined.name,
    message: sanitizeCleanupLog(combined.message),
    status,
    code: code == null ? null : String(code),
    retryable: isRetryableCleanupReadError(combined),
  }
}

export function isRetryableCleanupReadError(err) {
  if (!err) return false
  if (err.retryable === true) return true
  if (err.retryable === false) return false

  const status = Number(err.status ?? err.statusCode ?? err.httpStatus ?? err.cause?.status)
  const code = String(err.code ?? err.error_code ?? err.cause?.code ?? '')
  const msg = String(err.message || err.details || err.cause?.message || '')
  const name = String(err.name || err.cause?.name || '')

  if (status === 401 || status === 403) return false
  if (status === 400 || status === 404 || status === 409 || status === 422) return false
  if (
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'PGRST204' ||
    code === '42P01' ||
    code === '42703' ||
    code === '22P02'
  ) {
    return false
  }
  if (
    /JWT|permission denied|not authorized|invalid api key|invalid_api_key|schema cache|could not find.*column|does not exist|column .* not found/i.test(
      msg
    )
  ) {
    return false
  }

  if ([408, 429, 500, 502, 503, 504].includes(status)) return true
  if (
    /gateway timeout|service unavailable|bad gateway|too many requests|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket hang up|aborted/i.test(
      msg
    )
  ) {
    return true
  }
  if (/AbortError|FetchError|NetworkError|TimeoutError/i.test(name)) return true
  return false
}

export function cleanupRetryDelayMs(
  attempt,
  {
    baseMs = DEFAULT_CLEANUP_RETRY_BASE_MS,
    maxMs = DEFAULT_CLEANUP_RETRY_MAX_MS,
    random = Math.random,
  } = {}
) {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
  const jitter = exp * 0.5 * Number(random())
  return Math.max(0, Math.round(exp * 0.5 + jitter))
}

export function formatCleanupReadDiagnostic(info = {}) {
  const parts = [
    `filter=${info.filter ?? 'n/a'}`,
    `cursor=${info.cursor == null || info.cursor === '' ? 'none' : info.cursor}`,
    `pageSize=${info.pageSize ?? 'n/a'}`,
    `attempt=${info.attempt ?? '?'}/${info.maxAttempts ?? '?'}`,
    `elapsedMs=${info.elapsedMs ?? 'n/a'}`,
  ]
  if (info.status != null && info.status !== '') parts.push(`status=${info.status}`)
  if (info.code) parts.push(`code=${info.code}`)
  if (info.name) parts.push(`errorName=${info.name}`)
  if (info.message) parts.push(`message=${sanitizeCleanupLog(info.message)}`)
  if (info.retryable != null) parts.push(`retryable=${info.retryable}`)
  if (info.rowCount != null) parts.push(`rowCount=${info.rowCount}`)
  return `cleanup read: ${parts.join(' ')}`
}

export async function withCleanupReadRetry(operation, context = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_CLEANUP_READ_ATTEMPTS
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now
  const log = options.log
  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = now()
    try {
      const result = await operation({ attempt, maxAttempts })
      const elapsedMs = now() - started
      if (log) {
        log(
          formatCleanupReadDiagnostic({
            ...context,
            attempt,
            maxAttempts,
            elapsedMs,
            rowCount: Array.isArray(result) ? result.length : undefined,
            retryable: false,
          })
        )
      }
      return result
    } catch (err) {
      const elapsedMs = now() - started
      const described = describeCleanupReadError(err)
      lastError = err
      if (log) {
        log(
          formatCleanupReadDiagnostic({
            ...context,
            attempt,
            maxAttempts,
            elapsedMs,
            ...described,
          })
        )
      }
      if (!described.retryable || attempt >= maxAttempts) {
        throw new CleanupReadError(err?.message || 'cleanup read failed', {
          ...context,
          ...described,
          attempt,
          maxAttempts,
          elapsedMs,
          exhausted: Boolean(described.retryable && attempt >= maxAttempts),
          cause: err,
        })
      }
      await sleep(cleanupRetryDelayMs(attempt, { random, ...options.backoff }))
    }
  }

  throw lastError
}

export function dedupeCleanupCandidates(rows) {
  const byId = new Map()
  for (const row of rows || []) {
    if (!row || row.id == null) continue
    if (!byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

export async function paginateFilter(fetchPage, filter, options = {}) {
  const pageSize = clampCleanupPageSize(options.pageSize, DEFAULT_CLEANUP_PAGE_SIZE)
  const rows = []
  let cursor = null
  while (true) {
    const page = await withCleanupReadRetry(
      () => fetchPage({ filter, cursor, pageSize }),
      { filter: filter?.name, cursor, pageSize },
      options
    )
    if (!page || page.length === 0) break
    rows.push(...page)
    if (page.length < pageSize) break
    const lastId = page[page.length - 1]?.id
    if (lastId == null || String(lastId) === String(cursor)) {
      throw new CleanupReadError('cleanup read pagination stalled: cursor did not advance', {
        filter: filter?.name,
        cursor,
        pageSize,
        retryable: false,
      })
    }
    cursor = lastId
  }
  return rows
}

export async function collectCleanupCandidates(fetchPage, options = {}) {
  const { nowIso, filters, pageSize = DEFAULT_CLEANUP_PAGE_SIZE } = options
  const usedFilters = filters || DEFAULT_CLEANUP_FILTERS(nowIso)
  const collected = []
  for (const filter of usedFilters) {
    const rows = await paginateFilter(fetchPage, filter, { ...options, pageSize })
    collected.push(...rows)
  }
  return dedupeCleanupCandidates(collected)
}

function applyCleanupFilter(query, filter) {
  if (filter?.op === 'lt') return query.lt(filter.col, filter.val)
  if (filter?.op === 'eq') return query.eq(filter.col, filter.val)
  throw new CleanupReadError(`unsupported cleanup filter op: ${filter?.op}`, { retryable: false })
}

export function createSupabaseKeysetFetcher(supabase, table = 'PlayerPropCache', options = {}) {
  const columns = options.columns || PLAYER_PROP_CACHE_CLEANUP_COLUMNS
  const selectList = columns.join(',')
  return async function fetchPage({ filter, cursor, pageSize }) {
    let query = supabase
      .from(table)
      .select(selectList)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (cursor != null) query = query.gt('id', cursor)
    query = applyCleanupFilter(query, filter)

    let data
    let error
    let status
    try {
      ;({ data, error, status } = await query)
    } catch (err) {
      throw new CleanupReadError(err?.message || 'cleanup read failed', {
        ...describeCleanupReadError(err),
        filter: filter?.name,
        cursor,
        pageSize,
        cause: err,
      })
    }
    if (error) {
      const combinedStatus = error.status ?? error.statusCode ?? error.httpStatus ?? status
      throw new CleanupReadError(`cleanup read failed: ${error.message}`, {
        ...describeCleanupReadError(error, { status: combinedStatus }),
        filter: filter?.name,
        cursor,
        pageSize,
        cause: error,
      })
    }
    return data || []
  }
}

/** @deprecated Use createSupabaseKeysetFetcher. Offset range pages are no longer used. */
export const createSupabaseRangeFetcher = createSupabaseKeysetFetcher

function snapshotsMatch(row, snapshot) {
  if (!row || !snapshot) return false
  if (String(row.id) !== String(snapshot.id)) return false
  const current = propCacheVersionSnapshot(row)
  return stableHash(current) === stableHash(snapshot)
}

/**
 * Archive captured rows with verification. On any write/read failure, return
 * abort=true and do not report any row as delete-eligible.
 */
export function archiveCleanupRows(rows, {
  archiveDir,
  archivedAt,
  append = appendJsonlVerified,
  batchSize = DEFAULT_CLEANUP_PAGE_SIZE,
} = {}) {
  const dir = archiveDir || resolvePropLinesDir()
  const verified = []
  try {
    if (!rows || rows.length === 0) {
      return { abort: false, verified, written: 0 }
    }
    const mapped = rows.map((row) => ({
      row,
      snapshot: propCacheVersionSnapshot(row),
      archive: mapPropCacheToArchiveRow(row, { archivedAt }),
    }))
    let lastFile = null
    for (let i = 0; i < mapped.length; i += batchSize) {
      const batch = mapped.slice(i, i + batchSize)
      const result = append(dir, 'prop-lines', batch.map((item) => item.archive), archivedAt)
      if (!result || result.written !== batch.length) {
        throw new ArchiveWriteError('cleanup archive wrote fewer rows than captured')
      }
      lastFile = result.file
      verified.push(...batch)
    }
    return { abort: false, verified, written: verified.length, file: lastFile }
  } catch (err) {
    return {
      abort: true,
      verified: [],
      written: 0,
      error: err,
    }
  }
}

/**
 * Keep only snapshots whose current row still matches the captured version.
 * These are refetch-time mismatches, not delete-time mismatches.
 */
export function filterUnchangedSnapshots(currentRows, snapshots) {
  const byId = new Map((currentRows || []).map((row) => [String(row.id), row]))
  const unchanged = []
  const skippedConcurrent = []
  for (const item of snapshots) {
    const current = byId.get(String(item.snapshot.id))
    if (snapshotsMatch(current, item.snapshot)) unchanged.push(item)
    else skippedConcurrent.push(item)
  }
  return { unchanged, skippedConcurrent }
}

export async function deleteVerifiedSnapshots(deleteExact, snapshots) {
  let deleted = 0
  const skippedDeleteMismatch = []
  for (const item of snapshots) {
    const count = await deleteExact(item.snapshot)
    if (count > 0) deleted += count
    else skippedDeleteMismatch.push(item)
  }
  return { deleted, skippedDeleteMismatch, skipped: skippedDeleteMismatch }
}

export function createSupabaseExactDeleter(supabase, table = 'PlayerPropCache') {
  return async function deleteExact(snapshot) {
    let query = supabase.from(table).delete({ count: 'exact' }).eq('id', snapshot.id)
    if (snapshot.fetched_at) query = query.eq('fetchedAt', snapshot.fetched_at)
    else query = query.is('fetchedAt', null)
    const { error, count } = await query
    if (error) throw new ArchiveWriteError(`cleanup delete failed: ${error.message}`)
    return count || 0
  }
}

function emptyCleanupResult(overrides = {}) {
  return {
    abort: false,
    deleted: 0,
    archived: 0,
    candidates: 0,
    skippedConcurrent: 0,
    skippedDeleteMismatch: 0,
    cutoff: null,
    dryRun: false,
    ...overrides,
  }
}

/**
 * Full archive-then-delete pipeline. Delete runs only when archive verification
 * succeeded for the whole captured set. Candidate-read exhaustion yields zero
 * archive writes and zero deletes.
 */
export async function runPropCacheCleanup({
  fetchPage,
  refetchByIds,
  deleteExact,
  nowIso,
  archiveDir,
  archivedAt,
  dryRun = false,
  append,
  batchSize,
  pageSize,
  filters,
  maxAttempts,
  sleep,
  random,
  log,
} = {}) {
  const readOpts = { pageSize, maxAttempts, sleep, random, log, filters, nowIso }
  let candidates
  try {
    candidates = await collectCleanupCandidates(fetchPage, readOpts)
  } catch (err) {
    return emptyCleanupResult({
      abort: true,
      error: err,
      dryRun,
      cutoff: nowIso,
    })
  }

  if (candidates.length === 0) {
    return emptyCleanupResult({ dryRun, cutoff: nowIso })
  }

  if (dryRun) {
    return emptyCleanupResult({
      candidates: candidates.length,
      dryRun: true,
      cutoff: nowIso,
    })
  }

  const archivedAtValue = archivedAt || nowIso || new Date().toISOString()
  const archived = archiveCleanupRows(candidates, {
    archiveDir,
    archivedAt: archivedAtValue,
    append,
    batchSize,
  })

  if (archived.abort) {
    return emptyCleanupResult({
      abort: true,
      candidates: candidates.length,
      error: archived.error,
      dryRun,
      cutoff: nowIso,
    })
  }

  const ids = candidates.map((row) => row.id)
  let current
  try {
    current = refetchByIds ? await refetchByIds(ids) : candidates
  } catch (err) {
    return emptyCleanupResult({
      abort: true,
      archived: archived.written,
      candidates: candidates.length,
      error: err,
      dryRun,
      cutoff: nowIso,
    })
  }
  const { unchanged, skippedConcurrent } = filterUnchangedSnapshots(current, archived.verified)

  const { deleted, skippedDeleteMismatch } = await deleteVerifiedSnapshots(deleteExact, unchanged)
  return emptyCleanupResult({
    abort: false,
    deleted,
    archived: archived.written,
    candidates: candidates.length,
    skippedConcurrent: skippedConcurrent.length,
    skippedDeleteMismatch: skippedDeleteMismatch.length,
    dryRun: false,
    cutoff: nowIso,
  })
}

export async function refetchPlayerPropCacheByIds(supabase, ids, options = {}) {
  const pageSize = clampCleanupPageSize(options.pageSize, DEFAULT_CLEANUP_PAGE_SIZE)
  const columns = (options.columns || PLAYER_PROP_CACHE_CLEANUP_COLUMNS).join(',')
  const rows = []
  for (let i = 0; i < ids.length; i += pageSize) {
    const chunk = ids.slice(i, i + pageSize)
    const data = await withCleanupReadRetry(
      async () => {
        let result
        try {
          result = await supabase.from('PlayerPropCache').select(columns).in('id', chunk)
        } catch (err) {
          throw new CleanupReadError(err?.message || 'cleanup refetch failed', {
            ...describeCleanupReadError(err),
            filter: 'refetch',
            pageSize: chunk.length,
            cause: err,
          })
        }
        if (result.error) {
          throw new CleanupReadError(`cleanup refetch failed: ${result.error.message}`, {
            ...describeCleanupReadError(result.error),
            status: result.error.status ?? result.status,
            filter: 'refetch',
            pageSize: chunk.length,
            cause: result.error,
          })
        }
        return result.data || []
      },
      { filter: 'refetch', cursor: chunk[0], pageSize: chunk.length },
      options
    )
    if (data) rows.push(...data)
  }
  return rows
}

export async function countCleanupFilter(supabase, filter, options = {}) {
  const table = options.table || 'PlayerPropCache'
  return withCleanupReadRetry(
    async () => {
      let query = supabase.from(table).select('id', { count: 'exact', head: true })
      query = applyCleanupFilter(query, filter)
      let result
      try {
        result = await query
      } catch (err) {
        throw new CleanupReadError(err?.message || 'cleanup count failed', {
          ...describeCleanupReadError(err),
          filter: filter?.name,
          cause: err,
        })
      }
      if (result.error) {
        throw new CleanupReadError(`cleanup count failed: ${result.error.message}`, {
          ...describeCleanupReadError(result.error),
          status: result.error.status ?? result.status,
          filter: filter?.name,
          cause: result.error,
        })
      }
      return result.count ?? 0
    },
    { filter: filter?.name, cursor: 'count', pageSize: 0 },
    options
  )
}

export async function countCleanupRemaining(supabase, nowIso, options = {}) {
  const filters = DEFAULT_CLEANUP_FILTERS(nowIso)
  const counts = { remainingExpired: null, remainingStale: null, remainingPastGame: null }
  try {
    counts.remainingExpired = await countCleanupFilter(supabase, filters[0], options)
    counts.remainingStale = await countCleanupFilter(supabase, filters[1], options)
    counts.remainingPastGame = await countCleanupFilter(supabase, filters[2], options)
    counts.remainingTotal = await withCleanupReadRetry(
      async () => {
        const result = await supabase
          .from(options.table || 'PlayerPropCache')
          .select('id', { count: 'exact', head: true })
        if (result.error) {
          throw new CleanupReadError(`cleanup count failed: ${result.error.message}`, {
            ...describeCleanupReadError(result.error),
            status: result.error.status ?? result.status,
            filter: 'total',
            cause: result.error,
          })
        }
        return result.count ?? 0
      },
      { filter: 'total', cursor: 'count', pageSize: 0 },
      options
    )
  } catch (err) {
    counts.error = err
  }
  return counts
}

export function summarizeCleanupForOps(result = {}) {
  const unavailable = (value) => (value == null ? 'unavailable' : value)
  return {
    cleanup_status: result.abort ? 'fail' : 'ok',
    candidates: result.candidates ?? 0,
    archived: result.archived ?? 0,
    deleted: result.deleted ?? 0,
    skipped_refetch: result.skippedConcurrent ?? 0,
    skipped_delete: result.skippedDeleteMismatch ?? 0,
    remaining_expired: unavailable(result.remainingExpired),
    remaining_stale: unavailable(result.remainingStale),
    remaining_past_game: unavailable(result.remainingPastGame),
    remaining_total: unavailable(result.remainingTotal),
    read_only: Boolean(result.dryRun),
    cutoff: result.cutoff || 'n/a',
  }
}

export function formatCleanupOpsFooter(summary) {
  return [
    `CLEANUP_STATUS=${summary.cleanup_status}`,
    `CANDIDATES=${summary.candidates}`,
    `ARCHIVED=${summary.archived}`,
    `DELETED=${summary.deleted}`,
    `SKIPPED_REFETCH=${summary.skipped_refetch}`,
    `SKIPPED_DELETE=${summary.skipped_delete}`,
    `REMAINING_EXPIRED=${summary.remaining_expired}`,
    `REMAINING_STALE=${summary.remaining_stale}`,
    `REMAINING_PAST_GAME=${summary.remaining_past_game}`,
    `REMAINING_TOTAL=${summary.remaining_total}`,
    `READ_ONLY=${summary.read_only}`,
    `CUTOFF=${summary.cutoff}`,
  ].join('\n')
}

export function morningOverallStatus({ cleanupFailed, laterStepsFailed } = {}) {
  if (laterStepsFailed) return 'fail'
  if (cleanupFailed) return 'degraded'
  return 'ok'
}
