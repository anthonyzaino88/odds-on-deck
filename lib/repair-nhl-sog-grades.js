/**
 * Preview / apply helpers for repairing graded NHL shots-on-goal rows.
 * Default is dry-run. Writes require an explicit --apply flag.
 */

import { propValidationGradeAudit } from './grade-audit.js'
import { isGradeableNhlStatResult } from './nhl-stat-grade.js'

export const REPAIR_GRADE_SOURCE = 'repair-nhl-sog-2026-10'

export const NHL_SOG_PROP_TYPES = Object.freeze([
  'shots_on_goal',
  'player_shots_on_goal',
  'sog',
  'player_sog',
])

export function parseRepairArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply')
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
  }
}

export function isNhlSogValidation(row) {
  if (String(row?.sport || '').toLowerCase() !== 'nhl') return false
  return NHL_SOG_PROP_TYPES.includes(String(row?.propType || '').toLowerCase())
}

export function gradeFromActual(prediction, threshold, actualValue) {
  if (actualValue === threshold) return 'push'
  const pick = String(prediction || '').toLowerCase()
  if (
    (pick === 'over' && actualValue > threshold)
    || (pick === 'under' && actualValue < threshold)
  ) {
    return 'correct'
  }
  return 'incorrect'
}

export function buildRepairPreviewRow(row, lookup) {
  const gradeable = isGradeableNhlStatResult(lookup)
  const newActual = gradeable ? lookup.value : null
  const newResult = gradeable ? gradeFromActual(row.prediction, row.threshold, newActual) : null
  const oldResult = row.result ?? null
  const flips = Boolean(gradeable && oldResult != null && newResult !== oldResult)

  let skipReason = null
  if (!gradeable) {
    if (lookup && lookup.gameFinal === false) skipReason = 'not_final'
    else if (lookup?.matchStatus === 'ambiguous') skipReason = 'ambiguous'
    else if (lookup?.matchStatus !== 'matched') skipReason = 'unmatched'
    else if (!lookup?.statFound) skipReason = 'stat_missing'
    else skipReason = 'unmatched'
  }

  return {
    id: row.id,
    player: row.playerName,
    team: lookup?.team || row.team || '',
    game: row.gameIdRef,
    line: row.threshold,
    pick: row.prediction,
    oldActual: row.actualValue,
    newActual,
    oldResult,
    newResult,
    flips: flips ? 'yes' : 'no',
    skip: !gradeable,
    skipReason,
  }
}

export function isUnchangedRepairPreview(preview) {
  return Boolean(
    preview
    && preview.oldActual === preview.newActual
    && preview.oldResult === preview.newResult,
  )
}

export function shouldApplyRepairPreview(preview) {
  if (!preview || preview.skip) return false
  return !isUnchangedRepairPreview(preview)
}

export function summarizeRepairRows(rows) {
  return (rows || []).reduce((acc, row) => {
    acc.total += 1
    if (row.skip) acc.skipped += 1
    else acc.ready += 1
    if (isUnchangedRepairPreview(row) && !row.skip) acc.unchanged += 1
    if (row.flips === 'yes') acc.flips += 1
    if (!row.skip && row.oldActual !== row.newActual) acc.actualChanged += 1
    if (row.skipReason === 'unmatched') acc.unmatched += 1
    if (row.skipReason === 'ambiguous') acc.ambiguous += 1
    return acc
  }, {
    total: 0,
    ready: 0,
    skipped: 0,
    unchanged: 0,
    flips: 0,
    actualChanged: 0,
    unmatched: 0,
    ambiguous: 0,
  })
}

export function flippingRepairRows(previews, sogRows) {
  const flipIds = new Set((previews || []).filter((row) => row.flips === 'yes').map((row) => row.id))
  return (sogRows || []).filter((row) => flipIds.has(row.id))
}

export function legReferencesValidation(leg, row) {
  if (!leg || !row) return false
  return String(leg.playerName || '').toLowerCase() === String(row.playerName || '').toLowerCase()
    && String(leg.propType || '').toLowerCase() === String(row.propType || '').toLowerCase()
    && String(leg.gameIdRef || '') === String(row.gameIdRef || '')
}

export function matchFlippedParlayRefs(flippingRows, legs = []) {
  const parlayLegIds = []
  const parlayHistoryIds = []
  const seenLegs = new Set()
  const seenParlays = new Set()

  for (const row of flippingRows || []) {
    if (row.parlayId && !seenParlays.has(row.parlayId)) {
      seenParlays.add(row.parlayId)
      parlayHistoryIds.push(row.parlayId)
    }
    for (const leg of legs) {
      if (seenLegs.has(leg.id) || !legReferencesValidation(leg, row)) continue
      seenLegs.add(leg.id)
      parlayLegIds.push(leg.id)
      if (leg.parlayId && !seenParlays.has(leg.parlayId)) {
        seenParlays.add(leg.parlayId)
        parlayHistoryIds.push(leg.parlayId)
      }
    }
  }

  return { parlayLegIds, parlayHistoryIds }
}

export function repairTableRecords(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    player: row.player,
    team: row.team,
    game: row.game,
    line: row.line,
    pick: row.pick,
    'old actual': row.oldActual,
    'new actual': row.newActual,
    'old result': row.oldResult,
    'new result': row.newResult,
    flips: row.flips,
  }))
}

export function repairApplyPayload(row, preview, now = new Date()) {
  return {
    actualValue: preview.newActual,
    result: preview.newResult,
    status: 'completed',
    notes: `Repair NHL SOG: ${String(row.prediction || '').toUpperCase()} ${row.threshold} → Actual: ${preview.newActual} (was ${row.actualValue})`,
    completedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    ...propValidationGradeAudit(now, {
      gradedBy: 'system',
      gradeSource: REPAIR_GRADE_SOURCE,
    }),
  }
}
