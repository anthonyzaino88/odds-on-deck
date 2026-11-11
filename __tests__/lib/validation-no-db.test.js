const eqCalls = []
const orCalls = []
const selectCalls = []
const from = jest.fn()

function createChain() {
  const chain = {}
  const passthrough = (name) => jest.fn((...args) => {
    if (name === 'eq') eqCalls.push(args)
    if (name === 'or') orCalls.push(args)
    if (name === 'select') selectCalls.push(args)
    return chain
  })
  chain.select = passthrough('select')
  chain.eq = passthrough('eq')
  chain.in = passthrough('in')
  chain.gt = passthrough('gt')
  chain.gte = passthrough('gte')
  chain.not = passthrough('not')
  chain.or = passthrough('or')
  chain.order = passthrough('order')
  chain.range = passthrough('range')
  chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }))
  chain.single = jest.fn(async () => ({ data: null, error: null }))
  chain.update = jest.fn(() => chain)
  chain.insert = jest.fn(() => chain)
  chain.then = (onFulfilled, onRejected) => (
    Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
  )
  return chain
}

jest.mock('../../lib/supabase-admin.js', () => ({
  supabaseAdmin: {
    from: (...args) => from(...args),
  },
}))

import {
  recordPropPrediction,
  recordGameLinePrediction,
  getPublishedPicksStats,
  getValidationStats,
  getAccuracyByEdge,
} from '../../lib/validation.js'
import { clvFromOdds } from '../../lib/closing-line.js'
import {
  PUBLISHED_SOURCE,
  PUBLISHED_CLV_SELECT,
  PUBLISHED_STATS_SELECT,
  SHADOW_PUBLISHED_NOTES_OR_FILTER,
  PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER,
} from '../../lib/published-picks.js'

function publishedCloseRow(overrides = {}) {
  return {
    id: 'pv-mlb-1',
    status: 'completed',
    result: 'correct',
    prediction: 'over',
    propType: 'batter_hits',
    threshold: 0.5,
    odds: 150,
    edge: 0.05,
    qualityScore: 48,
    sport: 'mlb',
    source: PUBLISHED_SOURCE,
    notes: 'cohort:published',
    completedAt: '2026-07-16T04:00:00.000Z',
    timestamp: '2026-07-15T18:00:00.000Z',
    playerName: 'Aaron Judge',
    probability: 0.58,
    gameIdRef: 'g-1',
    closeOdds: 130,
    closeLine: 0.5,
    closeCapturedAt: '2026-07-15T23:00:00.000Z',
    ...overrides,
  }
}

