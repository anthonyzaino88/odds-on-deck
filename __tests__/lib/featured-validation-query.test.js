import {
  featuredValidationQueryKeys,
  fetchFeaturedPropValidations,
} from '../../lib/featured-validation-query.js'
import { SUPABASE_PAGE_SIZE } from '../../lib/supabase-page.js'

function mockClient(pages, captured) {
  let call = 0
  const chain = {
    in(column, values) {
      captured.filters[column] = values
      return chain
    },
    order(column, opts) {
      captured.order = { column, opts }
      return chain
    },
    range(from, to) {
      captured.ranges.push({ from, to })
      const page = pages[call++] || []
      return Promise.resolve({ data: page, error: null })
    },
  }
  return {
    from(table) {
      captured.table = table
      return {
        select(columns) {
          captured.columns = columns
          return chain
        },
      }
    },
  }
}

describe('fetchFeaturedPropValidations', () => {
  test('filters by playerName and gameIdRef and pages with a stable order', async () => {
    const captured = { filters: {}, ranges: [] }
    const page1 = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => ({ id: `pv-${i}` }))
    const page2 = [{ id: 'pv-last' }]
    const client = mockClient([page1, page2], captured)

    const { data, error } = await fetchFeaturedPropValidations(client, [
      { playerName: 'Jared Goff', gameIdRef: 'DET_at_CHI_2026-09-20' },
      { playerName: 'Jared Goff', gameId: 'DET_at_GB_2026-09-13' },
      { playerName: '  ', gameIdRef: '' },
    ])

    expect(error).toBeNull()
    expect(data).toHaveLength(SUPABASE_PAGE_SIZE + 1)
    expect(captured.table).toBe('PropValidation')
    expect(captured.filters.playerName).toEqual(['Jared Goff'])
    expect(captured.filters.gameIdRef).toEqual([
      'DET_at_CHI_2026-09-20',
      'DET_at_GB_2026-09-13',
    ])
    expect(captured.order).toEqual({ column: 'id', opts: { ascending: true } })
    expect(captured.ranges).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ])
  })

  test('returns empty without querying when legs have no names or refs', async () => {
    let called = false
    const client = {
      from() {
        called = true
        return { select() { return this } }
      },
    }
    const { data, error } = await fetchFeaturedPropValidations(client, [
      { playerName: '', gameIdRef: '' },
    ])
    expect(called).toBe(false)
    expect(data).toEqual([])
    expect(error).toBeNull()
  })
})

describe('featuredValidationQueryKeys', () => {
  test('dedupes names and refs and ignores blanks', () => {
    expect(featuredValidationQueryKeys([
      { playerName: 'Goff', gameIdRef: 'g1' },
      { playerName: 'Goff', gameId: 'g2' },
      { playerName: '', gameIdRef: '  ' },
    ])).toEqual({
      playerNames: ['Goff'],
      gameIdRefs: ['g1', 'g2'],
    })
  })
})
