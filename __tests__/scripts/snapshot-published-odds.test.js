import { createOddsApiBudget } from '../../lib/odds-api-budget.js'
import { PUBLISHED_COHORT_TAG, PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import {
  parseSnapshotArgs,
  runSnapshotPublishedOdds,
} from '../../scripts/snapshot-published-odds.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
    warn: (...args) => lines.push(args.join(' ')),
  }
}

function publishedPick(overrides = {}) {
  return {
    id: 'pv-mack',
    propId: 'prop-mack',
    gameIdRef: 'BOS_at_TOR_2026-11-05',
    playerName: 'Nathan MacKinnon',
    propType: 'player_shots_on_goal',
    threshold: 3.5,
    prediction: 'over',
    odds: -115,
    edge: 0.07,
    qualityScore: 55,
    sport: 'nhl',
    source: PUBLISHED_SOURCE,
    status: 'pending',
    notes: PUBLISHED_COHORT_TAG,
    ...overrides,
  }
}

function futureGame(overrides = {}) {
  return {
    id: 'BOS_at_TOR_2026-11-05',
    sport: 'nhl',
    date: '2026-11-05T23:00:00.000Z',
    status: 'scheduled',
    oddsApiEventId: 'evt-bos-tor',
    ...overrides,
  }
}

function eventOdds() {
  return {
    bookmakers: [{
      title: 'FanDuel',
      markets: [{
        key: 'player_shots_on_goal',
        outcomes: [{
          name: 'Over',
          description: 'Nathan MacKinnon',
          point: 3.5,
          price: -112,
        }],
      }],
    }],
  }
}

function chainable(terminal, extras = {}) {
  const query = {
    select() { return query },
    eq() { return query },
    in() { return query },
    gt() { return query },
    gte() { return query },
    lte() { return query },
    or() { return query },
    order() { return query },
    range() { return terminal },
    then: terminal.then?.bind(terminal),
    insert: extras.insert,
  }
  return query
}

function mockClient({
  games = [futureGame()],
  picks = [publishedPick()],
  snapshots = [],
  snapshotError = null,
  cache = [],
  inserts = [],
  insertError = null,
} = {}) {
  return {
    from(table) {
      if (table === 'Game') {
        return chainable(Promise.resolve({ data: games, error: null }))
      }
      if (table === 'OddsSnapshot') {
        return chainable(Promise.resolve({
          data: snapshotError ? null : snapshots,
          error: snapshotError,
        }), {
          insert(rows) {
            if (insertError) return Promise.resolve({ data: null, error: insertError })
            const list = Array.isArray(rows) ? rows : [rows]
            inserts.push(...list)
            return Promise.resolve({ data: list, error: null })
          },
        })
      }
      if (table === 'PlayerPropCache') {
        return chainable(Promise.resolve({ data: cache, error: null }))
      }
      return chainable(Promise.resolve({ data: picks, error: null }))
    },
  }
}

const NOW = new Date('2026-11-05T17:00:00.000Z')

function budget(overrides = {}) {
  return createOddsApiBudget({
    persist: false,
    now: NOW,
    log: memoryLog(),
    env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
    state: { lastRemaining: 12000, lastUsed: 2000, quotaDay: '2026-11-05' },
    purpose: 'snapshot',
    ...overrides,
  })
}

