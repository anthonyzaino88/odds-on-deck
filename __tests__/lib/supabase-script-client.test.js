import {
  createScriptSupabaseClient,
  resolveScriptSupabaseKey,
} from '../../lib/supabase-script-client.js'

describe('createScriptSupabaseClient key selection', () => {
  const urlEnv = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }

  test('prefers SUPABASE_SECRET_KEY over service role and anon, and stays quiet', () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    const factory = jest.fn(() => ({ tag: 'secret' }))
    const client = createScriptSupabaseClient({
      ...urlEnv,
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, { clientFactory: factory, logger })
    expect(client).toEqual({ tag: 'secret' })
    expect(factory).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'secret-key',
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false } }),
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('uses SUPABASE_SERVICE_ROLE_KEY when the secret is missing', () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    const factory = jest.fn(() => ({ tag: 'role' }))
    createScriptSupabaseClient({
      ...urlEnv,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, { clientFactory: factory, logger })
    expect(factory).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role',
      expect.any(Object),
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('falls back to anon with a loud warning when REQUIRE is unset', () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    const factory = jest.fn(() => ({ tag: 'anon' }))
    const resolved = resolveScriptSupabaseKey({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, logger)
    expect(resolved).toMatchObject({
      key: 'anon-key',
      usingSecret: false,
      fallbackToAnon: true,
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toMatch(/falling back to the anon key/)
    expect(logger.error.mock.calls[0][0]).not.toMatch(/anon-key/)

    createScriptSupabaseClient({
      ...urlEnv,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }, { clientFactory: factory, logger })
    expect(factory).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.any(Object),
    )
  })

  test('REQUIRE=1 does not fall back to anon and does not construct a client', () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    const factory = jest.fn()
    expect(() => createScriptSupabaseClient({
      ...urlEnv,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_REQUIRE_SECRET_KEY: '1',
    }, { clientFactory: factory, logger })).toThrow(/SUPABASE_REQUIRE_SECRET_KEY/)
    expect(factory).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  test('throws when the URL is missing even if a secret is set', () => {
    expect(() => createScriptSupabaseClient({
      SUPABASE_SECRET_KEY: 'secret-key',
    }, { clientFactory: jest.fn() })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})
