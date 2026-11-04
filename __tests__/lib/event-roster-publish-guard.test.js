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
  chain.ilike = jest.fn(passthrough)
  chain.not = jest.fn(passthrough)
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

  test('injury snapshot skips Out players and flags Questionable on notes', async () => {
    const saved = await persistPublishedEligibleProps([
      publishedNfl({ playerName: 'Isiah Pacheco', team: 'KC' }),
      publishedNfl({ playerName: 'Travis Kelce', team: 'KC' }),
    ], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
      injurySnapshot: {
        injuries: [
          { sport: 'nfl', teamAbbr: 'KC', playerName: 'Isiah Pacheco', status: 'Out' },
          { sport: 'nfl', teamAbbr: 'KC', playerName: 'Travis Kelce', status: 'Questionable' },
        ],
        goalies: [],
      },
      log: () => {},
    })
    expect(saved).toHaveLength(1)
    expect(inserts.some((row) => row.playerName === 'Isiah Pacheco')).toBe(false)
    expect(inserts[0].playerName).toBe('Travis Kelce')
    expect(inserts[0].notes).toMatch(/injury:questionable/)
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

describe('public NHL persist uses the Published path and roster guard', () => {
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
        return createChain({ data: { id: 'pv-nhl', ...payload }, error: null })
      })
      return chain
    })
  })

  test('records the stronger NHL side when Over and Under of the same line both clear', async () => {
    const saved = await persistPublishedEligibleProps([
      shadowNhl({
        playerName: 'Brock Boeser',
        type: 'player_shots_on_goal',
        pick: 'under',
        threshold: 2.5,
        edge: 0.04,
        qualityScore: 42,
      }),
      shadowNhl({
        playerName: 'Brock Boeser',
        type: 'player_shots_on_goal',
        pick: 'over',
        threshold: 2.5,
        edge: 0.09,
        qualityScore: 58,
      }),
    ], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].playerName).toBe('Brock Boeser')
    expect(inserts[0].prediction).toBe('over')
  })

  test('records new NHL as cohort:published after roster keep', async () => {
    const saved = await persistPublishedEligibleProps([
      shadowNhl(),
    ], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(1)
    expect(inserts[0].notes).toMatch(/cohort:published/)
    expect(inserts[0].notes).not.toMatch(/shadow-published/)
    expect(inserts[0].sport).toBe('nhl')
  })

  test('does not persist a public NHL prop when the roster is unavailable', async () => {
    const saved = await persistPublishedEligibleProps([
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

  test('leaves an existing shadow-tagged NHL row unchanged', async () => {
    const existing = {
      id: 'pv-shadow-hist',
      status: 'pending',
      source: 'system_generated',
      notes: 'cohort:shadow-published',
      sport: 'nhl',
      playerName: 'Jack Hughes',
    }
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
      const chain = createChain({ data: existing, error: null })
      chain.update = jest.fn(() => {
        throw new Error('must not rewrite historical shadow rows')
      })
      chain.insert = jest.fn(() => {
        throw new Error('must not insert over historical shadow rows')
      })
      return chain
    })

    const saved = await persistPublishedEligibleProps([
      shadowNhl(),
    ], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe('pv-shadow-hist')
    expect(saved[0].notes).toBe('cohort:shadow-published')
    expect(inserts).toEqual([])
  })
})

describe('Published persist opposite-side lookup ignores auto-save and shadow', () => {
  const nhlGame = {
    id: 'VAN_at_NYR_2026-11-02',
    sport: 'nhl',
    status: 'scheduled',
    date: '2026-11-02T00:00:00.000Z',
  }

  function boeserOver() {
    return shadowNhl({
      playerName: 'Brock Boeser',
      gameId: nhlGame.id,
      type: 'player_shots_on_goal',
      pick: 'over',
      threshold: 2.5,
      edge: 0.08,
      qualityScore: 55,
      propId: 'VAN_at_NYR_2026-11-02-Brock Boeser-player_shots_on_goal-2.5-over',
    })
  }

  function oppositeRow(notes) {
    return {
      id: 'pv-under',
      gameIdRef: nhlGame.id,
      playerName: 'Brock Boeser',
      propType: 'player_shots_on_goal',
      threshold: 2.5,
      prediction: 'under',
      pick: 'under',
      source: 'system_generated',
      sport: 'nhl',
      notes,
    }
  }

  function mockWithOpposite(oppositeRows) {
    from.mockReset()
    inserts.length = 0
    from.mockImplementation((table) => {
      if (table === 'Game') return createChain({ data: nhlGame, error: null })
      const chain = createChain({ data: [], error: null })
      chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }))
      chain.ilike = jest.fn(() => {
        chain._notesIlike = true
        return chain
      })
      chain.then = (onFulfilled, onRejected) => {
        const result = chain._notesIlike
          ? { data: oppositeRows, error: null }
          : { data: [], error: null }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      chain.insert = jest.fn((payload) => {
        inserts.push(payload)
        return createChain({ data: { id: 'pv-over', ...payload }, error: null })
      })
      return chain
    })
  }

  test('auto-saved Under does not block a Published Over insert', async () => {
    mockWithOpposite([oppositeRow('tier:elite,auto-saved')])
    const saved = await persistPublishedEligibleProps([boeserOver()], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].prediction).toBe('over')
  })

  test('shadow Under does not block a Published Over insert', async () => {
    mockWithOpposite([oppositeRow('cohort:shadow-published')])
    const saved = await persistPublishedEligibleProps([boeserOver()], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(1)
    expect(inserts).toHaveLength(1)
  })

  test('existing cohort:published Under skips the opposite Over', async () => {
    mockWithOpposite([oppositeRow('cohort:published')])
    const saved = await persistPublishedEligibleProps([boeserOver()], {
      guardPropsByEventRoster: async (rows) => ({ kept: rows, skipped: [] }),
    })
    expect(saved).toHaveLength(0)
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
    expect(lines.join('\n')).toMatch(/ROSTER_GUARD_STATUS=outage unavailable=3/)
  })

  test('runRecordPublishedProps exits 1 when NFL is a full outage even if NHL kept a prop', async () => {
    const lines = []
    const errors = []
    const saved = [{ playerName: 'Jack Hughes', sport: 'nhl' }]
    saved.rosterOutage = true
    saved.unavailableCount = 2
    saved.rosterGuard = {
      rosterOutage: true,
      unavailableCount: 2,
      sports: {
        nfl: { rosterOutage: true, unavailableCount: 2 },
        nhl: { rosterOutage: false, unavailableCount: 0 },
      },
    }
    const result = await runRecordPublishedProps({
      persist: async () => saved,
      log: (...args) => lines.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    })
    expect(result.exitCode).toBe(1)
    expect(publishedRosterOutageExit(saved)).toBe(1)
    expect(saved).toHaveLength(1)
    expect(lines.join('\n')).toMatch(/ROSTER_GUARD_STATUS=outage unavailable=2 nfl=outage nhl=ok/)
    expect(errors.join('\n')).toMatch(/Roster guard outage/)
  })
})
