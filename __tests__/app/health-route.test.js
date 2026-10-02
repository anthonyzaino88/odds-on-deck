import { GET } from '../../app/api/health/route.js'

const KEYS = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_REQUIRE_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

async function withEnv(overrides, fn) {
  const previous = {}
  for (const key of KEYS) previous[key] = process.env[key]
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const key of KEYS) {
      if (previous[key] == null) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

describe('GET /api/health', () => {
  test('reports admin-client selection without querying the database', async () => {
    const res = await withEnv({
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_ROLE_KEY: null,
      SUPABASE_REQUIRE_SECRET_KEY: null,
    }, () => GET())
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
    expect(JSON.stringify(body)).not.toMatch(/secret-key/)
  })

  test('marks the process degraded when the server is on the anon fallback', async () => {
    const res = await withEnv({
      SUPABASE_SECRET_KEY: null,
      SUPABASE_SERVICE_ROLE_KEY: null,
      SUPABASE_REQUIRE_SECRET_KEY: null,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, () => GET())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.degraded).toBe(true)
    expect(body.supabaseAdmin.fallbackToAnon).toBe(true)
    expect(body.supabaseAdmin.usingSecret).toBe(false)
  })

  test('REQUIRE=1 and no secret returns 200 degraded and does not throw', async () => {
    const res = await withEnv({
      SUPABASE_SECRET_KEY: null,
      SUPABASE_SERVICE_ROLE_KEY: null,
      SUPABASE_REQUIRE_SECRET_KEY: '1',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, () => GET())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.degraded).toBe(true)
    expect(body.supabaseAdmin).toEqual({
      usingSecret: false,
      fallbackToAnon: false,
      requireSecret: true,
      configured: false,
      degraded: true,
    })
  })
})
