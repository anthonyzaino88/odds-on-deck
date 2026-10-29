import { createScriptSupabaseClient } from '../../lib/supabase-script-client.js'
import { PUBLISHED_SOURCE } from '../../lib/published-picks.js'
import {
  captureSupabaseEnv,
  isClosingCaptureDisabled,
  parseCaptureClosesArgs,
  runCapturePublishedCloses,
} from '../../scripts/capture-published-closes.js'

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

function mockClient({
  games = [windowGame()],
  picks = [publishedPick()],
  pickError = null,
  updates = [],
} = {}) {
  return {
    from(table) {
      if (table === 'Game') {
        return chainable(Promise.resolve({ data: games, error: null }))
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
              then(resolve, reject) {
                return Promise.resolve({ error: null }).then(resolve, reject)
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
            then(resolve, reject) {
              return Promise.resolve({ error: null }).then(resolve, reject)
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
    expect(parseCaptureClosesArgs([])).toMatchObject({ apply: false, dryRun: true })
    expect(parseCaptureClosesArgs(['--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseCaptureClosesArgs(['--apply'])).toMatchObject({ apply: true, dryRun: false })
    expect(parseCaptureClosesArgs(['--apply', '--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseCaptureClosesArgs(['--max-calls', '3']).maxCalls).toBe(3)
    expect(isClosingCaptureDisabled({ CLOSING_CAPTURE: '0' })).toBe(true)
    expect(isClosingCaptureDisabled({ CLOSING_CAPTURE: '1' })).toBe(false)
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
    expect(result).toMatchObject({ exitCode: 0, calls: 0, skippedQuiet: true })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/quiet period/)
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
    expect(log.lines.join('\n')).toMatch(/DRY-RUN/)
    expect(log.lines.join('\n')).toMatch(/evt-kc-hou/)
    expect(log.lines.join('\n')).toMatch(/batter_hits/)
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
    expect(result.calls).toBe(1)
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
    expect(apply.exitCode).toBe(1)
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
    const result = await runCapturePublishedCloses({
      argv: ['--apply'],
      now: IN_WINDOW,
      env: { CLOSING_CAPTURE: '0' },
      createClient: () => { throw new Error('should not connect') },
      fetchEventOdds,
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result).toMatchObject({ exitCode: 0, calls: 0, skippedDisabled: true })
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('--max-calls 0 does not fetch', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '--max-calls', '0'],
      now: IN_WINDOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: async () => ({ remaining: 9000, used: 1 }),
      apiKey: 'test-key',
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toBe(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
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
    expect(result.calls).toBe(0)
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(probeQuota).toHaveBeenCalledTimes(1)
  })

  test('skips games that start within the final minute', async () => {
    const result = await runCapturePublishedCloses({
      argv: [],
      now: new Date('2026-07-15T23:09:00.000Z'),
      createClient: () => mockClient(),
      log: memoryLog(),
    })
    expect(result).toMatchObject({ exitCode: 0, calls: 0 })
    expect(result.openPicks || []).toHaveLength(0)
  })

  test('skips live, final, and postponed games even when the start is in-window', async () => {
    const fetchEventOdds = jest.fn()
    const games = [
      windowGame({ id: 'live', status: 'in_progress' }),
      windowGame({ id: 'done', status: 'final' }),
      windowGame({ id: 'ppd', status: 'postponed' }),
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
    expect(result.openPicks.map((pick) => pick.gameIdRef)).toEqual(['ok'])
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
    expect(result.calls).toBe(1)
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
                then(resolve, reject) {
                  writeFilters.push({ body, filters: [...filters] })
                  return Promise.resolve({ error: null }).then(resolve, reject)
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
              then(resolve, reject) {
                writeFilters.push({ body, filters: [...filters] })
                return Promise.resolve({ error: null }).then(resolve, reject)
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
    expect(result.exitCode).toBe(1)
    expect(result.missingSecret).toBe(true)
    expect(factory).not.toHaveBeenCalled()
    const printed = log.lines.join('\n')
    expect(printed).toMatch(/SUPABASE_REQUIRE_SECRET_KEY|SUPABASE_SECRET_KEY/)
    expect(printed).not.toMatch(/anon-public-key-should-never-print/)
    expect(printed).not.toMatch(/odds-api-key-should-never-print/)
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
    expect(result.exitCode).toBe(1)
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })
})
