#!/usr/bin/env node
/**
 * List (default) or clear NFL closes where closeLine moved off the pick
 * threshold. Backs up matching rows to JSONL before any write.
 *
 *   node scripts/clear-bad-nfl-closes.js --date 2026-10-26
 *   node scripts/clear-bad-nfl-closes.js --date 2026-10-26 --dry-run
 *   node scripts/clear-bad-nfl-closes.js --date 2026-10-26 --apply
 *
 * Dry-run is the default. --apply is refused in CI / hosted production.
 * Do NOT run --apply against prod. No schema change. Never prints secrets.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import {
  SUPABASE_REQUIRE_SECRET_ENV,
  isPublishableSupabaseKey,
} from '../lib/supabase-admin-key.js'
import {
  etDayEndExclusiveUtc,
  etDayStartUtc,
  paginateSupabaseSelect,
} from '../lib/unplayed-game-grades.js'
import { closeUpdateRowCount, isOpsWriteQuietPeriod } from '../lib/closing-line.js'
import {
  applyClearBadNflCloseUpdate,
  assertClearBadNflClosesApplyAllowed,
  backupFileName,
  clearBadNflClosesPayload,
  isMovedNflClose,
  parseClearBadNflClosesArgs,
  rowsToJsonl,
} from '../lib/clear-bad-nfl-closes.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date'
const PICK_SELECT = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'sport', 'source', 'status', 'notes',
  'closeOdds', 'closeLine', 'closeBook', 'closeNumBooks', 'closeCapturedAt',
].join(', ')

export function formatClearModeBanner(apply) {
  return apply ? 'MODE: APPLY' : 'MODE: DRY-RUN'
}

export function clearSupabaseEnv(env = process.env) {
  return {
    ...env,
    [SUPABASE_REQUIRE_SECRET_ENV]: '1',
  }
}

export function assertClearSecretIsNotPublishable(env = process.env) {
  const preferred = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (isPublishableSupabaseKey(preferred)) {
    throw new Error(
      'SUPABASE_SECRET_KEY is a publishable/anon key. Use the secret or service_role key.',
    )
  }
  return preferred
}

export async function runClearBadNflCloses({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  now = new Date(),
  env = process.env,
  log = console,
  writeFile = writeFileSync,
  mkdir = mkdirSync,
} = {}) {
  const args = parseClearBadNflClosesArgs(argv, env)
  if (args.help) {
    log.log(`Usage: node scripts/clear-bad-nfl-closes.js --date YYYY-MM-DD [--dry-run|--apply] [--backup-dir DIR]

Dry-run (default): list NFL PropValidation rows for that ET game date
whose closeLine moved off the recorded threshold.
--apply: backup matching rows to JSONL, then null closeOdds, closeLine,
         closeBook, closeNumBooks, closeCapturedAt.
         UPDATE is closeLine != threshold so a row fixed meanwhile
         is left alone. Refused in CI / hosted production and during
         the :05–:15 ET quiet period. Do NOT run against prod.
Requires SUPABASE_SECRET_KEY (SUPABASE_REQUIRE_SECRET_KEY=1).
Anon/public keys are refused. Never prints secrets.`)
    return { exitCode: 0, rows: [], applied: 0, help: true }
  }

  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return { exitCode: 1, rows: [], applied: 0, unknown: args.unknown }
  }
  if (args.dateMissing) {
    log.error('❌ --date YYYY-MM-DD is required.')
    return { exitCode: 1, rows: [], applied: 0, missingDate: true }
  }
  if (args.invalidFlags.length) {
    log.error(`❌ Invalid or missing value for ${args.invalidFlags.join(', ')}`)
    return { exitCode: 1, rows: [], applied: 0, invalidFlags: args.invalidFlags }
  }

  log.log(formatClearModeBanner(args.apply))
  log.log('Do not run --apply against production.')

  if (args.apply) {
    try {
      assertClearBadNflClosesApplyAllowed(env)
    } catch (error) {
      log.error(`❌ ${error.message}`)
      return { exitCode: 1, rows: [], applied: 0, refusedProd: true }
    }
    if (isOpsWriteQuietPeriod(now)) {
      log.log('⏸️  Ops quiet period (:05–:15 ET) — no close-clear writes.')
      return { exitCode: 0, rows: [], applied: 0, skippedQuiet: true }
    }
  }

  let supabase
  try {
    assertClearSecretIsNotPublishable(env)
    supabase = createClient(clearSupabaseEnv(env))
  } catch (error) {
    log.error(`❌ ${error.message}`)
    return { exitCode: 1, rows: [], applied: 0, missingSecret: true }
  }

  const dayStart = etDayStartUtc(args.date)
  const dayEnd = etDayEndExclusiveUtc(args.date)
  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .eq('sport', 'nfl')
    .gte('date', dayStart.toISOString())
    .lt('date', dayEnd.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${gameError.message}`)
    return { exitCode: 1, rows: [], applied: 0 }
  }

  const windowGames = games || []
  const gamesById = new Map(windowGames.map((game) => [game.id, game]))
  if (windowGames.length === 0) {
    log.log(`✅ No NFL games on ${args.date}.`)
    return { exitCode: 0, rows: [], applied: 0, date: args.date, games: [] }
  }

  const pickPage = await paginateSupabaseSelect(() => supabase
    .from('PropValidation')
    .select(PICK_SELECT)
    .eq('sport', 'nfl')
    .in('gameIdRef', windowGames.map((game) => game.id).concat(['__none__']))
    .not('closeLine', 'is', null)
    .order('id', { ascending: true }))

  if (pickPage.error) {
    log.error(`❌ Pick query failed: ${pickPage.error.message}`)
    return { exitCode: 1, rows: [], applied: 0 }
  }

  const rows = (pickPage.rows || []).filter((row) => (
    isMovedNflClose(row) && gamesById.has(row.gameIdRef)
  ))

  log.log('\n🧹 CLEAR BAD NFL CLOSES')
  log.log('='.repeat(60))
  log.log(`ET date: ${args.date}`)
  log.log(`NFL games: ${windowGames.length}`)
  log.log(`Moved closes (closeLine != threshold): ${rows.length}`)

  for (const row of rows) {
    log.log(
      `  ${args.apply ? 'CLEAR' : 'would clear'} ${row.id} ${row.playerName} ${row.propType}`
      + ` threshold=${row.threshold} closeLine=${row.closeLine}`
      + ` closeOdds=${row.closeOdds} book=${row.closeBook || '—'}`,
    )
  }

  if (!args.apply) {
    log.log('\n💡 Dry-run only. Pass --apply to null close fields after a JSONL backup.')
    log.log('   Do not run --apply against production.')
    return {
      exitCode: 0,
      rows,
      applied: 0,
      date: args.date,
      games: windowGames,
    }
  }

  let backupPath = null
  if (rows.length) {
    const backupDir = args.backupDir
      ? resolve(args.backupDir)
      : resolve('research', 'archive', 'clear-bad-nfl-closes')
    mkdir(backupDir, { recursive: true })
    backupPath = resolve(backupDir, backupFileName(args.date, now))
    writeFile(backupPath, rowsToJsonl(rows))
    log.log(`\n💾 Backup: ${backupPath}`)
  }

  const payload = clearBadNflClosesPayload()
  let applied = 0
  let skippedFixed = 0
  let applyErrors = 0
  for (const row of rows) {
    const write = await applyClearBadNflCloseUpdate(
      supabase.from('PropValidation'),
      row,
      payload,
    )
    if (write?.error) {
      applyErrors += 1
      log.error(`❌ Write failed for ${row.id}: ${write.error.message}`)
      continue
    }
    if (closeUpdateRowCount(write) === 0) {
      skippedFixed += 1
      log.log(`  skipped ${row.id} closeLine already matches threshold`)
      continue
    }
    applied += 1
    log.log(`✅ ${row.id} close fields nulled`)
  }

  log.log(`\nCleared ${applied} row(s); ${skippedFixed} already fixed; ${applyErrors} error(s).`)
  return {
    exitCode: applyErrors ? 1 : 0,
    rows,
    applied,
    skippedFixed,
    backupPath,
    date: args.date,
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
  runClearBadNflCloses().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
