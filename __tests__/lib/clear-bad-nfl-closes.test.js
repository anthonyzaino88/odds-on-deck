import {
  assertClearBadNflClosesApplyAllowed,
  backupFileName,
  clearBadNflClosesPayload,
  gameOnEtDate,
  isHostedOrCiProduction,
  isMovedNflClose,
  parseClearBadNflClosesArgs,
  parseYyyyMmDd,
  rowsToJsonl,
} from '../../lib/clear-bad-nfl-closes.js'
import {
  formatClearModeBanner,
  runClearBadNflCloses,
} from '../../scripts/clear-bad-nfl-closes.js'
import { CLOSE_ODDS_FIELDS } from '../../lib/closing-line.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function movedPick(overrides = {}) {
  return {
    id: 'pv-stafford',
    propId: 'prop-stafford',
    gameIdRef: 'LA_at_SEA_2026-10-26',
    playerName: 'Matthew Stafford',
    propType: 'pass_yds',
    threshold: 219.5,
    prediction: 'over',
    odds: -110,
    sport: 'nfl',
    source: 'system_generated',
    status: 'pending',
    closeOdds: 170,
    closeLine: 281.5,
    closeBook: 'FanDuel',
    closeNumBooks: 3,
    closeCapturedAt: '2026-10-26T19:50:00.000Z',
    ...overrides,
  }
}

function nflGame(overrides = {}) {
  return {
    id: 'LA_at_SEA_2026-10-26',
    sport: 'nfl',
    date: '2026-10-26T20:15:00.000Z',
    ...overrides,
  }
}

function chainable(terminal) {
  const query = {
    select() { return query },
    eq() { return query },
    in() { return query },
    not() { return query },
    gte() { return query },
    lt() { return terminal },
    order() { return query },
    range() { return terminal },
    then: terminal.then?.bind(terminal),
  }
  return query
}

function mockClient({
  games = [nflGame()],
  picks = [movedPick()],
  updates = [],
} = {}) {
  return {
    from(table) {
      if (table === 'Game') {
        return chainable(Promise.resolve({ data: games, error: null }))
      }
      return {
        select() {
          const terminal = Promise.resolve({ data: picks, error: null })
          const query = chainable(terminal)
          query.update = (body) => {
            updates.push(body)
            const chain = {
              eq() { return chain },
              then(resolve, reject) {
                return Promise.resolve({ data: [{ id: picks[0]?.id }], error: null })
                  .then(resolve, reject)
              },
            }
            return chain
          }
          return query
        },
        update(body) {
          updates.push(body)
          const chain = {
            eq() { return chain },
            then(resolve, reject) {
              return Promise.resolve({ data: [{ id: picks[0]?.id }], error: null })
                .then(resolve, reject)
            },
          }
          return chain
        },
      }
    },
  }
}

describe('clear-bad-nfl-closes flags', () => {
  test('defaults to dry-run and requires --date', () => {
    expect(parseClearBadNflClosesArgs([])).toMatchObject({
      apply: false,
      dryRun: true,
      dateMissing: true,
      date: null,
    })
    expect(parseClearBadNflClosesArgs(['--date', '2026-10-26'])).toMatchObject({
      apply: false,
      dryRun: true,
      date: '2026-10-26',
    })
    expect(parseClearBadNflClosesArgs(['--date', '2026-10-26', '--apply'])).toMatchObject({
      apply: true,
      dryRun: false,
      date: '2026-10-26',
    })
    expect(parseClearBadNflClosesArgs(['--date', '2026-10-26', '--apply', '--dry-run'])).toMatchObject({
      apply: false,
      dryRun: true,
    })
    expect(parseClearBadNflClosesArgs(['--date', '26-10-2026']).invalidFlags).toEqual(['--date'])
    expect(parseYyyyMmDd('2026-10-26')).toBe('2026-10-26')
    expect(parseYyyyMmDd('nope')).toBeNull()
  })
})

