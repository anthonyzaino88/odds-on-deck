import { createScriptSupabaseClient } from '../../lib/supabase-script-client.js'
import { isPublishableSupabaseKey } from '../../lib/supabase-admin-key.js'
import { PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import {
  ALREADY_CLOSED_RECAPTURE_MINUTES,
  assertCaptureSecretIsNotPublishable,
  captureSupabaseEnv,
  formatCaptureModeBanner,
  isClosingCaptureDisabled,
  parseCaptureClosesArgs,
  publishedCloseAlreadyStored,
  runCapturePublishedCloses,
  shouldRecaptureStoredClose,
} from '../../scripts/capture-published-closes.js'
import { createOddsApiBudget } from '../../lib/odds-api-budget.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function publishedPick(overrides = {}) {
  return {
    id: 'pv-vinnie',
    propId: 'prop-vinnie',
    gameIdRef: 'KC_at_HOU_2026-07-15',
    playerName: 'Vinnie Pasquantino',
    propType: 'batter_hits',
    threshold: 0.5,
    prediction: 'over',
    odds: -105,
    edge: 0.06,
    qualityScore: 52,
    sport: 'mlb',
    source: PUBLISHED_SOURCE,
    status: 'pending',
    closeOdds: null,
    closeCapturedAt: null,
    ...overrides,
  }
}

function windowGame(overrides = {}) {
  return {
    id: 'KC_at_HOU_2026-07-15',
    sport: 'mlb',
    date: '2026-07-15T23:10:00.000Z',
    status: 'scheduled',
    oddsApiEventId: 'evt-kc-hou',
    ...overrides,
  }
}

function chainable(terminal) {
  const query = {
    select() { return query },
    eq() { return query },
    in() { return query },
    gt() { return query },
    gte() { return query },
    lte() { return terminal },
    order() { return query },
    range() { return terminal },
    then: terminal.then?.bind(terminal),
  }
  return query
}

function nflWindowGame(overrides = {}) {
  return {
    id: 'KC_at_BUF_2026-07-15',
    sport: 'nfl',
    date: '2026-07-15T23:10:00.000Z',
    status: 'scheduled',
    oddsApiEventId: 'evt-kc-buf',
    ...overrides,
  }
}

function nflPendingPick(overrides = {}) {
  return {
    id: 'pv-kelce',
    propId: 'prop-kelce',
    gameIdRef: 'KC_at_BUF_2026-07-15',
    playerName: 'Travis Kelce',
    propType: 'player_receptions',
    threshold: 5.5,
    prediction: 'over',
    odds: -110,
    edge: 0,
    qualityScore: 18,
    sport: 'nfl',
    source: 'user_saved',
    status: 'pending',
    closeOdds: null,
    closeCapturedAt: null,
    ...overrides,
  }
}

function nflEventOdds() {
  return {
    home_team: 'Kansas City Chiefs',
    away_team: 'Buffalo Bills',
    bookmakers: [{
      title: 'FanDuel',
      markets: [
        {
          key: 'player_receptions',
          outcomes: [
            { name: 'Over', description: 'Travis Kelce', point: 5.5, price: -115 },
          ],
        },
        {
          key: 'h2h',
          last_update: '2026-07-15T22:40:00.000Z',
          outcomes: [
            { name: 'Kansas City Chiefs', price: -150 },
            { name: 'Buffalo Bills', price: 130 },
          ],
        },
        {
          key: 'spreads',
          last_update: '2026-07-15T22:40:00.000Z',
          outcomes: [
            { name: 'Kansas City Chiefs', price: -110, point: -3.5 },
            { name: 'Buffalo Bills', price: -110, point: 3.5 },
          ],
        },
        {
          key: 'totals',
          last_update: '2026-07-15T22:40:00.000Z',
          outcomes: [
            { name: 'Over', price: -108, point: 47.5 },
            { name: 'Under', price: -112, point: 47.5 },
          ],
        },
      ],
    }],
  }
}

