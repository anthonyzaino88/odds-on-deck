const recorded = []

function createChain() {
  const chain = {
    _neq: [],
    _eq: [],
    _limit: null,
    _range: null,
  }
  const passthrough = (name) => jest.fn((...args) => {
    if (name === 'neq') chain._neq.push(args)
    if (name === 'eq') chain._eq.push(args)
    if (name === 'limit') chain._limit = args[0]
    if (name === 'range') chain._range = args
    return chain
  })
  chain.select = passthrough('select')
  chain.eq = passthrough('eq')
  chain.neq = passthrough('neq')
  chain.order = passthrough('order')
  chain.limit = passthrough('limit')
  chain.range = passthrough('range')
  chain.then = (onFulfilled, onRejected) => (
    Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
  )
  recorded.push(chain)
  return chain
}

jest.mock('../../lib/supabase-admin.js', () => ({
  supabaseAdmin: {
    from: jest.fn(() => createChain()),
  },
}))

import { getValidationRecords } from '../../lib/validation.js'

describe('getValidationRecords excludePending is opt-in on both paths', () => {
  beforeEach(() => {
    recorded.length = 0
  })

  test('limited path applies neq pending only when asked', async () => {
    await getValidationRecords({ limit: 50, excludePending: true })
    expect(recorded[0]._limit).toBe(50)
    expect(recorded[0]._neq).toContainEqual(['status', 'pending'])

    recorded.length = 0
    await getValidationRecords({ limit: 50 })
    expect(recorded[0]._neq).toEqual([])
  })

  test('paginated path applies neq pending only when asked', async () => {
    await getValidationRecords({ excludePending: true, status: 'completed' })
    expect(recorded[0]._range).toEqual([0, 999])
    expect(recorded[0]._neq).toContainEqual(['status', 'pending'])
    expect(recorded[0]._eq).toContainEqual(['status', 'completed'])

    recorded.length = 0
    await getValidationRecords({ status: 'pending' })
    expect(recorded[0]._eq).toContainEqual(['status', 'pending'])
    expect(recorded[0]._neq).toEqual([])
  })
})
