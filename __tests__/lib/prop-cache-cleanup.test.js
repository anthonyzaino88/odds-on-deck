import fs from 'fs'
import os from 'os'
import path from 'path'
import { appendJsonlVerified } from '../../lib/local-archive.js'
import {
  PLAYER_PROP_CACHE_CLEANUP_COLUMNS,
  PROP_LINE_ARCHIVE_CONTRACT_FIELDS,
  archiveCleanupRows,
  cleanupRetryDelayMs,
  collectCleanupCandidates,
  createSupabaseKeysetFetcher,
  dedupeCleanupCandidates,
  filterUnchangedSnapshots,
  formatCleanupReadDiagnostic,
  isRetryableCleanupReadError,
  morningOverallStatus,
  paginateFilter,
  runPropCacheCleanup,
  sanitizeCleanupLog,
  summarizeCleanupForOps,
} from '../../lib/prop-cache-cleanup.js'
import { mapPropCacheToArchiveRow, propCacheVersionSnapshot } from '../../lib/prop-line-archive.js'

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ood-prop-cleanup-'))
}

function cacheRow(overrides = {}) {
  return {
    id: 'id-a',
    propId: 'prop-a',
    gameId: 'g1',
    sport: 'nfl',
    playerName: 'Ada',
    team: 'KC',
    type: 'player_passing_yards',
    pick: 'over',
    threshold: 250.5,
    odds: -115,
    probability: 0.5,
    edge: 0,
    confidence: 'medium',
    qualityScore: 40,
    bookmaker: 'fanduel',
    projection: 255,
    gameTime: '2026-09-10T17:00:00.000Z',
    fetchedAt: '2026-09-10T12:00:00.000Z',
    expiresAt: '2026-09-10T16:00:00.000Z',
    isStale: true,
    numBooks: 3,
    ...overrides,
  }
}

