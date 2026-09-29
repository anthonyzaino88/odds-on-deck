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

import { recordPropPrediction, getPublishedPicksStats } from '../../lib/validation.js'
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