function mockClient({
  games = [windowGame()],
  picks = [publishedPick()],
  pickError = null,
  updates = [],
  closingOdds = [],
  closingInserts = [],
  closingInsert = null,
  edges = [],
  edgeError = null,
  edgeTrace = null,
  edgePages = null,
} = {}) {
  return {
    from(table) {
      if (table === 'Game') {
        return chainable(Promise.resolve({ data: games, error: null }))
      }
      if (table === 'EdgeSnapshot') {
        const terminal = Promise.resolve({
          data: edgeError ? null : edges,
          error: edgeError,
        })
        const query = chainable(terminal)
        query.in = () => query
        if (edgeTrace || edgePages) {
          query.order = (col, opts) => {
            edgeTrace?.push(['order', col, Boolean(opts?.ascending)])
            return query
          }
          query.range = (from, to) => {
            edgeTrace?.push(['range', from, to])
            const data = edgePages ? edgePages(from, to) : (edgeError ? null : edges)
            return Promise.resolve({ data, error: edgeError })
          }
        }
        return { select() { return query } }
      }
      if (table === 'ClosingOdds') {
        const query = {
          select() { return query },
          eq() { return query },
          in() { return query },
          order() { return query },
          range() {
            return Promise.resolve({ data: closingOdds, error: null })
          },
          then(resolve, reject) {
            return Promise.resolve({ data: closingOdds, error: null }).then(resolve, reject)
          },
          insert(rows) {
            const list = Array.isArray(rows) ? rows : [rows]
            if (closingInsert) return closingInsert(list, { closingOdds, closingInserts })
            closingInserts.push(...list)
            closingOdds.push(...list)
            return Promise.resolve({ data: list, error: null })
          },
          upsert(rows) {
            const list = Array.isArray(rows) ? rows : [rows]
            if (closingInsert) return closingInsert(list, { closingOdds, closingInserts, upsert: true })
            for (const row of list) {
              const idx = closingOdds.findIndex((existing) => existing.id === row.id)
              if (idx >= 0) closingOdds[idx] = { ...closingOdds[idx], ...row }
              else closingOdds.push(row)
              closingInserts.push(row)
            }
            return Promise.resolve({ data: list, error: null })
          },
        }
        return query
      }
      return {
        select(cols) {
          const error = String(cols).includes('closeOdds') ? pickError : null
          const data = error ? null : picks
          const terminal = Promise.resolve({ data, error })
          const query = chainable(terminal)
          query.update = (body) => {
            updates.push(body)
            const chain = {
              eq() { return chain },
              is() { return chain },
              select() { return chain },
              then(resolve, reject) {
                return Promise.resolve({ data: [{ id: 'pv-vinnie' }], error: null })
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
            is() { return chain },
            select() { return chain },
            then(resolve, reject) {
              return Promise.resolve({ data: [{ id: 'pv-vinnie' }], error: null })
                .then(resolve, reject)
            },
          }
          return chain
        },
      }
    },
  }
}

const IN_WINDOW = new Date('2026-07-15T22:46:00.000Z')
const QUIET = new Date('2026-07-15T16:09:00.000Z')

describe('parseCaptureClosesArgs', () => {
  test('defaults to dry-run; --apply is required to write', () => {
    expect(parseCaptureClosesArgs([])).toMatchObject({ apply: false, dryRun: true, unknown: [] })
    expect(parseCaptureClosesArgs(['--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseCaptureClosesArgs(['--apply'])).toMatchObject({ apply: true, dryRun: false })
    expect(parseCaptureClosesArgs(['--apply', '--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseCaptureClosesArgs(['--max-calls', '3']).maxCalls).toBe(3)
    expect(parseCaptureClosesArgs(['--max-calls', '3']).invalidFlags).toEqual([])
    expect(parseCaptureClosesArgs(['--nfl-all']).nflAll).toBe(true)
    expect(parseCaptureClosesArgs(['--apply', '--nfl-all'])).toMatchObject({
      apply: true,
      nflAll: true,
      unknown: [],
    })
    expect(parseCaptureClosesArgs([]).nflAll).toBe(false)
    expect(parseCaptureClosesArgs(['--max-credits', '12']).maxCredits).toBe(12)
    expect(parseCaptureClosesArgs(['--max-credits']).invalidFlags).toEqual(['--max-credits'])
    expect(isClosingCaptureDisabled({ CLOSING_CAPTURE: '0' })).toBe(true)
    expect(isClosingCaptureDisabled({ CLOSING_CAPTURE: '1' })).toBe(false)
  })

  test('invalid or missing --max-calls / --min-remaining fail closed', () => {
    expect(parseCaptureClosesArgs(['--max-calls', 'abc']).invalidFlags).toEqual(['--max-calls'])
    expect(parseCaptureClosesArgs(['--max-calls', '-1']).invalidFlags).toEqual(['--max-calls'])
    expect(parseCaptureClosesArgs(['--max-calls']).invalidFlags).toEqual(['--max-calls'])
    expect(parseCaptureClosesArgs(['--max-calls', '--apply']).invalidFlags).toEqual(['--max-calls'])
    expect(parseCaptureClosesArgs(['--min-remaining', 'nope']).invalidFlags).toEqual(['--min-remaining'])
    expect(parseCaptureClosesArgs(['--min-remaining']).invalidFlags).toEqual(['--min-remaining'])
    expect(parseCaptureClosesArgs(['--max-calls', '0']).invalidFlags).toEqual([])
    expect(parseCaptureClosesArgs(['--max-credits', '-1']).invalidFlags).toEqual(['--max-credits'])
  })

  test('CLV_APPLY=1 is an apply switch; --dry-run still wins', () => {
    expect(parseCaptureClosesArgs([], { CLV_APPLY: '1' })).toMatchObject({
      apply: true,
      dryRun: false,
    })
    expect(parseCaptureClosesArgs(['--dry-run'], { CLV_APPLY: '1' })).toMatchObject({
      apply: false,
      dryRun: true,
    })
    expect(parseCaptureClosesArgs([], { CLV_APPLY: '0' })).toMatchObject({
      apply: false,
      dryRun: true,
    })
  })

  test('unknown flags and stray positionals fail closed', () => {
    expect(parseCaptureClosesArgs(['--apply', '3']).unknown).toEqual(['3'])
    expect(parseCaptureClosesArgs(['--max-calls', '3']).unknown).toEqual([])
    expect(parseCaptureClosesArgs(['--oops']).unknown).toEqual(['--oops'])
    expect(parseCaptureClosesArgs(['--nfl-all']).unknown).toEqual([])
    expect(parseCaptureClosesArgs(['--nfl-alls']).unknown).toEqual(['--nfl-alls'])
  })
})

describe('runCapturePublishedCloses', () => {
  test('quiet period is a no-op: no Odds API, no writes', async () => {
    const fetchEventOdds = jest.fn()
    const createClient = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: QUIET,
      createClient,
      fetchEventOdds,
      apiKey: 'test-key',
      log,
    })
    expect(result).toMatchObject({ exitCode: 0, calls: 0, skippedQuiet: true, captureStatus: 'partial' })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(log.lines[0]).toBe('MODE: APPLY')
    expect(log.lines.join('\n')).toMatch(/quiet period/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=partial/)
  })

  test('dry-run lists in-window picks and never fetches or writes', async () => {
    const updates = []
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient({ updates }),
      fetchEventOdds,
      apiKey: 'test-key',
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBe(0)
    expect(result.openPicks).toHaveLength(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(log.lines[0]).toBe('MODE: DRY-RUN')
    expect(log.lines.join('\n')).toMatch(/DRY-RUN/)
    expect(log.lines.join('\n')).toMatch(/evt-kc-hou/)
    expect(log.lines.join('\n')).toMatch(/batter_hits/)
  })

  test('already-closed recapture window is 10 minutes', () => {
    expect(ALREADY_CLOSED_RECAPTURE_MINUTES).toBe(10)
    const game = windowGame({ date: '2026-07-15T23:10:00.000Z' })
    const now = new Date('2026-07-15T23:00:00.000Z')
    expect(shouldRecaptureStoredClose(game, now)).toBe(true)
    expect(shouldRecaptureStoredClose(game, new Date('2026-07-15T22:59:59.999Z'))).toBe(false)
    expect(publishedCloseAlreadyStored({ closeOdds: -110, closeCapturedAt: '2026-07-15T22:00:00.000Z' })).toBe(true)
    expect(publishedCloseAlreadyStored({ closeOdds: -110, closeCapturedAt: null })).toBe(false)
    expect(publishedCloseAlreadyStored({ closeOdds: null, closeCapturedAt: '2026-07-15T22:00:00.000Z' })).toBe(false)
  })

  test('already-closed far from start is skipped and spends no call or credit', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:00:00.000Z',
        })],
      }),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'test-key',
      log,
    })
    expect(result.skippedAlreadyClosed).toBe(1)
    expect(result.calls).toBe(0)
    expect(result.creditsUsed).toBe(0)
    expect(result.updates).toHaveLength(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/SKIPPED_ALREADY_CLOSED=1/)
  })

  test('already-closed inside 10 minutes is re-captured', async () => {
    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        commence_time: '2026-07-15T23:10:00.000Z',
        bookmakers: [{
          title: 'FanDuel',
          last_update: '2026-07-15T23:01:00.000Z',
          markets: [{
            key: 'batter_hits',
            last_update: '2026-07-15T23:01:00.000Z',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -125 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000, last: 1 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: new Date('2026-07-15T23:02:00.000Z'),
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:46:00.000Z',
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.skippedAlreadyClosed).toBe(0)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.calls).toBe(2)
    expect(result.creditsUsed).toBeGreaterThan(0)
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ closeOdds: -125 })
    expect(log.lines.join('\n')).toMatch(/SKIPPED_ALREADY_CLOSED=0/)
  })

  test('a pick without a close is captured', async () => {
    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000, last: 1 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({ updates }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.skippedAlreadyClosed).toBe(0)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.calls).toBe(2)
    expect(result.creditsUsed).toBeGreaterThan(0)
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ closeOdds: -118 })
    expect(log.lines.join('\n')).toMatch(/SKIPPED_ALREADY_CLOSED=0/)
  })

  test('invalid kickoff does not recapture a stored close', async () => {
    const fetchEventOdds = jest.fn()
    const updates = []
    const log = memoryLog()
    const now = new Date('2026-07-15T23:02:00.000Z')
    const game = windowGame({ date: 'not-a-kickoff' })
    expect(shouldRecaptureStoredClose(game, now)).toBe(false)
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now,
      createClient: () => mockClient({
        games: [game],
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:46:00.000Z',
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'test-key',
      log,
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.calls).toBe(0)
    expect(result.creditsUsed).toBe(0)
    expect(result.updates).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(result.skippedAlreadyClosed).toBe(0)
    expect(log.lines.join('\n')).toMatch(/SKIPPED_ALREADY_CLOSED=0/)
    expect(log.lines.join('\n')).toMatch(/No games in the close-capture window/)
  })

  test('partial close fields follow the existing close check', async () => {
    const earlyNow = IN_WINDOW
    for (const partial of [
      { closeOdds: -110, closeCapturedAt: null },
      { closeOdds: null, closeCapturedAt: '2026-07-15T22:00:00.000Z' },
    ]) {
      const fetchEventOdds = jest.fn()
      const log = memoryLog()
      const result = await runCapturePublishedCloses({
        argv: ['--apply'],
        now: earlyNow,
        createClient: () => mockClient({
          picks: [publishedPick(partial)],
        }),
        fetchEventOdds,
        probeQuota: jest.fn(),
        apiKey: 'test-key',
        log,
      })
      expect(result.skippedAlreadyClosed).toBe(0)
      expect(result.calls).toBe(0)
      expect(result.creditsUsed).toBe(0)
      expect(result.updates).toHaveLength(0)
      expect(fetchEventOdds).not.toHaveBeenCalled()
      expect(log.lines.join('\n')).toMatch(/SKIPPED_ALREADY_CLOSED=0/)
    }

    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        commence_time: '2026-07-15T23:10:00.000Z',
        bookmakers: [{
          title: 'FanDuel',
          last_update: '2026-07-15T23:01:00.000Z',
          markets: [{
            key: 'batter_hits',
            last_update: '2026-07-15T23:01:00.000Z',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -125 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000, last: 1 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: new Date('2026-07-15T23:02:00.000Z'),
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: null,
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.skippedAlreadyClosed).toBe(0)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ closeOdds: -125 })
    expect(log.lines.join('\n')).toMatch(/SKIPPED_ALREADY_CLOSED=0/)
  })

  test('skips picks that already have a close', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:00:00.000Z',
        })],
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.openPicks).toHaveLength(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('--apply fetches one event and writes the best close', async () => {
    const updates = []
    const fetchEventOdds = jest.fn(async ({ url }) => {
      expect(url).toContain('/sports/baseball_mlb/events/evt-kc-hou/odds')
      expect(url).toContain('markets=batter_hits')
      expect(url).not.toContain('player_receptions')
      return {
        data: {
          bookmakers: [{
            title: 'FanDuel',
            markets: [{
              key: 'batter_hits',
              outcomes: [
                { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
              ],
            }],
          }],
        },
        quota: { remaining: 18000, used: 2000 },
      }
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({ updates }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBe(2)
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      closeOdds: -118,
      closeLine: 0.5,
      closeBook: 'FanDuel',
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
  })

  test('refuses --apply when 007 columns are missing; dry-run still lists', async () => {
    const fetchEventOdds = jest.fn()
    const missing = { code: 'PGRST204', message: "Could not find the 'closeOdds' column" }
    const apply = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({ pickError: missing }),
      fetchEventOdds,
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(apply.exitCode).toBe(0)
    expect(apply.captureStatus).toBe('failed')
    expect(apply.closeColumnsMissing).toBe(true)
    expect(fetchEventOdds).not.toHaveBeenCalled()

    const dry = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient({ pickError: missing }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(dry.exitCode).toBe(0)
    expect(dry.openPicks).toHaveLength(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('CLOSING_CAPTURE=0 is a no-op', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      env: { CLOSING_CAPTURE: '0' },
      createClient: () => { throw new Error('should not connect') },
      fetchEventOdds,
      apiKey: 'test-key',
      log,
    })
    expect(result).toMatchObject({ exitCode: 0, calls: 0, skippedDisabled: true })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(log.lines[0]).toBe('MODE: APPLY')
  })

  test('--max-calls 0 does not fetch and does not probe', async () => {
    const fetchEventOdds = jest.fn()
    const probeQuota = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--max-calls', '0'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota,
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBe(0)
    expect(result.skippedMaxCalls).toBe(true)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(probeQuota).not.toHaveBeenCalled()
  })

  test('--min-remaining stops before the first event call after the sports probe', async () => {
    const fetchEventOdds = jest.fn()
    const probeQuota = jest.fn(async () => ({ remaining: 40, used: 1960 }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--min-remaining', '50'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota,
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.skippedQuota).toBe(true)
    expect(result.calls).toBe(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(probeQuota).toHaveBeenCalledTimes(1)
  })

  test('near-start pass includes T−2 games and excludes exact T−1', async () => {
    const included = await runCapturePublishedCloses({
      argv: [],
      now: new Date('2026-07-15T23:38:00.000Z'),
      createClient: () => mockClient({
        games: [windowGame({ date: '2026-07-15T23:40:00.000Z' })],
      }),
      log: memoryLog(),
    })
    expect(included).toMatchObject({ exitCode: 0, calls: 0 })
    expect(included.openPicks || []).toHaveLength(1)
    expect(included.captureJobs?.[0]?.pass).toBe('near-start')

    const excluded = await runCapturePublishedCloses({
      argv: [],
      now: new Date('2026-07-15T23:39:00.000Z'),
      createClient: () => mockClient({
        games: [windowGame({ date: '2026-07-15T23:40:00.000Z' })],
      }),
      log: memoryLog(),
    })
    expect(excluded.openPicks || []).toHaveLength(0)
    expect(excluded.captureJobs || []).toHaveLength(0)
  })

  test('empty window costs 0 Odds API credits and does not probe', async () => {
    const fetchEventOdds = jest.fn()
    const probeQuota = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({ games: [] }),
      fetchEventOdds,
      probeQuota,
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result).toMatchObject({ exitCode: 0, calls: 0 })
    expect(result.creditsUsed ?? 0).toBe(0)
    expect(probeQuota).not.toHaveBeenCalled()
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('skips live, final, and postponed games even when the start is in-window', async () => {
    const fetchEventOdds = jest.fn()
    const games = [
      windowGame({ id: 'live', status: 'in_progress' }),
      windowGame({ id: 'done', status: 'final' }),
      windowGame({ id: 'ppd', status: 'postponed' }),
      windowGame({ id: 'rain', status: 'delayed' }),
      windowGame({ id: 'ok', status: 'scheduled' }),
    ]
    const picks = games.map((game, i) => publishedPick({
      id: `pv-${game.id}`,
      gameIdRef: game.id,
    }))
    const result = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient({ games, picks }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.openPicks.map((pick) => pick.gameIdRef).sort()).toEqual(['ok', 'rain'])
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('dedupes Odds API lookups by oddsApiEventId', async () => {
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000 },
    }))
    const games = [
      windowGame({ id: 'row-a', oddsApiEventId: 'evt-shared' }),
      windowGame({ id: 'row-b', oddsApiEventId: 'evt-shared' }),
    ]
    const picks = [
      publishedPick({ id: 'pv-a', gameIdRef: 'row-a' }),
      publishedPick({ id: 'pv-b', gameIdRef: 'row-b' }),
    ]
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({ games, picks }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.calls).toBe(2)
    expect(result.updates).toHaveLength(2)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds.mock.calls[0][0].url).toContain('/events/evt-shared/odds')
  })

  test('apply write is closeOdds IS NULL so re-runs stay idempotent', async () => {
    const writeFilters = []
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000 },
    }))
    const client = {
      from(table) {
        if (table === 'Game') {
          return chainable(Promise.resolve({ data: [windowGame()], error: null }))
        }
        return {
          select() {
            const terminal = Promise.resolve({ data: [publishedPick()], error: null })
            const query = chainable(terminal)
            query.update = (body) => {
              const filters = []
              const chain = {
                eq(col, val) { filters.push(['eq', col, val]); return chain },
                is(col, val) { filters.push(['is', col, val]); return chain },
                select(cols) { filters.push(['select', cols]); return chain },
                then(resolve, reject) {
                  writeFilters.push({ body, filters: [...filters] })
                  return Promise.resolve({ data: [{ id: 'pv-vinnie' }], error: null })
                    .then(resolve, reject)
                },
              }
              return chain
            }
            return query
          },
          update(body) {
            const filters = []
            const chain = {
              eq(col, val) { filters.push(['eq', col, val]); return chain },
              is(col, val) { filters.push(['is', col, val]); return chain },
              select(cols) { filters.push(['select', cols]); return chain },
              then(resolve, reject) {
                writeFilters.push({ body, filters: [...filters] })
                return Promise.resolve({ data: [{ id: 'pv-vinnie' }], error: null })
                  .then(resolve, reject)
              },
            }
            return chain
          },
        }
      },
    }
    await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => client,
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(writeFilters).toHaveLength(1)
    expect(writeFilters[0].filters).toEqual([
      ['eq', 'id', 'pv-vinnie'],
      ['is', 'closeOdds', null],
      ['select', 'id'],
    ])
  })

  test('requires the secret key and never falls back to anon', async () => {
    const factory = jest.fn()
    const log = memoryLog()
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-public-key-should-never-print',
    }
    expect(captureSupabaseEnv(env).SUPABASE_REQUIRE_SECRET_KEY).toBe('1')
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      env,
      createClient: (passedEnv) => createScriptSupabaseClient(passedEnv, {
        clientFactory: factory,
        logger: log,
      }),
      fetchEventOdds: jest.fn(),
      apiKey: 'odds-api-key-should-never-print',
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureStatus).toBe('failed')
    expect(result.missingSecret).toBe(true)
    expect(factory).not.toHaveBeenCalled()
    const printed = log.lines.join('\n')
    expect(printed).toMatch(/SUPABASE_REQUIRE_SECRET_KEY|SUPABASE_SECRET_KEY/)
    expect(printed).not.toMatch(/anon-public-key-should-never-print/)
    expect(printed).not.toMatch(/odds-api-key-should-never-print/)
  })

  test('MODE banner is the first line on quiet, missing-secret, and no-window returns', async () => {
    expect(formatCaptureModeBanner(false)).toBe('MODE: DRY-RUN')
    expect(formatCaptureModeBanner(true)).toBe('MODE: APPLY')

    const quietLog = memoryLog()
    await runCapturePublishedCloses({
      argv: [],
      now: QUIET,
      createClient: jest.fn(),
      log: quietLog,
    })
    expect(quietLog.lines[0]).toBe('MODE: DRY-RUN')

    const secretLog = memoryLog()
    await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-public-key-should-never-print',
      },
      createClient: (passedEnv) => createScriptSupabaseClient(passedEnv, {
        clientFactory: jest.fn(),
        logger: secretLog,
      }),
      log: secretLog,
    })
    expect(secretLog.lines[0]).toBe('MODE: APPLY')

    const emptyLog = memoryLog()
    await runCapturePublishedCloses({
      argv: [],
      now: new Date('2026-07-15T23:09:00.000Z'),
      createClient: () => mockClient(),
      log: emptyLog,
    })
    expect(emptyLog.lines[0]).toBe('MODE: DRY-RUN')
  })

  test('CLV_APPLY=1 apply without --apply prints MODE: APPLY', async () => {
    const log = memoryLog()
    await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      env: { CLV_APPLY: '1' },
      createClient: () => mockClient(),
      fetchEventOdds: jest.fn(),
      apiKey: '',
      log,
    })
    expect(log.lines[0]).toBe('MODE: APPLY')
  })

  test('invalid --max-calls or --min-remaining exits 0 with CLOSE_CAPTURE_STATUS=failed', async () => {
    const createClient = jest.fn()
    const fetchEventOdds = jest.fn()
    for (const argv of [['--max-calls', 'abc'], ['--max-calls'], ['--min-remaining', '-1'], ['--max-credits', 'nope']]) {
      const log = memoryLog()
      const result = await runCapturePublishedCloses({
        argv,
        now: IN_WINDOW,
        createClient,
        fetchEventOdds,
        log,
      })
      expect(result.exitCode).toBe(0)
      expect(result.captureStatus).toBe('failed')
      expect(result.invalidFlags?.length).toBeGreaterThan(0)
      expect(log.lines.join('\n')).toMatch(/Invalid or missing value/)
      expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=failed/)
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('unknown flags and stray positionals exit 0 with CLOSE_CAPTURE_STATUS=failed', async () => {
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '3'],
      now: IN_WINDOW,
      createClient: jest.fn(),
      fetchEventOdds: jest.fn(),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureStatus).toBe('failed')
    expect(result.unknown).toEqual(['3'])
    expect(log.lines.join('\n')).toMatch(/Unknown argument/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=failed/)
  })

  test('0-row closeOdds update logs skipped instead of success', async () => {
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000 },
    }))
    const client = {
      from(table) {
        if (table === 'Game') {
          return chainable(Promise.resolve({ data: [windowGame()], error: null }))
        }
        return {
          select() {
            const terminal = Promise.resolve({ data: [publishedPick()], error: null })
            const query = chainable(terminal)
            query.update = () => {
              const chain = {
                eq() { return chain },
                is() { return chain },
                select() { return chain },
                then(resolve, reject) {
                  return Promise.resolve({ data: [], error: null }).then(resolve, reject)
                },
              }
              return chain
            }
            return query
          },
          update() {
            const chain = {
              eq() { return chain },
              is() { return chain },
              select() { return chain },
              then(resolve, reject) {
                return Promise.resolve({ data: [], error: null }).then(resolve, reject)
              },
            }
            return chain
          },
        }
      },
    }
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => client,
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/skipped pv-vinnie already captured/)
  })

  test('publishable SUPABASE_SECRET_KEY fails closed without printing the value', async () => {
    const publishable = 'sb_publishable_should-never-print'
    expect(isPublishableSupabaseKey(publishable)).toBe(true)
    expect(isPublishableSupabaseKey('sb_secret_ok')).toBe(false)
    expect(() => assertCaptureSecretIsNotPublishable({
      SUPABASE_SECRET_KEY: publishable,
    })).toThrow(/publishable/)

    const factory = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: publishable,
      },
      createClient: (passedEnv) => createScriptSupabaseClient(passedEnv, {
        clientFactory: factory,
        logger: log,
      }),
      fetchEventOdds: jest.fn(),
      apiKey: 'odds-api-key-should-never-print',
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureStatus).toBe('failed')
    expect(factory).not.toHaveBeenCalled()
    const printed = log.lines.join('\n')
    expect(printed).toMatch(/publishable/)
    expect(printed).not.toMatch(/sb_publishable_should-never-print/)
    expect(printed).not.toMatch(/odds-api-key-should-never-print/)
  })

  test('legacy anon JWT in SUPABASE_SECRET_KEY fails closed without printing the value', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ role: 'anon', ref: 'x' })).toString('base64url')
    const anonJwt = `${header}.${body}.sig`
    const factory = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: anonJwt,
      },
      createClient: (passedEnv) => createScriptSupabaseClient(passedEnv, {
        clientFactory: factory,
        logger: log,
      }),
      fetchEventOdds: jest.fn(),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureStatus).toBe('failed')
    expect(factory).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/publishable|anon|service_role/)
    expect(log.lines.join('\n')).not.toMatch(anonJwt)
  })

  test('unconvertible close price skips the write so a later run can retry', async () => {
    const updates = []
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: 1 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient({ updates }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.updates).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBeGreaterThan(0)
  })

  test('--apply without ODDS_API_KEY fails before any HTTP call', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      apiKey: '',
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureStatus).toBe('failed')
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('captures published and tagged shadow NHL in the same window and ignores untagged NHL archive', async () => {
    const fetchEventOdds = jest.fn()
    const nhlGame = windowGame({
      id: 'TOR_at_BOS_2026-10-29',
      sport: 'nhl',
      oddsApiEventId: 'evt-tor-bos',
    })
    const shadow = publishedPick({
      id: 'pv-matthews',
      gameIdRef: nhlGame.id,
      playerName: 'Auston Matthews',
      propType: 'player_shots_on_goal',
      threshold: 2.5,
      sport: 'nhl',
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    })
    const published = publishedPick({
      id: 'pv-mcdavid',
      gameIdRef: nhlGame.id,
      playerName: 'Connor McDavid',
      propType: 'player_shots_on_goal',
      threshold: 3.5,
      sport: 'nhl',
      notes: 'cohort:published',
    })
    const archive = publishedPick({
      id: 'pv-archive',
      gameIdRef: nhlGame.id,
      playerName: 'Brad Marchand',
      propType: 'player_shots_on_goal',
      threshold: 1.5,
      sport: 'nhl',
      notes: 'tier:elite',
    })
    const result = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame],
        picks: [shadow, published, archive],
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.openPicks.map((pick) => pick.id).sort()).toEqual(['pv-matthews', 'pv-mcdavid'])
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('shares --max-calls across Published and shadow; Published jobs go first', async () => {
    const fetchEventOdds = jest.fn(async ({ url }) => ({
      data: { bookmakers: [] },
      quota: { remaining: 9000, used: 1 },
    }))
    const mlbGame = windowGame()
    const nhlGame = windowGame({
      id: 'TOR_at_BOS_2026-10-29',
      sport: 'nhl',
      oddsApiEventId: 'evt-tor-bos',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--max-calls', '2'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame, mlbGame],
        picks: [
          publishedPick({ notes: 'cohort:published' }),
          publishedPick({
            id: 'pv-matthews',
            gameIdRef: nhlGame.id,
            playerName: 'Auston Matthews',
            propType: 'player_shots_on_goal',
            threshold: 2.5,
            sport: 'nhl',
            notes: SHADOW_PUBLISHED_COHORT_TAG,
          }),
        ],
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.calls).toBe(2)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds.mock.calls[0][0].url).toContain('/sports/baseball_mlb/events/evt-kc-hou/odds')
    expect(fetchEventOdds.mock.calls[0][0].url).not.toContain('icehockey_nhl')
  })

  test('tight --max-calls spends on later NFL before an earlier NHL slate', async () => {
    const fetchEventOdds = jest.fn(async ({ url }) => ({
      data: { bookmakers: [] },
      quota: { remaining: 9000, used: 1 },
    }))
    const nhlGame = windowGame({
      id: 'TOR_at_BOS_2026-10-29',
      sport: 'nhl',
      date: '2026-07-15T23:00:00.000Z',
      oddsApiEventId: 'evt-tor-bos',
    })
    const nflGame = nflWindowGame({
      date: '2026-07-15T23:20:00.000Z',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--max-calls', '2'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame, nflGame],
        picks: [
          publishedPick({
            id: 'pv-matthews',
            gameIdRef: nhlGame.id,
            playerName: 'Auston Matthews',
            propType: 'player_shots_on_goal',
            threshold: 2.5,
            sport: 'nhl',
            notes: 'cohort:published',
          }),
          publishedPick({
            id: 'pv-kelce-pub',
            gameIdRef: nflGame.id,
            playerName: 'Travis Kelce',
            propType: 'player_receptions',
            threshold: 5.5,
            sport: 'nfl',
            notes: 'cohort:published',
          }),
        ],
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.calls).toBe(2)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds.mock.calls[0][0].url).toContain('/sports/americanfootball_nfl/events/evt-kc-buf/odds')
    expect(fetchEventOdds.mock.calls[0][0].url).not.toContain('icehockey_nhl')
  })

  test('without --nfl-all, unpublished NFL pending props stay untargeted', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.openPicks).toHaveLength(0)
    expect(result.captureJobs || []).toHaveLength(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('--nfl-all targets pending NFL props that miss the Published bar', async () => {
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
      }),
      fetchEventOdds: jest.fn(),
      log,
    })
    expect(result.openPicks.map((pick) => pick.id)).toEqual(['pv-kelce'])
    expect(result.captureJobs).toHaveLength(1)
    expect(log.lines.join('\n')).toMatch(/player_receptions/)
    expect(log.lines.join('\n')).toMatch(/h2h/)
    expect(log.lines.join('\n')).toMatch(/spreads/)
    expect(log.lines.join('\n')).toMatch(/totals/)
    expect(log.lines.join('\n')).toMatch(/Odds API HTTP calls this run: 2/)
    expect(log.lines.join('\n')).toMatch(/CALLS_USED=0/)
  })

  test('--nfl-all still leaves untagged NHL archive off the target list', async () => {
    const nhlGame = windowGame({
      id: 'TOR_at_BOS_2026-10-29',
      sport: 'nhl',
      oddsApiEventId: 'evt-tor-bos',
    })
    const archive = publishedPick({
      id: 'pv-archive',
      gameIdRef: nhlGame.id,
      playerName: 'Brad Marchand',
      propType: 'player_shots_on_goal',
      threshold: 1.5,
      sport: 'nhl',
      notes: 'tier:elite',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame, nflWindowGame()],
        picks: [archive, nflPendingPick()],
      }),
      fetchEventOdds: jest.fn(),
      log: memoryLog(),
    })
    expect(result.openPicks.map((pick) => pick.id)).toEqual(['pv-kelce'])
  })

  test('--nfl-all merges prop + game-line markets into one event call', async () => {
    const closingInserts = []
    const updates = []
    const fetchEventOdds = jest.fn(async ({ url }) => {
      expect(url).toContain('/sports/americanfootball_nfl/events/evt-kc-buf/odds')
      expect(url).toContain('player_receptions')
      expect(url).toContain('player_receptions_alternate')
      expect(url).toContain('h2h')
      expect(url).toContain('spreads')
      expect(url).toContain('totals')
      return { data: nflEventOdds(), quota: { remaining: 18000, used: 2000 } }
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
        updates,
        closingInserts,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.calls).toBe(2)
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      closeOdds: -115,
      closeLine: 5.5,
      closeBook: 'FanDuel',
    })
    expect(closingInserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        game_id: 'KC_at_BUF_2026-07-15',
        market: 'h2h',
        book: 'FanDuel',
        price_home: -150,
      }),
      expect.objectContaining({ market: 'spreads', spread: -3.5 }),
      expect.objectContaining({ market: 'totals', total: 47.5 }),
    ]))
    expect(closingInserts.filter((row) => row.market === 'player_receptions')).toHaveLength(0)
  })

  test('--nfl-all --max-calls spends the budget on the soonest kickoff', async () => {
    const fetchEventOdds = jest.fn(async () => ({
      data: nflEventOdds(),
      quota: { remaining: 9000, used: 1 },
    }))
    const soon = nflWindowGame({
      id: 'soon',
      date: '2026-07-15T23:00:00.000Z',
      oddsApiEventId: 'evt-soon',
    })
    const later = nflWindowGame({
      id: 'later',
      date: '2026-07-15T23:16:00.000Z',
      oddsApiEventId: 'evt-later',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all', '--max-calls', '2'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [later, soon],
        picks: [
          nflPendingPick({ id: 'pv-later', gameIdRef: later.id }),
          nflPendingPick({ id: 'pv-soon', gameIdRef: soon.id }),
        ],
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.calls).toBe(2)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds.mock.calls[0][0].url).toContain('/events/evt-soon/odds')
    expect(fetchEventOdds.mock.calls[0][0].url).not.toContain('evt-later')
  })

  test('prints CALLS_USED for dry-run and apply, with planned calls including quota', async () => {
    const dryLog = memoryLog()
    const dry = await runCapturePublishedCloses({
      argv: ['--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
      }),
      fetchEventOdds: jest.fn(),
      log: dryLog,
    })
    expect(dry.calls).toBe(0)
    expect(dry.plannedCalls).toBe(2)
    expect(dryLog.lines.join('\n')).toMatch(/Odds API HTTP calls this run: 2/)
    expect(dryLog.lines.at(-1)).toBe('CALLS_USED=0')

    const applyLog = memoryLog()
    const apply = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
      }),
      fetchEventOdds: async () => ({
        data: nflEventOdds(),
        quota: { remaining: 18000, used: 2000 },
      }),
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: applyLog,
    })
    expect(apply.calls).toBe(2)
    expect(applyLog.lines.at(-1)).toBe('CALLS_USED=2')
  })

  test('--nfl-all logs a mixed ClosingOdds batch without marking failed rows captured', async () => {
    const closingOdds = []
    const closingInserts = []
    const pkeyError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "ClosingOdds_pkey"',
    }
    const deniedError = { code: '42501', message: 'permission denied' }
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
        closingOdds,
        closingInserts,
        closingInsert(rows, { closingOdds: existing, closingInserts: inserts }) {
          if (rows.length > 1) {
            return Promise.resolve({ data: null, error: pkeyError })
          }
          const [row] = rows
          if (row.market === 'h2h') {
            return Promise.resolve({ data: null, error: pkeyError })
          }
          if (row.market === 'spreads') {
            return Promise.resolve({ data: null, error: deniedError })
          }
          inserts.push(row)
          existing.push(row)
          return Promise.resolve({ data: rows, error: null })
        },
      }),
      fetchEventOdds: async () => ({
        data: nflEventOdds(),
        quota: { remaining: 18000, used: 2000 },
      }),
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.gameLineWrites.every((row) => row.market !== 'spreads')).toBe(true)
    expect(result.gameLineWrites.some((row) => row.market === 'totals')).toBe(true)
    expect(log.lines.join('\n')).toMatch(/permission denied/)
    expect(log.lines.join('\n')).toMatch(/1 row\(s\) not captured/)
    expect(log.lines.join('\n')).toMatch(/proposed=/)
    expect(log.lines.join('\n')).toMatch(/inserted=1/)
    expect(log.lines.join('\n')).toMatch(/failed=1/)
  })

  test('--nfl-all game-line writes stay idempotent on a re-run', async () => {
    const closingOdds = []
    const closingInserts = []
    const client = mockClient({
      games: [nflWindowGame()],
      picks: [nflPendingPick()],
      closingOdds,
      closingInserts,
    })
    const run = () => runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all'],
      now: IN_WINDOW,
      createClient: () => client,
      fetchEventOdds: async () => ({
        data: nflEventOdds(),
        quota: { remaining: 18000, used: 2000 },
      }),
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    const first = await run()
    expect(first.gameLineWrites.length).toBeGreaterThan(0)
    const insertedAfterFirst = closingInserts.length
    const second = await run()
    expect(second.gameLineWrites).toHaveLength(0)
    expect(closingInserts).toHaveLength(insertedAfterFirst)
  })

  test('--help prints CALLS_USED', async () => {
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--help'],
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.help).toBe(true)
    expect(log.lines.at(-1)).toBe('CALLS_USED=0')
  })

  test('already-captured NFL game lines are not refetched when props are done', async () => {
    const fetchEventOdds = jest.fn()
    const game = nflWindowGame()
    const closingOdds = ['h2h', 'spreads', 'totals'].map((market) => ({
      id: `clvclose:${game.id}|fanduel|${market}`,
      game_id: game.id,
      book: 'FanDuel',
      market,
      snapshot_at: '2026-07-15T22:50:00.000Z',
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [game],
        picks: [nflPendingPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:50:00.000Z',
        })],
        closingOdds,
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.captureJobs || []).toHaveLength(0)
    expect(result.plannedCalls).toBe(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('--max-credits stops before exceeding, soonest kickoff first', async () => {
    const fetchEventOdds = jest.fn(async () => ({
      data: nflEventOdds(),
      quota: { remaining: 9000, used: 1 },
    }))
    const soon = nflWindowGame({
      id: 'soon',
      date: '2026-07-15T23:00:00.000Z',
      oddsApiEventId: 'evt-soon',
    })
    const later = nflWindowGame({
      id: 'later',
      date: '2026-07-15T23:16:00.000Z',
      oddsApiEventId: 'evt-later',
    })
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all', '--max-credits', '5'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [later, soon],
        picks: [
          nflPendingPick({ id: 'pv-later', gameIdRef: later.id }),
          nflPendingPick({ id: 'pv-soon', gameIdRef: soon.id }),
        ],
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.creditsUsed).toBe(5)
    expect(result.plannedCredits).toBe(5)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds.mock.calls[0][0].url).toContain('/events/evt-soon/odds')
    expect(log.lines.join('\n')).toMatch(/Odds API credits this run: 5/)
    expect(log.lines.join('\n')).toMatch(/CREDITS_USED=5/)
    expect(log.lines.at(-1)).toBe('CALLS_USED=2')
  })

  test('requests *_alternate and matches the exact recorded line, not a main-line juice', async () => {
    const updates = []
    const fetchEventOdds = jest.fn(async ({ url }) => {
      expect(url).toContain('player_pass_yds')
      expect(url).toContain('player_pass_yds_alternate')
      return {
        data: {
          home_team: 'Los Angeles Rams',
          away_team: 'Seattle Seahawks',
          bookmakers: [{
            title: 'FanDuel',
            markets: [
              {
                key: 'player_pass_yds',
                outcomes: [
                  { name: 'Over', description: 'Matthew Stafford', point: 281.5, price: 170 },
                ],
              },
              {
                key: 'player_pass_yds_alternate',
                outcomes: [
                  { name: 'Over', description: 'Matthew Stafford', point: 219.5, price: -110 },
                ],
              },
            ],
          }],
        },
        quota: { remaining: 18000, used: 2000 },
      }
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick({
          id: 'pv-stafford',
          playerName: 'Matthew Stafford',
          propType: 'pass_yds',
          threshold: 219.5,
          prediction: 'over',
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      closeOdds: -110,
      closeLine: 219.5,
      closeBook: 'FanDuel',
      closeNumBooks: 1,
    })
  })

  test('leaves close fields empty when the exact line is missing', async () => {
    const updates = []
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--nfl-all'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick({
          id: 'pv-stafford',
          playerName: 'Matthew Stafford',
          propType: 'pass_yds',
          threshold: 219.5,
        })],
        updates,
      }),
      fetchEventOdds: async () => ({
        data: {
          bookmakers: [{
            title: 'FanDuel',
            markets: [{
              key: 'player_pass_yds',
              outcomes: [
                { name: 'Over', description: 'Matthew Stafford', point: 281.5, price: 170 },
              ],
            }],
          }],
        },
        quota: { remaining: 18000, used: 2000 },
      }),
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.updates).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/no quote pv-stafford/)
  })

  test('budget floor probes /v4/sports first then skips paid calls and exits 0', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const probeQuota = jest.fn(async () => ({ remaining: 2500, used: 1000, last: 0 }))
    const budget = createOddsApiBudget({
      persist: false,
      now: IN_WINDOW,
      log,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      state: { lastRemaining: 2500, lastUsed: 1000, quotaDay: '2026-07-14' },
      purpose: 'close-capture',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--max-calls', '10'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota,
      apiKey: 'secret-key-value',
      log,
      budget,
    })
    expect(result.exitCode).toBe(0)
    expect(result.skippedBudget).toBe(true)
    expect(result.calls).toBe(1)
    expect(probeQuota).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/ODDS_BUDGET_STATUS=floor/)
    expect(log.lines.join('\n')).toMatch(/treat as WARN/)
    expect(log.lines.join('\n')).not.toMatch(/secret-key-value/)
    expect(parseCaptureClosesArgs(['--max-calls', '10']).maxCalls).toBe(10)
    expect(parseCaptureClosesArgs([]).maxCalls).toBeNull()
  })

  test('close capture recovers after a prior-day floor once the probe shows quota reset', async () => {
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
            ],
          }],
        }],
      },
      quota: { remaining: 17999, used: 101, last: 1 },
    }))
    const probeQuota = jest.fn(async () => ({ remaining: 18000, used: 100, last: 0 }))
    const budget = createOddsApiBudget({
      persist: false,
      now: IN_WINDOW,
      log: memoryLog(),
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      state: { lastRemaining: 2500, lastUsed: 17000, quotaDay: '2026-07-14' },
      purpose: 'close-capture',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota,
      apiKey: 'test-key',
      log: memoryLog(),
      budget,
    })
    expect(probeQuota).toHaveBeenCalledTimes(1)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.skippedBudget).toBeUndefined()
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBe(2)
    expect(budget.status()).toBe('ok')
  })

  test('close-capture --max-calls / --max-credits / --min-remaining defaults are unchanged', () => {
    expect(parseCaptureClosesArgs([]).maxCalls).toBeNull()
    expect(parseCaptureClosesArgs([]).maxCredits).toBeNull()
    expect(parseCaptureClosesArgs([]).minRemaining).toBe(50)
    expect(parseCaptureClosesArgs(['--max-calls', '10']).maxCalls).toBe(10)
    expect(parseCaptureClosesArgs(['--max-calls', '20']).maxCalls).toBe(20)
  })

  test('prints CLOSE_CAPTURE_STATUS and counts and always exits 0', async () => {
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: [],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds: jest.fn(),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureStatus).toBe('ok')
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=ok/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_CAPTURED=0/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_QUIET=/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_WINDOW=/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_CREDITS=0/)
    expect(log.lines.join('\n')).not.toMatch(/test-key/)
  })

  test('near-start pass overwrites an existing Published close', async () => {
    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        commence_time: '2026-07-15T23:10:00.000Z',
        bookmakers: [{
          title: 'FanDuel',
          last_update: '2026-07-15T23:01:00.000Z',
          markets: [{
            key: 'batter_hits',
            last_update: '2026-07-15T23:01:00.000Z',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -125 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000, last: 1 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: new Date('2026-07-15T23:02:00.000Z'),
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:46:00.000Z',
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.captureJobs?.[0]?.pass).toBe('near-start')
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ closeOdds: -125, closeLine: 0.5, closeNumBooks: 1 })
    expect(log.lines.join('\n')).toMatch(/books=1/)
  })

  test('near-start skips overwrite when payload commence_time is within 60s', async () => {
    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        commence_time: '2026-07-15T23:02:30.000Z',
        bookmakers: [{
          title: 'FanDuel',
          markets: [{
            key: 'batter_hits',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -125 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000, last: 1 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: new Date('2026-07-15T23:02:00.000Z'),
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:46:00.000Z',
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.captureJobs?.[0]?.pass).toBe('near-start')
    expect(result.updates).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/commence_time within 60s of now/)
  })

  test('near-start skips overwrite when quote last_update is at or after commence_time', async () => {
    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => ({
      data: {
        commence_time: '2026-07-15T23:10:00.000Z',
        bookmakers: [{
          title: 'FanDuel',
          last_update: '2026-07-15T23:10:00.000Z',
          markets: [{
            key: 'batter_hits',
            last_update: '2026-07-15T23:10:00.000Z',
            outcomes: [
              { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -125 },
            ],
          }],
        }],
      },
      quota: { remaining: 18000, used: 2000, last: 1 },
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: new Date('2026-07-15T23:02:00.000Z'),
      createClient: () => mockClient({
        picks: [publishedPick({
          closeOdds: -110,
          closeCapturedAt: '2026-07-15T22:46:00.000Z',
        })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.captureJobs?.[0]?.pass).toBe('near-start')
    expect(result.updates).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/quote last_update after capture/)
  })

  test('a :00 ET run re-checks quiet and stops at :05 before writes', async () => {
    let fetched = false
    const updates = []
    const log = memoryLog()
    const fetchEventOdds = jest.fn(async () => {
      fetched = true
      return {
        data: {
          bookmakers: [{
            title: 'FanDuel',
            markets: [{
              key: 'batter_hits',
              outcomes: [
                { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -118 },
              ],
            }],
          }],
        },
        quota: { remaining: 18000, used: 2000, last: 1 },
      }
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      clock: () => (fetched
        ? new Date('2026-07-15T20:05:00.000Z')
        : new Date('2026-07-15T20:00:00.000Z')),
      createClient: () => mockClient({
        games: [windowGame({ date: '2026-07-15T20:25:00.000Z' })],
        updates,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(updates).toHaveLength(0)
    expect(result.updates).toHaveLength(0)
    expect(result.skippedQuiet).toBe(true)
    expect(result.captureStatus).toBe('partial')
    expect(result.skippedQuietCount).toBeGreaterThan(0)
    expect(result.skippedBudgetCount).toBe(0)
    expect(log.lines.join('\n')).toMatch(/stopping before further writes/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=partial/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_QUIET=[1-9]/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=0/)
  })

  test('does not start a paid fetch after :04:30 ET and counts it as partial/skipped', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: new Date('2026-07-15T20:04:30.000Z'),
      createClient: () => mockClient({
        games: [windowGame({ date: '2026-07-15T20:25:00.000Z' })],
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.updates).toHaveLength(0)
    expect(result.skippedQuiet).toBe(true)
    expect(result.captureStatus).toBe('partial')
    expect(result.skippedQuietCount).toBeGreaterThan(0)
    expect(result.skippedBudgetCount).toBe(0)
    expect(log.lines.join('\n')).toMatch(/:04:30 ET/)
    expect(log.lines.join('\n')).toMatch(/quiet :05 would block/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=partial/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_QUIET=[1-9]/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=0/)
  })

  test('near-start nfl-all skips game-line overwrite when commence_time is missing or unparseable', async () => {
    const now = new Date('2026-07-15T23:02:00.000Z')
    const game = nflWindowGame({ date: '2026-07-15T23:10:00.000Z' })
    const pick = publishedPick({
      id: 'pv-kelce',
      gameIdRef: game.id,
      playerName: 'Travis Kelce',
      propType: 'player_receptions',
      threshold: 5.5,
      sport: 'nfl',
      closeOdds: -110,
      closeCapturedAt: '2026-07-15T22:46:00.000Z',
    })
    const run = async (eventData) => {
      const closingInserts = []
      const updates = []
      const log = memoryLog()
      const result = await runCapturePublishedCloses({
        argv: ['--apply', '--nfl-all'],
        now,
        createClient: () => mockClient({
          games: [game],
          picks: [pick],
          updates,
          closingInserts,
        }),
        fetchEventOdds: async () => ({
          data: eventData,
          quota: { remaining: 18000, used: 2000, last: 1 },
        }),
        probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
        apiKey: 'test-key',
        log,
      })
      return { result, closingInserts, updates, log }
    }

    const missing = await run(nflEventOdds())
    expect(missing.result.captureJobs?.[0]?.pass).toBe('near-start')
    expect(missing.closingInserts).toHaveLength(0)
    expect(missing.updates).toHaveLength(0)
    expect(missing.log.lines.join('\n')).toMatch(/near-start game-line overwrite: commence_time missing\/unparseable/)

    const bad = await run({ ...nflEventOdds(), commence_time: 'nope' })
    expect(bad.closingInserts).toHaveLength(0)
    expect(bad.updates).toHaveLength(0)
    expect(bad.log.lines.join('\n')).toMatch(/near-start game-line overwrite: commence_time missing\/unparseable/)
  })

  test('ODDS_CLOSE_CAPTURE_DAILY_CAP skips further event fetches', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const budget = createOddsApiBudget({
      persist: false,
      now: IN_WINDOW,
      log,
      env: {
        ODDS_CLOSE_CAPTURE_RESERVE: '200',
        ODDS_CLOSE_CAPTURE_DAILY_CAP: '40',
      },
      state: { days: { '2026-07-15': { credits: 80, calls: 40, closeCaptures: 40 } } },
      purpose: 'close-capture',
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
      budget,
    })
    expect(result.exitCode).toBe(0)
    expect(result.skippedBudgetCount).toBeGreaterThan(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=/)
    expect(log.lines.join('\n')).not.toMatch(/test-key/)
  })

  function gameLineEdge(overrides = {}) {
    return {
      id: 'edge-1',
      gameId: 'BOS_at_TOR',
      edgeMlHome: 0.05,
      edgeMlAway: null,
      edgeTotalO: 0.02,
      edgeTotalU: null,
      ts: '2026-07-15T18:00:00.000Z',
      ...overrides,
    }
  }

  function nhlGame(overrides = {}) {
    return windowGame({
      id: 'BOS_at_TOR',
      sport: 'nhl',
      oddsApiEventId: 'evt-bos',
      ...overrides,
    })
  }

  function sportOdds(events) {
    return {
      data: events,
      quota: { remaining: 18000, used: 20, last: 2 },
    }
  }

  function nhlEvent(id, home, away) {
    return {
      id,
      home_team: home,
      away_team: away,
      bookmakers: [{
        title: 'FanDuel',
        markets: [
          {
            key: 'h2h',
            last_update: '2026-07-15T22:44:00.000Z',
            outcomes: [
              { name: home, price: -140 },
              { name: away, price: 120 },
            ],
          },
          {
            key: 'totals',
            last_update: '2026-07-15T22:45:00.000Z',
            outcomes: [
              { name: 'Over', price: -105, point: 6.5 },
              { name: 'Under', price: -115, point: 6.5 },
            ],
          },
        ],
      }],
    }
  }

  test('--game-lines dry-run plans one sport call and prints the close footer', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--game-lines'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [
          nhlGame(),
          nhlGame({
            id: 'MTL_at_OTT',
            oddsApiEventId: 'evt-mtl',
            date: '2026-07-15T23:18:00.000Z',
          }),
        ],
        picks: [],
        edges: [
          gameLineEdge(),
          gameLineEdge({ id: 'edge-2', gameId: 'MTL_at_OTT' }),
        ],
      }),
      fetchEventOdds,
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBe(0)
    expect(result.plannedCalls).toBe(2)
    expect(result.plannedCredits).toBe(2)
    expect(result.gameLineClusters).toHaveLength(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    const text = log.lines.join('\n')
    expect(text).toMatch(/Odds API HTTP calls this run: 2/)
    expect(text).toMatch(/Odds API credits this run: 2/)
    expect(text).toMatch(/would fetch sport=icehockey_nhl games=BOS_at_TOR,MTL_at_OTT markets=h2h,totals credits=2/)
    expect(text).toMatch(/CLOSE_CAPTURE_STATUS=ok/)
    expect(text).toMatch(/CLOSE_CAPTURE_CAPTURED=0/)
    expect(text).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=0/)
    expect(text).toMatch(/CLOSE_CAPTURE_SKIPPED_QUIET=0/)
    expect(text).toMatch(/CLOSE_CAPTURE_SKIPPED_WINDOW=0/)
    expect(text).toMatch(/CLOSE_CAPTURE_CREDITS=0/)
    expect(text).toMatch(/CALLS_USED=0/)
  })

  test('--game-lines apply writes one cluster and a second early run does not refetch', async () => {
    const fetchEventOdds = jest.fn(async () => sportOdds([
      nhlEvent('evt-bos', 'Boston Bruins', 'Toronto Maple Leafs'),
      nhlEvent('evt-mtl', 'Montreal Canadiens', 'Ottawa Senators'),
    ]))
    const closingOdds = []
    const closingInserts = []
    const games = [
      nhlGame(),
      nhlGame({
        id: 'MTL_at_OTT',
        oddsApiEventId: 'evt-mtl',
        date: '2026-07-15T23:18:00.000Z',
      }),
    ]
    const edges = [
      gameLineEdge(),
      gameLineEdge({ id: 'edge-2', gameId: 'MTL_at_OTT' }),
    ]
    const first = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      now: IN_WINDOW,
      createClient: () => mockClient({ games, picks: [], edges, closingOdds, closingInserts }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    const url = fetchEventOdds.mock.calls[0][0].url
    expect(url).toContain('/v4/sports/icehockey_nhl/odds?')
    expect(url).not.toContain('/events/')
    expect(url).toContain('markets=h2h%2Ctotals')
    expect(url).toContain('regions=us')
    expect(url).not.toContain('spreads')
    expect(first.calls).toBe(2)
    expect(first.creditsUsed).toBe(2)
    const priced = closingInserts.filter((row) => row.book === 'FanDuel')
    expect(priced).toHaveLength(4)
    expect(priced.every((row) => row.id.startsWith('clvclose:'))).toBe(true)
    expect(priced.every((row) => row.sport === 'nhl')).toBe(true)
    expect(priced.find((row) => row.market === 'h2h').quoted_at).toBe('2026-07-15T22:44:00.000Z')

    fetchEventOdds.mockClear()
    const secondLog = memoryLog()
    const second = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      now: IN_WINDOW,
      createClient: () => mockClient({ games, picks: [], edges, closingOdds, closingInserts }),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'test-key',
      log: secondLog,
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(second.calls).toBe(0)
    expect(second.creditsUsed).toBe(0)
    expect(secondLog.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=ok/)
    expect(secondLog.lines.join('\n')).toMatch(/CLOSE_CAPTURE_CREDITS=0/)
  })

  test('--spreads adds the spreads market and quiet window makes no fetch', async () => {
    const fetchEventOdds = jest.fn()
    const dry = await runCapturePublishedCloses({
      argv: ['--game-lines', '--spreads'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(dry.plannedCredits).toBe(3)
    expect(dry.gameLineClusters[0].markets).toEqual(['h2h', 'spreads', 'totals'])

    const log = memoryLog()
    const quiet = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      now: QUIET,
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds,
      apiKey: 'test-key',
      log,
    })
    expect(quiet.skippedQuiet).toBe(true)
    expect(quiet.calls).toBe(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_STATUS=partial/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_SKIPPED_QUIET=0/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_CREDITS=0/)
    expect(log.lines.join('\n')).toMatch(/CLOSE_CAPTURE_CAPTURED=0/)
  })

  test('prop jobs keep the call budget ahead of game-line clusters', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--game-lines', '--max-calls', '2'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [windowGame(), nhlGame()],
        picks: [publishedPick()],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds,
      log,
    })
    expect(result.captureJobs).toHaveLength(1)
    expect(result.gameLineClusters).toHaveLength(0)
    expect(result.plannedCalls).toBe(2)
    expect(result.skippedBudgetCount).toBeGreaterThan(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    const text = log.lines.join('\n')
    expect(text).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=1/)
    expect(text).not.toMatch(/icehockey_nhl/)
  })

  test('near-start game lines upsert the same clvclose id', async () => {
    const nearNow = new Date('2026-07-15T22:46:00.000Z')
    const closingOdds = [{
      id: 'clvclose:bos_at_tor|fanduel|h2h',
      game_id: 'BOS_at_TOR',
      book: 'FanDuel',
      market: 'h2h',
      sport: 'nhl',
    }, {
      id: 'clvclose:bos_at_tor|fanduel|totals',
      game_id: 'BOS_at_TOR',
      book: 'FanDuel',
      market: 'totals',
      sport: 'nhl',
    }]
    const upserts = []
    const fetchEventOdds = jest.fn(async () => sportOdds([{
      ...nhlEvent('evt-bos', 'Boston Bruins', 'Toronto Maple Leafs'),
      commence_time: '2026-07-15T22:52:00.000Z',
    }]))
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      now: nearNow,
      createClient: () => mockClient({
        games: [nhlGame({ date: '2026-07-15T22:52:00.000Z' })],
        picks: [],
        edges: [gameLineEdge()],
        closingOdds,
        closingInsert(rows, ctx) {
          upserts.push(...rows)
          expect(ctx.upsert).toBe(true)
          return Promise.resolve({ data: rows, error: null })
        },
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log,
    })
    expect(result.calls).toBe(2)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(upserts.map((row) => row.id).sort()).toEqual([
      'clvclose:bos_at_tor|fanduel|h2h',
      'clvclose:bos_at_tor|fanduel|totals',
    ])
    expect(upserts.find((row) => row.market === 'totals').quoted_at).toBe('2026-07-15T22:45:00.000Z')
  })

  test('--max-credits stops a game-line cluster before the sport call', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--game-lines', '--max-credits', '1'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds,
      log,
    })
    expect(result.plannedCalls).toBe(0)
    expect(result.plannedCredits).toBe(0)
    expect(result.gameLineClusters).toHaveLength(0)
    expect(result.skippedBudgetCount).toBe(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    const text = log.lines.join('\n')
    expect(text).toMatch(/did not fit the remaining/)
    expect(text).toMatch(/CLOSE_CAPTURE_SKIPPED_BUDGET=1/)
    expect(text).toMatch(/CLOSE_CAPTURE_CREDITS=0/)
    expect(text).toMatch(/CLOSE_CAPTURE_STATUS=ok/)
  })

  test('--nfl-all keeps the per-game call and does not add a sport-level refetch', async () => {
    const fetchEventOdds = jest.fn()
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--nfl-all', '--game-lines'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nflWindowGame()],
        picks: [nflPendingPick()],
        edges: [gameLineEdge({
          id: 'edge-nfl',
          gameId: 'KC_at_BUF_2026-07-15',
        })],
      }),
      fetchEventOdds,
      log,
    })
    expect(result.captureJobs).toHaveLength(1)
    expect(result.gameLineClusters).toHaveLength(0)
    expect(result.plannedCalls).toBe(2)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    const text = log.lines.join('\n')
    expect(text).not.toMatch(/\/sports\/americanfootball_nfl\/odds/)
    expect(text).toMatch(/CLOSE_CAPTURE_STATUS=ok/)
  })

  test('a yesterday EdgeSnapshot does not plan a game-line call', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: ['--game-lines'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge({ ts: '2026-07-15T03:00:00.000Z' })],
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.plannedCalls).toBe(0)
    expect(result.plannedCredits).toBe(0)
    expect(result.calls).toBe(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('EdgeSnapshot load orders by ts then id and follows the next page', async () => {
    const edgeTrace = []
    const page = Array.from({ length: 1000 }, (_, index) => ({
      id: `edge-${String(index).padStart(4, '0')}`,
      gameId: 'BOS_at_TOR',
      edgeMlHome: 0.04,
      ts: '2026-07-15T18:00:00.000Z',
    }))
    const result = await runCapturePublishedCloses({
      argv: ['--game-lines'],
      now: IN_WINDOW,
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edgeTrace,
        edgePages: (from) => (from === 0 ? page : []),
      }),
      fetchEventOdds: jest.fn(),
      log: memoryLog(),
    })
    expect(result.gameLineClusters).toHaveLength(1)
    expect(edgeTrace).toEqual([
      ['order', 'ts', false],
      ['order', 'id', true],
      ['range', 0, 999],
      ['order', 'ts', false],
      ['order', 'id', true],
      ['range', 1000, 1999],
    ])
  })

  test('a second run sees the persisted daily game-line credits and does not fetch', async () => {
    const files = new Map()
    const filesystem = {
      files,
      existsSync: (filePath) => files.has(filePath),
      mkdirSync() {},
      writeFileSync(filePath, data) { files.set(filePath, String(data)) },
      readFileSync(filePath) { return files.get(filePath) },
      renameSync(from, to) {
        files.set(to, files.get(from))
        files.delete(from)
      },
      unlinkSync(filePath) { files.delete(filePath) },
      linkSync(from, to) {
        if (files.has(to)) {
          const error = new Error(`EEXIST ${to}`)
          error.code = 'EEXIST'
          throw error
        }
        files.set(to, files.get(from))
      },
      readdirSync(dir) {
        const prefix = dir.endsWith('/') ? dir : `${dir}/`
        const names = []
        for (const key of files.keys()) {
          const name = String(key)
          if (!name.startsWith(prefix)) continue
          const rest = name.slice(prefix.length)
          if (!rest || rest.includes('/')) continue
          names.push(rest)
        }
        return names
      },
    }
    const budgetEnv = {
      ODDS_BUDGET_PATH: '/tmp/capture-game-line-budget.json',
      ODDS_GAME_LINE_CLOSE_DAILY_CAP: '2',
      ODDS_CLOSE_CAPTURE_RESERVE: '0',
      ODDS_REMAINING_FLOOR: '0',
      ODDS_DAILY_CREDIT_CAP: '5000',
    }
    const budgetOpts = {
      persist: true,
      filesystem,
      now: IN_WINDOW,
      purpose: 'close-capture',
      env: budgetEnv,
      log: { log() {}, warn() {} },
    }
    const fetchEventOdds = jest.fn(async () => sportOdds([
      nhlEvent('evt-bos', 'Boston Bruins', 'Toronto Maple Leafs'),
    ]))
    const closingOdds = []
    const first = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      now: IN_WINDOW,
      budget: createOddsApiBudget(budgetOpts),
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge()],
        closingOdds,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(first.calls).toBe(2)
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    const secondBudget = createOddsApiBudget(budgetOpts)
    expect(secondBudget.todayGameLineCredits()).toBe(2)
    fetchEventOdds.mockClear()
    const second = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      now: IN_WINDOW,
      budget: secondBudget,
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge()],
        closingOdds,
      }),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(second.calls).toBe(0)
    expect(second.gameLineClusters).toHaveLength(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(secondBudget.todayGameLineCredits()).toBe(2)
  })

  test('game lines do not consume the prop headroom while a prop job still plans', async () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: IN_WINDOW,
      purpose: 'close-capture',
      env: {
        ODDS_REMAINING_FLOOR: '0',
        ODDS_CLOSE_CAPTURE_RESERVE: '0',
      },
      log: { log() {}, warn() {} },
      state: {
        days: {
          '2026-07-15': { credits: 24, calls: 12, closeCaptures: 12, gameLineCredits: 0 },
        },
      },
    })
    const fetchEventOdds = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: ['--game-lines'],
      now: IN_WINDOW,
      budget,
      createClient: () => mockClient({
        games: [windowGame(), nhlGame()],
        picks: [publishedPick()],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds,
      log: memoryLog(),
    })
    expect(result.captureJobs).toHaveLength(1)
    expect(result.gameLineClusters).toHaveLength(0)
    expect(result.plannedCalls).toBe(2)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('live clock stops a paid game-line call once quiet or the window has passed', async () => {
    const quietInWindow = new Date('2026-07-15T23:06:00.000Z')
    const openMinute = new Date('2026-07-15T23:04:00.000Z')
    const laterGame = nhlGame({ date: '2026-07-15T23:20:00.000Z' })
    let ticks = 0
    const quietBeforeFetch = jest.fn()
    const quietRun = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      clock: () => {
        ticks += 1
        return ticks === 1 ? openMinute : quietInWindow
      },
      createClient: () => mockClient({
        games: [laterGame],
        picks: [],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds: quietBeforeFetch,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(quietBeforeFetch).not.toHaveBeenCalled()
    expect(quietRun.calls).toBe(1)

    const afterStart = new Date('2026-07-15T23:30:00.000Z')
    let planned = true
    const leftWindow = jest.fn()
    const windowRun = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      clock: () => {
        const instant = planned ? IN_WINDOW : afterStart
        planned = false
        return instant
      },
      createClient: () => mockClient({
        games: [nhlGame()],
        picks: [],
        edges: [gameLineEdge()],
      }),
      fetchEventOdds: leftWindow,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(leftWindow).not.toHaveBeenCalled()
    expect(windowRun.calls).toBe(1)
    expect(windowRun.skippedWindow).toBeGreaterThan(0)
  })

  test('a fetch that lands in the quiet window does not insert the close', async () => {
    const openMinute = new Date('2026-07-15T23:04:00.000Z')
    const quietInWindow = new Date('2026-07-15T23:06:00.000Z')
    let fetched = false
    const closingInserts = []
    const fetchEventOdds = jest.fn(async () => {
      fetched = true
      return sportOdds([nhlEvent('evt-bos', 'Boston Bruins', 'Toronto Maple Leafs')])
    })
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      clock: () => (fetched ? quietInWindow : openMinute),
      createClient: () => mockClient({
        games: [nhlGame({ date: '2026-07-15T23:20:00.000Z' })],
        picks: [],
        edges: [gameLineEdge()],
        closingInserts,
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.calls).toBe(2)
    expect(closingInserts).toEqual([])
    expect(result.gameLineWrites).toEqual([])
  })

  test('a dropped target rebuilds the sport request commence bounds', async () => {
    const fetchEventOdds = jest.fn(async () => sportOdds([
      nhlEvent('evt-bos', 'Boston Bruins', 'Toronto Maple Leafs'),
    ]))
    let ticks = 0
    await runCapturePublishedCloses({
      argv: ['--apply', '--game-lines'],
      clock: () => {
        ticks += 1
        return ticks === 1 ? IN_WINDOW : new Date('2026-07-15T22:52:00.000Z')
      },
      createClient: () => mockClient({
        games: [
          nhlGame({ id: 'EARLY_NHL', oddsApiEventId: 'evt-early', date: '2026-07-15T22:50:00.000Z' }),
          nhlGame({ date: '2026-07-15T23:10:00.000Z' }),
        ],
        picks: [],
        edges: [
          gameLineEdge({ id: 'edge-early', gameId: 'EARLY_NHL' }),
          gameLineEdge(),
        ],
      }),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1, last: 0 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    const url = new URL(fetchEventOdds.mock.calls[0][0].url)
    expect(url.searchParams.get('commenceTimeFrom')).toBe('2026-07-15T23:09:59.000Z')
    expect(url.searchParams.get('commenceTimeTo')).toBe('2026-07-15T23:10:01.000Z')
  })
})
