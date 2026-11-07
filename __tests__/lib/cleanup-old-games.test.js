import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  acquireCleanupRunLock,
  CLEANUP_LOCK_STALE_MS,
  CLEANUP_SERVER_STATEMENT_TIMEOUT_CAP_MS,
  runCleanupOldGames,
} from '../../lib/cleanup-old-games.js'
import { isOpsWriteQuietPeriod } from '../../lib/closing-line.js'

const OPEN = new Date('2026-11-08T17:20:00.000Z')
const QUIET = new Date('2026-11-08T17:10:00.000Z')

function game(partial = {}) {
  return {
    id: 'g1',
    sport: 'mlb',
    date: '2020-01-02T00:00:00.000Z',
    status: 'final',
    homeScore: 3,
    awayScore: 2,
    homeId: 'home',
    awayId: 'away',
    ...partial,
  }
}

function odds(partial = {}) {
  return {
    id: 'o1',
    gameId: 'g1',
    book: 'FanDuel',
    market: 'h2h',
    priceHome: -110,
    priceAway: -110,
    total: null,
    spread: null,
    ts: '2020-01-01T16:00:00.000Z',
    quotedAt: '2020-01-01T15:50:00.000Z',
    ...partial,
  }
}

function memoryLog() {
  const lines = []
  return {
    lines,
    log(message) { lines.push(String(message)) },
    error(message) { lines.push(String(message)) },
  }
}

