import { GET, getLatestGameLastUpdate, getLatestQuoteUpdatedAt } from '../../app/api/refresh-status/route.js'
import { supabase } from '../../lib/supabase.js'
import { API_CONFIG } from '../../lib/api-usage-manager.js'

jest.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: jest.fn(),
  },
}))

function quoteChain({ data = null, error = null } = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error })
  return {
    maybeSingle,
    chain: {
      select: jest.fn().mockReturnValue({
        not: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              maybeSingle,
            }),
          }),
        }),
      }),
    },
  }
}

function mockRefreshQueries({ quote = null, quoteError = null, game = null, gameError = null } = {}) {
  const quotes = quoteChain({ data: quote, error: quoteError })
  const games = quoteChain({ data: game, error: gameError })
  supabase.from.mockImplementation((table) => {
    if (table === 'PlayerPropCache') return quotes.chain
    return games.chain
  })
  return { quotes, games }
}

function mockGameLastUpdateQuery({ data = null, error = null } = {}) {
  return mockRefreshQueries({ game: data, gameError: error })
}

describe('GET /api/refresh-status', () => {
  const originalLastRefresh = API_CONFIG.LAST_REFRESH_TIME

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    API_CONFIG.LAST_REFRESH_TIME = originalLastRefresh
  })

  test('lastRefreshTime comes from Game.lastUpdate, not in-memory LAST_REFRESH_TIME', async () => {
    const dbStamp = '2026-10-01T23:10:03.202'
    API_CONFIG.LAST_REFRESH_TIME = '1999-01-01T00:00:00.000Z'
    mockGameLastUpdateQuery({ data: { lastUpdate: dbStamp } })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRefreshTime).toBe('2026-10-01T23:10:03.202Z')
    expect(body.lastRefreshTime).not.toBe(API_CONFIG.LAST_REFRESH_TIME)
    expect(body.freshnessSource).toBe('game')
    expect(supabase.from).toHaveBeenCalledWith('PlayerPropCache')
    expect(supabase.from).toHaveBeenCalledWith('Game')
  })

  test('prefers PlayerPropCache.quoteUpdatedAt over Game.lastUpdate', async () => {
    mockRefreshQueries({
      quote: { quoteUpdatedAt: '2026-11-04T12:05:00.000Z' },
      game: { lastUpdate: '2026-11-04T18:00:00.000' },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.lastRefreshTime).toBe('2026-11-04T12:05:00.000Z')
    expect(body.quoteUpdatedAt).toBe('2026-11-04T12:05:00.000Z')
    expect(body.freshnessSource).toBe('quotes')
    expect(supabase.from).toHaveBeenCalledWith('PlayerPropCache')
    expect(supabase.from).not.toHaveBeenCalledWith('Game')
  })

  test('quote query degrades to Game.lastUpdate when SQL 010 is missing', async () => {
    mockRefreshQueries({
      quoteError: { code: 'PGRST204', message: "Could not find the 'quoteUpdatedAt' column" },
      game: { lastUpdate: '2026-10-01T23:10:03.202' },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.lastRefreshTime).toBe('2026-10-01T23:10:03.202Z')
    expect(body.quoteUpdatedAt).toBeNull()
    expect(body.freshnessSource).toBe('game')
  })

  test('lastRefreshTime is null when no Game.lastUpdate exists', async () => {
    mockGameLastUpdateQuery({ data: null })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRefreshTime).toBeNull()
  })

  test('lastRefreshTime is null when the Game query errors', async () => {
    mockGameLastUpdateQuery({ error: { message: 'boom' } })

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
