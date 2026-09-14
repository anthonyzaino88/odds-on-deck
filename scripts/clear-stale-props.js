#!/usr/bin/env node

/**
 * CLEAR STALE PROPS
 *
 * Archives matching PlayerPropCache rows to local JSONL, then deletes only
 * the exact versions that were verified on disk. Archive read/write failure
 * aborts deletion.
 *
 *   node scripts/clear-stale-props.js --help
 *   node scripts/clear-stale-props.js --dry-run
 *   node scripts/clear-stale-props.js --collect-only
 *   node scripts/clear-stale-props.js
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { runCleanupCli } from '../lib/prop-cache-cleanup-cli.js'

async function main() {
  const { exitCode } = await runCleanupCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    loadEnv: () => config({ path: '.env.local' }),
    createClient,
  })
  process.exit(exitCode)
}

main().catch((error) => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
