#!/usr/bin/env node
/**
 * Parsing and cap rules for scripts/ops/scheduled-close-capture.ps1.
 *
 * The wrapper shells out here so the ET quiet window, daily call cap,
 * and one-line summary stay in one place. Stdout is JSON or a single
 * summary line. Capture text is read from stdin and never copied out.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_CALL_CAP = 20
export const CAP_RAISE = 20
export const MAX_CALLS_PER_RUN = 10
export const MAX_CREDITS_PER_RUN = 150
export const QUIET_MINUTE_START = 5
export const QUIET_MINUTE_END = 15

export const CLOSE_CAPTURE_TASK_MINUTES = Object.freeze([4, 16, 26, 36, 46, 56])

/** Inclusive ET hours. Sunday 09–23, Saturday 12–23, Monday–Friday 18–23. */
export const CLOSE_CAPTURE_TASK_HOURS = Object.freeze({
  Sunday: Object.freeze([9, 23]),
  Monday: Object.freeze([18, 23]),
  Tuesday: Object.freeze([18, 23]),
  Wednesday: Object.freeze([18, 23]),
  Thursday: Object.freeze([18, 23]),
  Friday: Object.freeze([18, 23]),
  Saturday: Object.freeze([12, 23]),
})

const TASK_DAYS = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
])

const SUMMARY_REASONS = new Set([
  'quiet',
  'locked',
  'bad-args',
  'clock',
  'usage-unreadable',
  'plan-unknown',
  'cap-exhausted',
  'summary-failed',
  'nothing-planned',
  'dry-run-only',
])

function lastMatch(text, expression) {
  const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`
  const global = new RegExp(expression.source, flags)
  let found = null
  let match = global.exec(text)
  while (match) {
    found = match
    match = global.exec(text)
  }
  return found
}

function lastInt(text, expression) {
  const match = lastMatch(text, expression)
  if (!match) return null
  return Number(match[1])
}

export function isQuietEtMinute(minute) {
  const n = Number(minute)
  return Number.isInteger(n) && n >= QUIET_MINUTE_START && n <= QUIET_MINUTE_END
}

export function easternNow(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  let hour = parts.hour || '00'
  if (hour === '24') hour = '00'
  const minute = Number(parts.minute)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    stamp: `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second} ET`,
    minute,
    quiet: isQuietEtMinute(minute),
  }
}

export function parseUsageText(text) {
  if (text == null || String(text).trim() === '') {
    return { ok: true, missing: true, callsUsed: 0, cap: DEFAULT_CALL_CAP }
  }
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  if (!/^\d+$/.test(lines[0] || '')) {
    return { ok: false, missing: false, reason: 'usage-unreadable' }
  }
  let cap = DEFAULT_CALL_CAP
  if (lines.length >= 2) {
    const match = /^cap=(\d+)$/.exec(lines[1])
    if (!match) return { ok: false, missing: false, reason: 'usage-unreadable' }
    cap = Number(match[1])
  }
  return {
    ok: true,
    missing: false,
    callsUsed: Number(lines[0]),
    cap,
  }
}

export function formatUsageText({ callsUsed = 0, cap = DEFAULT_CALL_CAP } = {}) {
  const used = Math.max(0, Math.floor(Number(callsUsed) || 0))
  const nextCap = Math.max(0, Math.floor(Number(cap) || 0))
  return `${used}\ncap=${nextCap}\n`
}

export function remainingCalls(callsUsed, cap) {
  return Math.max(0, Math.floor(Number(cap) || 0) - Math.floor(Number(callsUsed) || 0))
}

export function closeCaptureTaskTriggers() {
  const lines = []
  for (const day of TASK_DAYS) {
    const [start, end] = CLOSE_CAPTURE_TASK_HOURS[day]
    for (let hour = start; hour <= end; hour += 1) {
      for (const minute of CLOSE_CAPTURE_TASK_MINUTES) {
        lines.push(`${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
      }
    }
  }
  return lines
}

