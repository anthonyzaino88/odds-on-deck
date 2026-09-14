import fs from 'fs'
import os from 'os'
import path from 'path'
import { appendJsonlVerified } from '../../lib/local-archive.js'
import {
  archiveCleanupRows,
  collectCleanupCandidates,
  dedupeCleanupCandidates,
  filterUnchangedSnapshots,
  runPropCacheCleanup,
} from '../../lib/prop-cache-cleanup.js'
import { propCacheVersionSnapshot } from '../../lib/prop-line-archive.js'

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

describe('cleanup candidate pagination + dedupe', () => {
  test('orders pages and dedupes overlapping filters', async () => {
    const expired = [cacheRow({ id: 'b' }), cacheRow({ id: 'a' })]
    const stale = [cacheRow({ id: 'a' }), cacheRow({ id: 'c' })]
    const past = [cacheRow({ id: 'c' })]

    const fetchPage = jest.fn(async ({ filter, from, to }) => {
      const src = filter.name === 'expired' ? expired : filter.name === 'stale' ? stale : past
      return src.slice(from, to + 1)
    })

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
    const fetchPage = jest.fn(async ({ from }) => (from === 0 ? [cacheRow()] : []))
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
      fetchPage: async ({ from }) => (from === 0 ? rows : []),
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
      fetchPage: async ({ from }) => (from === 0 ? [original] : []),
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
    expect(deleted).toEqual([])

    const { skippedConcurrent } = filterUnchangedSnapshots(
      [refreshed],
      [{ snapshot: propCacheVersionSnapshot(original), row: original }]
    )
    expect(skippedConcurrent).toHaveLength(1)
  })

  test('verified archive then exact-version delete', async () => {
    const row = cacheRow()
    const deleted = []
    const result = await runPropCacheCleanup({
      fetchPage: async ({ from }) => (from === 0 ? [row] : []),
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
    expect(line.odds_format).toBe('american')
    expect(line.num_books).toBe(3)
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
