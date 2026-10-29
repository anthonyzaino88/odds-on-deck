#!/usr/bin/env node
/**
 * Read-only private NHL shadow-published record.
 *
 *   node scripts/report-shadow-nhl.js
 *   npm run report:shadow-nhl
 *
 * Prints W–L–P, units/ROI, and CLV beat-rate/avg where closes exist.
 * Uses createScriptSupabaseClient. Never writes. Never calls The Odds API.
 * Never used by homepage / Editor's / public APIs.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  PUBLISHED_STATS_SELECT,
  SHADOW_PUBLISHED_COHORT_TAG,
  SHADOW_PUBLISHED_STATS_PREFILTER,
  filterShadowPublishedPicks,
  summarizeShadowPublishedPicks,
} from '../lib/published-picks.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import { summarizePublishedClv } from '../lib/closing-line.js'
import { formatClvSummary } from './report-published-clv.js'

config({ path: '.env.local' })

const CLOSE_SELECT = `${PUBLISHED_STATS_SELECT}, closeOdds, closeLine, closeBook, closeCapturedAt`

function formatSigned(n, digits = 2) {
  if (!Number.isFinite(n)) return 'n/a'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}`
}

export function formatShadowNhlSummary({ record, units, roi, clv }) {
  const clvLine = formatClvSummary(clv)
  return {
    record: `Record: ${record}`,
    units: `Units: ${formatSigned(units, 2)}u   ROI: ${formatSigned(roi * 100, 1)}%`,
    clv: clvLine.line,
  }
}

export async function runReportShadowNhl({
  createClient = createScriptSupabaseClient,
  log = console,
} = {}) {
  const supabase = createClient()

  async function load(select) {
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('status', 'completed')
      .in('sport', SHADOW_PUBLISHED_STATS_PREFILTER.sports)
      .eq('source', SHADOW_PUBLISHED_STATS_PREFILTER.source)
      .gt('edge', SHADOW_PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', SHADOW_PUBLISHED_STATS_PREFILTER.minQuality)
      .ilike('notes', `%${SHADOW_PUBLISHED_COHORT_TAG}%`)
      .not('propType', 'in', '(moneyline,total,totals,h2h,ml)')
      .order('id', { ascending: true }))
  }

  let page = await load(CLOSE_SELECT)
  if (page.error && isMissingColumnError(page.error)) {
    log.log('⚠️ closeOdds columns not applied yet (run 007 SQL). Reporting CLV as n/a.')
    page = await load(PUBLISHED_STATS_SELECT)
  }
  if (page.error) {
    log.error(`❌ Query error: ${page.error.message}`)
    return {
      exitCode: 1,
      summary: summarizeShadowPublishedPicks([]),
      clv: summarizePublishedClv([]),
    }
  }

  const picks = filterShadowPublishedPicks(page.rows || [])
  const summary = summarizeShadowPublishedPicks(picks)
  const clv = summarizePublishedClv(picks)
  const formatted = formatShadowNhlSummary({
    record: summary.record,
    units: summary.units,
    roi: summary.roi,
    clv,
  })

  log.log('\n🔒 SHADOW NHL PUBLISHED (private, read-only)')
  log.log('='.repeat(60))
  log.log(`Cohort: ${SHADOW_PUBLISHED_COHORT_TAG}`)
  log.log(formatted.record)
  log.log(`Graded: ${summary.graded}   Decided: ${summary.decided}   Pushes: ${summary.pushes}`)
  log.log(formatted.units)
  log.log(formatted.clv)
  log.log('Headline uses same-line closes only (closeLine = recorded line).')
  log.log('Does not write. Does not call The Odds API. Off every public surface.')
  return { exitCode: 0, summary, clv, picks }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runReportShadowNhl().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
