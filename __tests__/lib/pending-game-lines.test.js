const rangeCalls = []
const orderCalls = []
const pages = []

function createChain() {
  const chain = {}
  const passthrough = () => jest.fn(() => chain)
  chain.select = passthrough()
  chain.eq = passthrough()
  chain.in = passthrough()
  chain.order = jest.fn((...args) => {
    orderCalls.push(args)
    return chain
  })
  chain.range = jest.fn(async (from, to) => {
    rangeCalls.push([from, to])
    const page = pages.shift() || []
    return { data: page, error: null }
  })
  return chain
}

jest.mock('../../lib/supabase-admin.js', () => ({
  supabaseAdmin: {
    from: jest.fn(() => createChain()),
  },
}))

import {
  GAME_LINE_PENDING_ORDER,
  GAME_LINE_PENDING_PAGE_SIZE,
  fetchPendingGameLines,
} from '../../lib/validation.js'
import { UNPLAYED_PAGE_SIZE } from '../../lib/unplayed-game-grades.js'

describe('gradePendingGameLines fetch is ordered and paginated', () => {
  beforeEach(() => {
    rangeCalls.length = 0
    orderCalls.length = 0
    pages.length = 0
  })

  test('pages past the 1000-row default in id order', async () => {
    const first = Array.from({ length: GAME_LINE_PENDING_PAGE_SIZE }, (_, i) => ({
      id: `row-${String(i).padStart(4, '0')}`,
    }))
    const second = [{ id: 'row-1000' }]
    pages.push(first, second)

    const { rows, error } = await fetchPendingGameLines()
    expect(error).toBeNull()
    expect(rows).toHaveLength(GAME_LINE_PENDING_PAGE_SIZE + 1)
    expect(rows[0].id).toBe('row-0000')
    expect(rows[rows.length - 1].id).toBe('row-1000')
    expect(GAME_LINE_PENDING_PAGE_SIZE).toBe(UNPLAYED_PAGE_SIZE)
    expect(GAME_LINE_PENDING_PAGE_SIZE).toBe(1000)
    expect(orderCalls[0]).toEqual([GAME_LINE_PENDING_ORDER.column, { ascending: true }])
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })
})
