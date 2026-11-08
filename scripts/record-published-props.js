#!/usr/bin/env node
import { sanitizeLoggedValue } from '../lib/sanitize-error.js'
/**
 * Record Published-eligible MLB + NFL + NHL player props into
 * PropValidation (notes=cohort:published). Historical NHL rows tagged
 * cohort:shadow-published are left unchanged.
 *
 * Reads PlayerPropCache only — does not call The Odds API.
 * Run after the morning odds pull (or any time the public board is up)
 * so validate:all can grade the same cohort the homepage showed.
 *
 * Exits 1 (DEGRADED) when NFL and/or NHL had a full ESPN roster
 * outage. Later morning steps (record:featured, record:game-lines)
 * should still run. Parse the ROSTER_GUARD_STATUS= footer.
 *
 * Usage:
 *   node scripts/record-published-props.js
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { formatRosterGuardStatusLine } from '../lib/event-roster-eligibility.js'
config({ path: '.env.local' })

export function publishedRosterOutageExit(result) {
  return result?.rosterOutage ? 1 : 0
}

export async function runRecordPublishedProps({
  persist,
  log = console.log,
  error = console.error,
} = {}) {
  const persistFn = persist || (await import('../lib/validation.js')).persistPublishedEligibleFromCache
  const saved = await persistFn()
  log(`📌 Published + shadow track: recorded ${saved.length} PropValidation row(s)`)
  if (saved.unavailableCount) {
    log(`📌 Roster guard: unavailable=${saved.unavailableCount}`)
  }
  log(formatRosterGuardStatusLine(saved.rosterGuard || saved))
  if (saved.rosterOutage) {
    error('🚨 Roster guard outage: every prop skipped because ESPN roster was unavailable')
    return { saved, exitCode: 1 }
  }
  return { saved, exitCode: 0 }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runRecordPublishedProps().then((result) => {
    if (result.exitCode) process.exit(result.exitCode)
  }).catch((error) => {
    console.error('❌ record-published-props failed:', sanitizeLoggedValue(error))
    process.exit(1)
  })
}
