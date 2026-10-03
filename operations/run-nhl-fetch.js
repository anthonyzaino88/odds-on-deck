#!/usr/bin/env node

// Load environment variables from .env.local
import { config } from 'dotenv'
import { resolveScriptSupabaseKey } from '../lib/supabase-script-client.js'
config({ path: '.env.local' })

const resolved = resolveScriptSupabaseKey()
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !resolved.key) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in environment variables')
  process.exit(1)
}

if (!process.env.ODDS_API_KEY) {
  console.error('❌ Missing ODDS_API_KEY in environment variables')
  console.error('Please ensure .env.local contains ODDS_API_KEY')
  process.exit(1)
}

// Override process.argv to pass the correct arguments
process.argv = ['node', 'fetch-live-odds.js', 'nhl', '2025-11-18']

import('./scripts/fetch-live-odds.js')