function keysetPages(rowsByFilter) {
  return jest.fn(async ({ filter, cursor, pageSize }) => {
    const src = [...(rowsByFilter[filter.name] || [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    )
    const rest = cursor == null ? src : src.filter((row) => String(row.id) > String(cursor))
    return rest.slice(0, pageSize)
  })
}

function gatewayTimeout() {
  const err = new Error('Gateway Timeout')
  err.status = 504
  err.code = '504'
  return err
}

function noSleep() {
  return jest.fn(async () => {})
}

describe('cleanup candidate pagination + dedupe', () => {
  test('orders pages by id cursor and dedupes overlapping filters', async () => {
    const expired = [cacheRow({ id: 'b' }), cacheRow({ id: 'a' })]
    const stale = [cacheRow({ id: 'a' }), cacheRow({ id: 'c' })]
    const past = [cacheRow({ id: 'c' })]
    const fetchPage = keysetPages({ expired, stale, past_game: past })

    const rows = await collectCleanupCandidates(fetchPage, {
      nowIso: '2026-09-14T00:00:00.000Z',
      filters: [
        { name: 'expired', op: 'lt', col: 'expiresAt', val: 'now' },
        { name: 'stale', op: 'eq', col: 'isStale', val: true },
        { name: 'past_game', op: 'lt', col: 'gameTime', val: 'now' },
      ],
      pageSize: 10,
    })

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(dedupeCleanupCandidates([...expired, ...stale, ...past])).toHaveLength(3)
  })

  test('walks page-size boundaries with a stable id cursor', async () => {
    const expired = ['a', 'b', 'c', 'd', 'e'].map((id) => cacheRow({ id }))
    const fetchPage = keysetPages({ expired })
    const rows = await paginateFilter(fetchPage, { name: 'expired' }, { pageSize: 2 })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage.mock.calls[0][0].cursor).toBeNull()
    expect(fetchPage.mock.calls[1][0].cursor).toBe('b')
    expect(fetchPage.mock.calls[2][0].cursor).toBe('d')
  })

  test('keyset pagination still sees later ids after earlier rows disappear', async () => {
    const live = [
      cacheRow({ id: 'a' }),
      cacheRow({ id: 'b' }),
      cacheRow({ id: 'c' }),
      cacheRow({ id: 'd' }),
    ]
    const fetchPage = jest.fn(async ({ cursor, pageSize }) => {
      const src = cursor == null ? live : live.filter((row) => row.id > cursor)
      if (cursor == null) {
        const page = src.slice(0, pageSize)
        live.splice(0, 2)
        return page
      }
      return src.slice(0, pageSize)
    })
    const rows = await paginateFilter(fetchPage, { name: 'expired' }, { pageSize: 2 })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('keeps the candidate cutoff fixed across pages', async () => {
    const cutoff = '2026-09-14T08:15:00.123Z'
    const seen = []
    const fetchPage = jest.fn(async ({ filter, cursor }) => {
      if (filter.op === 'lt') seen.push(filter.val)
      if (cursor != null) return []
      return [cacheRow()]
    })
    await collectCleanupCandidates(fetchPage, {
      nowIso: cutoff,
      pageSize: 10,
      sleep: async () => {},
    })
    expect(seen.length).toBeGreaterThan(1)
    expect(new Set(seen)).toEqual(new Set([cutoff]))
  })
})

describe('cleanup read retries', () => {
  test('retries a transient 504 then collects successfully', async () => {
    let attempts = 0
    const fetchPage = jest.fn(async ({ cursor }) => {
      attempts += 1
      if (attempts === 1) throw gatewayTimeout()
      return cursor == null ? [cacheRow()] : []
    })
    const sleep = noSleep()
    const logs = []
    const result = await runPropCacheCleanup({
      fetchPage,
      deleteExact: async () => 1,
      refetchByIds: async () => [cacheRow()],
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: makeTempDir(),
      archivedAt: '2026-09-14T00:00:00.000Z',
      maxAttempts: 4,
      sleep,
      random: () => 0,
      log: (line) => logs.push(line),
    })
    expect(result.abort).toBe(false)
    expect(result.deleted).toBe(1)
    expect(result.candidates).toBe(1)
    expect(attempts).toBeGreaterThan(1)
    expect(sleep).toHaveBeenCalled()
    expect(logs.some((line) => line.includes('status=504') && line.includes('retryable=true'))).toBe(true)
  })

  test('exhausted retries write zero archives and delete nothing', async () => {
    const dir = makeTempDir()
    const append = jest.fn()
    const deleted = []
    let attempts = 0
    const result = await runPropCacheCleanup({
      fetchPage: async () => {
        attempts += 1
        throw gatewayTimeout()
      },
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      append,
      maxAttempts: 3,
      sleep: noSleep(),
      random: () => 0,
    })
    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(result.archived).toBe(0)
    expect(deleted).toEqual([])
    expect(append).not.toHaveBeenCalled()
    expect(attempts).toBe(3)
    expect(result.error.exhausted).toBe(true)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  test('nonretryable authorization errors fail on the first attempt', async () => {
    const sleep = noSleep()
    let attempts = 0
    const err = new Error('permission denied for table PlayerPropCache')
    err.status = 401
    err.code = '42501'
    const result = await runPropCacheCleanup({
      fetchPage: async () => {
        attempts += 1
        throw err
      },
      deleteExact: async () => 1,
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: makeTempDir(),
      maxAttempts: 4,
      sleep,
    })
    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(attempts).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(isRetryableCleanupReadError(err)).toBe(false)
  })

  test('classifies retryable vs nonretryable read errors', () => {
    expect(isRetryableCleanupReadError({ message: 'Gateway Timeout', status: 504 })).toBe(true)
    expect(isRetryableCleanupReadError({ message: 'fetch failed', name: 'FetchError' })).toBe(true)
    expect(isRetryableCleanupReadError({ message: 'Invalid API key', status: 401 })).toBe(false)
    expect(isRetryableCleanupReadError({ message: 'column reasoning does not exist', code: '42703' })).toBe(
      false
    )
    expect(cleanupRetryDelayMs(1, { random: () => 0 })).toBeGreaterThan(0)
    expect(sanitizeCleanupLog('Bearer super-secret apikey=abcd')).toMatch(/Bearer \*\*\*/)
    expect(sanitizeCleanupLog('Bearer super-secret apikey=abcd')).not.toMatch(/super-secret/)
    expect(formatCleanupReadDiagnostic({
      filter: 'expired',
      cursor: null,
      pageSize: 50,
      attempt: 2,
      maxAttempts: 4,
      elapsedMs: 12,
      status: 504,
      message: 'Gateway Timeout',
      retryable: true,
    })).toMatch(/filter=expired cursor=none pageSize=50 attempt=2\/4/)
  })
})

describe('deletion protection', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('read failure aborts deletion', async () => {
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async () => {
        throw new Error('supabase down')
      },
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
    })
    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
  })

  test('write failure aborts deletion', async () => {
    const deleted = []
    const fetchPage = jest.fn(async ({ cursor }) => (cursor == null ? [cacheRow()] : []))
    const result = await runPropCacheCleanup({
      fetchPage,
      refetchByIds: async () => [cacheRow()],
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
      append: () => {
        throw new Error('disk full')
      },
    })

    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
  })

  test('partial archive failure aborts all deletes', async () => {
    const rows = [cacheRow({ id: 'id-a', propId: 'p-a' }), cacheRow({ id: 'id-b', propId: 'p-b' })]
    let calls = 0
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? rows : []),
      refetchByIds: async () => rows,
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
      batchSize: 1,
      append: (archiveDir, prefix, batch) => {
        calls += 1
        if (calls === 2) throw new Error('second batch failed')
        return appendJsonlVerified(archiveDir, prefix, batch, '2026-09-14T00:00:00.000Z')
      },
    })

    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
    expect(calls).toBe(2)
  })

  test('concurrent update between capture and delete is not deleted', async () => {
    const original = cacheRow({ fetchedAt: '2026-09-10T12:00:00.000Z' })
    const refreshed = cacheRow({ fetchedAt: '2026-09-14T09:00:00.000Z', odds: 100 })
    const deleted = []

    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [original] : []),
      refetchByIds: async () => [refreshed],
      deleteExact: async (snapshot) => {
        deleted.push(snapshot)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
    })

    expect(result.abort).toBe(false)
    expect(result.deleted).toBe(0)
    expect(result.skippedConcurrent).toBe(1)
    expect(result.skippedDeleteMismatch).toBe(0)
    expect(deleted).toEqual([])

    const { skippedConcurrent } = filterUnchangedSnapshots(
      [refreshed],
      [{ snapshot: propCacheVersionSnapshot(original), row: original }]
    )
    expect(skippedConcurrent).toHaveLength(1)
  })

  test('delete-time version mismatch is reported separately from refetch skips', async () => {
    const row = cacheRow({ fetchedAt: '2026-09-10T12:00:00.123456+00:00' })
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [row] : []),
      refetchByIds: async () => [row],
      deleteExact: async (snapshot) => {
        deleted.push(snapshot)
        return 0
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
    })
    expect(result.abort).toBe(false)
    expect(result.deleted).toBe(0)
    expect(result.archived).toBe(1)
    expect(result.skippedConcurrent).toBe(0)
    expect(result.skippedDeleteMismatch).toBe(1)
    expect(deleted[0].fetched_at).toBe('2026-09-10T12:00:00.123456+00:00')
  })

  test('preserves exact fetchedAt precision for delete matching', async () => {
    const row = cacheRow({ fetchedAt: '2026-09-10T12:00:00.123456+00:00' })
    const snapshot = propCacheVersionSnapshot(row)
    expect(snapshot.fetched_at).toBe('2026-09-10T12:00:00.123456+00:00')
    expect(snapshot.fetched_at).not.toBe(new Date(row.fetchedAt).toISOString())

    const deleted = []
    await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [row] : []),
      refetchByIds: async () => [row],
      deleteExact: async (snapshotArg) => {
        deleted.push(snapshotArg.fetched_at)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
    })
    expect(deleted).toEqual(['2026-09-10T12:00:00.123456+00:00'])
  })

  test('verified archive then exact-version delete', async () => {
    const row = cacheRow()
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [row] : []),
      refetchByIds: async () => [row],
      deleteExact: async (snapshot) => {
        deleted.push(snapshot)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
    })

    expect(result.abort).toBe(false)
    expect(result.deleted).toBe(1)
    expect(deleted[0].id).toBe('id-a')
    expect(deleted[0].fetched_at).toBe('2026-09-10T12:00:00.000Z')

    const file = fs.readdirSync(dir).find((name) => name.endsWith('.jsonl'))
    const line = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n')[0])
    expect(line.quote_ts_status).toBe('unknown')
    expect(line.fetched_at).toBe('2026-09-10T12:00:00.000Z')
    expect(line.archived_at).toBe('2026-09-14T00:00:00.000Z')
    expect(line.odds_format).toBe('unknown')
    expect(line.odds).toBe(-115)
    expect(line.num_books).toBe(3)
    for (const field of PROP_LINE_ARCHIVE_CONTRACT_FIELDS) {
      expect(line).toHaveProperty(field)
    }
  })

  test('truncated archive file aborts deletion and preserves damaged bytes', async () => {
    const file = path.join(dir, 'prop-lines-2026-09-14.jsonl')
    fs.writeFileSync(file, '{"interrupted":', 'utf8')
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [cacheRow()] : []),
      refetchByIds: async () => [cacheRow()],
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
    })
    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe('{"interrupted":')
  })

  test('corrupt archive file aborts deletion and preserves damaged bytes', async () => {
    const file = path.join(dir, 'prop-lines-2026-09-14.jsonl')
    const damaged = '{"ok":true}\nnot-json\n'
    fs.writeFileSync(file, damaged, 'utf8')
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [cacheRow()] : []),
      refetchByIds: async () => [cacheRow()],
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      nowIso: '2026-09-14T00:00:00.000Z',
      archiveDir: dir,
      archivedAt: '2026-09-14T00:00:00.000Z',
    })
    expect(result.abort).toBe(true)
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(damaged)
  })

  test('partial archive write aborts deletion and does not rewrite the file', async () => {
    const first = appendJsonlVerified(dir, 'prop-lines', [{ prop_id: 'kept' }], '2026-09-14T00:00:00.000Z')
    const before = fs.readFileSync(first.file, 'utf8')
    const realAppend = fs.appendFileSync.bind(fs)
    const spy = jest.spyOn(fs, 'appendFileSync').mockImplementation((p, data, enc) => {
      realAppend(p, String(data).slice(0, 10), enc)
    })
    const deleted = []
    try {
      const result = await runPropCacheCleanup({
        fetchPage: async ({ cursor }) => (cursor == null ? [cacheRow()] : []),
        refetchByIds: async () => [cacheRow()],
        deleteExact: async (snapshot) => {
          deleted.push(snapshot.id)
          return 1
        },
        nowIso: '2026-09-14T00:00:00.000Z',
        archiveDir: dir,
        archivedAt: '2026-09-14T00:00:00.000Z',
      })
      expect(result.abort).toBe(true)
      expect(result.deleted).toBe(0)
    } finally {
      spy.mockRestore()
    }
    expect(deleted).toEqual([])
    const after = fs.readFileSync(first.file, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect(JSON.parse(after.split('\n')[0])).toEqual({ prop_id: 'kept' })
  })
})

