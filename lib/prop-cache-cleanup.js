/**
 * Safe PlayerPropCache cleanup: archive first, delete only verified versions.
 *
 * Abort the entire delete phase if any archive read/write fails.
 * Pagination is ordered by id. Overlapping stale/expired/past-game
 * candidates are deduped. Deletes match id + fetchedAt so a refresh
 * between capture and delete is left alone.
 */

import { ArchiveWriteError, appendJsonlVerified, resolvePropLinesDir, stableHash } from './local-archive.js'
import { mapPropCacheToArchiveRow, propCacheVersionSnapshot } from './prop-line-archive.js'

export const CLEANUP_PAGE_SIZE = 500

export const DEFAULT_CLEANUP_FILTERS = (nowIso) => [
  { name: 'expired', op: 'lt', col: 'expiresAt', val: nowIso },
  { name: 'stale', op: 'eq', col: 'isStale', val: true },
  { name: 'past_game', op: 'lt', col: 'gameTime', val: nowIso },
]

export function dedupeCleanupCandidates(rows) {
  const byId = new Map()
  for (const row of rows || []) {
    if (!row || row.id == null) continue
    if (!byId.has(row.id)) byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

export async function paginateFilter(fetchPage, filter, { pageSize = CLEANUP_PAGE_SIZE } = {}) {
  const rows = []
  let from = 0
  while (true) {
    const page = await fetchPage({ filter, from, to: from + pageSize - 1 })
    if (!page || page.length === 0) break
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return rows
}

export async function collectCleanupCandidates(fetchPage, { nowIso, filters, pageSize = CLEANUP_PAGE_SIZE } = {}) {
  const usedFilters = filters || DEFAULT_CLEANUP_FILTERS(nowIso)
  const collected = []
  for (const filter of usedFilters) {
    const rows = await paginateFilter(fetchPage, filter, { pageSize })
    collected.push(...rows)
  }
  return dedupeCleanupCandidates(collected)
}

export function createSupabaseRangeFetcher(supabase, table = 'PlayerPropCache') {
  return async function fetchPage({ filter, from, to }) {
    let query = supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, to)

    if (filter?.op === 'lt') query = query.lt(filter.col, filter.val)
    else if (filter?.op === 'eq') query = query.eq(filter.col, filter.val)

    const { data, error } = await query
    if (error) throw new ArchiveWriteError(`cleanup read failed: ${error.message}`)
    return data || []
  }
}

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
  batchSize = CLEANUP_PAGE_SIZE,
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
  const skipped = []
  for (const item of snapshots) {
    const count = await deleteExact(item.snapshot)
    if (count > 0) deleted += count
    else skipped.push(item)
  }
  return { deleted, skipped }
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

/**
 * Full archive-then-delete pipeline. Delete runs only when archive verification
 * succeeded for the whole captured set.
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
} = {}) {
  let candidates
  try {
    candidates = await collectCleanupCandidates(fetchPage, { nowIso })
  } catch (err) {
    return {
      abort: true,
      deleted: 0,
      archived: 0,
      candidates: 0,
      error: err,
      dryRun,
    }
  }
  if (candidates.length === 0) {
    return {
      abort: false,
      deleted: 0,
      archived: 0,
      candidates: 0,
      skippedConcurrent: 0,
      dryRun,
    }
  }

  if (dryRun) {
    return {
      abort: false,
      deleted: 0,
      archived: 0,
      candidates: candidates.length,
      skippedConcurrent: 0,
      dryRun: true,
    }
  }

  const archivedAtValue = archivedAt || nowIso || new Date().toISOString()
  const archived = archiveCleanupRows(candidates, {
    archiveDir,
    archivedAt: archivedAtValue,
    append,
    batchSize,
  })

  if (archived.abort) {
    return {
      abort: true,
      deleted: 0,
      archived: 0,
      candidates: candidates.length,
      error: archived.error,
      dryRun,
    }
  }

  const ids = candidates.map((row) => row.id)
  const current = refetchByIds ? await refetchByIds(ids) : candidates
  const { unchanged, skippedConcurrent } = filterUnchangedSnapshots(current, archived.verified)

  const { deleted } = await deleteVerifiedSnapshots(deleteExact, unchanged)
  return {
    abort: false,
    deleted,
    archived: archived.written,
    candidates: candidates.length,
    skippedConcurrent: skippedConcurrent.length,
    dryRun: false,
  }
}

export async function refetchPlayerPropCacheByIds(supabase, ids, { pageSize = CLEANUP_PAGE_SIZE } = {}) {
  const rows = []
  for (let i = 0; i < ids.length; i += pageSize) {
    const chunk = ids.slice(i, i + pageSize)
    const { data, error } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .in('id', chunk)
    if (error) throw new ArchiveWriteError(`cleanup refetch failed: ${error.message}`)
    if (data) rows.push(...data)
  }
  return rows
}
