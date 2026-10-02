// Server-side Supabase client. Re-exports the admin client so every
// existing `import { supabase }` read path uses SUPABASE_SECRET_KEY
// (with the same safe anon fallback as lib/supabase-admin.js).
// Do not import this from a 'use client' module.

import 'server-only'

export {
  isSupabaseAdminConfigured,
  isUsableSupabase,
  supabaseAdmin as supabase,
} from './supabase-admin.js'
