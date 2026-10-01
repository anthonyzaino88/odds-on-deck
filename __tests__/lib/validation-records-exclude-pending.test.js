import { PUBLIC_VALIDATION_STATUSES } from '../../lib/api-limits.js'

const recorded = []
const from = jest.fn()

function createChain() {
  const chain = {
    _neq: [],
    _eq: [],
    _in: [],
    _limit: null,
    _range: null,
  }
  const passthrough = (name) => jest.fn((...args) => {
    if (name === 'neq') chain._neq.push(args)
    if (name === 'eq') chain._eq.push(args)
    if (name === 'in') chain._in.push(args)
    if (name === 'limit') chain._limit = args[0]
    if (name === 'range') chain._range = args
    return chain
  })
  chain.select = passthrough('select')
  chain.eq = passthrough('eq')
  chain.neq = passthrough('neq')
  chain.in = passthrough('in')
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
    from: (...args) => from(...args),
  },
}))

import { getValidationRecords } from '../../lib/validation.js'

describe('getValidationRecords excludePending is opt-in on both paths', () => {
  beforeEach(() => {
    recorded.length = 0
    from.mockReset()
    from.mockImplementation(() => createChain())
  })

  test('limited path allow-lists statuses when excludePending and status is omitted', async () => {
    await getValidationRecords({ limit: 50, excludePending: true })
    expect(recorded[0]._limit).toBe(50)
    expect(recorded[0]._in).toContainEqual(['status', PUBLIC_VALIDATION_STATUSES])
    expect(recorded[0]._neq).toEqual([])

    recorded.length = 0
    await getValidationRecords({ limit: 50 })
    expect(recorded[0]._in).toEqual([])
    expect(recorded[0]._neq).toEqual([])
  })

  test('paginated path allow-lists only when excludePending and status is omitted', async () => {
    await getValidationRecords({ excludePending: true })
    expect(recorded[0]._range).toEqual([0, 999])
    expect(recorded[0]._in).toContainEqual(['status', PUBLIC_VALIDATION_STATUSES])
    expect(recorded[0]._neq).toEqual([])

    recorded.length = 0
    await getValidationRecords({ excludePending: true, status: 'completed' })
    expect(recorded[0]._eq).toContainEqual(['status', 'completed'])
    expect(recorded[0]._in).toEqual([])
    expect(recorded[0]._neq).toEqual([])

    recorded.length = 0
    await getValidationRecords({ status: 'pending' })
    expect(recorded[0]._eq).toContainEqual(['status', 'pending'])
    expect(recorded[0]._in).toEqual([])
    expect(recorded[0]._neq).toEqual([])
  })
})