function createDb(initial = {}, hooks = {}) {
  const state = {
    games: [...(initial.games || [game()])],
    odds: [...(initial.odds || [odds()])],
    closing: [],
    archived: [],
    edges: [...(initial.edges || [])],
    nfl: [...(initial.nfl || [])],
  }
  const events = []
  const rowsFor = (table) => {
    if (table === 'Game') return state.games
    if (table === 'Odds') return state.odds
    if (table === 'ClosingOdds') return state.closing
    if (table === 'ArchivedGame') return state.archived
    if (table === 'EdgeSnapshot') return state.edges
    if (table === 'NFLGameData') return state.nfl
    return []
  }

  function matches(row, filters) {
    return filters.every(([op, col, val]) => {
      if (op === 'eq') return row[col] === val
      if (op === 'is') return val == null ? row[col] == null : row[col] === val
      if (op === 'in') return val.includes(row[col])
      if (op === 'gt') return String(row[col]) > String(val)
      if (op === 'or') {
        return String(val).split(',').some((part) => {
          const lt = part.match(/^date\.lt\.(.+)$/)
          if (lt) return String(row.date) < lt[1]
          const gte = part.match(/^date\.gte\.(.+)$/)
          if (gte) return String(row.date) >= gte[1]
          return false
        })
      }
      return true
    })
  }

  function from(table) {
    const q = { filters: [], op: 'select', columns: '*' }
    const chain = {
      select(cols, options) {
        q.columns = typeof cols === 'string' ? cols : '*'
        q.head = Boolean(options?.head)
        if (q.op === 'delete') return Promise.resolve(execDelete())
        if (q.head) {
          chain.then = (resolve, reject) => Promise.resolve().then(execCount).then(resolve, reject)
        }
        return chain
      },
      eq(col, val) { q.filters.push(['eq', col, val]); return chain },
      is(col, val) { q.filters.push(['is', col, val]); return chain },
      or(expr) { q.filters.push(['or', 'date', expr]); return chain },
      in(col, val) { q.filters.push(['in', col, val]); return chain },
      gt(col, val) { q.filters.push(['gt', col, val]); return chain },
      order() { return chain },
      async limit(n) {
        if (table === 'Odds' && hooks.pauseOdds) await hooks.pauseOdds
        return execSelect(n)
      },
      delete() { q.op = 'delete'; return chain },
      upsert(body, options) { return Promise.resolve(execUpsert(body, options)) },
      insert(body) { return Promise.resolve(execUpsert(body, {})) },
    }

    function execSelect(n) {
      if (hooks.failDiscovery && table === 'Game' && q.columns === 'id, date, sport') {
        return { data: null, error: { message: 'game read failed' } }
      }
      if (hooks.failOdds && table === 'Odds') {
        const gameIds = q.filters.find((filter) => filter[0] === 'in' && filter[1] === 'gameId')?.[2] || []
        if (!hooks.failOddsGame || gameIds.includes(hooks.failOddsGame)) {
          events.push({ op: 'read', table, error: true })
          return { data: null, error: { message: 'odds read failed' } }
        }
      }
      let page = rowsFor(table)
        .filter((row) => matches(row, q.filters))
        .sort((a, b) => String(a.id ?? a.gameId).localeCompare(String(b.id ?? b.gameId)))
        .slice(0, n)
      const cap = hooks.truncateReads?.[table]
      if (Number.isFinite(cap)) page = page.slice(0, cap)
      events.push({ op: 'read', table, ids: page.map((row) => row.id ?? row.gameId) })
      hooks.onRead?.(table, page)
      return { data: page, error: null }
    }

    function execCount() {
      const matched = rowsFor(table).filter((row) => matches(row, q.filters))
      const inIds = q.filters.find((filter) => filter[0] === 'in' && filter[1] === 'id')?.[2] || null
      events.push({ op: 'count', table, ids: inIds })
      return { data: null, error: null, count: matched.length }
    }

    function execUpsert(body, options) {
      const rows = Array.isArray(body) ? body : [body]
      if (table === 'ArchivedGame' && hooks.archiveGameError) {
        return { error: { message: 'archive failed' } }
      }
      if (table === 'ClosingOdds' && hooks.missingQuotedAt && rows.some((row) => Object.prototype.hasOwnProperty.call(row, 'quoted_at'))) {
        hooks.missingQuotedAt = false
        return {
          error: { code: 'PGRST204', message: "Could not find the 'quoted_at' column of 'ClosingOdds' in the schema cache" },
        }
      }
      if (table === 'ClosingOdds' && hooks.dropClosingWrites) {
        events.push({ op: 'upsert', table, ids: rows.map((row) => row.id), dropped: true })
        return { error: null }
      }
      const target = rowsFor(table)
      for (const row of rows) {
        const stored = { ...row }
        if (table === 'ClosingOdds' && hooks.corruptPrice) stored.price_home = 999
        if (options?.ignoreDuplicates && target.some((item) => item.id === stored.id)) continue
        const index = target.findIndex((item) => item.id === stored.id)
        if (index >= 0) target[index] = stored
        else target.push(stored)
      }
      events.push({ op: 'upsert', table, ids: rows.map((row) => row.id), ignoreDuplicates: options?.ignoreDuplicates === true })
      hooks.onUpsert?.(table, rows)
      return { error: null }
    }

    function execDelete() {
      if (hooks.failDelete === table) {
        events.push({ op: 'delete', table, error: true })
        return { error: { message: `${table} delete failed` }, count: null }
      }
      if (table === 'Game') {
        const inIds = q.filters.find((filter) => filter[0] === 'in' && filter[1] === 'id')?.[2] || []
        const eqId = q.filters.find((filter) => filter[0] === 'eq' && filter[1] === 'id')?.[2]
        const ids = eqId == null ? inIds : [...inIds, eqId]
        const blocking = state.odds.filter((row) => ids.includes(row.gameId))
        if (blocking.length > 0) {
          events.push({ op: 'delete', table, error: true, column: 'id' })
          return { error: { message: 'odds fk' }, count: null }
        }
      }
      const target = rowsFor(table)
      const kept = []
      const removed = []
      for (const row of target) {
        if (matches(row, q.filters)) removed.push(row)
        else kept.push(row)
      }
      target.splice(0, target.length, ...kept)
      const column = q.filters.find((filter) => filter[0] === 'in')?.[1]
        || (q.filters.some((filter) => filter[0] === 'eq' && filter[1] === 'id') ? 'id' : null)
      events.push({
        op: 'delete',
        table,
        ids: removed.map((row) => row.id),
        column,
        filters: q.filters.map(([op, col]) => `${op}:${col}`),
      })
      hooks.onDelete?.(table, removed)
      return { error: null, count: removed.length, data: removed }
    }

    return chain
  }

  return { state, events, from, supabase: { from } }
}

function run(db, extra = {}) {
  return runCleanupOldGames({
    supabase: db.supabase,
    now: extra.now || (() => OPEN),
    acquireLock: extra.acquireLock || (() => ({ acquired: true, release() {} })),
    log: extra.log || memoryLog(),
    pageSize: extra.pageSize || 1000,
    batchSize: extra.batchSize || 50,
    archiveChunkSize: extra.archiveChunkSize,
    renewEveryMs: extra.renewEveryMs,
    operationTimeoutMs: extra.operationTimeoutMs,
  })
}