describe('snapshot-published-odds script', () => {
  test('parseSnapshotArgs is dry-run by default and does not honor CLV_APPLY', () => {
    expect(parseSnapshotArgs([]).dryRun).toBe(true)
    expect(parseSnapshotArgs([], { CLV_APPLY: '1' }).apply).toBe(false)
    expect(parseSnapshotArgs(['--apply']).apply).toBe(true)
    expect(parseSnapshotArgs([], { SNAPSHOT_APPLY: '1' }).apply).toBe(true)
    expect(parseSnapshotArgs(['--nfl-all']).unknown).toEqual(['--nfl-all'])
  })

  test('dry-run plans Published events and prints the footer without fetching', async () => {
    const log = memoryLog()
    const fetchEventOdds = jest.fn()
    const result = await runSnapshotPublishedOdds({
      argv: [],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      log,
      budget: budget(),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.snapshotStatus).toBe('ok')
    expect(result.events).toBe(1)
    expect(result.calls).toBe(0)
    expect(log.lines.some((line) => line === 'MODE: DRY-RUN')).toBe(true)
    expect(log.lines.some((line) => line === 'SNAPSHOT_STATUS=ok')).toBe(true)
    expect(log.lines.some((line) => line === 'SNAPSHOT_EVENTS=1')).toBe(true)
    expect(log.lines.some((line) => line === 'CALLS_USED=0')).toBe(true)
    expect(log.lines.some((line) => line === 'CREDITS=0')).toBe(true)
  })

  test('never snapshots shadow-published rows', async () => {
    const result = await runSnapshotPublishedOdds({
      argv: [],
      now: NOW,
      createClient: () => mockClient({
        picks: [publishedPick({
          id: 'pv-shadow',
          notes: `${SHADOW_PUBLISHED_COHORT_TAG} leftover`,
        })],
      }),
      fetchEventOdds: jest.fn(),
      log: memoryLog(),
      budget: budget(),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(result.events).toBe(0)
    expect(result.snapshotJobs || []).toHaveLength(0)
  })

  test('skips events inside the close-capture window', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({
        games: [futureGame({ date: '2026-11-05T17:20:00.000Z' })],
      }),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 12000, used: 2000, last: 0 })),
      apiKey: 'secret-key',
      log: memoryLog(),
      budget: budget(),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.events).toBe(0)
  })

  test('skips events whose saved quotes are fresher than 90 minutes', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({
        snapshots: [{
          gameId: 'BOS_at_TOR_2026-11-05',
          capturedAt: '2026-11-05T16:20:00.000Z',
        }],
      }),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 12000, used: 2000, last: 0 })),
      apiKey: 'secret-key',
      log: memoryLog(),
      budget: budget(),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.skippedFresh).toBe(1)
  })

  test('self-stops during the :05–:15 ET quiet window', async () => {
    const quiet = new Date('2026-11-05T05:08:00.000-05:00')
    const fetchEventOdds = jest.fn()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: quiet,
      createClient: () => mockClient(),
      fetchEventOdds,
      log: memoryLog(),
      budget: budget({ now: quiet }),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.skippedQuiet).toBe(true)
    expect(result.snapshotStatus).toBe('partial')
  })

  test('--apply writes OddsSnapshot through the budget guard', async () => {
    const inserts = []
    const fetchEventOdds = jest.fn(async () => ({
      data: eventOdds(),
      quota: { remaining: 11999, used: 2001, last: 1 },
      skipped: false,
    }))
    const oddsBudget = budget()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({ inserts }),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 12000, used: 2000, last: 0 })),
      apiKey: 'secret-key',
      log: memoryLog(),
      budget: oddsBudget,
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    const url = String(fetchEventOdds.mock.calls[0][0].url)
    expect(url).toContain('/events/evt-bos-tor/odds')
    expect(url).toContain('regions=us')
    expect(url).toContain('player_shots_on_goal')
    expect(result.rows).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].propValidationId).toBe('pv-mack')
    expect(inserts[0].source).toBe('midday')
    expect(inserts[0].consensusOdds).toBe(-112)
    expect(result.snapshotStatus).toBe('ok')
    expect(result.events).toBe(1)
    expect(oddsBudget.purpose).toBe('snapshot')
  })

  test('degrades on missing OddsSnapshot table without crashing', async () => {
    const log = memoryLog()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({
        snapshotError: { code: '42P01', message: 'relation OddsSnapshot does not exist' },
      }),
      fetchEventOdds: jest.fn(),
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      log,
      budget: budget(),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(result.tableMissing).toBe(true)
    expect(result.snapshotStatus).toBe('partial')
    expect(result.calls).toBe(0)
    expect(log.lines.some((line) => /011 SQL/.test(line))).toBe(true)
  })

  test('stops after the daily snapshot pass cap', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      log: memoryLog(),
      budget: budget(),
      persistPasses: false,
      passState: { days: { '2026-11-05': { passes: 2 } } },
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.skippedPasses).toBe(true)
    expect(result.events).toBe(0)
  })

  test('honors remaining-credit floor via the shared budget guard', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runSnapshotPublishedOdds({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 2500, used: 17000, last: 0 })),
      apiKey: 'secret-key',
      log: memoryLog(),
      budget: createOddsApiBudget({
        persist: false,
        now: NOW,
        log: memoryLog(),
        env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
        state: { lastRemaining: 2500, lastUsed: 17000, quotaDay: '2026-11-05' },
        purpose: 'snapshot',
      }),
      persistPasses: false,
      env: { NODE_ENV: 'test' },
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.skippedBudget || result.snapshotStatus).toBeTruthy()
  })
})
