/**
 * The lazy admin Proxy is always truthy. These paths must use
 * isSupabaseAdminConfigured / isUsableSupabase and return their
 * graceful empty / unconfigured result instead of throwing
 * `supabase.from is not a function`.
 */
const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_REQUIRE_SECRET_KEY',
]

describe('unconfigured admin client is graceful', () => {
  let saved

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of ENV_KEYS) delete process.env[key]
    jest.resetModules()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] == null) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  test('GET /api/refresh-status returns 200 with null lastRefreshTime', async () => {
    const { GET, getLatestGameLastUpdate } = await import('../../app/api/refresh-status/route.js')
    await expect(getLatestGameLastUpdate()).resolves.toBeNull()

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lastRefreshTime).toBeNull()
    expect(body.error).toBeUndefined()
  })

  test('getTodaysGames / getTopProps / persistPublishedEligibleFromCache do not throw', async () => {
    const { getTodaysGames } = await import('../../lib/todays-games.js')
    const { getTopProps } = await import('../../lib/top-props.js')
    const { persistPublishedEligibleFromCache } = await import('../../lib/validation.js')

    await expect(getTodaysGames()).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/not configured/i),
    })
    await expect(getTopProps('mlb')).resolves.toEqual([])
    await expect(persistPublishedEligibleFromCache()).resolves.toEqual([])
  })
})
