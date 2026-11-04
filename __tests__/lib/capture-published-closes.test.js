import { createScriptSupabaseClient } from '../../lib/supabase-script-client.js'
import { isPublishableSupabaseKey } from '../../lib/supabase-admin-key.js'
import { PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import {
  assertCaptureSecretIsNotPublishable,
  captureSupabaseEnv,
  formatCaptureModeBanner,
  isClosingCaptureDisabled,
  parseCaptureClosesArgs,
  runCapturePublishedCloses,
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
          outcomes: [
            { name: 'Kansas City Chiefs', price: -150 },
            { name: 'Buffalo Bills', price: 130 },
          ],
        },
        {
          key: 'spreads',
          outcomes: [
            { name: 'Kansas City Chiefs', price: -110, point: -3.5 },
            { name: 'Buffalo Bills', price: -110, point: 3.5 },
          ],
        },
        {
          key: 'totals',
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
} = {}) {
  return {
    from(table) {
      if (table === 'Game') {
        return chainable(Promise.resolve({ data: games, error: null }))
      }
      if (table === 'ClosingOdds') {
        const query = {
          select() { return query },
          eq() { return query },
          in() { return query },
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
    expect(result).toMatchObject({ exitCode: 0, calls: 0, skippedQuiet: true })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(log.lines[0]).toBe('MODE: APPLY')
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
    expect(log.lines[0]).toBe('MODE: DRY-RUN')
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
    expect(result.exitCode).toBe(1)
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

  test('invalid --max-calls or --min-remaining exits 1 before any work', async () => {
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
      expect(result.exitCode).toBe(1)
      expect(result.invalidFlags?.length).toBeGreaterThan(0)
      expect(log.lines.join('\n')).toMatch(/Invalid or missing value/)
    }
    expect(createClient).not.toHaveBeenCalled()
    expect(fetchEventOdds).not.toHaveBeenCalled()
  })

  test('unknown flags and stray positionals exit 1', async () => {
    const log = memoryLog()
    const result = await runCapturePublishedCloses({
      argv: ['--apply', '3'],
      now: IN_WINDOW,
      createClient: jest.fn(),
      fetchEventOdds: jest.fn(),
      log,
    })
    expect(result.exitCode).toBe(1)
    expect(result.unknown).toEqual(['3'])
    expect(log.lines.join('\n')).toMatch(/Unknown argument/)
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
    expect(result.exitCode).toBe(1)
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
    expect(result.exitCode).toBe(1)
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
    expect(result.exitCode).toBe(1)
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
})
