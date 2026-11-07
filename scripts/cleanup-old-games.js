#!/usr/bin/env node

/**
 * CLEANUP OLD GAMES FROM DATABASE
 *
 * Removes games outside the current date ranges:
 * - NFL: outside the current week (Sun–Sat)
 * - NHL and MLB: outside today
 *
 * The run holds an exclusive lock, refreshes it while working, and refuses
 * each archive write and each table delete during the ET :05–:15 quiet window.
 * Game and Odds reads are paginated and checked. A read error, a failed
 * archive, a short verify, or a quiet-window hit stops every delete that
 * has not already run. Lock and close odds are copied onto ClosingOdds
 * and read back before any delete. See lib/cleanup-old-games.js.
 */

import path from 'path'
import { pathToFileURL } from 'url'
import { config } from 'dotenv'
import { runCleanupOldGames } from '../lib/cleanup-old-games.js'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'

config({ path: '.env.local' })

function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(path.resolve(entry)).href
}

if (invokedDirectly()) {
  const supabase = createScriptSupabaseClient()
  runCleanupOldGames({ supabase, log: console })
    .then((result) => {
      if (result?.exitCode) process.exit(result.exitCode)
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error)
      process.exit(1)
    })
}
