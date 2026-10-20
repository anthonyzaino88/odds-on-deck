#!/usr/bin/env node

/**
 * Retire ghost / flipped scheduled MLB games (status=not_needed).
 * Dry-run by default. Never deletes rows.
 *
 *   node scripts/reconcile-games.js [--sport mlb] [--date YYYY-MM-DD] [--days N] [--apply] [--max N] [--json]
 */

import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { RECONCILE_CLI_USAGE, runReconcileCli } from '../lib/game-reconcile.js'

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith('reconcile-games.js')

async function main(argv = process.argv.slice(2)) {
  const result = await runReconcileCli({
    argv,
    env: process.env,
    createClient: (env) => createScriptSupabaseClient(env),
    loadEnv: () => config({ path: '.env.local' }),
  })
  process.exitCode = result.exitCode
  return result
}

if (invokedDirectly) {
  main().catch((error) => {
    console.error(RECONCILE_CLI_USAGE)
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  })
}

export { main }