export function parseCaptureOutput(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  const planned = lastInt(text, /Odds API HTTP calls this run:\s*(\d+)/)
  const callsUsed = lastInt(text, /(?:^|[\r\n])CALLS_USED=(\d+)\s*(?=$|[\r\n])/)
  const creditsUsed = lastInt(text, /(?:^|[\r\n])CREDITS_USED=(\d+)\s*(?=$|[\r\n])/)
  const closeCredits = lastInt(text, /CLOSE_CAPTURE_CREDITS=(\d+)/)
  const statusMatch = lastMatch(text, /CLOSE_CAPTURE_STATUS=(ok|partial|failed)\b/)
  const budgetMatch = lastMatch(text, /ODDS_BUDGET_STATUS=(close_cap|ledger_unreadable)\b/)
  const captured = lastInt(text, /CLOSE_CAPTURE_CAPTURED=(\d+)/)
  const gameLine = { proposed: 0, inserted: 0, skipped: 0, failed: 0 }
  const gameLineRe = /^\s*game-line\s+\S.*\bproposed=(\d+)\s+inserted=(\d+)\s+skipped=(\d+)\s+failed=(\d+)/gm
  let row = gameLineRe.exec(text)
  while (row) {
    gameLine.proposed += Number(row[1])
    gameLine.inserted += Number(row[2])
    gameLine.skipped += Number(row[3])
    gameLine.failed += Number(row[4])
    row = gameLineRe.exec(text)
  }
  const skipped = {}
  const skippedRe = /\b((?:CLOSE_CAPTURE_)?SKIPPED_[A-Z0-9_]+)=(\d+)\b/g
  let skippedRow = skippedRe.exec(text)
  while (skippedRow) {
    const value = Number(skippedRow[2])
    if (value > 0) skipped[skippedRow[1]] = value
    else delete skipped[skippedRow[1]]
    skippedRow = skippedRe.exec(text)
  }
  let errors = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('❌') || /^Fatal:/.test(line)) errors += 1
  }
  return {
    planned: planned == null ? 0 : planned,
    plannedKnown: planned != null,
    callsUsed: callsUsed == null ? 0 : callsUsed,
    callsUsedPresent: callsUsed != null,
    status: statusMatch ? statusMatch[1] : 'ok',
    captured: captured == null ? 0 : captured,
    credits: creditsUsed != null ? creditsUsed : (closeCredits == null ? 0 : closeCredits),
    gameLine,
    skipped,
    budgetStatus: budgetMatch ? budgetMatch[1] : '',
    errors,
  }
}

export function callsToRecord({ callsUsedPresent = false, callsUsed = 0, planned = 0 } = {}) {
  if (callsUsedPresent) return Math.max(0, Math.floor(Number(callsUsed) || 0))
  return Math.max(0, Math.floor(Number(planned) || 0))
}

export function planScheduledCapture({
  planned = 0,
  plannedKnown = false,
  callsUsed = 0,
  cap = DEFAULT_CALL_CAP,
  dryRunOnly = false,
} = {}) {
  const used = Math.max(0, Math.floor(Number(callsUsed) || 0))
  const startCap = Math.max(0, Math.floor(Number(cap) || 0))
  const base = {
    cap: startCap,
    callsUsed: used,
    raisedBy: 0,
    remaining: remainingCalls(used, startCap),
    planned: plannedKnown ? Math.max(0, Math.floor(Number(planned) || 0)) : null,
    maxCalls: 0,
    maxCredits: MAX_CREDITS_PER_RUN,
  }
  if (!plannedKnown) {
    return { ...base, action: 'exit', reason: 'plan-unknown' }
  }
  const plan = base.planned
  if (plan === 0) {
    return { ...base, action: 'exit', reason: 'nothing-planned' }
  }
  if (dryRunOnly) {
    return { ...base, action: 'dry-run-only', reason: 'dry-run-only' }
  }
  let nextCap = startCap
  let raisedBy = 0
  let remaining = remainingCalls(used, nextCap)
  if (remaining === 0) {
    nextCap += CAP_RAISE
    raisedBy = CAP_RAISE
    remaining = remainingCalls(used, nextCap)
  }
  if (remaining <= 0) {
    return {
      ...base,
      action: 'exit',
      reason: 'cap-exhausted',
      cap: nextCap,
      raisedBy,
      remaining,
    }
  }
  return {
    ...base,
    action: 'apply',
    reason: '',
    cap: nextCap,
    raisedBy,
    remaining,
    maxCalls: Math.min(MAX_CALLS_PER_RUN, remaining),
    maxCredits: MAX_CREDITS_PER_RUN,
  }
}

function skippedPairs(skipped) {
  return Object.entries(skipped || {})
    .filter(([key, value]) => /SKIPPED_[A-Z0-9_]+$/.test(key) && Number(value) > 0)
    .map(([key, value]) => `${key}=${Number(value)}`)
}

