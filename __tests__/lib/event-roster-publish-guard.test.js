const inserts = []
const from = jest.fn()

function createChain(result = { data: null, error: null }) {
  const chain = {}
  const passthrough = () => chain
  chain.select = jest.fn(passthrough)
  chain.eq = jest.fn(passthrough)
  chain.in = jest.fn(passthrough)
  chain.gt = jest.fn(passthrough)
  chain.gte = jest.fn(passthrough)
  chain.order = jest.fn(passthrough)
  chain.limit = jest.fn(passthrough)
  chain.maybeSingle = jest.fn(async () => result)
  chain.single = jest.fn(async () => result)
  chain.update = jest.fn(() => chain)
  chain.insert = jest.fn((payload) => {
    inserts.push(payload)
    return chain
  })
  chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

jest.mock('../../lib/supabase-admin.js', () => ({
  isSupabaseAdminConfigured: () => true,
  supabaseAdmin: {
    from: (...args) => from(...args),
  },
}))

import {
  persistPublishedEligibleProps,
  persistShadowPublishedEligibleProps,
} from '../../lib/validation.js'
import { ROSTER_SKIP_REASONS } from '../../lib/event-roster-eligibility.js'
import {
  publishedRosterOutageExit,
  runRecordPublishedProps,
} from '../../scripts/record-published-props.js'

const NYG_PHI = {
  id: 'NYG_at_PHI_2026-11-02',
  sport: 'nfl',
  status: 'scheduled',
  date: '2026-11-02T18:00:00.000Z',
  espnGameId: '401772801',
  homeId: 'NFL_21',
  awayId: 'NFL_19',
  home: { abbr: 'PHI' },
  away: { abbr: 'NYG' },
}

function publishedNfl(overrides = {}) {
  return {
    playerName: 'Malik Nabers',
    gameId: NYG_PHI.id,
    sport: 'nfl',
    type: 'receiving_yards',
    pick: 'over',
    threshold: 64.5,
    odds: -110,
    edge: 0.08,
    qualityScore: 55,
    category: 'player_prop',
    ...overrides,
  }
}

function shadowNhl(overrides = {}) {
  return {
    playerName: 'Jack Hughes',
    gameId: 'NYR_at_NJD_2026-11-02',
    sport: 'nhl',
    type: 'points',
    pick: 'over',
    threshold: 0.5,
    odds: -110,
    edge: 0.08,
    qualityScore: 55,
    category: 'player_prop',
    ...overrides,
  }
}

describe('Published persist applies the event-roster guard', () => {
  beforeEach(() => {
    inserts.length = 0
    from.mockReset()
    from.mockImplementation((table) => {
      if (table === 'Game') return createChain({ data: NYG_PHI, error: null })
      const chain = createChain({ data: null, error: null })
      chain.insert = jest.fn((payload) => {
        inserts.push(payload)
        const written = createChain({ data: { id: 'pv-1', ...payload }, error: null })
        return written
      })
      return chain
    })
  })

  test('does not record a free-agent Slayton prop as Published', async () => {
    const lines = []
    const saved = await persistPublishedEligibleProps([
      publishedNfl({ playerName: 'Darius Slayton' }),
      publishedNfl({ playerName: 'Malik Nabers' }),
    ], {
      guardPropsByEventRoster: async (rows) => ({
        kept: rows.filter((row) => row.playerName !== 'Darius Slayton'),
        skipped: rows.filter((row) => row.playerName === 'Darius Slayton').map((row) => ({
          playerName: row.playerName,
          event: 'NYG @ PHI (NYG_at_PHI_2026-11-02)',
          reason: ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER,
        })),
      }),
      log: (...args) => lines.push(args.join(' ')),
    })
    expect(saved).toHaveLength(1)
    expect(inserts.some((row) => row.playerName === 'Darius Slayton')).toBe(false)
    expect(inserts[0].playerName).toBe('Malik Nabers')
    expect(inserts[0].notes).toMatch(/cohort:published/)
  })

  test('fails closed when ESPN roster fetch fails, without writing', async () => {
    const saved = await persistPublishedEligibleProps([
      publishedNfl({ playerName: 'Malik Nabers' }),
    ], {
      loadGame: async () => NYG_PHI,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
      sleepImpl: async () => {},
      retryMs: 0,
      log: () => {},
      error: () => {},
    })
    expect([...saved]).toEqual([])
    expect(saved.rosterOutage).toBe(true)
    expect(saved.unavailableCount).toBe(1)
    expect(inserts).toEqual([])
  })
})

describe('shadow NHL persist uses the same roster guard and stays private', () => {
  beforeEach(() => {
    inserts.length = 0
    from.mockReset()
    from.mockImplementation((table) => {
      if (table === 'Game') {
        return createChain({
          data: {
            id: 'NYR_at_NJD_2026-11-02',
            sport: 'nhl',
            status: 'scheduled',
            date: '2026-11-02T00:00:00.000Z',
          },
          error: null,
        })
      }
      const chain = createChain({ data: null, error: null })
      chain.insert = jest.fn((payload) => {
        inserts.push(payload)
        return createChain({ data: { id: 'pv-shadow', ...payload }, error: null })
      })
      return chain
    })
  })

  test('records shadow-published notes, not public Published, after roster keep', async () => {
    const saved = await persistShadowPublishedEligibleProps([
      shadowNhl(),
    ], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(1)
    expect(inserts[0].notes).toMatch(/cohort:shadow-published/)
    expect(inserts[0].notes).not.toMatch(/cohort:published[^-]/)
    expect(inserts[0].sport).toBe('nhl')
  })

  test('does not persist a shadow NHL prop when the roster is unavailable', async () => {
    const saved = await persistShadowPublishedEligibleProps([
      shadowNhl({ playerName: 'Connor McDavid' }),
    ], {
      loadGame: async () => ({
        id: 'NYR_at_NJD_2026-11-02',
        sport: 'nhl',
        home: { abbr: 'NJD' },
        away: { abbr: 'NYR' },
        homeId: 'NHL_11',
        awayId: 'NHL_13',
      }),
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
      sleepImpl: async () => {},
      retryMs: 0,
      log: () => {},
      error: () => {},
    })
    expect([...saved]).toEqual([])
    expect(inserts).toEqual([])
  })
})

describe('record:published exits non-zero on a full roster outage', () => {
  test('publishedRosterOutageExit is 1 only when every guarded prop was unavailable', () => {
    expect(publishedRosterOutageExit({ rosterOutage: true })).toBe(1)
    expect(publishedRosterOutageExit({ rosterOutage: false, unavailableCount: 2 })).toBe(0)
    expect(publishedRosterOutageExit([])).toBe(0)
  })

  test('runRecordPublishedProps logs a loud warning and returns exitCode 1', async () => {
    const lines = []
    const errors = []
    const saved = []
    saved.rosterOutage = true
    saved.unavailableCount = 3
    const result = await runRecordPublishedProps({
      persist: async () => saved,
      log: (...args) => lines.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    })
    expect(result.exitCode).toBe(1)
    expect(errors.join('\n')).toMatch(/Roster guard outage/)
    expect(lines.join('\n')).toMatch(/unavailable=3/)
  })
})
