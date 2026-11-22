#!/usr/bin/env node
/**
 * Dry-run only. Lists NFL v1.1.0 game-line shadow PropValidation rows
 * scored before the regular-season-finals filter (mixed preseason +
 * regular records). Does not write. --apply is refused.
 *
 *   node operations/preview-nfl-v110-pre-rs-filter.mjs
 *   node operations/preview-nfl-v110-pre-rs-filter.mjs --json
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import { GAME_LINE_SOURCE } from '../lib/game-lines.js'
import { SHADOW_PUBLISHED_COHORT_TAG } from '../lib/published-picks.js'
import { NFL_SELECTION_MODEL_VERSION } from '../lib/nfl-selection-model.js'
import {
  NFL_REGULAR_SEASON_FINALS_NOTES_TAG,
  planNflV110PreRsFilterRetag,
} from '../lib/game-line-shadow.js'

config({ path: '.env.local' })

export const NFL_V110_PRE_RS_FILTER_USAGE = `Usage:
  node operations/preview-nfl-v110-pre-rs-filter.mjs [--json]

Dry-run only. Lists NFL v1.1.0 game-line shadow PropValidation rows
that do not yet carry ${NFL_REGULAR_SEASON_FINALS_NOTES_TAG}.
Those rows were scored on mixed preseason+regular records.
Does not write. --apply is refused. Does not call The Odds API.
`

export async function runPreviewNflV110PreRsFilter({
  argv = [],
  supabase,
  log = console,
  loadRows = null,
} = {}) {
  const flags = new Set((argv || []).filter((arg) => String(arg).startsWith('--')))
  if (flags.has('--help') || flags.has('-h')) {
    log.log(NFL_V110_PRE_RS_FILTER_USAGE)
    return { exitCode: 0, planned: [], wrote: false }
  }
  if (flags.has('--apply')) {
    log.error('Dry-run only. Refusing --apply; this PR does not write PropValidation notes.')
    return { exitCode: 2, planned: [], wrote: false }
  }

  let rows = []
  if (typeof loadRows === 'function') {
    rows = await loadRows()
  } else {
    const client = supabase
    const page = await paginateSupabaseSelect(() => client
      .from('PropValidation')
      .select('id, gameIdRef, gameId, sport, notes, modelRun, modelVersion, source, status')
      .eq('sport', 'nfl')
      .eq('source', GAME_LINE_SOURCE)
      .ilike('notes', `%${SHADOW_PUBLISHED_COHORT_TAG}%`)
      .ilike('notes', `%model:${NFL_SELECTION_MODEL_VERSION}%`)
      .order('id', { ascending: true }))
    if (page.error) {
      log.error(`Query error: ${page.error.message}`)
      return { exitCode: 1, planned: [], wrote: false }
    }
    rows = page.rows || []
  }

  const planned = planNflV110PreRsFilterRetag(rows)
  if (flags.has('--json')) {
    log.log(JSON.stringify({
      wrote: false,
      modelVersion: NFL_SELECTION_MODEL_VERSION,
      scanned: rows.length,
      wouldRetag: planned.length,
      rows: planned,
    }, null, 2))
  } else {
    log.log('NFL v1.1.0 pre-regular-season-filter preview (dry-run, no writes)')
    log.log(`scanned=${rows.length} wouldRetag=${planned.length}`)
    for (const row of planned.slice(0, 25)) {
      log.log(`  ${row.id} ${row.gameIdRef || ''}`.trim())
    }
    if (planned.length > 25) log.log(`  … ${planned.length - 25} more`)
    log.log('Re-run later with a dedicated apply script if you want to stamp')
    log.log('features:pre-regular-season-filter on these rows. Not in this PR.')
  }
  return { exitCode: 0, planned, wrote: false, scanned: rows.length }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runPreviewNflV110PreRsFilter({
    argv: process.argv.slice(2),
    supabase: createScriptSupabaseClient(),
  }).then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
