#!/usr/bin/env node

// Load environment variables from .env.local
import { config } from 'dotenv'
config({ path: '.env.local' })

// Validate environment variables are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in environment variables')
  console.error('Please ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

if (!process.env.ODDS_API_KEY) {
  console.error('❌ Missing ODDS_API_KEY in environment variables')
  console.error('Please ensure .env.local contains ODDS_API_KEY')
  process.exit(1)
}

import('./scripts/remap-nhl-event-ids.js')



