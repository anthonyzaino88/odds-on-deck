import { GET } from '../../app/api/health/route.js'
import { getAdminClientHealth } from '../../lib/supabase-admin.js'

jest.mock('../../lib/supabase-admin.js', () => ({
  getAdminClientHealth: jest.fn(),
}))

describe('GET /api/health', () => {
  beforeEach(() => {
    getAdminClientHealth.mockReset()
  })

  test('reports admin-client selection without querying the database', async () => {
    getAdminClientHealth.mockReturnValue({
      usingSecret: true,
      fallbackToAnon: false,
      requireSecret: false,
      configured: true,
      degraded: false,
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      degraded: false,
      supabaseAdmin: {
        usingSecret: true,
        fallbackToAnon: false,
        requireSecret: false,
        configured: true,
        degraded: false,
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/key/i)
  })

  test('marks the process degraded when the server is on the anon fallback', async () => {
    getAdminClientHealth.mockReturnValue({
      usingSecret: false,
      fallbackToAnon: true,
      requireSecret: false,
      configured: true,
      degraded: true,
    })

    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.degraded).toBe(true)
    expect(body.supabaseAdmin.fallbackToAnon).toBe(true)
  })
})
