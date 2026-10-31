/**
 * Preview / apply helpers for regrading PropValidation rows that are
 * still needs_review. Dry-run is the default. Writes require
 * --apply --confirm <plan-hash>.
 *
 * Rollback: each apply writes a full-row JSONL backup under
 * operations/backups/. Restore a row by updating PropValidation with
 * the backed-up fields (status, result, actualValue, notes, audit)
 * keyed by id.
 */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { voidPropValidationPatch } from './game-grade-eligibility.js'
import { propValidationGradeAudit } from './grade-audit.js'
import { isOpsWriteQuietPeriod } from './mlb-recording-window.js'
import {
  appearanceGradeContext,
  gradePropFromActual,
  planPlayerAppearanceGrade,
} from './player-stat-grade.js'
import { withPreservedCohortNotes } from './published-picks.js'
import { chunkIds, etDayEndExclusiveUtc, etDayStartUtc, paginateSupabaseSelect } from './unplayed-game-grades.js'

export const REGRADE_GRADE_SOURCE = 'regrade_needs_review'
export const REGRADE_REQUIRED_SOURCE = 'system_generated'
export const REGRADE_BATCH_SIZE = 25
export const REGRADE_SPORTS = Object.freeze(['mlb', 'nhl', 'nfl'])
export const REGRADE_PLAN_CSV_HEADER = [
  'id',
  'sport',
  'player',
  'prop',
  'game',
  'oldStatus',
  'action',
  'newStatus',
  'newResult',
  'actualValue',
  'reason',
].join(',')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function takeFlag(args, flag) {
  const i = args.indexOf(flag)
  if (i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith('--')) return args[i + 1]
  return null
}

function takeAllFlags(args, flag) {
  const values = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1] && !String(args[i + 1]).startsWith('--')) {
      values.push(args[i + 1])
    }
  }
  return values
}

function parseIdList(raw) {
  const ids = []
  for (const chunk of raw) {
    for (const part of String(chunk).split(',')) {
      const id = part.trim()
      if (id) ids.push(id)
    }
  }
  return [...new Set(ids)]
}

export function parseRegradeNeedsReviewArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply')
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
    sport: takeFlag(args, '--sport'),
    source: takeFlag(args, '--source'),
    from: takeFlag(args, '--from'),
    to: takeFlag(args, '--to'),
    confirm: takeFlag(args, '--confirm'),
    backupDir: takeFlag(args, '--backup-dir'),
    ids: parseIdList(takeAllFlags(args, '--ids')),
  }
}

export function validateRegradeNeedsReviewArgs(args) {
  if (!args || args.help) return { ok: true }
  const sport = String(args.sport || '').toLowerCase().trim()
  if (!sport) return { ok: false, error: '--sport is required (mlb|nhl|nfl)' }
  if (!REGRADE_SPORTS.includes(sport)) {
    return { ok: false, error: `Unknown --sport ${args.sport}. Use mlb, nhl, or nfl.` }
  }
  const source = String(args.source || '').trim()
  if (!source) return { ok: false, error: '--source is required and must be system_generated' }
  if (source !== REGRADE_REQUIRED_SOURCE) {
    return { ok: false, error: `--source must be ${REGRADE_REQUIRED_SOURCE}` }
  }
  const hasIds = Array.isArray(args.ids) && args.ids.length > 0
  const hasFrom = Boolean(args.from)
  const hasTo = Boolean(args.to)
  if (!hasIds && !(hasFrom && hasTo)) {
    return { ok: false, error: 'Provide --ids or a --from/--to date range' }
  }
  if ((hasFrom && !DATE_RE.test(args.from)) || (hasTo && !DATE_RE.test(args.to))) {
    return { ok: false, error: '--from and --to must be YYYY-MM-DD' }
  }
  if (hasFrom && hasTo && args.from > args.to) {
    return { ok: false, error: '--from must be on or before --to' }
  }
  return { ok: true, sport, source }
}

