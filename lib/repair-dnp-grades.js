/**
 * Preview / apply helpers for voiding player props graded as 0 when the
 * player did not appear. Dry-run is the default. Writes require --apply.
 */

import { voidPropValidationPatch } from './game-grade-eligibility.js'
import { propValidationGradeAudit } from './grade-audit.js'
import { GAME_LINE_SOURCE } from './game-lines.js'
import { isZeroActual, planPlayerAppearanceGrade } from './player-stat-grade.js'
import {
  PUBLISHED_STATS_SELECT,
  summarizePublishedPicks,
} from './published-picks.js'
import { isAlreadyVoided } from './unplayed-game-grades.js'

export const REPAIR_GRADE_SOURCE = 'repair-dnp-grades'
export const DNP_REPAIR_SPORTS = Object.freeze(['mlb', 'nhl'])

export function parseRepairDnpArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const take = (flag) => {
    const i = args.indexOf(flag)
    if (i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith('--')) return args[i + 1]
    return null
  }
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply')
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
    sport: take('--sport'),
    csv: take('--csv'),
    backupDir: take('--backup-dir'),
  }
}

export function isDnpRepairCandidate(row) {
  if (!row) return false
  if (isAlreadyVoided(row)) return false
  if (String(row.source || '').toLowerCase() === GAME_LINE_SOURCE) return false
  if (String(row.status || '').toLowerCase() !== 'completed') return false
  const sport = String(row.sport || '').toLowerCase()
  if (!DNP_REPAIR_SPORTS.includes(sport)) return false
  const result = String(row.result || '').toLowerCase()
  if (!['correct', 'incorrect', 'push', 'pushed', 'win', 'won', 'loss', 'lost'].includes(result)) {
    return false
  }
  return isZeroActual(row.actualValue)
}

export function buildDnpRepairPreview(row, lookup) {
  const plan = planPlayerAppearanceGrade(lookup)
  const oldResult = row?.result ?? null
  const base = {
    id: row?.id,
    player: row?.playerName,
    prop: row?.propType,
    game: row?.gameIdRef,
    sport: row?.sport,
    prediction: row?.prediction,
    threshold: row?.threshold,
    odds: row?.odds,
    oldResult,
    oldStatus: row?.status ?? null,
    oldActual: row?.actualValue ?? null,
    reason: plan.reason,
  }

  if (isAlreadyVoided(row)) {
    return { ...base, skip: true, skipReason: 'already_void', newResult: 'void', newStatus: 'manual_closed' }
  }
  if (plan.action !== 'void') {
    return {
      ...base,
      skip: true,
      skipReason: plan.reason || 'appeared',
      newResult: oldResult,
      newStatus: row?.status ?? null,
    }
  }
  return {
    ...base,
    skip: false,
    skipReason: null,
    newResult: 'void',
    newStatus: 'manual_closed',
    reason: plan.reason,
  }
}

export function shouldApplyDnpPreview(preview) {
  return Boolean(preview && !preview.skip)
}

export function summarizeDnpPreviews(previews) {
  return (previews || []).reduce((acc, row) => {
    acc.total += 1
    if (row.skip) {
      acc.skipped += 1
      if (row.skipReason === 'already_void') acc.alreadyVoid += 1
      if (row.skipReason === 'appeared') acc.appeared += 1
      if (row.skipReason === 'stat_not_found' || row.skipReason === 'stat_missing') acc.unmatched += 1
    } else {
      acc.ready += 1
      if (row.reason === 'no_plate_appearances') acc.noPa += 1
      if (row.reason === 'no_batters_faced') acc.noBf += 1
      if (row.reason === 'not_in_box') acc.notInBox += 1
      if (row.reason === 'zero_toi') acc.zeroToi += 1
      if (String(row.oldResult).toLowerCase() === 'incorrect') acc.wasLoss += 1
      if (['correct', 'win', 'won'].includes(String(row.oldResult).toLowerCase())) acc.wasWin += 1
    }
    return acc
  }, {
    total: 0,
    ready: 0,
    skipped: 0,
    alreadyVoid: 0,
    appeared: 0,
    unmatched: 0,
    noPa: 0,
    noBf: 0,
    notInBox: 0,
    zeroToi: 0,
    wasLoss: 0,
    wasWin: 0,
  })
}

export function dnpRepairApplyPayload(row, preview, game, now = new Date()) {
  return {
    ...voidPropValidationPatch(now, game, `DNP: ${preview.reason}`),
    ...propValidationGradeAudit(now, {
      gradedBy: 'system',
      gradeSource: REPAIR_GRADE_SOURCE,
    }),
  }
}

export function publishedSummariesAfterVoids(publishedRows, voidIds) {
  const ids = voidIds instanceof Set ? voidIds : new Set(voidIds || [])
  const before = summarizePublishedPicks(publishedRows)
  const afterRows = (publishedRows || []).map((row) => (
    ids.has(row.id)
      ? { ...row, status: 'manual_closed', result: 'void', actualValue: null }
      : row
  ))
  return { before, after: summarizePublishedPicks(afterRows) }
}

export function parseDnpCsvIds(text) {
  const ids = new Set()
  const lines = String(text || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    const id = line.split(',')[0].trim()
    if (!id || id === 'id' || id.toLowerCase() === 'id') continue
    ids.add(id)
  }
  return ids
}

export function compareRepairIdsToCsv(repairIds, csvIds) {
  const repair = new Set(repairIds || [])
  const csv = csvIds instanceof Set ? csvIds : new Set(csvIds || [])
  const both = []
  const onlyInRepair = []
  const onlyInCsv = []
  for (const id of repair) {
    if (csv.has(id)) both.push(id)
    else onlyInRepair.push(id)
  }
  for (const id of csv) {
    if (!repair.has(id)) onlyInCsv.push(id)
  }
  both.sort()
  onlyInRepair.sort()
  onlyInCsv.sort()
  return {
    both,
    onlyInRepair,
    onlyInCsv,
    repairCount: repair.size,
    csvCount: csv.size,
  }
}

export function formatPublishedRecord(summary) {
  if (!summary) return '0–0'
  return summary.record || '0–0'
}

export function describePublishedDelta(before, after) {
  return {
    beforeRecord: formatPublishedRecord(before),
    afterRecord: formatPublishedRecord(after),
    beforeDecided: before?.decided ?? 0,
    afterDecided: after?.decided ?? 0,
    beforeUnits: before?.units ?? 0,
    afterUnits: after?.units ?? 0,
    unitsDelta: (after?.units ?? 0) - (before?.units ?? 0),
  }
}

export { PUBLISHED_STATS_SELECT }