describe('recordPropPrediction refuses without a DB call', () => {
  beforeEach(() => {
    eqCalls.length = 0
    from.mockReset()
    from.mockImplementation(() => createChain())
  })

  test('user_saved returns null before supabase.from', async () => {
    const result = await recordPropPrediction({
      playerName: 'Aaron Judge',
      gameId: 'NYY_at_BOS_2026-09-29',
      type: 'batter_hits',
      propId: 'pub-mlb-g1-aaron judge-batter_hits-over-1.5',
    }, 'user_saved')
    expect(result).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})

describe('recordGameLinePrediction respects the public kill switch', () => {
  beforeEach(() => {
    eqCalls.length = 0
    from.mockReset()
    from.mockImplementation(() => createChain())
  })

  test('skips unpublished MLB game lines before any write', async () => {
    const result = await recordGameLinePrediction({
      gameId: 'g-mlb-1',
      sport: 'mlb',
      type: 'total',
      pick: 'over',
      threshold: 8.5,
      edge: 0.25,
      odds: -110,
    })
    expect(result).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  test('records NHL game lines privately with shadow notes', async () => {
    const inserted = []
    const chain = createChain()
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    chain.insert.mockImplementation((payload) => {
      inserted.push(payload)
      return chain
    })
    chain.single.mockResolvedValue({ data: { id: 'pv-nhl-1' }, error: null })
    from.mockImplementation(() => chain)

    const result = await recordGameLinePrediction({
      gameId: 'g-nhl-1',
      sport: 'nhl',
      type: 'total',
      pick: 'over',
      threshold: 6.5,
      edge: 0.06,
      odds: -110,
      eligibleForPublic: false,
    })

    expect(result).toEqual({ id: 'pv-nhl-1' })
    expect(from).toHaveBeenCalledWith('PropValidation')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      sport: 'nhl',
      source: 'game_line',
      propType: 'total',
      prediction: 'over',
    })
    expect(inserted[0].notes).toMatch(/cohort:sides_totals/)
    expect(inserted[0].notes).toMatch(/cohort:shadow-published/)
    expect(inserted[0].notes).not.toMatch(/auto-saved/)
  })

  test('does not persist public-ineligible NFL game lines', async () => {
    const result = await recordGameLinePrediction({
      gameId: 'g-nfl-1',
      sport: 'nfl',
      type: 'moneyline',
      pick: 'KC',
      edge: 0.09,
      odds: -110,
      eligibleForPublic: false,
    })
    expect(result).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  test('does not recreate, overwrite, or un-void an existing void row', async () => {
    const existing = {
      id: 'pv-void',
      propId: 'gl-g-nfl-1-moneyline-KC-ml',
      status: 'manual_closed',
      result: 'void',
      source: 'game_line',
    }
    const chain = createChain()
    chain.maybeSingle.mockResolvedValue({ data: existing, error: null })
    from.mockImplementation(() => chain)

    const result = await recordGameLinePrediction({
      gameId: 'g-nfl-1',
      sport: 'nfl',
      type: 'moneyline',
      pick: 'KC',
      team: 'KC',
      eligibleForPublic: true,
      edge: 0.09,
      odds: -110,
    })

    expect(result).toEqual(existing)
    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.insert).not.toHaveBeenCalled()
  })

  test('does not overwrite an already-graded row', async () => {
    const existing = {
      id: 'pv-graded',
      propId: 'gl-g-nfl-1-moneyline-KC-ml',
      status: 'completed',
      result: 'correct',
      source: 'game_line',
    }
    const chain = createChain()
    chain.maybeSingle.mockResolvedValue({ data: existing, error: null })
    from.mockImplementation(() => chain)

    const result = await recordGameLinePrediction({
      gameId: 'g-nfl-1',
      sport: 'nfl',
      type: 'moneyline',
      pick: 'KC',
      team: 'KC',
      eligibleForPublic: true,
      edge: 0.09,
      odds: -110,
    })

    expect(result).toEqual(existing)
    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.insert).not.toHaveBeenCalled()
  })
})

describe('getPublishedPicksStats query applies the source filter', () => {
  beforeEach(() => {
    eqCalls.length = 0
    orCalls.length = 0
    selectCalls.length = 0
    from.mockReset()
    from.mockImplementation(() => createChain())
  })

  test('fetch chain eqs source to system_generated', async () => {
    const stats = await getPublishedPicksStats()
    expect(from).toHaveBeenCalledWith('PropValidation')
    expect(eqCalls).toEqual(expect.arrayContaining([
      ['status', 'completed'],
      ['source', PUBLISHED_SOURCE],
    ]))
    expect(eqCalls.filter((args) => args[0] === 'source')).toEqual([
      ['source', PUBLISHED_SOURCE],
    ])
    expect(stats.sample).toBe(0)
    expect(stats.clv).toMatchObject({ sameLine: 0, avgClvProb: null, pctBeatClose: null })
    expect(orCalls).toEqual([[SHADOW_PUBLISHED_NOTES_OR_FILTER]])
    expect(selectCalls[0][0]).toBe(PUBLISHED_CLV_SELECT)
    expect(selectCalls[0][0]).toMatch(/closeOdds/)
  })

  test('falls back to PUBLISHED_STATS_SELECT when close columns are missing', async () => {
    let selects = 0
    from.mockImplementation(() => {
      const chain = createChain()
      chain.then = (onFulfilled, onRejected) => {
        selects += 1
        const result = selects === 1
          ? { data: null, error: { code: '42703', message: 'column closeOdds does not exist' } }
          : { data: [], error: null }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return chain
    })
    const stats = await getPublishedPicksStats()
    expect(stats.clv.sameLine).toBe(0)
    expect(selectCalls.map((args) => args[0])).toEqual([
      PUBLISHED_CLV_SELECT,
      PUBLISHED_STATS_SELECT,
    ])
  })

  test('public CLV uses stored same-line closes and drops shadow plus moved lines', async () => {
    from.mockImplementation(() => {
      const chain = createChain()
      chain.then = (onFulfilled, onRejected) => Promise.resolve({
        data: [
          publishedCloseRow(),
          publishedCloseRow({
            id: 'pv-moved',
            closeLine: 1.5,
            closeOdds: 100,
          }),
          publishedCloseRow({
            id: 'pv-shadow',
            sport: 'nhl',
            propType: 'player_shots_on_goal',
            notes: 'cohort:shadow-published',
            closeOdds: 110,
          }),
          publishedCloseRow({
            id: 'pv-gl',
            sport: 'nhl',
            source: 'game_line',
            propType: 'moneyline',
            notes: 'cohort:sides_totals | cohort:shadow-published',
            closeOdds: 110,
          }),
          publishedCloseRow({
            id: 'pv-open',
            closeOdds: null,
            closeLine: null,
            closeCapturedAt: null,
          }),
        ],
        error: null,
      }).then(onFulfilled, onRejected)
      return chain
    })

    const stats = await getPublishedPicksStats()
    expect(stats.clv.sameLine).toBe(1)
    expect(stats.clv.lineMoved).toBe(1)
    expect(stats.clv.beatClose).toBe(1)
    expect(stats.clv.avgClvProb).toBeCloseTo(clvFromOdds(150, 130).clvProb, 8)
    expect(stats.clv.pctBeatClose).toBe(1)
  })
})

describe('public archive queries drop shadow-only rows and keep auto-saved', () => {
  beforeEach(() => {
    eqCalls.length = 0
    orCalls.length = 0
    from.mockReset()
    from.mockImplementation(() => createChain())
  })

  test('getValidationStats and getAccuracyByEdge use the private-shadow or-filter', async () => {
    await getValidationStats()
    expect(orCalls).toEqual(expect.arrayContaining([[PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER]]))
    expect(orCalls).not.toEqual(expect.arrayContaining([[SHADOW_PUBLISHED_NOTES_OR_FILTER]]))

    orCalls.length = 0
    await getAccuracyByEdge()
    expect(orCalls).toEqual([[PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER]])
  })
})
