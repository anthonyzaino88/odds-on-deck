#!/usr/bin/env node
/**
 * Read-only: did SQL 010 add PlayerPropCache.quotes / quoteUpdatedAt
 * and PropValidation.entryBook?
 *
 * Does not write. Does not apply the migration. Does not call The Odds API.
 * Empty quotes after a successful apply is expected until the next
 * morning fetch writes ladders.
 *
 * Usage:
 *   node scripts/report-line-shop-schema.js
 *   node scripts/report-line-shop-schema.js --json
 *   npm run report:line-shop-schema
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  checkLineShop010Schema,
  formatLineShop010Report,
} from '../lib/line-shopping.js'

export const REPORT_LINE_SHOP_SCHEMA_USAGE = `Usage:
  node scripts/report-line-shop-schema.js [--json]

Read-only check for SQL 010 columns (quotes, quoteUpdatedAt, entryBook).
Does not write. Does not apply the migration. Does not call The Odds API.
`

function parseArgs(argv = []) {
  const out = { json: false, help: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--json') out.json = true
  }
  return out
}

export async function runLineShop010Report({
  argv = process.argv.slice(2),
  client,
  stdout = console,
} = {}) {
  const args = parseArgs(argv)
  if (args.help) {
    stdout.log(REPORT_LINE_SHOP_SCHEMA_USAGE)
    return { exitCode: 0, summary: null }
  }

  let supabase = client
  if (!supabase) {
    const { createScriptSupabaseClient } = await import('../lib/supabase-script-client.js')
    supabase = createScriptSupabaseClient()
  }

  const summary = await checkLineShop010Schema(supabase)
  if (args.json) {
    stdout.log(JSON.stringify(summary, null, 2))
  } else {
    stdout.log(formatLineShop010Report(summary))
  }
  return { exitCode: summary.status === 'ok' ? 0 : 1, summary }
}

const isDirect = process.argv[1] && process.argv[1].endsWith('report-line-shop-schema.js')
if (isDirect) {
  runLineShop010Report()
    .then((result) => {
      if (result?.exitCode) process.exit(result.exitCode)
    })
    .catch((error) => {
      console.error('❌ report-line-shop-schema failed:', error)
      process.exit(1)
    })
}
