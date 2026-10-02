// Server-only Supabase client. Uses SUPABASE_SECRET_KEY (bypasses RLS).
// NEVER import this from a 'use client' module — the secret must not
// ship in the browser bundle.
//
// Rollout: default is fail-open (anon fallback) so a missing Vercel
// secret cannot take prod down. /api/health reports usingSecret.
// After the owner confirms SUPABASE_SECRET_KEY in Vercel prod, set
// SUPABASE_REQUIRE_SECRET_KEY=1 so a missing secret fails closed.
// Do not apply the RLS migration until usingSecret is true.

import { createClient } from '@supabase/supabase-js'

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

export function createSupabaseAdminClient(env = process.env, clientFactory = createClient) {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  const resolved = assertSupabaseAdminKey(env)
  logAdminKeyResolution(resolved)
  if (!url || !resolved.key) return null
  return clientFactory(url, resolved.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export const supabaseAdmin = createSupabaseAdminClient()
