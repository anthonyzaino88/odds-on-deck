#!/usr/bin/env node
import { sanitizedErrorMessage } from '../lib/sanitize-error.js'
/**
 * Morning ESPN injury + NHL starting-goalie snapshot.
 *
 * Free public JSON only (site.api.espn.com, api-web.nhle.com).
 * Zero Odds API credits. Always exits 0.
 *
 * Quiet period: this script WRITES during :05–:15 ET. The 8:09 morning
 * job is inside that window. Same exemption class as fetch-fresh-games
 * Game upserts (`ignoreQuietPeriod`). Do not no-op this snapshot or the
 * morning routine will skip injuries. :05–:15 still applies to
 * record:mlb-window / close-capture / reconcile --apply.
 *
 * Usage:
 *   node scripts/fetch-injuries.js
 *
 * Footer:
 *   INJURIES_STATUS=ok|partial|failed
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import {
  formatInjuriesStatus,
  runFetchInjuries,
} from '../lib/injury-availability.js'

config({ path: '.env.local' })

export async function runFetchInjuriesCli({
  createClient = createScriptSupabaseClient,
  fetchImpl = fetch,
  now = new Date(),
  log = console,
  env = process.env,
} = {}) {
  let client = null
  try {
    client = createClient(env, { logger: log })
  } catch (error) {
    (log.warn || log.log)?.(`⚠️ Supabase client unavailable (${sanitizedErrorMessage(error)}); fetch continues without persist`)
  }
  try {
    return await runFetchInjuries({
      fetchImpl,
      supabase: client,
      now,
      log,
    })
  } catch (error) {
    (log.error || log.log)?.(`⚠️ fetch-injuries failed: ${sanitizedErrorMessage(error)}`)
    log.log?.(formatInjuriesStatus('failed'))
    return { exitCode: 0, status: 'failed', errors: [{ message: error.message }] }
  }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runFetchInjuriesCli().then((result) => {
    process.exit(result.exitCode || 0)
  }).catch((error) => {
    console.error('⚠️ fetch-injuries failed:', sanitizedErrorMessage(error))
    console.log(formatInjuriesStatus('failed'))
    process.exit(0)
  })
}
