#!/usr/bin/env node
/**
 * Preview (default) or apply NHL shots-on-goal grade repairs.
 *
 *   node scripts/repair-nhl-sog-grades.js
 *   node scripts/repair-nhl-sog-grades.js --dry-run
 *   node scripts/repair-nhl-sog-grades.js --apply
 *
 * --apply writes via createScriptSupabaseClient (SUPABASE_SECRET_KEY).
 * Unmatched / ambiguous / unchanged rows are reported and skipped.
 * Do not run --apply against production from CI or this PR.
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { createNhlLookupCache, lookupPlayerGameStat } from '../lib/vendors/nhl-game-stats.js'
import { updateWithOptionalAudit } from '../lib/grade-audit.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  buildRepairPreviewRow,
  flippingRepairRows,
  isNhlSogValidation,
  matchFlippedParlayRefs,
  NHL_SOG_PROP_TYPES,
  parseRepairArgs,
  repairApplyPayload,
  repairTableRecords,
  shouldApplyRepairPreview,
  summarizeRepairRows,
} from '../lib/repair-nhl-sog-grades.js'

config({ path: '.env.local' })

export const REPAIR_FETCH_DELAY_MS = 150

export async function runRepairNhlSogGrades({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  lookupStat = lookupPlayerGameStat,
  now = new Date(),
  log = console,
  sleep,
  fetchDelayMs = REPAIR_FETCH_DELAY_MS,
} = {}) {
  const args = parseRepairArgs(argv)
  if (args.help) {
    log.log('Usage: node scripts/repair-nhl-sog-grades.js [--dry-run|--apply]')
    return { exitCode: 0, previews: [], summary: summarizeRepairRows([]) }
  }

  const supabase = createClient()
  const { rows, error } = await paginateSupabaseSelect(() => supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .in('propType', [...NHL_SOG_PROP_TYPES])
    .eq('status', 'completed')
    .order('id', { ascending: true }))
  if (error) {
    log.error(`❌ Query error: ${error.message}`)
    return { exitCode: 1, previews: [], summary: summarizeRepairRows([]) }
  }

  const sogRows = (rows || []).filter(isNhlSogValidation)
  const gameIds = [...new Set(sogRows.map((row) => row.gameIdRef).filter(Boolean))]
  const gameMap = new Map()
  for (let i = 0; i < gameIds.length; i += 200) {
    const chunk = gameIds.slice(i, i + 200)
    const { data: games } = await supabase.from('Game').select('*').in('id', chunk)
    if (games) games.forEach((game) => gameMap.set(game.id, game))
  }

  const cache = createNhlLookupCache()
  const previews = []
  for (const row of sogRows) {
    const game = gameMap.get(row.gameIdRef)
    let lookup = null
    if (game?.espnGameId) {
      // PropValidation has no playerId or team column, so these are
      // always undefined. Matching is name-only for now; the NHL team
      // alias table is inert until those columns exist.
      lookup = await lookupStat(
        game.espnGameId,
        row.playerName,
        row.propType,
        row.gameIdRef,
        {
          playerId: row.playerId,
          team: row.team,
          cache,
          fetchDelayMs,
          sleep,
        },
      )
    }
    previews.push(buildRepairPreviewRow(row, lookup))
  }

  const summary = summarizeRepairRows(previews)
  const flippingRows = flippingRepairRows(previews, sogRows)
  const flipGameIds = [...new Set(flippingRows.map((row) => row.gameIdRef).filter(Boolean))]
  let flippedParlayLegs = []
  let flippedParlayHistory = []
  if (flipGameIds.length > 0) {
    const legs = []
    for (let i = 0; i < flipGameIds.length; i += 200) {
      const chunk = flipGameIds.slice(i, i + 200)
      const page = await paginateSupabaseSelect(() => supabase
        .from('ParlayLeg')
        .select('id, parlayId, playerName, propType, gameIdRef')
        .in('gameIdRef', chunk)
        .order('id', { ascending: true }))
      if (page.error) {
        log.error(`⚠️ ParlayLeg lookup failed: ${page.error.message}`)
        break
      }
      legs.push(...page.rows)
    }
    const refs = matchFlippedParlayRefs(flippingRows, legs)
    flippedParlayLegs = refs.parlayLegIds
    flippedParlayHistory = refs.parlayHistoryIds
  }

  log.log('\nNHL SOG grade repair preview')
  log.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN (default)'}`)
  if (typeof log.table === 'function') {
    log.table(repairTableRecords(previews))
  } else {
    for (const record of repairTableRecords(previews)) {
      log.log(record)
    }
  }
  log.log('\nSummary')
  log.log(`  total:          ${summary.total}`)
  log.log(`  ready:          ${summary.ready}`)
  log.log(`  unchanged:      ${summary.unchanged}`)
  log.log(`  skipped:        ${summary.skipped}`)
  log.log(`  unmatched:      ${summary.unmatched}`)
  log.log(`  ambiguous:      ${summary.ambiguous}`)
  log.log(`  actual changed: ${summary.actualChanged}`)
  log.log(`  result flips:   ${summary.flips}`)
  log.log('\nParlay rows that reference a flipping NHL SOG grade (report only):')
  log.log(`  ParlayLeg ids:      ${flippedParlayLegs.join(', ') || '(none)'}`)
  log.log(`  ParlayHistory ids:  ${flippedParlayHistory.join(', ') || '(none)'}`)

  if (!args.apply) {
    log.log('\nDry-run only. Pass --apply to write (skips unmatched/ambiguous/unchanged).')
    return {
      exitCode: 0,
      previews,
      summary,
      applied: 0,
      flippedParlayLegs,
      flippedParlayHistory,
    }
  }

  let applied = 0
  let applyErrors = 0
  let unchanged = 0
  for (const preview of previews) {
    if (preview.skip) {
      log.log(`⏭️  skip ${preview.id} ${preview.player} (${preview.skipReason})`)
      continue
    }
    if (!shouldApplyRepairPreview(preview)) {
      unchanged += 1
      log.log(`⏭️  unchanged ${preview.id} ${preview.player} ${preview.oldActual}`)
      continue
    }
    const row = sogRows.find((item) => item.id === preview.id)
    const write = await updateWithOptionalAudit(
      (payload) => supabase.from('PropValidation').update(payload).eq('id', preview.id),
      repairApplyPayload(row, preview, now),
    )
    if (write?.error) {
      applyErrors += 1
      log.error(`❌ Write failed for ${preview.id}: ${write.error.message}`)
      continue
    }
    applied += 1
    log.log(`✅ ${preview.id} ${preview.player} ${preview.oldActual} → ${preview.newActual}`)
  }

  log.log(`\nApplied ${applied} row(s); ${summary.skipped} skipped; ${unchanged} unchanged; ${applyErrors} error(s).`)
  return {
    exitCode: applyErrors ? 1 : 0,
    previews,
    summary,
    applied,
    flippedParlayLegs,
    flippedParlayHistory,
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
  runRepairNhlSogGrades().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
