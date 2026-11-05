import { createOddsApiBudget } from '../../lib/odds-api-budget.js'
import { PUBLISHED_COHORT_TAG, PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import {
  parseNflAltArgs,
  runFetchPublishedNflAltLines,
} from '../../scripts/fetch-published-nfl-alt-lines.js'

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
    id: 'pv-hurts',
    propId: 'prop-hurts',
    gameIdRef: 'DAL_at_PHI_2026-11-08',
    playerName: 'Jalen Hurts',
    propType: 'player_pass_yds',
    threshold: 224.5,
    prediction: 'over',
    odds: -110,
    edge: 0.06,
    qualityScore: 52,
    sport: 'nfl',
    source: PUBLISHED_SOURCE,
    status: 'pending',
    notes: PUBLISHED_COHORT_TAG,
    ...overrides,
  }
}

function futureGame(overrides = {}) {
  return {
    id: 'DAL_at_PHI_2026-11-08',
    sport: 'nfl',
    date: '2026-11-08T21:00:00.000Z',
    status: 'scheduled',
    oddsApiEventId: 'evt-dal-phi',
    ...overrides,
  }
}

function eventOdds() {
  return {
    bookmakers: [{
      title: 'FanDuel',
      markets: [{
        key: 'player_pass_yds_alternate',
        last_update: '2026-11-08T16:00:00.000Z',
        outcomes: [{
          name: 'Over',
          description: 'Jalen Hurts',
          point: 219.5,
          price: -115,
        }, {
          name: 'Over',
          description: 'Jalen Hurts',
          point: 224.5,
          price: -110,
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
    update: extras.update,
  }
  return query
}

function mockClient({
  games = [futureGame()],
  picks = [publishedPick()],
  cache = [{
    id: 'cache-1',
    propId: 'prop-hurts',
    gameId: 'DAL_at_PHI_2026-11-08',
    playerName: 'Jalen Hurts',
    type: 'player_pass_yds',
    pick: 'over',
    altQuotes: null,
    altQuoteUpdatedAt: null,
  }],
  cacheError = null,
  updates = [],
  updateError = null,
} = {}) {
  return {
    from(table) {
      if (table === 'Game') {
        return chainable(Promise.resolve({ data: games, error: null }))
      }
      if (table === 'PlayerPropCache') {
        return chainable(Promise.resolve({
          data: cacheError ? null : cache,
          error: cacheError,
        }), {
          update(payload) {
            if (updateError) {
              return {
                eq() { return Promise.resolve({ data: null, error: updateError }) },
              }
            }
            updates.push(payload)
            return {
              eq() { return Promise.resolve({ data: payload, error: null }) },
            }
          },
        })
      }
      return chainable(Promise.resolve({ data: picks, error: null }))
    },
  }
}

const NOW = new Date('2026-11-08T16:00:00.000Z')

function budget(overrides = {}) {
  return createOddsApiBudget({
    persist: false,
    now: NOW,
    log: memoryLog(),
    env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
    state: { lastRemaining: 12000, lastUsed: 2000, quotaDay: '2026-11-08' },
    purpose: 'nfl-alt',
    ...overrides,
  })
}

describe('fetch-published-nfl-alt-lines script', () => {
  test('parseNflAltArgs is dry-run by default and does not honor SNAPSHOT_APPLY or CLV_APPLY', () => {
    expect(parseNflAltArgs([]).dryRun).toBe(true)
    expect(parseNflAltArgs([], { CLV_APPLY: '1' }).apply).toBe(false)
    expect(parseNflAltArgs([], { SNAPSHOT_APPLY: '1' }).apply).toBe(false)
    expect(parseNflAltArgs(['--apply']).apply).toBe(true)
    expect(parseNflAltArgs([], { NFL_ALT_APPLY: '1' }).apply).toBe(true)
    expect(parseNflAltArgs(['--nfl-all']).unknown).toEqual(['--nfl-all'])
    expect(parseNflAltArgs(['--apply-stale']).unknown).toEqual(['--apply-stale'])
  })

  test('dry-run plans Published NFL events and prints the footer without fetching', async () => {
    const log = memoryLog()
    const fetchEventOdds = jest.fn()
    const result = await runFetchPublishedNflAltLines({
      argv: [],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget(),
      persistDays: false,
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.exitCode).toBe(0)
    expect(result.nflAltStatus).toBe('ok')
    expect(result.altJobs).toHaveLength(1)
    expect(result.altJobs[0].markets).toEqual(['player_pass_yds_alternate'])
    expect(result.creditsUsed).toBe(0)
    expect(result.calls).toBe(0)
    expect(log.lines.some((line) => line.includes('MODE: DRY-RUN'))).toBe(true)
    expect(log.lines).toEqual(expect.arrayContaining([
      'NFL_ALT_STATUS=ok',
      'NFL_ALT_EVENTS=1',
      'CALLS_USED=0',
      'CREDITS=0',
    ]))
  })

  test('drops shadow, unpublished, NHL, and close-window games', async () => {
    const log = memoryLog()
    const result = await runFetchPublishedNflAltLines({
      argv: [],
      now: NOW,
      createClient: () => mockClient({
        picks: [
          publishedPick(),
          publishedPick({
            id: 'shadow',
            notes: SHADOW_PUBLISHED_COHORT_TAG,
          }),
          publishedPick({
            id: 'nhl',
            sport: 'nhl',
            propType: 'player_shots_on_goal',
          }),
          publishedPick({
            id: 'user',
            source: 'user_saved',
          }),
        ],
        games: [
          futureGame(),
          futureGame({
            id: 'close-game',
            date: '2026-11-08T16:30:00.000Z',
          }),
        ],
      }),
      fetchEventOdds: jest.fn(),
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget(),
      persistDays: false,
    })
    expect(result.altJobs).toHaveLength(1)
    expect(result.altJobs[0].picks.map((pick) => pick.id)).toEqual(['pv-hurts'])
  })

  test('--apply writes altQuotes and does not rewrite odds or closeOdds', async () => {
    const log = memoryLog()
    const updates = []
    const fetchEventOdds = jest.fn(async ({ url }) => {
      expect(url).toContain('/americanfootball_nfl/events/evt-dal-phi/odds')
      expect(url).toContain('markets=player_pass_yds_alternate')
      expect(url).toContain('regions=us')
      expect(url).not.toContain('player_pass_yds&')
      expect(url).not.toContain('player_shots_on_goal')
      return { data: eventOdds(), quota: { remaining: 11998, used: 2002, last: 1 } }
    })
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({ updates }),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 12000, used: 2000, last: 0 })),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget(),
      persistDays: false,
    })
    expect(result.nflAltStatus).toBe('ok')
    expect(result.creditsUsed).toBe(1)
    expect(result.calls).toBe(2)
    expect(updates).toHaveLength(1)
    expect(updates[0].altQuotes).toEqual([
      expect.objectContaining({ line: 219.5, side: 'over', price: -115, book: 'FanDuel' }),
      expect.objectContaining({ line: 224.5, side: 'over', price: -110, book: 'FanDuel' }),
    ])
    expect(updates[0].altQuoteUpdatedAt).toBe(NOW.toISOString())
    expect(updates[0].altQuotes[0].lastUpdate).toBe('2026-11-08T16:00:00.000Z')
    expect(updates[0].odds).toBeUndefined()
    expect(updates[0].closeOdds).toBeUndefined()
    expect(log.lines).toEqual(expect.arrayContaining([
      'NFL_ALT_STATUS=ok',
      'CREDITS=1',
    ]))
  })

  test('refuses to start in the quiet window and re-checks before write', async () => {
    const quietStart = new Date('2026-11-08T09:05:00.000Z')
    const log = memoryLog()
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: quietStart,
      createClient: () => mockClient(),
      fetchEventOdds: jest.fn(),
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget({ now: quietStart }),
      persistDays: false,
    })
    expect(result.skippedQuiet).toBe(true)
    expect(result.calls).toBe(0)
    expect(result.creditsUsed).toBe(0)
    expect(log.lines.some((line) => /quiet window/i.test(line))).toBe(true)
  })

  test('post-setup quiet abort happens before the paid fetch', async () => {
    const ticks = [
      new Date('2026-11-08T16:00:00.000Z'),
      new Date('2026-11-08T09:04:30.000Z'),
    ]
    const log = memoryLog()
    const fetchEventOdds = jest.fn()
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      clock: () => ticks.shift() || new Date('2026-11-08T09:04:30.000Z'),
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget(),
      persistDays: false,
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.skippedQuiet).toBe(true)
    expect(result.nflAltStatus).toBe('partial')
    expect(log.lines.some((line) => /aborting after setup/i.test(line))).toBe(true)
  })

  test('degrades when 012 columns are missing on apply', async () => {
    const log = memoryLog()
    const fetchEventOdds = jest.fn()
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({
        cacheError: { code: 'PGRST204', message: "Could not find the 'altQuotes' column" },
      }),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget(),
      persistDays: false,
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.columnsMissing).toBe(true)
    expect(result.creditsUsed).toBe(0)
    expect(result.nflAltStatus).toBe('partial')
  })

  test('ODDS_NFL_ALT=0 and daily cap 0 disable without fetching', async () => {
    const fetchEventOdds = jest.fn()
    const off = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key', ODDS_NFL_ALT: '0' },
      log: memoryLog(),
      budget: budget(),
      persistDays: false,
    })
    expect(off.skippedDisabled).toBe(true)
    expect(fetchEventOdds).not.toHaveBeenCalled()

    const capOff = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key', ODDS_NFL_ALT_DAILY_CREDITS: '0' },
      log: memoryLog(),
      budget: budget(),
      persistDays: false,
    })
    expect(capOff.skippedDisabled).toBe(true)
  })

  test('cap-reached footer does not count fresh skips as close-window', async () => {
    const result = await runFetchPublishedNflAltLines({
      argv: [],
      now: NOW,
      createClient: () => mockClient({
        picks: [
          publishedPick(),
          publishedPick({
            id: 'pv-close',
            gameIdRef: 'close-game',
          }),
        ],
        games: [
          futureGame(),
          futureGame({
            id: 'close-game',
            date: '2026-11-08T16:30:00.000Z',
          }),
        ],
        cache: [{
          id: 'cache-1',
          propId: 'prop-hurts',
          gameId: 'DAL_at_PHI_2026-11-08',
          playerName: 'Jalen Hurts',
          type: 'player_pass_yds',
          pick: 'over',
          altQuoteUpdatedAt: '2026-11-08T15:00:00.000Z',
        }],
      }),
      fetchEventOdds: jest.fn(),
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log: memoryLog(),
      budget: budget(),
      persistDays: false,
      dayState: { version: 1, days: { '2026-11-08': { credits: 48 } } },
    })
    expect(result.skippedCap).toBe(true)
    expect(result.skippedWindow).toBe(1)
    expect(result.skippedFresh).toBe(1)
    expect(result.creditsUsed).toBe(0)
  })

  test('skips --apply when the exclusive lock is held', async () => {
    const fetchEventOdds = jest.fn()
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient(),
      fetchEventOdds,
      probeQuota: jest.fn(),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log: memoryLog(),
      budget: budget(),
      persistDays: false,
      acquirePassLock: () => ({ acquired: false, release() {} }),
    })
    expect(fetchEventOdds).not.toHaveBeenCalled()
    expect(result.skippedLock).toBe(true)
    expect(result.nflAltStatus).toBe('partial')
    expect(result.creditsUsed).toBe(0)
  })

  test('records spend per call and stops before exceeding the daily cap', async () => {
    const fetchEventOdds = jest.fn(async () => ({
      data: eventOdds(),
      quota: { remaining: 11998, used: 2002, last: 1 },
    }))
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      now: NOW,
      createClient: () => mockClient({
        picks: [
          publishedPick(),
          publishedPick({
            id: 'pv-saquon',
            propId: 'prop-saquon',
            gameIdRef: 'KC_at_BUF_2026-11-08',
            playerName: 'Saquon Barkley',
            propType: 'player_rush_yds',
          }),
        ],
        games: [
          futureGame(),
          futureGame({
            id: 'KC_at_BUF_2026-11-08',
            date: '2026-11-08T21:25:00.000Z',
            oddsApiEventId: 'evt-kc-buf',
          }),
        ],
        cache: [
          {
            id: 'cache-1',
            propId: 'prop-hurts',
            gameId: 'DAL_at_PHI_2026-11-08',
            playerName: 'Jalen Hurts',
            type: 'player_pass_yds',
            pick: 'over',
          },
          {
            id: 'cache-2',
            propId: 'prop-saquon',
            gameId: 'KC_at_BUF_2026-11-08',
            playerName: 'Saquon Barkley',
            type: 'player_rush_yds',
            pick: 'over',
          },
        ],
      }),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 12000, used: 2000, last: 0 })),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log: memoryLog(),
      budget: budget(),
      persistDays: false,
      dayState: { version: 1, days: { '2026-11-08': { credits: 47 } } },
    })
    expect(fetchEventOdds).toHaveBeenCalledTimes(1)
    expect(result.creditsUsed).toBe(1)
  })

  test('re-checks quiet inside the per-row write loop and holds remaining', async () => {
    const updates = []
    const quiet = new Date('2026-11-08T09:05:00.000Z')
    const clock = () => (updates.length >= 1 ? quiet : NOW)
    const fetchEventOdds = jest.fn(async () => ({
      data: eventOdds(),
      quota: { remaining: 11998, used: 2002, last: 1 },
    }))
    const log = memoryLog()
    const result = await runFetchPublishedNflAltLines({
      argv: ['--apply'],
      clock,
      createClient: () => mockClient({
        cache: [
          {
            id: 'cache-1',
            propId: 'prop-hurts',
            gameId: 'DAL_at_PHI_2026-11-08',
            playerName: 'Jalen Hurts',
            type: 'player_pass_yds',
            pick: 'over',
          },
          {
            id: 'cache-1b',
            propId: 'prop-hurts-b',
            gameId: 'DAL_at_PHI_2026-11-08',
            playerName: 'Jalen Hurts',
            type: 'player_pass_yds',
            pick: 'over',
          },
        ],
        updates,
      }),
      fetchEventOdds,
      probeQuota: jest.fn(async () => ({ remaining: 12000, used: 2000, last: 0 })),
      apiKey: 'secret-key',
      env: { SUPABASE_SECRET_KEY: 'secret-key' },
      log,
      budget: budget(),
      persistDays: false,
    })
    expect(result.skippedQuiet).toBe(true)
    expect(result.nflAltStatus).toBe('partial')
    expect(updates).toHaveLength(1)
    expect(log.lines.some((line) => /Quiet window before write/.test(line))).toBe(true)
  })
})
