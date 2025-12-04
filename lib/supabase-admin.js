// Supabase Admin Client - For server-side operations only
// Uses the secret key which bypasses RLS
// NEVER use this in browser/client-side code!

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

// For server-side operations, we need the secret key
// If not available, fall back to anon key (for backwards compatibility during migration)
const keyToUse = supabaseSecretKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
}

if (!keyToUse) {
  throw new Error('Missing SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable')
}

// Create admin client with secret key (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, keyToUse, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Log which key type is being used (for debugging)
if (supabaseSecretKey) {
  console.log('🔐 Supabase Admin: Using secret key (full access)')
} else {
  console.log('⚠️ Supabase Admin: Falling back to anon key (limited access)')
}