export function buildCloseCaptureSummaryLine({
  stamp,
  status = 'ok',
  reason = '',
  dryRunOnly = false,
  captured = 0,
  gameLine = {},
  skipped = {},
  calls = 0,
  credits = 0,
  cap = DEFAULT_CALL_CAP,
  capRaises = 0,
  budgetStatus = '',
  errors = 0,
  planned = null,
} = {}) {
  const when = easternNow()
  const safeStamp = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ET$/.test(stamp)
    ? stamp
    : when.stamp
  const safeStatus = status === 'partial' || status === 'failed' || status === 'skipped' || status === 'ok'
    ? status
    : 'failed'
  const bits = [safeStamp, `CLOSE_CAPTURE_STATUS=${safeStatus}`]
  if (reason && SUMMARY_REASONS.has(reason)) bits.push(`reason=${reason}`)
  if (dryRunOnly) bits.push('dry_run_only=1')
  if (safeStatus !== 'skipped') {
    const lines = gameLine || {}
    bits.push(`CAPTURED=${Math.max(0, Number(captured) || 0)}`)
    bits.push(`game_line_proposed=${Math.max(0, Number(lines.proposed) || 0)}`)
    bits.push(`game_line_inserted=${Math.max(0, Number(lines.inserted) || 0)}`)
    bits.push(`game_line_skipped=${Math.max(0, Number(lines.skipped) || 0)}`)
    bits.push(`game_line_failed=${Math.max(0, Number(lines.failed) || 0)}`)
    bits.push(...skippedPairs(skipped))
    bits.push(`calls=${Math.max(0, Number(calls) || 0)}`)
    bits.push(`credits=${Math.max(0, Number(credits) || 0)}`)
    bits.push(`cap=${Math.max(0, Number(cap) || 0)}`)
    bits.push(`cap_raises=${Math.max(0, Number(capRaises) || 0)}`)
    if (budgetStatus === 'close_cap' || budgetStatus === 'ledger_unreadable') {
      bits.push(`ODDS_BUDGET_STATUS=${budgetStatus}`)
    }
    if (Number(errors) > 0) bits.push(`errors=${Math.floor(Number(errors))}`)
    if (planned != null && Number.isFinite(Number(planned))) {
      bits.push(`planned=${Math.max(0, Math.floor(Number(planned)))}`)
    }
  }
  return bits.join(' ').replace(/[\r\n]+/g, ' ').trim()
}

export function summarizeCaptureOutput(raw, {
  stamp,
  cap = DEFAULT_CALL_CAP,
  capRaises = 0,
  plannedFallback = 0,
  recordCalls = false,
  dryRunOnly = false,
  reason = '',
  status = '',
  extraErrors = 0,
  now = new Date(),
} = {}) {
  const parsed = parseCaptureOutput(raw)
  const recorded = recordCalls
    ? callsToRecord({
      callsUsedPresent: parsed.callsUsedPresent,
      callsUsed: parsed.callsUsed,
      planned: plannedFallback,
    })
    : 0
  const clock = easternNow(now)
  const skipReason = new Set([
    'quiet', 'locked', 'bad-args', 'clock', 'usage-unreadable', 'summary-failed', 'plan-unknown',
  ])
  const line = buildCloseCaptureSummaryLine({
    stamp: stamp || clock.stamp,
    status: status || (skipReason.has(reason) ? 'skipped' : parsed.status),
    reason,
    dryRunOnly,
    captured: parsed.captured,
    gameLine: parsed.gameLine,
    skipped: parsed.skipped,
    calls: recorded,
    credits: parsed.credits,
    cap,
    capRaises,
    budgetStatus: parsed.budgetStatus,
    errors: parsed.errors + Math.max(0, Number(extraErrors) || 0),
    planned: parsed.plannedKnown ? parsed.planned : (recordCalls ? plannedFallback : null),
  })
  return { line, recordedCalls: recorded, parsed }
}

