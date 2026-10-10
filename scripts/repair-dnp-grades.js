#!/usr/bin/env node
/**
 * Preview (default) or apply DNP voids for player props graded as a
 * real 0 when the player did not appear.
 *
 *   node scripts/repair-dnp-grades.js
 *   node scripts/repair-dnp-grades.js --dry-run
 *   node scripts/repair-dnp-grades.js --csv path\to\mlb_dnp_graded_rows.csv
 *   node scripts/repair-dnp-grades.js --apply
 *
 * Dry-run is the default. --apply writes via createScriptSupabaseClient
 * (SUPABASE_SECRET_KEY). Do not run --apply against production from CI.
 * Writes a JSON backup of affected rows before the first update.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { updateWithOptionalAudit } from '../lib/grade-audit.js'
import { paginateSupabaseSelect, chunkIds } from '../lib/unplayed-game-grades.js'
import { fetchParsedMlbBoxscore } from '../lib/vendors/mlb-game-stats.js'
import { lookupMlbPlayerStat } from '../lib/mlb-stat-grade.js'
import { lookupPlayerGameStat as lookupNhlStat, createNhlLookupCache } from '../lib/vendors/nhl-game-stats.js'
import {
  PUBLISHED_STATS_PREFILTER,
  PUBLISHED_STATS_SELECT,
} from '../lib/published-picks.js'
import {
  buildDnpRepairPreview,
  compareRepairIdsToCsv,
  describePublishedDelta,
  dnpRepairApplyPayload,
  DNP_REPAIR_SPORTS,
  isDnpRepairCandidate,
  parseDnpCsvIds,
  parseRepairDnpArgs,
  publishedSummariesAfterVoids,
  shouldApplyDnpPreview,
  summarizeDnpPreviews,
} from '../lib/repair-dnp-grades.js'

config({ path: '.env.local' })

export const REPAIR_FETCH_DELAY_MS = 150
const GAME_SELECT = 'id, sport, status, mlbGameId, espnGameId, homeScore, awayScore'

function sleepMs(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function formatUnits(n) {
  const value = Number(n) || 0
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}u`
}

export async function runRepairDnpGrades({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  fetchMlbBoxscore = fetchParsedMlbBoxscore,
  lookupMlb = lookupMlbPlayerStat,
  lookupNhl = lookupNhlStat,
  now = new Date(),
  log = console,
  sleep = sleepMs,
  fetchDelayMs = REPAIR_FETCH_DELAY_MS,
  readFile = readFileSync,
  writeFile = writeFileSync,
  mkdir = mkdirSync,
  fileExists = existsSync,
} = {}) {
  const args = parseRepairDnpArgs(argv)
  if (args.help) {
    log.log(`Usage: node scripts/repair-dnp-grades.js [--dry-run|--apply] [--sport mlb|nhl] [--csv PATH] [--backup-dir DIR]

Dry-run (default): find completed 0-actual MLB/NHL player props whose
box score shows the player did not appear, print every row, Published
record/units before and after, and an optional CSV diff.
--apply: write void / manual_closed. Requires SUPABASE_SECRET_KEY.
         Writes a JSON backup first. Do not run against production from CI.`)
    return { exitCode: 0, previews: [], summary: summarizeDnpPreviews([]) }
  }

  const sportFilter = args.sport ? String(args.sport).toLowerCase() : null
  if (sportFilter === 'nfl') {
    log.log('NFL players missing from the box score stay needs_review (not inferred DNP). Nothing to void.')
    return { exitCode: 0, previews: [], summary: summarizeDnpPreviews([]), nflSkipped: true }
  }
  if (sportFilter && !DNP_REPAIR_SPORTS.includes(sportFilter)) {
    log.error(`Unknown --sport ${args.sport}. Use mlb or nhl.`)
    return { exitCode: 1, previews: [], summary: summarizeDnpPreviews([]) }
  }

  const supabase = createClient()
  const sports = sportFilter ? [sportFilter] : [...DNP_REPAIR_SPORTS]
  const { rows, error } = await paginateSupabaseSelect(() => supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'completed')
    .eq('actualValue', 0)
    .in('sport', sports)
    .order('id', { ascending: true }))
  if (error) {
    log.error(`❌ Query error: ${error.message}`)
    return { exitCode: 1, previews: [], summary: summarizeDnpPreviews([]) }
  }

  const candidates = (rows || []).filter(isDnpRepairCandidate)
  const gameIds = [...new Set(candidates.map((row) => row.gameIdRef).filter(Boolean))]
  const gameMap = new Map()
  for (const chunk of chunkIds(gameIds, 200)) {
    const { data: games } = await supabase.from('Game').select(GAME_SELECT).in('id', chunk)
    if (games) games.forEach((game) => gameMap.set(game.id, game))
  }

  const mlbCache = new Map()
  const nhlCache = createNhlLookupCache()
  const previews = []
  const previewRows = []

  for (const row of candidates) {
    const game = gameMap.get(row.gameIdRef)
    const sport = String(row.sport || game?.sport || '').toLowerCase()
    let lookup = null
    if (sport === 'mlb') {
      if (!game?.mlbGameId) {
        lookup = { didNotPlay: false, reason: 'stat_not_found', value: null }
      } else {
        if (!mlbCache.has(game.mlbGameId)) {
          const players = await fetchMlbBoxscore(game.mlbGameId)
          mlbCache.set(game.mlbGameId, players)
          if (fetchDelayMs) await sleep(fetchDelayMs)
        }
        const players = mlbCache.get(game.mlbGameId)
        lookup = players
          ? lookupMlb(players, row.playerName, row.propType)
          : { didNotPlay: false, reason: 'stat_not_found', value: null }
      }
    } else if (sport === 'nhl') {
      if (!game?.espnGameId) {
        lookup = { didNotPlay: false, reason: 'stat_not_found', value: null }
      } else {
        lookup = await lookupNhl(
          game.espnGameId,
          row.playerName,
          row.propType,
          row.gameIdRef,
          { playerId: row.playerId, team: row.team, cache: nhlCache, fetchDelayMs, sleep },
        )
      }
    } else {
      lookup = { didNotPlay: false, reason: 'stat_not_found', value: null }
    }

    const preview = buildDnpRepairPreview(row, lookup)
    previews.push(preview)
    if (shouldApplyDnpPreview(preview)) previewRows.push({ row, preview, game })
  }

  const summary = summarizeDnpPreviews(previews)
  const voidIds = new Set(previewRows.map(({ row }) => row.id))

  const publishedPage = await paginateSupabaseSelect(() => supabase
    .from('PropValidation')
    .select(PUBLISHED_STATS_SELECT)
    .eq('status', 'completed')
    .in('sport', PUBLISHED_STATS_PREFILTER.sports)
    .eq('source', PUBLISHED_STATS_PREFILTER.source)
    .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
    .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
    .not('propType', 'in', '(moneyline,total,totals,h2h,ml)')
    .order('id', { ascending: true }))
  if (publishedPage.error) {
    log.error(`⚠️ Published cohort lookup failed: ${publishedPage.error.message}`)
  }
  const published = publishedSummariesAfterVoids(publishedPage.rows || [], voidIds)
  const publishedDelta = describePublishedDelta(published.before, published.after)

  let csvCompare = null
  if (args.csv) {
    const csvPath = resolve(args.csv)
    if (!fileExists(csvPath)) {
      log.error(`⚠️ CSV not found: ${csvPath}`)
    } else {
      const csvIds = parseDnpCsvIds(String(readFile(csvPath, 'utf8')))
      csvCompare = compareRepairIdsToCsv(voidIds, csvIds)
    }
  }

  log.log('\n📋 DNP GRADE REPAIR')
  log.log('='.repeat(60))
  log.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN (default)'}`)
  log.log(`Sports: ${sports.join(', ')}`)
  log.log(`Candidates (completed actual=0): ${candidates.length}`)
  log.log(`Would void: ${summary.ready}`)
  log.log(`Skipped (appeared / missing / already void): ${summary.skipped}`)
  log.log(`  no PA: ${summary.noPa}   no BF: ${summary.noBf}   not in box: ${summary.notInBox}   0 TOI: ${summary.zeroToi}`)
  log.log(`  old losses: ${summary.wasLoss}   old wins: ${summary.wasWin}`)

  for (const preview of previews) {
    if (preview.skip) continue
    log.log(
      `  ${args.apply ? 'WRITE' : 'would write'} ${preview.id} ${preview.player} ${preview.prop} ${preview.game} ${preview.oldResult} -> void (${preview.reason})`
    )
  }

  log.log('\n📊 Published card')
  log.log(`  before: ${publishedDelta.beforeRecord}   ${publishedDelta.beforeDecided} decided   ${formatUnits(publishedDelta.beforeUnits)}`)
  log.log(`  after:  ${publishedDelta.afterRecord}   ${publishedDelta.afterDecided} decided   ${formatUnits(publishedDelta.afterUnits)}`)
  log.log(`  units delta: ${formatUnits(publishedDelta.unitsDelta)}`)

  if (csvCompare) {
    log.log('\n📄 CSV comparison')
    log.log(`  script voids: ${csvCompare.repairCount}   csv rows: ${csvCompare.csvCount}   overlap: ${csvCompare.both.length}`)
    log.log(`  only in script: ${csvCompare.onlyInRepair.length}`)
    log.log(`  only in csv: ${csvCompare.onlyInCsv.length}`)
    if (csvCompare.onlyInRepair.length) {
      log.log(`  script-only ids: ${csvCompare.onlyInRepair.slice(0, 20).join(', ')}${csvCompare.onlyInRepair.length > 20 ? ' …' : ''}`)
    }
    if (csvCompare.onlyInCsv.length) {
      log.log(`  csv-only ids: ${csvCompare.onlyInCsv.slice(0, 20).join(', ')}${csvCompare.onlyInCsv.length > 20 ? ' …' : ''}`)
    }
    log.log('  Differences are expected when the CSV is a point-in-time dump (new games, already-voided rows, name-mismatch skips, or NHL 0-TOI that the MLB-only CSV omitted).')
  }

  if (!args.apply) {
    log.log('\n💡 Dry-run only. Pass --apply to write voids (JSON backup first).')
    log.log('   Do not run --apply against production from CI.')
    return {
      exitCode: 0,
      previews,
      summary,
      applied: 0,
      published: publishedDelta,
      csvCompare,
    }
  }

  const toWrite = previewRows
  let backupPath = null
  if (toWrite.length > 0) {
    const backupDir = args.backupDir
      ? resolve(args.backupDir)
      : resolve('research', 'archive', 'dnp-grade-backups')
    mkdir(backupDir, { recursive: true })
    const stamp = (now instanceof Date ? now : new Date(now)).toISOString().replace(/[:.]/g, '-')
    backupPath = resolve(backupDir, `dnp-repair-${stamp}.json`)
    writeFile(backupPath, JSON.stringify(toWrite.map(({ row }) => row), null, 2))
    log.log(`\n💾 Backup: ${backupPath}`)
  }

  let applied = 0
  let applyErrors = 0
  for (const { row, preview, game } of toWrite) {
    const write = await updateWithOptionalAudit(
      (payload) => supabase.from('PropValidation').update(payload).eq('id', row.id),
      dnpRepairApplyPayload(row, preview, game, now),
    )
    if (write?.error) {
      applyErrors += 1
      log.error(`❌ Write failed for ${row.id}: ${write.error.message}`)
      continue
    }
    applied += 1
    log.log(`✅ ${row.id} ${row.playerName} ${preview.oldResult} -> void`)
  }

  log.log(`\nApplied ${applied} void(s); ${summary.skipped} skipped; ${applyErrors} error(s).`)
  return {
    exitCode: applyErrors ? 1 : 0,
    previews,
    summary,
    applied,
    backupPath,
    published: publishedDelta,
    csvCompare,
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
  runRepairDnpGrades().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
