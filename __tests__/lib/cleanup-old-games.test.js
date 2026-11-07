import os from 'os'
import path from 'path'
import {
  acquireCleanupRunLock,
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
    nfl: [],
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
      select(cols) {
        q.columns = typeof cols === 'string' ? cols : '*'
        if (q.op === 'delete') return Promise.resolve(execDelete())
        return chain
      },
      eq(col, val) { q.filters.push(['eq', col, val]); return chain },
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
      const page = rowsFor(table)
        .filter((row) => matches(row, q.filters))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(0, n)
      events.push({ op: 'read', table, ids: page.map((row) => row.id) })
      return { data: page, error: null }
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
        if (options?.ignoreDuplicates && target.some((item) => item.id === row.id)) continue
        const index = target.findIndex((item) => item.id === row.id)
        if (index >= 0) target[index] = { ...row }
        else target.push({ ...row })
      }
      events.push({ op: 'upsert', table, ids: rows.map((row) => row.id), ignoreDuplicates: options?.ignoreDuplicates === true })
      return { error: null }
    }

    function execDelete() {
      if (hooks.failDelete === table) {
        events.push({ op: 'delete', table, error: true })
        return { error: { message: `${table} delete failed` }, count: null }
      }
      const target = rowsFor(table)
      const kept = []
      const removed = []
      for (const row of target) {
        if (matches(row, q.filters)) removed.push(row)
        else kept.push(row)
      }
      target.splice(0, target.length, ...kept)
      events.push({ op: 'delete', table, ids: removed.map((row) => row.id) })
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
  })
}

describe('runCleanupOldGames', () => {
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
    expect(db.state.closing.map((row) => row.id).sort()).toEqual(['oddsret:o2', 'oddsret:o3'])
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
    const db = createDb({}, { failDelete: 'EdgeSnapshot' })
    const result = await run(db)
    expect(result.status).toBe('failed')
    expect(result.reason).toBe('delete')
    expect(db.events.filter((event) => event.op === 'delete').map((event) => event.table)).toEqual(['Odds', 'EdgeSnapshot'])
    expect(db.state.games).toHaveLength(1)
    expect(db.state.odds).toEqual([])
  })

  test('a quiet clock before the delete batch leaves the copy in place', async () => {
    let calls = 0
    const db = createDb()
    const result = await run(db, {
      now: () => {
        calls += 1
        return calls >= 4 ? QUIET : OPEN
      },
    })
    expect(result.status).toBe('quiet')
    expect(result.deletedGames).toBe(0)
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.closing.map((row) => row.id)).toEqual(['oddsret:o1'])
    expect(db.state.games).toHaveLength(1)
  })

  test('a quiet clock before a later copy batch stops every delete', async () => {
    let calls = 0
    const db = createDb({
      games: [game(), game({ id: 'g2' })],
      odds: [odds(), odds({ id: 'o2', gameId: 'g2' })],
    })
    const result = await run(db, {
      batchSize: 1,
      now: () => {
        calls += 1
        return calls >= 4 ? QUIET : OPEN
      },
    })
    expect(result.status).toBe('quiet')
    expect(db.events.some((event) => event.op === 'delete')).toBe(false)
    expect(db.state.games).toHaveLength(2)
    expect(db.state.closing.map((row) => row.id)).toEqual(['oddsret:o1'])
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
