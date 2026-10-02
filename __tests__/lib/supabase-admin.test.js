import {
  SUPABASE_REQUIRE_SECRET_ENV,
  assertSupabaseAdminKey,
  createSupabaseAdminClient,
  envFlagEnabled,
  getAdminClientHealth,
  logAdminKeyResolution,
  resolveSupabaseAdminKey,
} from '../../lib/supabase-admin.js'

describe('supabase admin key selection', () => {
  const secretEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'secret-key',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  }

  test('envFlagEnabled accepts 1/true/yes only', () => {
    expect(envFlagEnabled('1')).toBe(true)
    expect(envFlagEnabled('true')).toBe(true)
    expect(envFlagEnabled('YES')).toBe(true)
    expect(envFlagEnabled('0')).toBe(false)
    expect(envFlagEnabled('false')).toBe(false)
    expect(envFlagEnabled('')).toBe(false)
    expect(envFlagEnabled(undefined)).toBe(false)
  })

  test('prefers SUPABASE_SECRET_KEY over anon', () => {
    const resolved = resolveSupabaseAdminKey(secretEnv)
    expect(resolved).toMatchObject({
      key: 'secret-key',
      usingSecret: true,
      fallbackToAnon: false,
      configured: true,
      missingSecret: false,
    })
  })

  test('accepts SUPABASE_SERVICE_ROLE_KEY as the secret', () => {
    const resolved = resolveSupabaseAdminKey({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(resolved.usingSecret).toBe(true)
    expect(resolved.key).toBe('service-role')
  })

  test('falls back to anon when the secret is missing and the flag is off', () => {
    const resolved = resolveSupabaseAdminKey({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(resolved).toMatchObject({
      key: 'anon-key',
      usingSecret: false,
      fallbackToAnon: true,
      configured: true,
      missingSecret: true,
      requireSecret: false,
    })
    expect(() => assertSupabaseAdminKey({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    })).not.toThrow()
  })

  test('require-secret flag fails closed and does not fall back to anon', () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      [SUPABASE_REQUIRE_SECRET_ENV]: '1',
    }
    const resolved = resolveSupabaseAdminKey(env)
    expect(resolved.usingSecret).toBe(false)
    expect(resolved.fallbackToAnon).toBe(false)
    expect(resolved.configured).toBe(false)
    expect(resolved.error).toMatch(/SUPABASE_REQUIRE_SECRET_KEY/)
    expect(() => assertSupabaseAdminKey(env)).toThrow(/SUPABASE_REQUIRE_SECRET_KEY/)
  })

  test('health signal is degraded on anon fallback and healthy on secret', () => {
    expect(getAdminClientHealth(secretEnv)).toEqual({
      usingSecret: true,
      fallbackToAnon: false,
      requireSecret: false,
      configured: true,
      degraded: false,
    })
    expect(getAdminClientHealth({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' })).toEqual({
      usingSecret: false,
      fallbackToAnon: true,
      requireSecret: false,
      configured: true,
      degraded: true,
    })
  })

  test('createSupabaseAdminClient uses the secret and does not throw on fallback', () => {
    const createClient = jest.fn(() => ({ tag: 'admin' }))
    const client = createSupabaseAdminClient(secretEnv, createClient)
    expect(client).toEqual({ tag: 'admin' })
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'secret-key',
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false } }),
    )

    const fallbackFactory = jest.fn(() => ({ tag: 'anon' }))
    const fallback = createSupabaseAdminClient({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, fallbackFactory)
    expect(fallback).toEqual({ tag: 'anon' })
    expect(fallbackFactory).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.any(Object),
    )
  })

  test('createSupabaseAdminClient throws only when the require flag is set', () => {
    const createClient = jest.fn()
    expect(() => createSupabaseAdminClient({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      [SUPABASE_REQUIRE_SECRET_ENV]: 'true',
    }, createClient)).toThrow(/SUPABASE_REQUIRE_SECRET_KEY/)
    expect(createClient).not.toHaveBeenCalled()
  })

  test('fallback logs loudly and never prints the key', () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    logAdminKeyResolution(resolveSupabaseAdminKey({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'super-secret-anon',
    }), logger)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toMatch(/falling back to the anon key/)
    expect(logger.error.mock.calls[0][0]).not.toMatch(/super-secret-anon/)
  })
})
