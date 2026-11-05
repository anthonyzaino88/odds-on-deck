/**
 * NFL Game.season hygiene.
 *
 * Stored format matches Team.season: a four-digit year string ('2026').
 * ESPN event.season.year is preferred. When it is missing, Jan–Feb ET
 * dates belong to the prior NFL season year (Super Bowl / playoffs).
 *
 * Does not change NFL selection eligibility gates.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { espnEventSeasonYear } from './team-mapping.js'
import { isOpsWriteQuietPeriod } from './mlb-recording-window.js'

export const NFL_SEASON_TZ = 'America/New_York'
export const NFL_SEASON_BACKUP_DIR = '.local/backups'
export const NFL_SEASON_BACKFILL_USAGE = `Usage:
  node operations/backfill-nfl-game-season.mjs [--apply] [--json] [--limit N]

Dry-run (default): count NFL Game rows with null/empty season and print
proposed Team.season-format values (e.g. '2026').
--apply: write a JSON backup to .local/backups, then UPDATE season.
         Refused during the :05–:15 ET quiet window.
Does not change eligibility gates. Does not call The Odds API.
`

export function formatSeasonYear(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const year = Math.trunc(value)
    return year >= 1990 && year <= 2100 ? String(year) : null
  }
  const match = String(value).trim().match(/^(19|20)\d{2}/)
  return match ? match[0] : null
}

export function isMissingNflSeason(value) {
  return formatSeasonYear(value) == null
}

/**
 * NFL season year from a kickoff instant. January and February ET belong
 * to the prior year (playoffs / Super Bowl).
 */
export function nflSeasonYearFromDate(date, { timeZone = NFL_SEASON_TZ } = {}) {
  const instant = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null
  const seasonYear = month <= 2 ? year - 1 : year
  return formatSeasonYear(seasonYear)
}

export function resolveNflGameSeason({ event, date } = {}) {
  return formatSeasonYear(espnEventSeasonYear(event)) || nflSeasonYearFromDate(date)
}

export function parseBackfillNflGameSeasonArgs(argv = []) {
  const out = {
    apply: false,
    json: false,
    help: false,
    limit: 2000,
    unknown: [],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--apply') out.apply = true
    else if (arg === '--dry-run') out.apply = false
    else if (arg === '--json') out.json = true
    else if (arg === '--limit') {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n > 0) out.limit = Math.floor(n)
    } else {
      out.unknown.push(arg)
    }
  }
  return out
}

export function planNflSeasonBackfill(rows = []) {
  const planned = []
  const skipped = []
  for (const row of rows || []) {
    if (String(row?.sport || '').toLowerCase() !== 'nfl') {
      skipped.push({ id: row?.id, reason: 'not_nfl' })
      continue
    }
    if (!isMissingNflSeason(row?.season)) {
      skipped.push({ id: row?.id, reason: 'season_present', season: formatSeasonYear(row.season) })
      continue
    }
    const season = nflSeasonYearFromDate(row.date)
    if (!season) {
      skipped.push({ id: row.id, date: row.date, reason: 'unparseable_date' })
      continue
    }
    planned.push({
      id: row.id,
      date: row.date,
      priorSeason: row.season ?? null,
      season,
    })
  }
  return {
    planned,
    skipped,
    count: planned.length,
    bySeason: tallyBySeason(planned),
  }
}

function tallyBySeason(planned) {
  const counts = {}
  for (const row of planned) {
    counts[row.season] = (counts[row.season] || 0) + 1
  }
  return counts
}

export function nflSeasonBackupFileName(now = new Date()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  return `nfl-game-season-${stamp}.json`
}

export async function runBackfillNflGameSeason({
  argv = [],
  supabase,
  now = new Date(),
  log = console,
  writeFile = writeFileSync,
  mkdir = mkdirSync,
  backupDir = NFL_SEASON_BACKUP_DIR,
  cwd = process.cwd(),
} = {}) {
  const args = parseBackfillNflGameSeasonArgs(argv)
  if (args.help) {
    log.log?.(NFL_SEASON_BACKFILL_USAGE)
    return { exitCode: 0, help: true, applied: 0, planned: [] }
  }
  if (args.unknown.length) {
    log.error?.(`Unknown argument(s): ${args.unknown.join(' ')}`)
    log.error?.(NFL_SEASON_BACKFILL_USAGE)
    return { exitCode: 2, error: 'unknown_args', applied: 0, planned: [] }
  }

  if (!supabase) throw new Error('supabase client is required')

  const { data, error } = await supabase
    .from('Game')
    .select('id, sport, date, season')
    .eq('sport', 'nfl')
    .or('season.is.null,season.eq.')
    .order('date', { ascending: true })
    .limit(args.limit)

  if (error) throw new Error(`NFL Game lookup failed: ${error.message}`)

  const plan = planNflSeasonBackfill(data || [])
  const result = {
    apply: args.apply,
    dryRun: !args.apply,
    count: plan.count,
    bySeason: plan.bySeason,
    planned: plan.planned,
    skipped: plan.skipped,
    applied: 0,
    backupPath: null,
  }

  if (args.json) {
    log.log?.(JSON.stringify({
      dryRun: result.dryRun,
      count: plan.count,
      bySeason: plan.bySeason,
      planned: plan.planned,
      skipped: plan.skipped,
    }, null, 2))
  } else {
    log.log?.(args.apply ? 'MODE: APPLY' : 'MODE: DRY-RUN')
    log.log?.(`📌 NFL games missing season: ${plan.count}`)
    log.log?.(`📌 Proposed season counts: ${JSON.stringify(plan.bySeason)}`)
    log.log?.('   (eligibility gates are unchanged)')
    for (const row of plan.planned.slice(0, 25)) {
      log.log?.(`  ${row.id} ${row.date} → ${row.season}`)
    }
    if (plan.planned.length > 25) {
      log.log?.(`  … ${plan.planned.length - 25} more`)
    }
    for (const row of plan.skipped) {
      if (row.reason === 'unparseable_date') {
        log.log?.(`  skip ${row.id}: ${row.reason}`)
      }
    }
  }

  if (!args.apply) {
    log.log?.('   Dry-run: no writes. Pass --apply to update.')
    return { ...result, exitCode: 0 }
  }

  if (isOpsWriteQuietPeriod(now)) {
    log.warn?.('Refuse --apply during ops quiet window (:05–:15 ET)')
    return { ...result, exitCode: 1, refused: true, reason: 'ops_quiet_period' }
  }

  if (plan.count === 0) {
    log.log?.('✅ No null-season NFL games to backfill')
    return { ...result, exitCode: 0 }
  }

  const fileName = nflSeasonBackupFileName(now)
  const backupPath = join(cwd, backupDir, fileName)
  mkdir(join(cwd, backupDir), { recursive: true })
  writeFile(backupPath, JSON.stringify({
    writtenAt: new Date(now).toISOString(),
    sport: 'nfl',
    rows: data || [],
    planned: plan.planned,
  }, null, 2))
  result.backupPath = backupPath
  log.log?.(`💾 Backup: ${backupPath}`)

  let applied = 0
  const errors = []
  for (const row of plan.planned) {
    const update = await supabase
      .from('Game')
      .update({ season: row.season })
      .eq('id', row.id)
      .eq('sport', 'nfl')
      .select('id')
    if (update?.error) {
      errors.push({ id: row.id, error: update.error.message })
      continue
    }
    if (update?.data?.length) applied += 1
  }
  result.applied = applied
  result.errors = errors
  log.log?.(`✅ Backfilled season on ${applied} NFL Game rows`)
  return { ...result, exitCode: errors.length ? 1 : 0 }
}
