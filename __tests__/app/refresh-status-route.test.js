import { GET, getLatestGameLastUpdate } from '../../app/api/refresh-status/route.js'
import { supabase } from '../../lib/supabase.js'
import { API_CONFIG } from '../../lib/api-usage-manager.js'

jest.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: jest.fn(),
  },
}))

function mockGameLastUpdateQuery({ data = null, error = null } = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error })
  supabase.from.mockReturnValue({
    select: jest.fn().mockReturnValue({
      not: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            maybeSingle,
          }),
        }),
      }),
    }),
  })
  return maybeSingle
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
    expect(supabase.from).toHaveBeenCalledWith('Game')
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
  })
})