function readStdin() {
  if (process.stdin.isTTY) return ''
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function flagName(arg) {
  const text = String(arg ?? '')
  if (text.startsWith('-')) {
    const eq = text.indexOf('=')
    return (eq === -1 ? text : text.slice(0, eq)) || '--'
  }
  return 'positional'
}

function readFlag(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (value == null || String(value).startsWith('-')) return null
  return String(value)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function failClosed(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function runCli(argv) {
  const command = argv[0]
  const rest = argv.slice(1)
  const known = new Set([
    '--file', '--calls', '--cap', '--calls-used', '--dry-run-only',
    '--raised-by', '--planned', '--usage-file', '--record-calls',
    '--extra-errors', '--reason', '--stamp', '--status',
  ])
  for (const arg of rest) {
    if (String(arg).startsWith('-') && !known.has(flagName(arg))) {
      failClosed(`unknown argument ${flagName(arg)}`)
    }
  }
  if (command === 'quiet-now') {
    printJson(easternNow())
    return
  }
  if (command === 'triggers') {
    process.stdout.write(`${closeCaptureTaskTriggers().join('\n')}\n`)
    return
  }
  if (command === 'read-usage') {
    const file = readFlag(rest, '--file')
    if (!file) failClosed('missing --file')
    let text = ''
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8')
    printJson(parseUsageText(text))
    return
  }
  if (command === 'write-usage') {
    const file = readFlag(rest, '--file')
    const calls = readFlag(rest, '--calls')
    const cap = readFlag(rest, '--cap')
    if (!file || calls == null || cap == null) failClosed('missing usage fields')
    if (!/^\d+$/.test(calls) || !/^\d+$/.test(cap)) failClosed('usage fields must be integers')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, formatUsageText({ callsUsed: Number(calls), cap: Number(cap) }))
    printJson({ ok: true })
    return
  }
  if (command === 'plan') {
    const parsed = parseCaptureOutput(readStdin())
    const callsUsed = readFlag(rest, '--calls-used')
    const cap = readFlag(rest, '--cap')
    if (callsUsed == null || cap == null || !/^\d+$/.test(callsUsed) || !/^\d+$/.test(cap)) {
      failClosed('plan needs integer --calls-used and --cap')
    }
    printJson(planScheduledCapture({
      planned: parsed.planned,
      plannedKnown: parsed.plannedKnown,
      callsUsed: Number(callsUsed),
      cap: Number(cap),
      dryRunOnly: rest.includes('--dry-run-only'),
    }))
    return
  }
  if (command === 'line') {
    const reason = readFlag(rest, '--reason') || ''
    const status = readFlag(rest, '--status')
    process.stdout.write(`${buildCloseCaptureSummaryLine({
      status: status || 'skipped',
      reason: SUMMARY_REASONS.has(reason) ? reason : (reason ? 'bad-args' : ''),
    })}\n`)
    return
  }
  if (command === 'finalize') {
    const cap = readFlag(rest, '--cap')
    const raisedBy = readFlag(rest, '--raised-by') || '0'
    const planned = readFlag(rest, '--planned') || '0'
    const callsUsed = readFlag(rest, '--calls-used') || '0'
    const usageFile = readFlag(rest, '--usage-file')
    const extraErrors = readFlag(rest, '--extra-errors') || '0'
    const reason = readFlag(rest, '--reason') || ''
    if (cap == null || !/^\d+$/.test(cap) || !/^\d+$/.test(raisedBy) || !/^\d+$/.test(planned)
      || !/^\d+$/.test(callsUsed) || !/^\d+$/.test(extraErrors)) {
      failClosed('finalize needs integer fields')
    }
    const summary = summarizeCaptureOutput(readStdin(), {
      cap: Number(cap),
      capRaises: Number(raisedBy),
      plannedFallback: Number(planned),
      recordCalls: rest.includes('--record-calls'),
      dryRunOnly: rest.includes('--dry-run-only'),
      reason: SUMMARY_REASONS.has(reason) ? reason : '',
      extraErrors: Number(extraErrors),
    })
    if (rest.includes('--record-calls')) {
      if (!usageFile) failClosed('missing --usage-file')
      const next = {
        callsUsed: Number(callsUsed) + summary.recordedCalls,
        cap: Number(cap),
      }
      fs.mkdirSync(path.dirname(usageFile), { recursive: true })
      fs.writeFileSync(usageFile, formatUsageText(next))
    }
    process.stdout.write(`${summary.line}\n`)
    return
  }
  failClosed('unknown command')
}

function invokedDirectly() {
  try {
    return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  try {
    runCli(process.argv.slice(2))
  } catch {
    failClosed('close-capture-summary failed')
  }
}
