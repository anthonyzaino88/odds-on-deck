// Server-only Supabase client. Uses SUPABASE_SECRET_KEY (bypasses RLS).
// NEVER import this from a 'use client' module — the secret must not
// ship in the browser bundle.
//
// Rollout: default is fail-open (anon fallback) so a missing Vercel
// secret cannot take prod down. /api/health reports usingSecret via
// lib/supabase-admin-key.js (no client construction).
// After the owner confirms SUPABASE_SECRET_KEY in Vercel prod, set
// SUPABASE_REQUIRE_SECRET_KEY=1 so a missing secret fails closed on
// first client *use*, not on import.
// Do not apply the RLS migration until usingSecret is true.

import 'server-only'

import { createClient } from '@supabase/supabase-js'
import {
  SUPABASE_ADMIN_PROXY,
  assertSupabaseAdminKey,
  isSupabaseAdminConfigured,
  logAdminKeyResolution,
} from './supabase-admin-key.js'

export {
  SUPABASE_ADMIN_PROXY,
  SUPABASE_REQUIRE_SECRET_ENV,
  assertSupabaseAdminKey,
  envFlagEnabled,
  getAdminClientHealth,
  isSupabaseAdminConfigured,
  isUsableSupabase,
  logAdminKeyResolution,
  resolveSupabaseAdminKey,
} from './supabase-admin-key.js'

/**
 * Next 14.2 patches global fetch. A request with no cache/revalidate option
 * enters the Vercel Data Cache with revalidate=false (CACHE_ONE_YEAR) even
 * on routes that only set `dynamic = 'force-dynamic'`. supabase-js uses
 * global fetch with no cache option, so PostgREST reads were frozen until
 * that entry expired. Force no-store so every admin-client read hits the DB.
 *
 * Per-fetch `next.revalidate` / `cache` from supabase-js is never set; this
 * wrapper always wins. Page-level ISR (e.g. /game/[id] revalidate=300) is
 * overridden to dynamic because a no-store fetch opts the route into
 * request-time rendering.
 */
export function noStoreFetch(input, init) {
  return fetch(input, { ...init, cache: 'no-store' })
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
    global: {
      fetch: noStoreFetch,
    },
  })
}

let cachedAdminClient
let cachedAdminReady = false

function getOrCreateSupabaseAdmin() {
  if (cachedAdminReady) return cachedAdminClient
  cachedAdminClient = createSupabaseAdminClient()
  cachedAdminReady = true
  return cachedAdminClient
}

function bindAdmin(client, prop) {
  const value = client[prop]
  return typeof value === 'function' ? value.bind(client) : value
}

// Lazy: import never throws for a missing secret. First property access
// (e.g. supabaseAdmin.from) constructs the client and may throw when
// SUPABASE_REQUIRE_SECRET_KEY=1. Existing `import { supabaseAdmin }` callers
// keep working.
export const supabaseAdmin = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__esModule') return false
    if (prop === 'then') return undefined
    if (prop === SUPABASE_ADMIN_PROXY) return true
    if (prop === '__configured') return isSupabaseAdminConfigured()
    const client = getOrCreateSupabaseAdmin()
    if (client == null) return undefined
    return bindAdmin(client, prop)
  },
})
