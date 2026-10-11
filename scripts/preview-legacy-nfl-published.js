#!/usr/bin/env node
/**
 * Read-only preview of the honest Published card after dropping
 * legacy NFL generator rows (recorded before the current persist path).
 *
 * Dry-run / read-only by default. This script never writes.
 *
 *   node scripts/preview-legacy-nfl-published.js
 *   node scripts/preview-legacy-nfl-published.js --dry-run
 *
 * Uses createScriptSupabaseClient (SUPABASE_SECRET_KEY). Safe to run
 * from the ops laptop. Does not call The Odds API.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  PUBLISHED_PIPELINE_START,
  PUBLISHED_PIPELINE_START_ET,
  PUBLISHED_STATS_PREFILTER,
  PUBLISHED_STATS_SELECT,
  comparePublishedLegacyNfl,
  legacyNflPublishedFingerprint,
} from '../lib/published-picks.js'
import { formatAmericanOdds } from '../lib/odds-units.js'

config({ path: '.env.local' })

export function parsePreviewLegacyNflArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  return {
    dryRun: true,
    help: args.includes('--help') || args.includes('-h'),
    apply: args.includes('--apply'),
  }
}

function formatUnits(n) {
  const value = Number(n) || 0
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}u`
}

function formatPct(n) {
  const value = Number(n)
  if (!Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(2)}%`
}

function formatRecordedAt(row) {
  return row?.timestamp || row?.completedAt || '—'
}

function formatFingerprint(row) {
  const fp = legacyNflPublishedFingerprint(row)
  const bits = []
  if (fp.probabilityInOldBand) bits.push(`p=${Number(row.probability).toFixed(3)}`)
  if (fp.edgeInOldBand) bits.push(`edge=${(Number(row.edge) * 100).toFixed(1)}%`)
  if (fp.americanInOldBand) bits.push(`odds=${formatAmericanOdds(row.odds) || row.odds}`)
  return bits.length ? bits.join(' ') : 'date-only (outside old-generator bands)'
}

export function formatPublishedSummaryLine(summary) {
  return `${summary.record}   ${summary.decided} decided   ${formatUnits(summary.units)}   ROI ${formatPct(summary.roi)}`
}

export async function runPreviewLegacyNflPublished({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  log = console,
} = {}) {
  const args = parsePreviewLegacyNflArgs(argv)
  if (args.help) {
    log.log(`Usage: node scripts/preview-legacy-nfl-published.js [--dry-run]

Read-only. Prints the Published record before and after excluding NFL
rows recorded before ${PUBLISHED_PIPELINE_START_ET} ET (current persist
path start), plus every excluded row.

This script never writes. --apply is rejected on purpose — the filter
is code-level in lib/published-picks.js. Revert that helper to put the
rows back on the card.`)
    return { exitCode: 0, excluded: [], comparison: null }
  }

  if (args.apply) {
    log.error('❌ This preview never writes. The filter is code-level (isLegacyNflPublishedRow).')
    log.error('   Merge the PR to apply. Revert the helper to undo. No --apply.')
    return { exitCode: 2, excluded: [], comparison: null }
  }

  const supabase = createClient()
  const page = await paginateSupabaseSelect(() => supabase
    .from('PropValidation')
    .select(PUBLISHED_STATS_SELECT)
    .eq('status', 'completed')
    .in('sport', PUBLISHED_STATS_PREFILTER.sports)
    .eq('source', PUBLISHED_STATS_PREFILTER.source)
    .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
    .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
    .not('propType', 'in', '(moneyline,total,totals,h2h,ml)')
    .order('id', { ascending: true }))

  if (page.error) {
    log.error(`❌ Query error: ${page.error.message}`)
    return { exitCode: 1, excluded: [], comparison: null }
  }

  const comparison = comparePublishedLegacyNfl(page.rows || [])
  const fingerprintHits = comparison.excluded.filter((row) => {
    const fp = legacyNflPublishedFingerprint(row)
    return fp.probabilityInOldBand && fp.edgeInOldBand
  })

  log.log('\n📋 LEGACY NFL PUBLISHED PREVIEW (read-only)')
  log.log('='.repeat(60))
  log.log('Mode: DRY-RUN / READ-ONLY (no writes)')
  log.log(`Rule: drop NFL rows recorded before ${PUBLISHED_PIPELINE_START_ET} ET`)
  log.log(`Cutoff: ${PUBLISHED_PIPELINE_START}`)
  log.log('Rows are not deleted. The public card uses isLegacyNflPublishedRow.')
  log.log('')
  log.log('📊 Published card')
  log.log(`  before: ${formatPublishedSummaryLine(comparison.before)}`)
  log.log(`  after:  ${formatPublishedSummaryLine(comparison.after)}`)
  log.log(`  excluded: ${comparison.excluded.length} row(s)`)
  log.log(`  units delta: ${formatUnits(comparison.after.units - comparison.before.units)}`)
  log.log(`  old-generator fingerprint (p 0.50–0.515 and edge ≥15%): ${fingerprintHits.length}`)

  log.log('\n📄 Excluded rows')
  if (comparison.excluded.length === 0) {
    log.log('  (none)')
  } else {
    for (const row of comparison.excluded) {
      log.log(
        `  ${row.id}  ${row.playerName || '—'}  ${row.propType || '—'}  `
        + `${row.prediction || ''} ${row.threshold ?? ''}  `
        + `${row.result || '—'}  ${formatAmericanOdds(row.odds) || row.odds}  `
        + `recorded ${formatRecordedAt(row)}  ${formatFingerprint(row)}`,
      )
    }
  }

  log.log('\n💡 Read-only. Merge the PR to change the public card. No DB writes.')
  return {
    exitCode: 0,
    excluded: comparison.excluded,
    comparison,
    fingerprintHits,
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
  runPreviewLegacyNflPublished().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