describe('archive field preservation + explicit select list', () => {
  test('cleanup columns cover archive mapping without select(*)', () => {
    expect(PLAYER_PROP_CACHE_CLEANUP_COLUMNS).not.toContain('*')
    expect(PLAYER_PROP_CACHE_CLEANUP_COLUMNS).not.toContain('reasoning')
    const row = {}
    for (const col of PLAYER_PROP_CACHE_CLEANUP_COLUMNS) row[col] = cacheRow()[col] ?? null
    row.id = 'id-a'
    const archived = mapPropCacheToArchiveRow(row, { archivedAt: '2026-09-14T00:00:00.000Z' })
    for (const field of PROP_LINE_ARCHIVE_CONTRACT_FIELDS) {
      expect(archived).toHaveProperty(field)
    }
    expect(archived.cache_id).toBe('id-a')
    expect(archived.num_books).toBe(3)
  })

  test('keyset fetcher selects the explicit column list and uses gt(id)', async () => {
    const state = {}
    const builder = {
      select(...a) {
        state.select = a
        return builder
      },
      order(...a) {
        state.order = a
        return builder
      },
      limit(n) {
        state.limit = n
        return builder
      },
      gt(...a) {
        state.gt = a
        return builder
      },
      lt(...a) {
        state.lt = a
        return builder
      },
      eq(...a) {
        state.eq = a
        return builder
      },
      then(resolve, reject) {
        return Promise.resolve({ data: [], error: null, status: 200 }).then(resolve, reject)
      },
    }
    const supabase = { from: jest.fn(() => builder) }
    const fetchPage = createSupabaseKeysetFetcher(supabase)
    await fetchPage({
      filter: { name: 'expired', op: 'lt', col: 'expiresAt', val: 'CUTOFF' },
      cursor: 'id-100',
      pageSize: 50,
    })
    expect(state.select[0]).toBe(PLAYER_PROP_CACHE_CLEANUP_COLUMNS.join(','))
    expect(state.select[0]).not.toBe('*')
    expect(state.gt).toEqual(['id', 'id-100'])
    expect(state.lt).toEqual(['expiresAt', 'CUTOFF'])
    expect(state.limit).toBe(50)
  })
})

