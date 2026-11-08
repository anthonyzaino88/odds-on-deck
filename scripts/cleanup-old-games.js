#!/usr/bin/env node
import { sanitizeLoggedValue } from '../lib/sanitize-error.js'

/**
 * CLEANUP OLD GAMES FROM DATABASE
 *
 * Removes games outside the current date ranges:
 * - NFL: outside the current week (Sun–Sat)
 * - NHL and MLB: outside today
 *
 * The run holds an exclusive lock and renews it every 20 seconds while the
 * event loop can run. A client timeout stops heartbeats and leaves the
 * lock held until the lease expires. Aborting the HTTP call does not
 * cancel the SQL. The ET :05–:15 quiet window refuses each archive write
 * and each table delete.
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
      console.error('❌ Fatal error:', sanitizeLoggedValue(error))
      process.exit(1)
    })
}