export function csvEscape(value) {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function formatRegradePlanCsv(planRows) {
  const lines = [REGRADE_PLAN_CSV_HEADER]
  for (const row of planRows || []) {
    lines.push([
      row.id,
      row.sport,
      row.player,
      row.prop,
      row.game,
      row.oldStatus,
      row.action,
      row.newStatus,
      row.newResult,
      row.actualValue,
      row.reason,
    ].map(csvEscape).join(','))
  }
  return `${lines.join('\n')}\n`
}

export function regradePlanHash(planRows) {
  const payload = (planRows || []).map((row) => ({
    id: row.id,
    action: row.action,
    newStatus: row.newStatus,
    newResult: row.newResult,
    actualValue: row.actualValue ?? null,
    reason: row.reason,
  }))
  payload.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function summarizeRegradePlan(planRows) {
  return (planRows || []).reduce((acc, row) => {
    acc.total += 1
    if (row.action === 'void') acc.voids += 1
    else if (row.action === 'grade') acc.grades += 1
    else acc.skipped += 1
    return acc
  }, { total: 0, voids: 0, grades: 0, skipped: 0 })
}

export function buildRegradePreview(row, lookup, game, context = {}) {
  const sport = String(row?.sport || game?.sport || context.sport || '').toLowerCase()
  const ctx = {
    sport,
    gameFinal: context.gameFinal,
    gameIdVerified: context.gameIdVerified,
  }
  const base = {
    id: row?.id,
    sport,
    player: row?.playerName,
    prop: row?.propType,
    game: row?.gameIdRef,
    oldStatus: row?.status ?? 'needs_review',
    prediction: row?.prediction,
    threshold: row?.threshold,
  }

  if (sport === 'nfl' && (lookup == null || typeof lookup === 'number')) {
    if (lookup == null) {
      return {
        ...base,
        action: 'skip',
        newStatus: 'needs_review',
        newResult: row?.result ?? null,
        actualValue: null,
        reason: 'not_in_box',
      }
    }
    const result = gradePropFromActual(row?.prediction, row?.threshold, lookup)
    return {
      ...base,
      action: 'grade',
      newStatus: 'completed',
      newResult: result,
      actualValue: lookup,
      reason: 'appeared',
    }
  }

  const plan = planPlayerAppearanceGrade(lookup, ctx)
  if (plan.action === 'void') {
    return {
      ...base,
      action: 'void',
      newStatus: 'manual_closed',
      newResult: 'void',
      actualValue: null,
      reason: plan.reason,
    }
  }
  if (plan.action === 'grade') {
    const result = gradePropFromActual(row?.prediction, row?.threshold, plan.actualValue)
    return {
      ...base,
      action: 'grade',
      newStatus: 'completed',
      newResult: result,
      actualValue: plan.actualValue,
      reason: plan.reason,
    }
  }
  return {
    ...base,
    action: 'skip',
    newStatus: 'needs_review',
    newResult: row?.result ?? null,
    actualValue: row?.actualValue ?? null,
    reason: plan.reason,
  }
}

export function regradeApplyPayload(row, preview, game, now = new Date()) {
  const audit = propValidationGradeAudit(now, {
    gradedBy: 'system',
    gradeSource: REGRADE_GRADE_SOURCE,
  })
  if (preview.action === 'void') {
    const voidPatch = voidPropValidationPatch(now, game, `DNP: ${preview.reason}`)
    return {
      ...voidPatch,
      notes: withPreservedCohortNotes(row?.notes, voidPatch.notes),
      ...audit,
    }
  }
  if (preview.action === 'grade') {
    return {
      actualValue: preview.actualValue,
      result: preview.newResult,
      status: 'completed',
      completedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
      notes: withPreservedCohortNotes(
        row?.notes,
        `Regraded: ${String(row?.prediction || '').toUpperCase()} ${row?.threshold} → Actual: ${preview.actualValue}`,
      ),
      ...audit,
    }
  }
  return null
}

export function writableRegradePreviews(planRows) {
  return (planRows || []).filter((row) => row.action === 'void' || row.action === 'grade')
}

export const REGRADE_USAGE = `Usage:
  node --conditions=react-server operations/regrade-needs-review.mjs --sport mlb|nhl|nfl --source system_generated (--ids ID[,ID] | --from YYYY-MM-DD --to YYYY-MM-DD)
  node --conditions=react-server operations/regrade-needs-review.mjs ... --apply --confirm <plan-hash>

Dry-run (default): look up box scores for needs_review system_generated
rows, write a plan CSV to operations/backups/, print the plan hash.
--apply --confirm <plan-hash>: write voids/grades. Requires the hash from
the plan CSV. Refuses :05–:15 ET. Batches of 25. Updates only rows that
are still status=needs_review.

Rollback: restore each line of the JSONL backup onto PropValidation by id
(status, result, actualValue, notes, completedAt, audit fields).`

function stampForFile(now) {
  return (now instanceof Date ? now : new Date(now)).toISOString().replace(/[:.]/g, '-')
}

async function countNeedsReviewIds(supabase, ids) {
  let total = 0
  for (const chunk of chunkIds(ids, 200)) {
    const { count, error } = await supabase
      .from('PropValidation')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'needs_review')
      .in('id', chunk)
    if (error) return { count: null, error }
    total += Number(count) || 0
  }
  return { count: total, error: null }
}

async function recountStatuses(supabase, { sport, source }) {
  const counts = { needs_review: 0, completed: 0, manual_closed: 0, pending: 0, other: 0 }
  const page = await paginateSupabaseSelect(() => supabase
    .from('PropValidation')
    .select('id, status')
    .eq('sport', sport)
    .eq('source', source)
    .order('id', { ascending: true }))
  if (page.error) return { counts, error: page.error }
  for (const row of page.rows || []) {
    const status = String(row.status || '')
    if (status in counts) counts[status] += 1
    else counts.other += 1
  }
  return { counts, error: null }
}

export async function runRegradeNeedsReview({
  argv = [],
  createClient,
  now = new Date(),
  log = console,
  writeFile,
  mkdir,
  isQuietPeriod = isOpsWriteQuietPeriod,
  lookupMlb,
  lookupNhl,
  lookupNfl,
  fetchMlbBoxscore,
  sleep = async () => {},
} = {}) {
  const args = parseRegradeNeedsReviewArgs(argv)
  if (args.help) {
    log.log(REGRADE_USAGE)
    return { exitCode: 0, plan: [], summary: summarizeRegradePlan([]) }
  }

  const valid = validateRegradeNeedsReviewArgs(args)
  if (!valid.ok) {
    log.error(valid.error)
    return { exitCode: 2, plan: [], summary: summarizeRegradePlan([]), error: valid.error }
  }

  const sport = valid.sport
  const source = valid.source
  const supabase = await createClient()

  let query = () => {
    let q = supabase
      .from('PropValidation')
      .select('*')
      .eq('status', 'needs_review')
      .eq('sport', sport)
      .eq('source', source)
      .order('id', { ascending: true })
    if (args.ids.length) q = q.in('id', args.ids)
    if (args.from) q = q.gte('timestamp', etDayStartUtc(args.from).toISOString())
    if (args.to) q = q.lt('timestamp', etDayEndExclusiveUtc(args.to).toISOString())
    return q
  }

  const page = await paginateSupabaseSelect(query)
  if (page.error) {
    log.error(`Query error: ${page.error.message}`)
    return { exitCode: 1, plan: [], summary: summarizeRegradePlan([]) }
  }

  const rows = page.rows || []
  const gameIds = [...new Set(rows.map((row) => row.gameIdRef).filter(Boolean))]
  const gameMap = new Map()
  for (const chunk of chunkIds(gameIds, 200)) {
    const { data: games } = await supabase
      .from('Game')
      .select('id, sport, status, mlbGameId, espnGameId, homeScore, awayScore, date, homeTeam, awayTeam')
      .in('id', chunk)
    if (games) games.forEach((game) => gameMap.set(game.id, game))
  }

  const mlbCache = new Map()
  const plan = []

  for (const row of rows) {
    const game = gameMap.get(row.gameIdRef)
    const usedId = sport === 'mlb' ? game?.mlbGameId : game?.espnGameId
    const context = appearanceGradeContext(game, sport, usedId)
    let lookup = null

    if (sport === 'mlb') {
      if (!game?.mlbGameId) {
        lookup = { didNotPlay: false, reason: 'not_in_box', matchStatus: 'unmatched', value: null }
      } else if (fetchMlbBoxscore) {
        if (!mlbCache.has(game.mlbGameId)) {
          mlbCache.set(game.mlbGameId, await fetchMlbBoxscore(game.mlbGameId))
        }
        const players = mlbCache.get(game.mlbGameId)
        lookup = players && lookupMlb
          ? lookupMlb(players, row.playerName, row.propType)
          : { didNotPlay: false, reason: 'stat_not_found', value: null }
      } else if (lookupMlb) {
        lookup = await lookupMlb(game.mlbGameId, row.playerName, row.propType)
      } else {
        lookup = { didNotPlay: false, reason: 'stat_not_found', value: null }
      }
      plan.push(buildRegradePreview(row, lookup, game, context))
    } else if (sport === 'nhl') {
      if (!game?.espnGameId) {
        lookup = { didNotPlay: false, reason: 'not_in_box', matchStatus: 'unmatched', value: null, gameFinal: false }
      } else if (lookupNhl) {
        lookup = await lookupNhl(
          game.espnGameId,
          row.playerName,
          row.propType,
          row.gameIdRef,
          { playerId: row.playerId, team: row.team },
        )
      } else {
        lookup = { didNotPlay: false, reason: 'stat_not_found', value: null }
      }
      plan.push(buildRegradePreview(row, lookup, game, context))
    } else {
      const nflValue = game?.espnGameId && lookupNfl
        ? await lookupNfl(game.espnGameId, row.playerName, row.propType)
        : null
      plan.push(buildRegradePreview(row, nflValue, game, context))
    }
  }

  const summary = summarizeRegradePlan(plan)
  const hash = regradePlanHash(plan)
  const writable = writableRegradePreviews(plan)
  const backupDir = args.backupDir
    ? resolve(args.backupDir)
    : resolve('operations', 'backups')
  const stamp = stampForFile(now)
  const planPath = resolve(backupDir, `regrade-needs-review-${stamp}-plan.csv`)

  if (mkdir && writeFile) {
    mkdir(backupDir, { recursive: true })
    writeFile(planPath, formatRegradePlanCsv(plan))
  }

  log.log('\nREGRADE NEEDS_REVIEW')
  log.log('='.repeat(60))
  log.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN (default)'}`)
  log.log(`Sport: ${sport}   source: ${source}`)
  log.log(`Candidates: ${rows.length}`)
  log.log(`Would void: ${summary.voids}   would grade: ${summary.grades}   skip: ${summary.skipped}`)
  log.log(`Plan hash: ${hash}`)
  if (planPath) log.log(`Plan CSV: ${planPath}`)

  for (const preview of plan) {
    if (preview.action === 'skip') continue
    log.log(`  ${args.apply ? 'WRITE' : 'would write'} ${preview.id} ${preview.player} ${preview.prop} ${preview.action} ${preview.reason}`)
  }

  if (!args.apply) {
    log.log('\nDry-run only. Pass --apply --confirm <plan-hash> to write.')
    log.log('Rollback: restore each JSONL backup line onto PropValidation by id.')
    return {
      exitCode: 0,
      plan,
      summary,
      hash,
      planPath,
      applied: 0,
    }
  }

  if (isQuietPeriod(now)) {
    log.error('Refuse --apply during ops quiet window (:05–:15 ET)')
    return { exitCode: 1, plan, summary, hash, planPath, applied: 0, quiet: true }
  }

  if (!args.confirm || args.confirm !== hash) {
    log.error('Refuse --apply without --confirm <plan-hash> matching this plan')
    return { exitCode: 1, plan, summary, hash, planPath, applied: 0, confirmMismatch: true }
  }

  const writeIds = writable.map((row) => row.id)
  const beforeCount = await countNeedsReviewIds(supabase, writeIds)
  if (beforeCount.error) {
    log.error(`Count check failed: ${beforeCount.error.message}`)
    return { exitCode: 1, plan, summary, hash, applied: 0 }
  }
  if (beforeCount.count !== writeIds.length) {
    log.error(`Row-count mismatch before backup: expected ${writeIds.length} needs_review, found ${beforeCount.count}`)
    return { exitCode: 1, plan, summary, hash, applied: 0, countMismatch: true }
  }

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const backupPath = resolve(backupDir, `regrade-needs-review-${stamp}-rows.jsonl`)
  if (mkdir && writeFile) {
    mkdir(backupDir, { recursive: true })
    const jsonl = writeIds.map((id) => JSON.stringify(rowById.get(id))).join('\n')
    writeFile(backupPath, jsonl ? `${jsonl}\n` : '')
    log.log(`\nBackup JSONL: ${backupPath}`)
    log.log('Rollback: update PropValidation by id with each JSONL line\'s fields.')
  }

  const afterBackupCount = await countNeedsReviewIds(supabase, writeIds)
  if (afterBackupCount.error || afterBackupCount.count !== writeIds.length) {
    log.error(`Row-count mismatch after backup: expected ${writeIds.length}, found ${afterBackupCount.count}`)
    return { exitCode: 1, plan, summary, hash, backupPath, applied: 0, countMismatch: true }
  }

  let applied = 0
  let applyErrors = 0
  const { updateWithOptionalAudit } = await import('./grade-audit.js')

  for (const batch of chunkIds(writable, REGRADE_BATCH_SIZE)) {
    if (isQuietPeriod(new Date())) {
      log.error('Refuse remaining writes during ops quiet window (:05–:15 ET)')
      return {
        exitCode: 1,
        plan,
        summary,
        hash,
        backupPath,
        applied,
        quiet: true,
      }
    }
    for (const preview of batch) {
      const row = rowById.get(preview.id)
      const game = gameMap.get(row?.gameIdRef)
      const payload = regradeApplyPayload(row, preview, game, now)
      if (!payload) continue
      const write = await updateWithOptionalAudit(
        (next) => supabase
          .from('PropValidation')
          .update(next)
          .eq('id', row.id)
          .eq('status', 'needs_review'),
        payload,
      )
      if (write?.error) {
        applyErrors += 1
        log.error(`Write failed for ${row.id}: ${write.error.message}`)
        continue
      }
      applied += 1
      log.log(`OK ${row.id} ${preview.action} ${preview.reason}`)
      if (sleep) await sleep(0)
    }
  }

  const recount = await recountStatuses(supabase, { sport, source })
  log.log('\nPost-run status recount (same sport + source):')
  log.log(`  needs_review: ${recount.counts.needs_review}`)
  log.log(`  completed: ${recount.counts.completed}`)
  log.log(`  manual_closed: ${recount.counts.manual_closed}`)
  log.log(`  pending: ${recount.counts.pending}`)
  log.log(`Applied ${applied}; ${summary.skipped} skipped; ${applyErrors} error(s).`)
  log.log('Rollback: restore each JSONL backup line onto PropValidation by id.')

  return {
    exitCode: applyErrors ? 1 : 0,
    plan,
    summary,
    hash,
    planPath,
    backupPath,
    applied,
    recount: recount.counts,
  }
}
