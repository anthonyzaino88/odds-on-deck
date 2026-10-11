#!/usr/bin/env node
/**
 * Read-only Published CLV report.
 *
 *   node scripts/report-published-clv.js
 *   npm run report:published-clv
 *
 * Uses createScriptSupabaseClient. Never writes. Never calls The Odds API.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  PUBLISHED_STATS_PREFILTER,
  PUBLISHED_STATS_SELECT,
  filterPublishedPicks,
} from '../lib/published-picks.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import { summarizePublishedClv } from '../lib/closing-line.js'

config({ path: '.env.local' })

const CLOSE_SELECT = `${PUBLISHED_STATS_SELECT}, closeOdds, closeLine, closeBook, closeCapturedAt`

export function formatClvSummary(summary) {
  const avg = summary.avgClvProb == null
    ? 'n/a'
    : `${summary.avgClvProb >= 0 ? '+' : ''}${(summary.avgClvProb * 100).toFixed(2)}pp`
  const beat = summary.pctBeatClose == null
    ? 'n/a'
    : `${(summary.pctBeatClose * 100).toFixed(1)}%`
  return {
    line: `${summary.withClose} with close / ${summary.sample} Published   `
      + `avg CLV ${avg}   beat close ${beat}   `
      + `(${summary.beatClose} beat / ${summary.withClose - summary.beatClose} worse)`,
    avg,
    beat,
  }
}

export async function runReportPublishedClv({
  createClient = createScriptSupabaseClient,
  log = console,
} = {}) {
  const supabase = createClient()

  async function load(select) {
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('status', 'completed')
      .in('sport', PUBLISHED_STATS_PREFILTER.sports)
      .eq('source', PUBLISHED_STATS_PREFILTER.source)
      .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
      .not('propType', 'in', '(moneyline,total,totals,h2h,ml)')
      .order('id', { ascending: true }))
  }

  let page = await load(CLOSE_SELECT)
  if (page.error && isMissingColumnError(page.error)) {
    log.log('⚠️ closeOdds columns not applied yet (run 007 SQL). Reporting zeros.')
    page = await load(PUBLISHED_STATS_SELECT)
  }
  if (page.error) {
    log.error(`❌ Query error: ${page.error.message}`)
    return { exitCode: 1, summary: summarizePublishedClv([]) }
  }

  const published = filterPublishedPicks(page.rows || [])
  const summary = summarizePublishedClv(published)
  const formatted = formatClvSummary(summary)

  log.log('\n📈 PUBLISHED CLV (read-only)')
  log.log('='.repeat(60))
  log.log(formatted.line)
  log.log(`Same line as recorded: ${summary.sameLine}   line moved: ${summary.lineMoved}`)
  log.log('CLV is implied(close) − implied(recorded). Positive = we beat the close.')
  log.log('Does not write. Does not call The Odds API.')
  return { exitCode: 0, summary, published }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runReportPublishedClv().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