describe('moved NFL close selection', () => {
  test('only NFL rows whose closeLine left the recorded threshold', () => {
    expect(isMovedNflClose(movedPick())).toBe(true)
    expect(isMovedNflClose(movedPick({ closeLine: 219.5 }))).toBe(false)
    expect(isMovedNflClose(movedPick({ sport: 'mlb' }))).toBe(false)
    expect(isMovedNflClose(movedPick({ closeLine: null }))).toBe(false)
    expect(gameOnEtDate(nflGame(), '2026-10-26')).toBe(true)
    expect(gameOnEtDate(nflGame(), '2026-10-27')).toBe(false)
  })

  test('apply payload nulls existing close columns only', () => {
    expect(clearBadNflClosesPayload()).toEqual({
      closeOdds: null,
      closeLine: null,
      closeBook: null,
      closeNumBooks: null,
      closeCapturedAt: null,
    })
    expect(Object.keys(clearBadNflClosesPayload()).sort()).toEqual([...CLOSE_ODDS_FIELDS].sort())
  })

  test('JSONL backup is one object per line', () => {
    const text = rowsToJsonl([movedPick(), movedPick({ id: 'pv-2' })])
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).id).toBe('pv-stafford')
    expect(backupFileName('2026-10-26', new Date('2026-10-27T01:02:03.000Z')))
      .toMatch(/^clear-bad-nfl-closes-2026-10-26-/)
  })
})

describe('prod / CI apply guard', () => {
  test('refuses --apply in CI or hosted production', () => {
    expect(isHostedOrCiProduction({ CI: 'true' })).toBe(true)
    expect(isHostedOrCiProduction({ VERCEL_ENV: 'production' })).toBe(true)
    expect(isHostedOrCiProduction({ SUPABASE_ENV: 'production' })).toBe(true)
    expect(isHostedOrCiProduction({})).toBe(false)
    expect(() => assertClearBadNflClosesApplyAllowed({ CI: '1' })).toThrow(/production/)
    expect(() => assertClearBadNflClosesApplyAllowed({})).not.toThrow()
  })
})

describe('runClearBadNflCloses', () => {
  test('dry-run lists moved closes and never writes', async () => {
    const updates = []
    const writes = []
    const log = memoryLog()
    const result = await runClearBadNflCloses({
      argv: ['--date', '2026-10-26'],
      createClient: () => mockClient({ updates }),
      writeFile: (path, body) => writes.push({ path, body }),
      mkdir: () => {},
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.applied).toBe(0)
    expect(result.rows).toHaveLength(1)
    expect(updates).toHaveLength(0)
    expect(writes).toHaveLength(0)
    expect(log.lines[0]).toBe(formatClearModeBanner(false))
    expect(log.lines.join('\n')).toMatch(/would clear pv-stafford/)
    expect(log.lines.join('\n')).toMatch(/219\.5/)
    expect(log.lines.join('\n')).toMatch(/281\.5/)
    expect(log.lines.join('\n')).toMatch(/Do not run --apply against production/)
  })

  test('same-line closes stay off the list', async () => {
    const result = await runClearBadNflCloses({
      argv: ['--date', '2026-10-26'],
      createClient: () => mockClient({
        picks: [movedPick({ closeLine: 219.5 })],
      }),
      log: memoryLog(),
    })
    expect(result.rows).toHaveLength(0)
  })

  test('--apply is refused in CI without writing', async () => {
    const updates = []
    const writes = []
    const result = await runClearBadNflCloses({
      argv: ['--date', '2026-10-26', '--apply'],
      env: { CI: 'true' },
      createClient: () => mockClient({ updates }),
      writeFile: (path, body) => writes.push({ path, body }),
      log: memoryLog(),
    })
    expect(result).toMatchObject({ exitCode: 1, refusedProd: true, applied: 0 })
    expect(updates).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  test('--apply backs up JSONL then nulls close fields', async () => {
    const updates = []
    const writes = []
    const log = memoryLog()
    const result = await runClearBadNflCloses({
      argv: ['--date', '2026-10-26', '--apply', '--backup-dir', '/tmp/clear-bad-closes'],
      env: {},
      now: new Date('2026-10-27T01:02:03.000Z'),
      createClient: () => mockClient({ updates }),
      writeFile: (path, body) => writes.push({ path, body }),
      mkdir: () => {},
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.applied).toBe(1)
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toMatch(/clear-bad-nfl-closes-2026-10-26-/)
    expect(writes[0].body).toMatch(/pv-stafford/)
    expect(writes[0].body.trim().split('\n')).toHaveLength(1)
    expect(updates[0]).toEqual(clearBadNflClosesPayload())
    expect(log.lines[0]).toBe('MODE: APPLY')
    expect(log.lines.join('\n')).toMatch(/close fields nulled/)
  })

  test('missing --date fails closed', async () => {
    const createClient = jest.fn()
    const result = await runClearBadNflCloses({
      argv: [],
      createClient,
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(1)
    expect(result.missingDate).toBe(true)
    expect(createClient).not.toHaveBeenCalled()
  })
})
