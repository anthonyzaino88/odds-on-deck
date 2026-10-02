// Pure key-selection helpers. No Supabase client construction, no import-time I/O.
// /api/health imports only this file so SUPABASE_REQUIRE_SECRET_KEY=1
// cannot take the health handler down.

export const SUPABASE_REQUIRE_SECRET_ENV = 'SUPABASE_REQUIRE_SECRET_KEY'

export function envFlagEnabled(value) {
  if (value == null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/**
 * Pick the server key without creating a client. Pure + testable.
 * Prefers SUPABASE_SECRET_KEY, then SUPABASE_SERVICE_ROLE_KEY.
 * Falls back to the anon key only when the require-secret flag is off.
 */
export function resolveSupabaseAdminKey(env = process.env) {
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const anon = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim()
  const requireSecret = envFlagEnabled(env[SUPABASE_REQUIRE_SECRET_ENV])

  if (secret) {
    return {
      key: secret,
      usingSecret: true,
      fallbackToAnon: false,
      requireSecret,
      missingSecret: false,
      configured: true,
    }
  }

  if (requireSecret) {
    return {
      key: null,
      usingSecret: false,
      fallbackToAnon: false,
      requireSecret: true,
      missingSecret: true,
      configured: false,
      error: 'SUPABASE_SECRET_KEY is required because SUPABASE_REQUIRE_SECRET_KEY is set',
    }
  }

  if (anon) {
    return {
      key: anon,
      usingSecret: false,
      fallbackToAnon: true,
      requireSecret: false,
      missingSecret: true,
      configured: true,
    }
  }

  return {
    key: null,
    usingSecret: false,
    fallbackToAnon: false,
    requireSecret: false,
    missingSecret: true,
    configured: false,
    error: 'Missing SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY',
  }
}

export function getAdminClientHealth(env = process.env) {
  const resolved = resolveSupabaseAdminKey(env)
  return {
    usingSecret: resolved.usingSecret,
    fallbackToAnon: resolved.fallbackToAnon,
    requireSecret: resolved.requireSecret,
    configured: resolved.configured,
    degraded: !resolved.usingSecret,
  }
}

/**
 * Same condition as createSupabaseAdminClient returning a client.
 * Use this instead of `if (!supabase)` — the lazy Proxy is always truthy.
 */
export function isSupabaseAdminConfigured(env = process.env) {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  const resolved = resolveSupabaseAdminKey(env)
  if (resolved.requireSecret && !resolved.usingSecret) return false
  return Boolean(url && resolved.key)
}

/**
 * Hard-fail gate. Throws only when SUPABASE_REQUIRE_SECRET_KEY is set
 * and the secret is missing. Default path never throws for a missing key.
 */
export function assertSupabaseAdminKey(env = process.env) {
  const resolved = resolveSupabaseAdminKey(env)
  if (resolved.requireSecret && !resolved.usingSecret) {
    throw new Error(resolved.error)
  }
  return resolved
}

export function logAdminKeyResolution(resolved, logger = console) {
  if (resolved.usingSecret) {
    logger.log('🔐 Supabase Admin: Using secret key (bypasses RLS)')
    return
  }
  if (resolved.fallbackToAnon) {
    logger.error(
      '⚠️ SUPABASE_SECRET_KEY is missing. Server is falling back to the anon key. '
      + 'Pages still render, but the RLS lockdown will hide every public-schema row. '
      + 'Set SUPABASE_SECRET_KEY in Vercel, confirm GET /api/health shows usingSecret=true, '
      + 'then set SUPABASE_REQUIRE_SECRET_KEY=1 so a later missing key fails closed. '
      + 'Do not paste scripts/migrations/006_rls_lockdown.sql until usingSecret is true.',
    )
    return
  }
  logger.error(`⚠️ Supabase Admin: ${resolved.error || 'not configured'}`)
}
