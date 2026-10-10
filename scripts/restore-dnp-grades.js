#!/usr/bin/env node
/**
 * Restore PropValidation rows from a DNP repair JSON backup.
 *
 *   node scripts/restore-dnp-grades.js path\to\dnp-repair-backup.json
 *   node scripts/restore-dnp-grades.js --backup path\to\dnp-repair-backup.json
 *   node scripts/restore-dnp-grades.js --backup path\to\backup.json --apply
 *
 * Dry-run is the default. --apply writes via createScriptSupabaseClient
 * (SUPABASE_SECRET_KEY). Do not run --apply against production from CI.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { updateWithOptionalAudit } from '../lib/grade-audit.js'
import { chunkIds } from '../lib/unplayed-game-grades.js'
import {
  buildRestorePreview,
  parseDnpBackupJson,
  parseRestoreDnpArgs,
  summarizeRestorePreviews,
} from '../lib/restore-dnp-grades.js'

config({ path: '.env.local' })

export async function runRestoreDnpGrades({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  log = console,
  readFile = readFileSync,
  fileExists = existsSync,
} = {}) {
  const args = parseRestoreDnpArgs(argv)
  if (args.help) {
    log.log(`Usage: node scripts/restore-dnp-grades.js [--dry-run|--apply] --backup PATH

Dry-run (default): print every backup row that would be restored.
--apply: write the backed-up grade fields. Requires SUPABASE_SECRET_KEY.
         Do not run against production from CI.`)
    return { exitCode: 0, previews: [], summary: summarizeRestorePreviews([]) }
  }

  if (!args.backup) {
    log.error('❌ Missing backup path. Pass --backup PATH or a positional JSON file.')
    return { exitCode: 1, previews: [], summary: summarizeRestorePreviews([]) }
  }

  const backupPath = resolve(args.backup)
  if (!fileExists(backupPath)) {
    log.error(`❌ Backup not found: ${backupPath}`)
    return { exitCode: 1, previews: [], summary: summarizeRestorePreviews([]) }
  }

  let backupRows
  try {
    backupRows = parseDnpBackupJson(String(readFile(backupPath, 'utf8')))
  } catch (error) {
    log.error(`❌ ${error.message}`)
    return { exitCode: 1, previews: [], summary: summarizeRestorePreviews([]) }
  }

  const supabase = createClient()
  const currentById = new Map()
  for (const chunk of chunkIds(backupRows.map((row) => row.id), 200)) {
    const { data, error } = await supabase
      .from('PropValidation')
      .select('*')
      .in('id', chunk)
    if (error) {
      log.error(`❌ PropValidation lookup failed: ${error.message}`)
      return { exitCode: 1, previews: [], summary: summarizeRestorePreviews([]) }
    }
    for (const row of data || []) currentById.set(row.id, row)
  }

  const previews = backupRows.map((row) => buildRestorePreview(row, currentById.get(row.id) || null))
  const summary = summarizeRestorePreviews(previews)

  log.log('\n📋 DNP GRADE RESTORE')
  log.log('='.repeat(60))
  log.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN (default)'}`)
  log.log(`Backup: ${backupPath}`)
  log.log(`Rows: ${summary.total}   would restore: ${summary.ready}   skipped: ${summary.skipped}`)

  for (const preview of previews) {
    if (preview.skip) {
      log.log(`  skip ${preview.id} ${preview.player} (${preview.skipReason})`)
      continue
    }
    log.log(
      `  ${args.apply ? 'WRITE' : 'would write'} ${preview.id} ${preview.player} ${preview.prop} ${preview.game} ${preview.oldResult}/${preview.oldStatus} -> ${preview.newResult}/${preview.newStatus}`
    )
  }

  if (!args.apply) {
    log.log('\n💡 Dry-run only. Pass --apply to write restored grade fields.')
    return { exitCode: 0, previews, summary, applied: 0 }
  }

  let applied = 0
  let applyErrors = 0
  for (const preview of previews) {
    if (preview.skip) continue
    const write = await updateWithOptionalAudit(
      (payload) => supabase.from('PropValidation').update(payload).eq('id', preview.id),
      preview.payload,
    )
    if (write?.error) {
      applyErrors += 1
      log.error(`❌ Write failed for ${preview.id}: ${write.error.message}`)
      continue
    }
    applied += 1
    log.log(`✅ ${preview.id} ${preview.player} restored ${preview.newResult}/${preview.newStatus}`)
  }

  log.log(`\nRestored ${applied} row(s); ${summary.skipped} skipped; ${applyErrors} error(s).`)
  return {
    exitCode: applyErrors ? 1 : 0,
    previews,
    summary,
    applied,
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
  runRestoreDnpGrades().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
