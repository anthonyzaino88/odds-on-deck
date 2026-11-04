import {
  GET,
  getLatestGameLastUpdate,
  getLatestQuoteUpdatedAt,
  resetQuoteFreshnessColumnCache,
} from '../../app/api/refresh-status/route.js'
import { supabase } from '../../lib/supabase.js'
import { API_CONFIG } from '../../lib/api-usage-manager.js'

jest.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: jest.fn(),
  },
}))

function cacheChain({ data = null, error = null } = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error })
  const select = jest.fn().mockReturnValue({
    not: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          maybeSingle,
        }),
      }),
    }),
  })
  return {
    maybeSingle,
    select,
    chain: { select },
  }
}

function mockCacheQuery({ data = null, error = null } = {}) {
  const cache = cacheChain({ data, error })
  supabase.from.mockReturnValue(cache.chain)
  return cache
}

describe('GET /api/refresh-status', () => {
  const originalLastRefresh = API_CONFIG.LAST_REFRESH_TIME
  let errorSpy

  beforeEach(() => {
    jest.clearAllMocks()
    resetQuoteFreshnessColumnCache()
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    API_CONFIG.LAST_REFRESH_TIME = originalLastRefresh
    errorSpy.mockRestore()
  })

  test('lastRefreshTime comes from one PlayerPropCache poll, not in-memory LAST_REFRESH_TIME', async () => {
    API_CONFIG.LAST_REFRESH_TIME = '1999-01-01T00:00:00.000Z'
    mockCacheQuery({ data: { fetchedAt: '2026-10-01T23:10:03.202Z' } })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRefreshTime).toBe('2026-10-01T23:10:03.202Z')
    expect(body.lastRefreshTime).not.toBe(API_CONFIG.LAST_REFRESH_TIME)
    expect(body.freshnessSource).toBe('cache')
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).toHaveBeenCalledWith('PlayerPropCache')
    expect(supabase.from).not.toHaveBeenCalledWith('Game')
  })

  test('prefers quoteUpdatedAt from the same cache row', async () => {
    mockCacheQuery({
      data: {
        quoteUpdatedAt: '2026-11-04T12:05:00.000Z',
        fetchedAt: '2026-11-04T12:00:00.000Z',
      },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.lastRefreshTime).toBe('2026-11-04T12:05:00.000Z')
    expect(body.quoteUpdatedAt).toBe('2026-11-04T12:05:00.000Z')
    expect(body.freshnessSource).toBe('quotes')
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).not.toHaveBeenCalledWith('Game')
  })

  test('missing quoteUpdatedAt column degrades to fetchedAt without logging', async () => {
    const select = jest.fn((columns) => {
      const missing = String(columns).includes('quoteUpdatedAt')
      const maybeSingle = jest.fn().mockResolvedValue(
        missing
          ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'quoteUpdatedAt' column" } }
          : { data: { fetchedAt: '2026-10-01T23:10:03.202Z' }, error: null },
      )
      return {
        not: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
      }
    })
    supabase.from.mockReturnValue({ select })

    const res = await GET()
    const body = await res.json()
    expect(body.lastRefreshTime).toBe('2026-10-01T23:10:03.202Z')
    expect(body.quoteUpdatedAt).toBeNull()
    expect(body.freshnessSource).toBe('cache')
    expect(select.mock.calls.map((call) => call[0])).toEqual([
      'quoteUpdatedAt, fetchedAt',
      'fetchedAt',
    ])
    expect(errorSpy).not.toHaveBeenCalled()

    select.mockClear()
    supabase.from.mockClear()
    supabase.from.mockReturnValue({ select })
    await GET()
    expect(select.mock.calls.map((call) => call[0])).toEqual(['fetchedAt'])
  })

  test('logs non-missing-column errors and does not fall back to Game', async () => {
    mockCacheQuery({ error: { code: '42501', message: 'permission denied' } })
    const res = await GET()
    const body = await res.json()
    expect(body.lastRefreshTime).toBeNull()
    expect(body.quoteUpdatedAt).toBeNull()
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(supabase.from).not.toHaveBeenCalledWith('Game')
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/getLatestOddsFreshness/)
  })

  test('lastRefreshTime is null when the cache has no fetchedAt', async () => {
    mockCacheQuery({ data: null })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRefreshTime).toBeNull()
  })

  test('getLatestGameLastUpdate returns null when supabase is missing', async () => {
    await expect(getLatestGameLastUpdate(null)).resolves.toBeNull()
    await expect(getLatestQuoteUpdatedAt(null)).resolves.toBeNull()
  })
})