describe('runCleanupOldGames', () => {
  test('the lock lease is longer than the verified client statement timeout cap', () => {
    expect(CLEANUP_SERVER_STATEMENT_TIMEOUT_CAP_MS).toBe(60 * 1000)
    expect(CLEANUP_LOCK_STALE_MS).toBeGreaterThan(CLEANUP_SERVER_STATEMENT_TIMEOUT_CAP_MS)
  })

  test('quiet clock is the ET :05–:15 window', () => {
    expect(isOpsWriteQuietPeriod(QUIET)).toBe(true)
    expect(isOpsWriteQuietPeriod(OPEN)).toBe(false)
  })

  test('copies the retained row, verifies it, then deletes', async () => {
    const db = createDb()
    const result = await run(db)
    expect(result.status).toBe('ok')
    expect(result.deletedGames).toBe(1)
    expect(db.state.games).toEqual([])
    expect(db.state.odds).toEqual([])
    expect(db.state.closing.map((row) => row.id)).toEqual(['oddsret:o1'])
    expect(db.state.archived.map((row) => row.id)).toEqual(['g1'])
    const closingWrite = db.events.find((event) => event.op === 'upsert' && event.table === 'ClosingOdds')
    const firstDelete = db.events.findIndex((event) => event.op === 'delete')
    const closingAt = db.events.indexOf(closingWrite)
    expect(closingAt).toBeGreaterThanOrEqual(0)
    expect(closingAt).toBeLessThan(firstDelete)
    expect(closingWrite.ignoreDuplicates).toBe(true)
    const oddsDelete = db.events.find((event) => event.op === 'delete' && event.table === 'Odds')
    expect(oddsDelete.column).toBe('id')
    expect(oddsDelete.ids).toEqual(['o1'])
  })

  test('an odds read error deletes nothing', async () => {
    const db = createDb({}, { failOdds: true })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('odds-read')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.games).toHaveLength(1)
    expect(db.state.odds).toHaveLength(1)
  })

  test('a game discovery error deletes nothing', async () => {
    const db = createDb({}, { failDiscovery: true })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('game-read')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
  })

  test('pages the odds read before deleting', async () => {
    const db = createDb({
      odds: [
        odds({ id: 'o1', ts: '2020-01-01T14:00:00.000Z', quotedAt: '2020-01-01T13:50:00.000Z' }),
        odds({ id: 'o2', ts: '2020-01-01T16:00:00.000Z', quotedAt: '2020-01-01T15:50:00.000Z' }),
        odds({ id: 'o3', ts: '2020-01-01T23:40:00.000Z', quotedAt: '2020-01-01T23:30:00.000Z' }),
      ],
    })
    const result = await run(db, { pageSize: 1 })
    expect(result.status).toBe('ok')
    const oddsReads = db.events.filter((event) => event.op === 'read' && event.table === 'Odds')
    expect(oddsReads.length).toBeGreaterThanOrEqual(3)
    expect(db.state.closing.map((row) => row.id).sort()).toEqual(['oddsret:o1', 'oddsret:o2', 'oddsret:o3'])
    expect(db.state.odds).toEqual([])
  })

  test('retries a missing quoted_at column and still verifies before delete', async () => {
    const db = createDb({}, { missingQuotedAt: true })
    const result = await run(db)
    expect(result.status).toBe('ok')
    expect(db.state.closing).toHaveLength(1)
    expect(db.state.closing[0].quoted_at).toBeUndefined()
    expect(db.state.closing[0].id).toBe('oddsret:o1')
    expect(db.state.games).toEqual([])
  })

  test('a short closing verify blocks every delete', async () => {
    const db = createDb({}, { dropClosingWrites: true })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('odds-archive')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.odds).toHaveLength(1)
  })

  test('a failed game archive blocks that batch and later deletes', async () => {
    const db = createDb({
      games: [game(), game({ id: 'g2' })],
      odds: [odds(), odds({ id: 'o2', gameId: 'g2' })],
    }, { archiveGameError: true })
    const result = await run(db, { batchSize: 1 })
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('game-archive')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.games).toHaveLength(2)
  })

  test('an odds failure on a later batch deletes nothing already copied', async () => {
    const db = createDb({
      games: [game(), game({ id: 'g2' })],
      odds: [odds(), odds({ id: 'o2', gameId: 'g2' })],
    }, { failOdds: true, failOddsGame: 'g2' })
    const result = await run(db, { batchSize: 1 })
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('odds-read')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.games.map((item) => item.id).sort()).toEqual(['g1', 'g2'])
    expect(db.state.closing.map((row) => row.id)).toEqual(['oddsret:o1'])
  })

  test('a delete failure stops the later tables', async () => {
    const db = createDb({ edges: [{ id: 'e1', gameId: 'g1' }] }, { failDelete: 'EdgeSnapshot' })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('delete')
    expect(db.events.filter((event) => event.op === 'delete').map((event) => event.table)).toEqual(['Odds', 'EdgeSnapshot'])
    expect(db.state.games).toHaveLength(1)
    expect(db.state.odds).toEqual([])
  })

  test('a quiet clock before the odds delete leaves the copy in place', async () => {
    let quiet = false
    const db = createDb({}, {
      onUpsert(table) {
        if (table === 'ClosingOdds') quiet = true
      },
    })
    const result = await run(db, { now: () => (quiet ? QUIET : OPEN) })
    expect(result.status).toBe('quiet')
    expect(result.deletedGames).toBe(0)
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.closing.map((row) => row.id)).toEqual(['oddsret:o1'])
    expect(db.state.games).toHaveLength(1)
  })

  test('a quiet clock before the next archive chunk stops every delete', async () => {
    let quiet = false
    const db = createDb({
      odds: [
        odds({ id: 'o1', ts: '2020-01-01T14:00:00.000Z', quotedAt: '2020-01-01T13:50:00.000Z' }),
        odds({ id: 'o2', ts: '2020-01-01T16:00:00.000Z', quotedAt: '2020-01-01T15:50:00.000Z' }),
      ],
    }, {
      onUpsert(table) {
        if (table === 'ClosingOdds') quiet = true
      },
    })
    const result = await run(db, {
      archiveChunkSize: 1,
      now: () => (quiet ? QUIET : OPEN),
    })
    expect(result.status).toBe('quiet')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.closing).toHaveLength(1)
    expect(db.state.odds).toHaveLength(2)
    expect(db.state.games).toHaveLength(1)
  })

  test('a quiet clock before the next table delete stops there', async () => {
    let quiet = false
    const db = createDb({}, {
      onDelete(table) {
        if (table === 'Odds') quiet = true
      },
    })
    const result = await run(db, { now: () => (quiet ? QUIET : OPEN) })
    expect(result.status).toBe('quiet')
    expect(db.events.filter((event) => event.op === 'delete').map((event) => event.table)).toEqual(['Odds'])
    expect(db.state.games).toHaveLength(1)
    expect(db.state.odds).toEqual([])
  })

  test('a second run does no work while the first holds the lock', async () => {
    let releaseGate
    const gate = new Promise((resolve) => { releaseGate = resolve })
    let held = false
    const acquireLock = () => {
      if (held) return { acquired: false, release() {} }
      held = true
      return { acquired: true, release() { held = false } }
    }
    const db = createDb({}, { pauseOdds: gate })
    const log = memoryLog()
    const first = run(db, { acquireLock, log })
    const second = await run(createDb(), {
      acquireLock,
      log,
      supabase: undefined,
    })
    expect(second.status).toBe('locked')
    expect(second.deletedGames).toBe(0)
    releaseGate()
    const finished = await first
    expect(finished.status).toBe('ok')
    expect(held).toBe(false)
  })

  test('the file lock refuses an overlapping run', async () => {
    const persistPath = path.join(os.tmpdir(), `ood-cleanup-${process.pid}-${Date.now()}`)
    const first = acquireCleanupRunLock({ persistPath })
    expect(first.acquired).toBe(true)
    const db = createDb()
    const result = await run(db, {
      acquireLock: () => acquireCleanupRunLock({ persistPath }),
    })
    expect(result.status).toBe('locked')
    expect(db.events).toEqual([])
    first.release()
  })

  test('a mismatched price on read-back blocks the delete', async () => {
    const db = createDb({}, { corruptPrice: true })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('odds-archive')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.odds).toHaveLength(1)
  })

  test('deletes only the odds ids that were read', async () => {
    const db = createDb({
      odds: [
        odds(),
        odds({ id: 'o-skip', ts: '2020-01-01T23:10:00.000Z', quotedAt: '2020-01-01T23:00:00.000Z' }),
      ],
    }, {
      onUpsert(table) {
        if (table === 'ClosingOdds') {
          db.state.odds.push(odds({ id: 'o-new', ts: '2020-01-01T16:05:00.000Z', quotedAt: '2020-01-01T16:00:00.000Z' }))
        }
      },
    })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('delete')
    const oddsDelete = db.events.find((event) => event.op === 'delete' && event.table === 'Odds')
    expect(oddsDelete.column).toBe('id')
    expect([...oddsDelete.ids].sort()).toEqual(['o-skip', 'o1'])
    expect(db.state.closing.map((row) => row.id)).toEqual(['oddsret:o1'])
    expect(db.state.odds.map((row) => row.id)).toEqual(['o-new'])
    expect(db.state.games).toHaveLength(1)
  })

  test('an empty page before the count is met still fails the read', async () => {
    const db = createDb({}, { truncateReads: { Odds: 0 } })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('odds-read')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.odds).toHaveLength(1)
  })

  test('a short page lowers the page size and the read still finishes', async () => {
    const db = createDb({
      odds: [
        odds({ id: 'o1' }),
        odds({ id: 'o2', ts: '2020-01-01T15:00:00.000Z', quotedAt: '2020-01-01T14:50:00.000Z' }),
        odds({ id: 'o3', ts: '2020-01-01T14:00:00.000Z', quotedAt: '2020-01-01T13:50:00.000Z' }),
      ],
    }, { truncateReads: { Odds: 1 } })
    const result = await run(db)
    expect(result.status).toBe('ok')
    expect(result.deletedGames).toBe(1)
    expect(db.state.closing.map((row) => row.id).sort()).toEqual(['oddsret:o1', 'oddsret:o2', 'oddsret:o3'])
    expect(db.state.odds).toEqual([])
  })

  test('a null quote in the lock window is copied and flagged', async () => {
    const db = createDb({
      odds: [odds({ quotedAt: null })],
    })
    const log = memoryLog()
    const result = await run(db, { log })
    expect(result.status).toBe('ok')
    expect(db.state.closing[0]).toMatchObject({ id: 'oddsret:o1', quoted_at: null })
    expect(log.lines.some((line) => line.includes('1 quote-time-unknown, not lock-eligible; 0 lock-eligible'))).toBe(true)
    expect(log.lines.some((line) => line.includes('ClosingOdds archive grew by 1 row(s) observed this run.'))).toBe(true)
  })

  test('archive growth counts chunk the archive ids', async () => {
    const db = createDb({
      odds: [
        odds({ id: 'o1', ts: '2020-01-01T14:00:00.000Z', quotedAt: '2020-01-01T13:50:00.000Z' }),
        odds({ id: 'o2', ts: '2020-01-01T16:00:00.000Z', quotedAt: '2020-01-01T15:50:00.000Z' }),
      ],
    })
    const log = memoryLog()
    const result = await run(db, { log, pageSize: 1 })
    expect(result.status).toBe('ok')
    const growthCounts = db.events.filter((event) => (
      event.op === 'count' && event.table === 'ClosingOdds' && Array.isArray(event.ids)
    ))
    expect(growthCounts.length).toBeGreaterThanOrEqual(4)
    expect(growthCounts.every((event) => event.ids.length === 1)).toBe(true)
    const countedIds = growthCounts.map((event) => event.ids[0])
    expect(countedIds.filter((id) => id === 'oddsret:o1').length).toBeGreaterThanOrEqual(2)
    expect(countedIds.filter((id) => id === 'oddsret:o2').length).toBeGreaterThanOrEqual(2)
    expect(new Set(countedIds)).toEqual(new Set(['oddsret:o1', 'oddsret:o2']))
    expect(log.lines.some((line) => line.includes('ClosingOdds archive grew by 2 row(s) observed this run.'))).toBe(true)
  })

  test('a changed date, status, or lastUpdate skips the non-odds deletes', async () => {
    const db = createDb({
      edges: [{ id: 'e1', gameId: 'g1' }],
      nfl: [{ id: 'g1', gameId: 'g1' }],
    }, {
      onDelete(table) {
        if (table === 'Odds') {
          db.state.games[0].date = OPEN.toISOString()
          db.state.games[0].status = 'scheduled'
          db.state.games[0].lastUpdate = OPEN.toISOString()
        }
      },
    })
    const result = await run(db)
    expect(result.status).toBe('ok')
    expect(result.deletedGames).toBe(0)
    expect(db.state.games).toHaveLength(1)
    expect(db.state.edges.map((row) => row.id)).toEqual(['e1'])
    expect(db.state.nfl.map((row) => row.gameId)).toEqual(['g1'])
    expect(db.events.some((event) => event.op === 'delete' && event.table === 'Game')).toBe(false)
  })

  test('the game delete predicates reject a row that changed after the re-read', async () => {
    const db = createDb({}, {
      onRead(table) {
        if (table === 'EdgeSnapshot') db.state.games[0].status = 'scheduled'
      },
    })
    const result = await run(db)
    expect(result.status).toBe('ok')
    expect(result.deletedGames).toBe(0)
    expect(db.state.games).toHaveLength(1)
    expect(db.state.games[0].status).toBe('scheduled')
    const gameDelete = db.events.find((event) => event.op === 'delete' && event.table === 'Game')
    expect(gameDelete.ids).toEqual([])
    expect(gameDelete.filters).toEqual(expect.arrayContaining(['eq:id', 'eq:date', 'eq:status', 'is:lastUpdate']))
  })

  test('an edge or nfl row inserted after the re-read is not deleted', async () => {
    const db = createDb({
      edges: [{ id: 'e1', gameId: 'g1' }],
      nfl: [{ id: 'g1', gameId: 'g1' }],
    }, {
      onRead(table) {
        if (table === 'EdgeSnapshot' && !db.state.edges.some((row) => row.id === 'e-new')) {
          db.state.edges.push({ id: 'e-new', gameId: 'g1' })
        }
        if (table === 'NFLGameData' && !db.state.nfl.some((row) => row.gameId === 'g-new')) {
          db.state.nfl.push({ id: 'g-new', gameId: 'g-new' })
        }
      },
    })
    const result = await run(db)
    expect(result.status).toBe('ok')
    expect(result.deletedGames).toBe(1)
    const edgeDelete = db.events.find((event) => event.op === 'delete' && event.table === 'EdgeSnapshot')
    expect(edgeDelete.column).toBe('id')
    expect(edgeDelete.ids).toEqual(['e1'])
    expect(db.state.edges.map((row) => row.id)).toEqual(['e-new'])
    const nflDelete = db.events.find((event) => event.op === 'delete' && event.table === 'NFLGameData')
    expect(nflDelete.column).toBe('gameId')
    expect(nflDelete.ids).toEqual(['g1'])
    expect(db.state.nfl.map((row) => row.gameId)).toEqual(['g-new'])
  })

  test('a failed lock renewal aborts the in-flight read and later deletes', async () => {
    const started = Date.now()
    const db = createDb({}, { pauseOdds: new Promise(() => {}) })
    const result = await run(db, {
      renewEveryMs: 15,
      operationTimeoutMs: 1000,
      acquireLock: () => ({
        acquired: true,
        heartbeat: () => Date.now() - started < 40,
        release() {},
      }),
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('lock')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.games).toHaveLength(1)
    expect(db.state.odds).toHaveLength(1)
  })

  test('a call that outlives the operation timeout aborts later work', async () => {
    let released = false
    const db = createDb({}, { pauseOdds: new Promise(() => {}) })
    const log = memoryLog()
    const result = await run(db, {
      log,
      renewEveryMs: 60_000,
      operationTimeoutMs: 40,
      acquireLock: () => ({
        acquired: true,
        heartbeat: () => true,
        release() { released = true },
      }),
    })
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('timeout')
    expect(released).toBe(false)
    expect(log.lines.some((line) => line.includes('The cleanup lock stays until the lease expires'))).toBe(true)
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.odds).toHaveLength(1)
  })

  test('a heartbeat keeps a live lock from being stolen after the stale window', () => {
    const persistPath = path.join(os.tmpdir(), `ood-cleanup-beat-${process.pid}-${Date.now()}`)
    const lockFile = `${persistPath}.lock`
    const first = acquireCleanupRunLock({ persistPath, staleMs: 1000 })
    expect(first.acquired).toBe(true)
    const old = new Date(Date.now() - 60 * 1000)
    fs.utimesSync(lockFile, old, old)
    expect(first.heartbeat()).toBe(true)
    const second = acquireCleanupRunLock({ persistPath, staleMs: 1000 })
    expect(second.acquired).toBe(false)
    first.release()
    const crashed = acquireCleanupRunLock({ persistPath, staleMs: 1000 })
    expect(crashed.acquired).toBe(true)
    const stale = new Date(Date.now() - 60 * 1000)
    fs.utimesSync(lockFile, stale, stale)
    const recovered = acquireCleanupRunLock({ persistPath, staleMs: 1000 })
    expect(recovered.acquired).toBe(true)
    recovered.release()
  })

  test('an unparseable start blocks the delete', async () => {
    const db = createDb({
      games: [game({ date: 'not-a-start' })],
    })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('retention')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.games).toHaveLength(1)
  })
})
