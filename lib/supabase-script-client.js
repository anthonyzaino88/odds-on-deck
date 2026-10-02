// Node-safe Supabase client for laptop scripts in scripts/ and operations/.
// Reuses resolveSupabaseAdminKey (pure, no client side effects).
// Does not import server-only. Do not use from Next app code.

import { createClient } from '@supabase/supabase-js'
import { logAdminKeyResolution, resolveSupabaseAdminKey } from './supabase-admin-key.js'

const DEFAULT_CLIENT_OPTIONS = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}

/**
 * Resolve the script key: SUPABASE_SECRET_KEY, then SUPABASE_SERVICE_ROLE_KEY,
 * then anon only when SUPABASE_REQUIRE_SECRET_KEY is unset. Warns on anon fallback.
 */
export function resolveScriptSupabaseKey(env = process.env, logger = console) {
  const resolved = resolveSupabaseAdminKey(env)
  if (resolved.fallbackToAnon || !resolved.key) {
    logAdminKeyResolution(resolved, logger)
  }
  return resolved
}

export function createScriptSupabaseClient(env = process.env, {
  clientFactory = createClient,
  logger = console,
  clientOptions = DEFAULT_CLIENT_OPTIONS,
} = {}) {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  const resolved = resolveScriptSupabaseKey(env, logger)
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!resolved.key) {
    throw new Error(resolved.error || 'Missing SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return clientFactory(url, resolved.key, clientOptions)
}
