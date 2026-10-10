/**
 * Restore PropValidation rows from a DNP repair JSON backup.
 * Dry-run is the default. Writes require --apply.
 */

export const DNP_RESTORE_FIELDS = Object.freeze([
  'result',
  'status',
  'actualValue',
  'completedAt',
  'notes',
  'updatedAt',
  'gradedAt',
  'gradedBy',
  'gradeSource',
])

export function parseRestoreDnpArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const take = (flag) => {
    const i = args.indexOf(flag)
    if (i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith('--')) return args[i + 1]
    return null
  }
  const flaggedValues = new Set()
  for (const flag of ['--backup', '--csv', '--sport', '--backup-dir']) {
    const value = take(flag)
    if (value) flaggedValues.add(value)
  }
  const positional = args.find((arg) => arg && !String(arg).startsWith('--') && !flaggedValues.has(arg))
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply')
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
    backup: take('--backup') || positional || null,
  }
}

export function parseDnpBackupJson(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text || ''))
  } catch (error) {
    throw new Error(`Invalid backup JSON: ${error.message}`)
  }
  const rows = Array.isArray(parsed) ? parsed : parsed?.rows
  if (!Array.isArray(rows)) {
    throw new Error('Backup JSON must be an array of PropValidation rows')
  }
  return rows.filter((row) => row && row.id)
}

export function restorePayloadFromBackupRow(row) {
  const payload = {}
  for (const key of DNP_RESTORE_FIELDS) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      payload[key] = row[key]
    }
  }
  return payload
}

export function isUnchangedRestore(current, payload) {
  if (!payload || Object.keys(payload).length === 0) return true
  return DNP_RESTORE_FIELDS.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return true
    return current?.[key] === payload[key]
  })
}

export function buildRestorePreview(backupRow, current) {
  const payload = restorePayloadFromBackupRow(backupRow)
  if (!current) {
    return {
      id: backupRow?.id,
      player: backupRow?.playerName,
      prop: backupRow?.propType,
      game: backupRow?.gameIdRef,
      oldResult: null,
      oldStatus: null,
      newResult: payload.result ?? null,
      newStatus: payload.status ?? null,
      oldActual: null,
      newActual: Object.prototype.hasOwnProperty.call(payload, 'actualValue') ? payload.actualValue : null,
      skip: true,
      skipReason: 'missing_current',
      payload,
    }
  }
  const skip = isUnchangedRestore(current, payload)
  return {
    id: backupRow?.id,
    player: backupRow?.playerName || current.playerName,
    prop: backupRow?.propType || current.propType,
    game: backupRow?.gameIdRef || current.gameIdRef,
    oldResult: current.result ?? null,
    oldStatus: current.status ?? null,
    newResult: payload.result ?? null,
    newStatus: payload.status ?? null,
    oldActual: current.actualValue ?? null,
    newActual: Object.prototype.hasOwnProperty.call(payload, 'actualValue') ? payload.actualValue : null,
    skip,
    skipReason: skip ? 'unchanged' : null,
    payload,
  }
}

export function summarizeRestorePreviews(previews) {
  return (previews || []).reduce((acc, row) => {
    acc.total += 1
    if (row.skip) acc.skipped += 1
    else acc.ready += 1
    if (row.skipReason === 'unchanged') acc.unchanged += 1
    if (row.skipReason === 'missing_current') acc.missing += 1
    return acc
  }, {
    total: 0,
    ready: 0,
    skipped: 0,
    unchanged: 0,
    missing: 0,
  })
}
