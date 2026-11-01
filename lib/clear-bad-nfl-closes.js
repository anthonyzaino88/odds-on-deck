/**
 * Find NFL PropValidation rows whose stored closeLine moved off the
 * recorded threshold, list them (default), or null the close fields.
 *
 * Dry-run is the default. --apply is refused in CI / hosted production.
 * Do not run --apply against prod from this agent or CI.
 */

import { CLOSE_ODDS_FIELDS, closeLineMoved, isNflSport } from './closing-line.js'
import { etDateKey } from './game-grade-eligibility.js'
import { envFlagEnabled } from './supabase-admin-key.js'

export const CLEAR_BAD_NFL_CLOSE_FIELDS = CLOSE_ODDS_FIELDS

export const CLEAR_BAD_NFL_CLOSES_NULL_PAYLOAD = Object.freeze({
  closeOdds: null,
  closeLine: null,
  closeBook: null,
  closeNumBooks: null,
  closeCapturedAt: null,
})

const KNOWN_FLAGS = new Set([
  '--dry-run', '--apply', '--help', '-h', '--date', '--backup-dir',
])
const FLAGS_WITH_VALUE = new Set(['--date', '--backup-dir'])

export function parseYyyyMmDd(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function takeFlag(args, flag) {
  const i = args.indexOf(flag)
  if (i < 0) return { present: false, value: null, invalid: false }
  const raw = args[i + 1]
  if (raw == null || String(raw).startsWith('--')) {
    return { present: true, value: null, invalid: true }
  }
  return { present: true, value: String(raw).trim(), invalid: false }
}

export function unknownClearBadNflClosesArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const unknown = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i])
    if (FLAGS_WITH_VALUE.has(arg)) {
      const value = args[i + 1]
      if (value != null && !String(value).startsWith('--')) i += 1
      continue
    }
    if (KNOWN_FLAGS.has(arg)) continue
    unknown.push(arg)
  }
  return unknown
}

export function parseClearBadNflClosesArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : []
  const dateFlag = takeFlag(args, '--date')
  const backupDir = takeFlag(args, '--backup-dir')
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply') || envFlagEnabled(env.CLEAR_BAD_NFL_CLOSES_APPLY)
  const unknown = unknownClearBadNflClosesArgs(args)
  const invalidFlags = [
    dateFlag.present && (dateFlag.invalid || !parseYyyyMmDd(dateFlag.value)) ? '--date' : null,
    backupDir.invalid ? '--backup-dir' : null,
  ].filter(Boolean)
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
    date: dateFlag.present ? parseYyyyMmDd(dateFlag.value) : null,
    backupDir: backupDir.present && !backupDir.invalid ? backupDir.value : null,
    unknown,
    invalidFlags,
    dateMissing: !dateFlag.present,
  }
}

export function isMovedNflClose(row) {
  if (!row || typeof row !== 'object') return false
  if (!isNflSport(row.sport)) return false
  if (row.closeLine == null || row.threshold == null) return false
  return closeLineMoved(row)
}

export function clearBadNflClosesPayload() {
  return { ...CLEAR_BAD_NFL_CLOSES_NULL_PAYLOAD }
}

/** Null close fields only while closeLine is still off the recorded threshold. */
export function applyClearBadNflCloseUpdate(table, row, payload = clearBadNflClosesPayload()) {
  return table
    .update(payload)
    .eq('id', row.id)
    .neq('closeLine', row.threshold)
    .select('id')
}

export function isHostedOrCiProduction(env = process.env) {
  const truthy = (value) => {
    const raw = String(value || '').trim().toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes'
  }
  if (truthy(env.CI) || truthy(env.GITHUB_ACTIONS)) return true
  if (String(env.VERCEL_ENV || '').toLowerCase() === 'production') return true
  if (String(env.SUPABASE_ENV || '').toLowerCase() === 'production') return true
  return false
}

export function assertClearBadNflClosesApplyAllowed(env = process.env) {
  if (isHostedOrCiProduction(env)) {
    throw new Error('Refusing --apply against production / CI. Dry-run only.')
  }
}

export function gameOnEtDate(game, date) {
  const wanted = parseYyyyMmDd(date)
  if (!wanted || !game?.date) return false
  return etDateKey(game.date) === wanted
}

export function rowsToJsonl(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return ''
  return `${list.map((row) => JSON.stringify(row)).join('\n')}\n`
}

export function backupFileName(date, now = new Date()) {
  const day = parseYyyyMmDd(date) || 'undated'
  const stamp = (now instanceof Date ? now : new Date(now)).toISOString().replace(/[:.]/g, '-')
  return `clear-bad-nfl-closes-${day}-${stamp}.jsonl`
}
