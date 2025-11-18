#!/usr/bin/env node

// Temporary script to run NHL fetch with hardcoded env vars
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://przixigqxtdbunfsaped.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByeml4aWdxeHRkYnVuZnNhcGVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5Mjg5NzYsImV4cCI6MjA3NzUwNDk3Nn0.AYq9VEGm775eP0Go7vSEODi6lllYe6o8wIEi0y0QF2s'
process.env.ODDS_API_KEY = 'c35f7ecbd7c0fe0649582ffc2951ef01' // You'll need to add this

// Override process.argv to pass the correct arguments
process.argv = ['node', 'fetch-live-odds.js', 'nhl', '2025-11-18']

import('./scripts/fetch-live-odds.js')
