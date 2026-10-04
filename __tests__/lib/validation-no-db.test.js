const eqCalls = []
const from = jest.fn()

function createChain() {
  const chain = {}
  const passthrough = (name) => jest.fn((...args) => {
    if (name === 'eq') eqCalls.push(args)
    return chain
  })
  chain.select = passthrough('select')
  chain.eq = passthrough('eq')
  chain.in = passthrough('in')
  chain.gt = passthrough('gt')
  chain.gte = passthrough('gte')
  chain.not = passthrough('not')
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

import { recordPropPrediction, recordGameLinePrediction, getPublishedPicksStats } from '../../lib/validation.js'
import { PUBLISHED_SOURCE } from '../../lib/published-picks.js'

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
  })
})