describe('archiveCleanupRows', () => {
  test('returns abort when append throws', () => {
    const result = archiveCleanupRows([cacheRow()], {
      archiveDir: '/tmp',
      append: () => {
        throw new Error('nope')
      },
    })
    expect(result.abort).toBe(true)
    expect(result.verified).toEqual([])
  })
})

describe('read-only collect/dry-run', () => {
  test('does not archive or delete when candidates exist', async () => {
    const append = jest.fn()
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ cursor }) => (cursor == null ? [cacheRow()] : []),
      deleteExact: async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
      append,
      dryRun: true,
      nowIso: '2026-09-14T00:00:00.000Z',
    })
    expect(result.abort).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(result.candidates).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.archived).toBe(0)
    expect(append).not.toHaveBeenCalled()
    expect(deleted).toEqual([])
  })

  test('read failure in dry-run still aborts with zero writes', async () => {
    const append = jest.fn()
    const result = await runPropCacheCleanup({
      fetchPage: async () => {
        throw gatewayTimeout()
      },
      append,
      dryRun: true,
      maxAttempts: 2,
      sleep: noSleep(),
      random: () => 0,
      nowIso: '2026-09-14T00:00:00.000Z',
    })
    expect(result.abort).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.deleted).toBe(0)
    expect(append).not.toHaveBeenCalled()
  })
})

describe('ops status helpers', () => {
  test('cleanup failure with later steps ok is degraded, not ok', () => {
    expect(morningOverallStatus({ cleanupFailed: true, laterStepsFailed: false })).toBe('degraded')
    expect(morningOverallStatus({ cleanupFailed: false, laterStepsFailed: false })).toBe('ok')
    expect(morningOverallStatus({ cleanupFailed: true, laterStepsFailed: true })).toBe('fail')
    const footer = summarizeCleanupForOps({
      abort: true,
      candidates: 0,
      archived: 0,
      deleted: 0,
      skippedConcurrent: 0,
      skippedDeleteMismatch: 0,
      remainingExpired: 412,
    })
    expect(footer.cleanup_status).toBe('fail')
    expect(footer.remaining_expired).toBe(412)
    expect(footer.remaining_stale).toBe('unavailable')
  })
})
