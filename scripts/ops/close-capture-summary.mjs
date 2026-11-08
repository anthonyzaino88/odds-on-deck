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
export const DEFAULT_CALL_CEILING = 80
export const MAX_CALLS_PER_RUN = 10
export const MAX_CREDITS_PER_RUN = 150
export const QUIET_MINUTE_START = 5
export const QUIET_MINUTE_END = 15
export const QUIET_DEADLINE_MINUTE = 4
export const QUIET_DEADLINE_SECOND = 50
/** Windows refuses a task with more than this many triggers. */
export const WINDOWS_TRIGGER_LIMIT = 48
/** Windows time-zone id for Eastern, including daylight time. */
export const REQUIRED_WINDOWS_TZ = 'Eastern Standard Time'
/**
 * Longest scheduled gap is :16:00 → the next :04:50.
 * The task ExecutionTimeLimit matches that span. The wrapper still
 * kills the Node child at the live :04:50, which is sooner for a :04 start.
 */
export const CLOSE_CAPTURE_EXECUTION_LIMIT_SECONDS = (48 * 60) + 50
const REPEATING_TRIGGER_START_HOUR = 9
const REPEATING_TRIGGER_END_HOUR = 23
const REPEATING_TRIGGER_INTERVAL_MINUTES = 60
/** 09:MM through 23:MM. One extra minute keeps the 23:MM fire inside the window. */
const REPEATING_TRIGGER_DURATION_MINUTES = ((REPEATING_TRIGGER_END_HOUR - REPEATING_TRIGGER_START_HOUR) * 60) + 1

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

const SUMMARY_REASONS = new Set([
  'quiet',
  'locked',
  'bad-args',
  'clock',
  'usage-unreadable',
  'plan-unknown',
  'cap-exhausted',
  'summary-failed',
  'usage-blocked',
  'nothing-planned',
  'dry-run-only',
  'schedule',
  'timezone',
  'deadline',
  'cap-ceiling',
  'job',
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

export function easternParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
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
  let hourText = parts.hour || '00'
  if (hourText === '24') hourText = '00'
  const hour = Number(hourText)
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute,
    second,
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    stamp: `${parts.year}-${parts.month}-${parts.day} ${hourText}:${parts.minute}:${parts.second} ET`,
    quiet: isQuietEtMinute(minute),
  }
}

export function easternNow(date = new Date()) {
  const parts = easternParts(date)
  return {
    date: parts.date,
    stamp: parts.stamp,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday: parts.weekday,
    quiet: parts.quiet,
  }
}

function easternOffsetMs(date) {
  const parts = easternParts(date)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - date.getTime()
}

export function easternCivilToUtc(year, month, day, hour, minute, second) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const offset = easternOffsetMs(guess)
  let utc = new Date(guess.getTime() - offset)
  const offset2 = easternOffsetMs(utc)
  if (offset2 !== offset) utc = new Date(guess.getTime() - offset2)
  return utc
}

/**
 * The next :04:50 ET, or the one that has already arrived this hour.
 * A clock at 19:04:50 or later in that minute is already due.
 * A clock past minute 4 waits for the following hour's :04:50.
 */
export function nextQuietDeadline(date = new Date()) {
  const parts = easternParts(date)
  let { year, month, day, hour } = parts
  const dueThisHour = parts.minute < QUIET_DEADLINE_MINUTE
    || (parts.minute === QUIET_DEADLINE_MINUTE && parts.second < QUIET_DEADLINE_SECOND)
  const alreadyDue = parts.minute === QUIET_DEADLINE_MINUTE && parts.second >= QUIET_DEADLINE_SECOND
  if (!dueThisHour && !alreadyDue) {
    hour += 1
    if (hour >= 24) {
      hour = 0
      const next = new Date(Date.UTC(year, month - 1, day) + (24 * 60 * 60 * 1000))
      year = next.getUTCFullYear()
      month = next.getUTCMonth() + 1
      day = next.getUTCDate()
    }
  }
  const deadline = easternCivilToUtc(year, month, day, hour, QUIET_DEADLINE_MINUTE, QUIET_DEADLINE_SECOND)
  return {
    deadline,
    iso: deadline.toISOString(),
    remainingMs: Math.max(0, deadline.getTime() - date.getTime()),
    executionTimeLimitSeconds: CLOSE_CAPTURE_EXECUTION_LIMIT_SECONDS,
  }
}

/**
 * Time left until a deadline chosen at the start of the run.
 * This never rolls forward to the next hour's :04:50.
 */
export function remainingUntilDeadline(iso, now = new Date()) {
  const text = String(iso || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) {
    return { ok: false, iso: '', remainingMs: 0 }
  }
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return { ok: false, iso: '', remainingMs: 0 }
  return {
    ok: true,
    iso: new Date(ms).toISOString(),
    remainingMs: Math.max(0, ms - now.getTime()),
  }
}

/**
 * Start suspended, assign to the job, record the PID, then resume.
 * A failed job, assign, or resume kills the child and does not resume it.
 */
export function containCapturedChild({
  jobReady = false,
  startSuspended,
  assign,
  recordPid,
  resume,
  kill,
} = {}) {
  if (!jobReady) return { ran: false, resumed: false, reason: 'job-create-failed' }
  let child = null
  try {
    child = startSuspended()
  } catch {
    return { ran: false, resumed: false, reason: 'start-failed' }
  }
  if (!child) return { ran: false, resumed: false, reason: 'start-failed' }
  try {
    if (!assign(child)) {
      kill(child)
      return { ran: false, resumed: false, reason: 'assign-failed' }
    }
    recordPid(child)
    if (!resume(child)) {
      kill(child)
      return { ran: false, resumed: false, reason: 'resume-failed' }
    }
    return { ran: true, resumed: true, reason: '' }
  } catch {
    try { kill(child) } catch { /* the child must not be left running */ }
    return { ran: false, resumed: false, reason: 'contain-failed' }
  }
}

/**
 * After a deadline kill, wait until the child has exited, then read its
 * output, then drop the lock and the process handles. A failed read charges
 * the full reserved call count.
 */
export async function settleCapturedChild({
  timedOut = false,
  kill,
  waitForExit,
  readOutput,
  clearOwnership,
  release,
  reservedCalls = 0,
} = {}) {
  const reserved = Math.max(0, Math.floor(Number(reservedCalls) || 0))
  let exited = !timedOut
  if (timedOut) {
    try {
      kill()
    } catch {
      /* the wait below is what confirms the process is gone */
    }
    exited = Boolean(await waitForExit())
  }
  let text = ''
  let readFailed = !exited
  if (exited) {
    try {
      text = String(await readOutput())
    } catch {
      readFailed = true
      text = ''
    }
    clearOwnership()
    release()
  }
  return {
    exited: Boolean(exited),
    readFailed,
    text,
    calls: readFailed ? reserved : null,
  }
}

export function orphanShouldKill(lockText, actual = {}) {
  const text = String(lockText || '')
  const pid = /^pid=(\d+)\s*$/m.exec(text)
  const ticks = /^startTicks=(\d+)\s*$/m.exec(text)
  if (!pid || !ticks) return false
  if (actual.pid == null || actual.startTicks == null || actual.startTicks === '') return false
  return pid[1] === String(actual.pid) && ticks[1] === String(actual.startTicks)
}

export function windowsTimeZoneOk(id) {
  return id === REQUIRED_WINDOWS_TZ
}

/** Day and hour gate, plus :04/:16/:26/:36/:46/:56 alignment. */
export function scheduledCaptureDecision(date = new Date()) {
  const clock = easternNow(date)
  const hours = CLOSE_CAPTURE_TASK_HOURS[clock.weekday] || [24, -1]
  const [start, end] = hours
  const minuteOk = CLOSE_CAPTURE_TASK_MINUTES.includes(clock.minute)
  const hourOk = clock.hour >= start && clock.hour <= end
  return {
    ...clock,
    minuteOk,
    hourOk,
    allowed: minuteOk && hourOk && !clock.quiet,
  }
}

export function parseUsageText(text) {
  if (text == null) {
    return { ok: true, missing: true, callsUsed: 0, cap: DEFAULT_CALL_CAP, runId: '' }
  }
  if (String(text).trim() === '') {
    return { ok: false, missing: false, reason: 'usage-unreadable' }
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
  let runId = ''
  for (const line of lines.slice(2)) {
    const run = /^run=([A-Za-z0-9_-]+)$/.exec(line)
    if (run) runId = run[1]
  }
  return {
    ok: true,
    missing: false,
    callsUsed: Number(lines[0]),
    cap,
    runId,
  }
}

export function formatUsageText({ callsUsed = 0, cap = DEFAULT_CALL_CAP, runId = '' } = {}) {
  const used = Math.max(0, Math.floor(Number(callsUsed) || 0))
  const nextCap = Math.max(0, Math.floor(Number(cap) || 0))
  const body = `${used}\ncap=${nextCap}\n`
  const run = String(runId || '')
  if (!run || !/^[A-Za-z0-9_-]+$/.test(run)) return body
  return `${body}run=${run}\n`
}

export function usageMatchesRequest(text, {
  calls,
  cap,
  day,
  runId,
  fileDay,
} = {}) {
  const parsed = parseUsageText(text)
  if (!parsed || !parsed.ok || parsed.missing) return { ok: false, reason: 'unreadable' }
  const wantCalls = Number(calls)
  const wantCap = Number(cap)
  if (!Number.isInteger(wantCalls) || parsed.callsUsed !== wantCalls) {
    return { ok: false, reason: 'calls' }
  }
  if (!Number.isInteger(wantCap) || parsed.cap !== wantCap) {
    return { ok: false, reason: 'cap' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) || String(fileDay || '') !== String(day)) {
    return { ok: false, reason: 'day' }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(String(runId || '')) || parsed.runId !== String(runId)) {
    return { ok: false, reason: 'run' }
  }
  return { ok: true, reason: '' }
}

/** Read-back for a write. Day and run id are required only when the write requested them. */
export function landedUsage(text, {
  calls,
  cap,
  day = '',
  runId = '',
  fileDay = '',
} = {}) {
  const parsed = parseUsageText(text)
  if (!parsed || !parsed.ok || parsed.missing) return { ok: false, reason: 'unreadable' }
  const wantCalls = Number(calls)
  const wantCap = Number(cap)
  if (!Number.isInteger(wantCalls) || parsed.callsUsed !== wantCalls) {
    return { ok: false, reason: 'calls' }
  }
  if (!Number.isInteger(wantCap) || parsed.cap !== wantCap) {
    return { ok: false, reason: 'cap' }
  }
  if (String(day || '') !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || String(fileDay || '') !== String(day)) {
      return { ok: false, reason: 'day' }
    }
  }
  if (String(runId || '') !== '') {
    if (!/^[A-Za-z0-9_-]+$/.test(String(runId)) || parsed.runId !== String(runId)) {
      return { ok: false, reason: 'run' }
    }
  }
  return { ok: true, reason: '' }
}

export function recordedUsageTotal({
  prior = 0,
  raw = '',
  planned = 0,
  readFailed = false,
  reservedCalls = 0,
} = {}) {
  const parsed = parseCaptureOutput(raw)
  const used = callsToRecord({
    callsUsedPresent: parsed.callsUsedPresent,
    callsUsed: parsed.callsUsed,
    planned,
    readFailed,
    reservedCalls,
  })
  const start = Math.max(0, Math.floor(Number(prior) || 0))
  return { used, total: start + used }
}

/**
 * A finalize that exits 0 and prints a line is still rejected when the
 * usage file is not prior + used for this run. The fallback charges the
 * full reserved count and must itself read back.
 */
export function acceptFinalizeUsage({
  finalize,
  readFile,
  writeFallback,
  prior = 0,
  used = 0,
  reserved = 0,
  cap,
  day,
  runId,
} = {}) {
  const finished = typeof finalize === 'function' ? finalize() : { exitCode: NATIVE_EXIT_SENTINEL, text: '' }
  const exit = runNativeCommand({
    priorExit: 0,
    invoke({ setExit }) {
      const code = finished && Object.prototype.hasOwnProperty.call(finished, 'exitCode')
        ? finished.exitCode
        : undefined
      setExit(code)
    },
  })
  const start = Math.max(0, Math.floor(Number(prior) || 0))
  const expected = start + Math.max(0, Math.floor(Number(used) || 0))
  const hasLine = Boolean(finished && String(finished.text || '').trim())
  if (exit.ok && hasLine) {
    const precise = confirmUsageWrite({
      write: () => ({ exitCode: 0 }),
      readFile,
      requested: { calls: expected, cap, day, runId },
    })
    if (precise.ok) return { ok: true, accepted: true, fallback: false, calls: expected, reason: '' }
  }
  const conservative = start + Math.max(0, Math.floor(Number(reserved) || 0))
  const fallback = confirmUsageWrite({
    write: () => (typeof writeFallback === 'function'
      ? writeFallback(conservative)
      : { exitCode: NATIVE_EXIT_SENTINEL }),
    readFile,
    requested: { calls: conservative, cap, day, runId },
  })
  return {
    ok: fallback.ok,
    accepted: false,
    fallback: true,
    calls: conservative,
    reason: fallback.reason,
  }
}

export function blockedMarkerName(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? `${day}.blocked` : ''
}

export function fallbackBlockedMarkerName(day) {
  const name = blockedMarkerName(day)
  return name ? `localappdata:${name}` : ''
}

export function pendingMarkerName(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? `${day}.pending` : ''
}

export function fallbackPendingMarkerName(day) {
  const name = pendingMarkerName(day)
  return name ? `localappdata:${name}` : ''
}

function markerPresent(markers, names) {
  return names.some((name) => (
    name && markers && typeof markers.has === 'function' && markers.has(name)
  ))
}

function clearPendingMarkers(markers, day) {
  if (!markers || typeof markers.delete !== 'function') return
  markers.delete(pendingMarkerName(day))
  markers.delete(fallbackPendingMarkerName(day))
}

/**
 * A missing usage file has no write to verify. A file on disk must
 * round-trip its own calls, cap, ET day, and run id.
 */
export function usageWriteVerified(text, { day, fileDay } = {}) {
  if (text == null) return { ok: true, reason: '' }
  const parsed = parseUsageText(text)
  if (!parsed || !parsed.ok || parsed.missing || !parsed.runId) {
    return { ok: false, reason: 'usage-blocked' }
  }
  return usageMatchesRequest(text, {
    calls: parsed.callsUsed,
    cap: parsed.cap,
    day,
    runId: parsed.runId,
    fileDay: fileDay || day,
  })
}

/**
 * A fallback that does not verify blocks that ET day and exits non-zero.
 * The primary marker is tried first. A failed primary write is logged and
 * the fallback location is tried. The run still exits non-zero when both
 * marker writes fail.
 */
export function blockUsageDay({
  verified = false,
  day,
  markers,
  primaryWrite,
  fallbackWrite,
  log,
} = {}) {
  const marker = blockedMarkerName(day)
  const fallback = fallbackBlockedMarkerName(day)
  if (verified) return { exitCode: 0, blocked: false, marker, fallback: '', reason: '' }
  const note = (message) => {
    let logged = false
    try {
      if (typeof log === 'function') {
        log(message)
        logged = true
      }
    } catch {
      logged = false
    }
    return logged
  }
  const writePrimary = typeof primaryWrite === 'function'
    ? primaryWrite
    : (name) => {
      if (name && markers && typeof markers.add === 'function') markers.add(name)
      return true
    }
  const writeFallback = typeof fallbackWrite === 'function'
    ? fallbackWrite
    : (name) => {
      if (name && markers && typeof markers.add === 'function') markers.add(name)
      return true
    }
  let primaryOk = false
  try {
    primaryOk = writePrimary(marker) === true
  } catch (error) {
    primaryOk = false
    note(`primary ${error && error.message ? error.message : 'marker write failed'}`)
  }
  let fallbackOk = false
  if (!primaryOk) {
    try {
      fallbackOk = writeFallback(fallback) === true
    } catch (error) {
      fallbackOk = false
      note(`fallback ${error && error.message ? error.message : 'marker write failed'}`)
    }
  }
  return {
    exitCode: 1,
    blocked: primaryOk || fallbackOk,
    marker: primaryOk ? marker : '',
    fallback: fallbackOk ? fallback : '',
    reason: 'usage-blocked',
  }
}

/**
 * Pending stays until the usage file matches this run's id and expected
 * calls. A self-consistent older file does not clear it. Blocked-marker
 * failures, including a log that throws, still leave pending in place.
 */
/**
 * A nothing-planned or dry-run-only exit made no paid call, so it
 * removes any pending marker and leaves the next run free to capture.
 */
export function releaseUnpaidCapture({
  day,
  markers,
  action = '',
  dryRunOnly = false,
} = {}) {
  const paid = !dryRunOnly && action === 'apply'
  if (paid) {
    return {
      exitCode: 0,
      cleared: false,
      pending: markerPresent(markers, [
        pendingMarkerName(day),
        fallbackPendingMarkerName(day),
      ]),
    }
  }
  clearPendingMarkers(markers, day)
  return { exitCode: 0, cleared: true, pending: false }
}

export function accountPaidCapture({
  day,
  markers,
  usageText,
  expectedCalls,
  cap,
  runId,
  primaryWrite,
  fallbackWrite,
  log,
} = {}) {
  const verified = usageText != null && usageMatchesRequest(usageText, {
    calls: expectedCalls,
    cap,
    day,
    runId,
    fileDay: day,
  }).ok
  if (verified) {
    clearPendingMarkers(markers, day)
    return { exitCode: 0, cleared: true, reason: '' }
  }
  const blocked = blockUsageDay({
    verified: false,
    day,
    markers,
    primaryWrite,
    fallbackWrite,
    log,
  })
  return {
    exitCode: 1,
    cleared: false,
    reason: 'usage-blocked',
    blocked: blocked.blocked,
    fallback: blocked.fallback,
  }
}

/**
 * A blocked day does not capture. Either marker location, or a usage
 * file whose latest write does not verify, plans zero calls and exits
 * non-zero with reason usage-blocked.
 */
export function nextCapturePlan({
  day,
  markers,
  usageText,
  planned = 0,
  plannedKnown = false,
  callsUsed = 0,
  cap = DEFAULT_CALL_CAP,
  ceiling = DEFAULT_CALL_CEILING,
  capture,
} = {}) {
  const pendingOn = markerPresent(markers, [
    pendingMarkerName(day),
    fallbackPendingMarkerName(day),
  ])
  const blockedOn = markerPresent(markers, [
    blockedMarkerName(day),
    fallbackBlockedMarkerName(day),
  ])
  const usage = usageWriteVerified(usageText, { day, fileDay: day })
  const missingAfterPending = pendingOn && usageText == null
  if (pendingOn || blockedOn || missingAfterPending || !usage.ok) {
    return {
      called: false,
      exitCode: 1,
      reason: 'usage-blocked',
      plan: planScheduledCapture({
        planned,
        plannedKnown,
        callsUsed,
        cap,
        ceiling,
        blocked: true,
      }),
    }
  }
  if (typeof capture === 'function') capture()
  const plan = planScheduledCapture({
    planned,
    plannedKnown,
    callsUsed,
    cap,
    ceiling,
    blocked: false,
  })
  return { called: true, exitCode: 0, reason: plan.reason, plan }
}

/** A native call must replace this before a 0 can count as success. */
export const NATIVE_EXIT_SENTINEL = -999

/**
 * priorExit is the sticky LASTEXITCODE from an earlier command.
 * The call sets the sentinel first. If invoke never writes a new code,
 * the prior 0 is not success.
 */
export function runNativeCommand({ priorExit = 0, invoke } = {}) {
  let exitCode = NATIVE_EXIT_SENTINEL
  if (typeof invoke === 'function') {
    invoke({
      priorExit,
      setExit(code) { exitCode = code },
    })
  }
  const code = exitCode == null || !Number.isFinite(Number(exitCode))
    ? NATIVE_EXIT_SENTINEL
    : Number(exitCode)
  return { ok: code === 0, code }
}

/**
 * A write-usage exit of 0 still fails unless the file read back has the
 * requested calls, cap, ET day, and this run's id.
 */
export function confirmUsageWrite({ write, readFile, requested = {} } = {}) {
  const written = typeof write === 'function' ? write() : { exitCode: NATIVE_EXIT_SENTINEL }
  const exit = runNativeCommand({
    priorExit: 0,
    invoke({ setExit }) {
      const code = written && Object.prototype.hasOwnProperty.call(written, 'exitCode')
        ? written.exitCode
        : undefined
      setExit(code)
    },
  })
  if (!exit.ok) return { ok: false, reason: 'exit', code: exit.code }
  let text = null
  let fileDay = ''
  try {
    const read = readFile()
    if (read == null) return { ok: false, reason: 'missing', code: 0 }
    if (typeof read === 'string') {
      text = read
    } else {
      text = read.text
      fileDay = String(read.fileDay || '')
    }
  } catch {
    return { ok: false, reason: 'missing', code: 0 }
  }
  if (text == null) return { ok: false, reason: 'missing', code: 0 }
  const match = usageMatchesRequest(text, {
    calls: requested.calls,
    cap: requested.cap,
    day: requested.day,
    runId: requested.runId,
    fileDay,
  })
  if (!match.ok) return { ok: false, reason: match.reason, code: 0 }
  return { ok: true, reason: '', code: 0 }
}

export function remainingCalls(callsUsed, cap) {
  return Math.max(0, Math.floor(Number(cap) || 0) - Math.floor(Number(callsUsed) || 0))
}

/**
 * One daily repeating trigger per aligned minute. A single every-10-minute
 * trigger that starts at :04 never lands on :16, so each aligned minute
 * gets its own hourly repeat. The wrapper still drops fires outside the
 * day/hour window and any minute that is not :04/:16/:26/:36/:46/:56.
 */
export function closeCaptureRepeatingTriggers() {
  return CLOSE_CAPTURE_TASK_MINUTES.map((minute) => ({
    startHour: REPEATING_TRIGGER_START_HOUR,
    minute,
    intervalMinutes: REPEATING_TRIGGER_INTERVAL_MINUTES,
    durationMinutes: REPEATING_TRIGGER_DURATION_MINUTES,
  }))
}

export function expandRepeatingTrigger(trigger) {
  const fires = []
  const start = (trigger.startHour * 60) + trigger.minute
  const end = start + trigger.durationMinutes
  for (let cursor = start; cursor < end; cursor += trigger.intervalMinutes) {
    const hour = Math.floor(cursor / 60)
    if (hour >= 24) break
    fires.push({ hour, minute: cursor % 60 })
  }
  return fires
}

export function closeCaptureTaskSpec() {
  const triggers = closeCaptureRepeatingTriggers()
  if (triggers.length > WINDOWS_TRIGGER_LIMIT) {
    throw new Error('trigger count exceeds the Windows limit')
  }
  return {
    triggers,
    count: triggers.length,
    limit: WINDOWS_TRIGGER_LIMIT,
    executionTimeLimitSeconds: CLOSE_CAPTURE_EXECUTION_LIMIT_SECONDS,
    windowsTimeZone: REQUIRED_WINDOWS_TZ,
    enabledByDefault: false,
  }
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

export function callsToRecord({
  callsUsedPresent = false,
  callsUsed = 0,
  planned = 0,
  readFailed = false,
  reservedCalls = 0,
} = {}) {
  if (readFailed) return Math.max(0, Math.floor(Number(reservedCalls) || 0))
  if (callsUsedPresent) return Math.max(0, Math.floor(Number(callsUsed) || 0))
  return Math.max(0, Math.floor(Number(planned) || 0))
}

export function planScheduledCapture({
  planned = 0,
  plannedKnown = false,
  callsUsed = 0,
  cap = DEFAULT_CALL_CAP,
  ceiling = DEFAULT_CALL_CEILING,
  dryRunOnly = false,
  blocked = false,
} = {}) {
  if (blocked) {
    return {
      cap: Math.max(0, Math.floor(Number(cap) || 0)),
      callsUsed: Math.max(0, Math.floor(Number(callsUsed) || 0)),
      raisedBy: 0,
      remaining: 0,
      planned: 0,
      maxCalls: 0,
      maxCredits: 0,
      ceiling: Math.max(0, Math.floor(Number(ceiling) || 0)),
      ceilingHit: false,
      action: 'exit',
      reason: 'usage-blocked',
    }
  }
  const used = Math.max(0, Math.floor(Number(callsUsed) || 0))
  const startCap = Math.max(0, Math.floor(Number(cap) || 0))
  const hard = Math.max(0, Math.floor(Number(ceiling) || 0))
  let nextCap = Math.min(startCap, hard)
  let ceilingHit = nextCap < startCap
  const base = {
    cap: nextCap,
    callsUsed: used,
    raisedBy: 0,
    remaining: remainingCalls(used, nextCap),
    planned: plannedKnown ? Math.max(0, Math.floor(Number(planned) || 0)) : null,
    maxCalls: 0,
    maxCredits: MAX_CREDITS_PER_RUN,
    ceiling: hard,
    ceilingHit,
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
  let raisedBy = 0
  let remaining = base.remaining
  if (remaining === 0) {
    if (nextCap >= hard) {
      return {
        ...base,
        action: 'exit',
        reason: 'cap-ceiling',
        cap: nextCap,
        raisedBy: 0,
        remaining: 0,
        ceilingHit: true,
      }
    }
    const raisedTo = Math.min(hard, nextCap + CAP_RAISE)
    raisedBy = raisedTo - nextCap
    nextCap = raisedTo
    remaining = remainingCalls(used, nextCap)
    ceilingHit = ceilingHit || nextCap >= hard
  }
  if (remaining <= 0) {
    return {
      ...base,
      action: 'exit',
      reason: 'cap-exhausted',
      cap: nextCap,
      raisedBy,
      remaining,
      ceilingHit,
    }
  }
  return {
    ...base,
    action: 'apply',
    reason: '',
    cap: nextCap,
    raisedBy,
    remaining,
    ceilingHit,
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
  ceiling = null,
  ceilingHit = false,
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
  if (ceilingHit || reason === 'cap-ceiling') {
    if (safeStatus === 'skipped') bits.push(`cap=${Math.max(0, Number(cap) || 0)}`)
    bits.push(`cap_ceiling=${Math.max(0, Number(ceiling) || 0)}`)
  }
  return bits.join(' ').replace(/[\r\n]+/g, ' ').trim()
}

export function summarizeCaptureOutput(raw, {
  stamp,
  cap = DEFAULT_CALL_CAP,
  capRaises = 0,
  ceiling = null,
  ceilingHit = false,
  plannedFallback = 0,
  recordCalls = false,
  dryRunOnly = false,
  reason = '',
  status = '',
  extraErrors = 0,
  readFailed = false,
  reservedCalls = 0,
  now = new Date(),
} = {}) {
  const parsed = parseCaptureOutput(raw)
  const recorded = recordCalls
    ? callsToRecord({
      callsUsedPresent: parsed.callsUsedPresent,
      callsUsed: parsed.callsUsed,
      planned: plannedFallback,
      readFailed,
      reservedCalls,
    })
    : 0
  const clock = easternNow(now)
  const skipReason = new Set([
    'quiet', 'locked', 'bad-args', 'clock', 'usage-unreadable', 'summary-failed', 'usage-blocked', 'plan-unknown',
    'schedule', 'timezone', 'deadline', 'cap-ceiling', 'job',
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
    ceiling,
    ceilingHit: ceilingHit || reason === 'cap-ceiling',
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

export function writeUsageFile(file, { callsUsed = 0, cap = DEFAULT_CALL_CAP, runId = '', day = '' } = {}) {
  const used = Math.max(0, Math.floor(Number(callsUsed) || 0))
  const nextCap = Math.max(0, Math.floor(Number(cap) || 0))
  const run = String(runId || '')
  const fileDay = path.basename(file, path.extname(file))
  if (String(day || '') !== '' && fileDay !== String(day)) {
    const mismatch = new Error('usage write did not land')
    mismatch.reason = 'day'
    throw mismatch
  }
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  const text = formatUsageText({ callsUsed: used, cap: nextCap, runId: run })
  try {
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* the rename owns the file */ }
    throw error
  }
  let readBack = null
  try {
    readBack = fs.readFileSync(file, 'utf8')
  } catch {
    readBack = null
  }
  const match = landedUsage(readBack, {
    calls: used,
    cap: nextCap,
    day,
    runId: run,
    fileDay,
  })
  if (!match.ok) {
    const missed = new Error('usage write did not land')
    missed.reason = match.reason
    throw missed
  }
}

function optionalIntFlag(argv, name) {
  if (!argv.includes(name)) return { present: false, value: null }
  const raw = readFlag(argv, name)
  if (raw == null || !/^\d+$/.test(raw)) return { present: true, value: null, invalid: true }
  return { present: true, value: Number(raw), invalid: false }
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
    '--ceiling', '--id', '--ceiling-hit', '--deadline', '--pid', '--start-ticks',
    '--read-failed', '--reserved-calls', '--run', '--day',
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
  if (command === 'deadline') {
    printJson(nextQuietDeadline())
    return
  }
  if (command === 'remaining') {
    const iso = readFlag(rest, '--deadline')
    if (iso == null) failClosed('missing --deadline')
    printJson(remainingUntilDeadline(iso))
    return
  }
  if (command === 'orphan-match') {
    const pid = readFlag(rest, '--pid')
    const startTicks = readFlag(rest, '--start-ticks')
    printJson({
      kill: orphanShouldKill(readStdin(), { pid, startTicks }),
    })
    return
  }
  if (command === 'schedule-now') {
    printJson(scheduledCaptureDecision())
    return
  }
  if (command === 'assert-tz') {
    const id = readFlag(rest, '--id')
    if (id == null) failClosed('missing --id')
    const ok = windowsTimeZoneOk(id)
    printJson({ ok, reason: ok ? '' : 'timezone' })
    return
  }
  if (command === 'triggers') {
    printJson(closeCaptureTaskSpec())
    return
  }
  if (command === 'read-usage') {
    const file = readFlag(rest, '--file')
    if (!file) failClosed('missing --file')
    if (!fs.existsSync(file)) {
      printJson(parseUsageText(null))
      return
    }
    printJson(parseUsageText(fs.readFileSync(file, 'utf8')))
    return
  }
  if (command === 'write-usage') {
    const file = readFlag(rest, '--file')
    const calls = readFlag(rest, '--calls')
    const cap = readFlag(rest, '--cap')
    const day = readFlag(rest, '--day')
    const runId = readFlag(rest, '--run') || ''
    if (!file || calls == null || cap == null) failClosed('missing usage fields')
    if (!/^\d+$/.test(calls) || !/^\d+$/.test(cap)) failClosed('usage fields must be integers')
    if (day != null && path.basename(file, path.extname(file)) !== day) failClosed('usage day mismatch')
    if (runId && !/^[A-Za-z0-9_-]+$/.test(runId)) failClosed('usage run id rejected')
    try {
      writeUsageFile(file, { callsUsed: Number(calls), cap: Number(cap), runId, day: day || '' })
    } catch {
      failClosed('usage write did not land')
    }
    printJson({ ok: true })
    return
  }
  if (command === 'recorded-calls') {
    const callsUsed = readFlag(rest, '--calls-used')
    const planned = readFlag(rest, '--planned') || '0'
    const reserved = optionalIntFlag(rest, '--reserved-calls')
    if (callsUsed == null || !/^\d+$/.test(callsUsed) || !/^\d+$/.test(planned) || reserved.invalid) {
      failClosed('recorded-calls needs integers')
    }
    printJson(recordedUsageTotal({
      prior: Number(callsUsed),
      raw: readStdin(),
      planned: Number(planned),
      readFailed: rest.includes('--read-failed'),
      reservedCalls: reserved.present ? reserved.value : 0,
    }))
    return
  }
  if (command === 'confirm-usage') {
    const file = readFlag(rest, '--file')
    const calls = readFlag(rest, '--calls')
    const cap = readFlag(rest, '--cap')
    const day = readFlag(rest, '--day')
    const runId = readFlag(rest, '--run')
    if (!file || calls == null || cap == null || day == null || runId == null) {
      failClosed('missing usage check')
    }
    if (!/^\d+$/.test(calls) || !/^\d+$/.test(cap)) failClosed('usage fields must be integers')
    let text = null
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      printJson({ ok: false, reason: 'missing' })
      return
    }
    printJson(usageMatchesRequest(text, {
      calls: Number(calls),
      cap: Number(cap),
      day,
      runId,
      fileDay: path.basename(file, path.extname(file)),
    }))
    return
  }
  if (command === 'plan') {
    const parsed = parseCaptureOutput(readStdin())
    const callsUsed = readFlag(rest, '--calls-used')
    const cap = readFlag(rest, '--cap')
    const ceiling = optionalIntFlag(rest, '--ceiling')
    if (callsUsed == null || cap == null || !/^\d+$/.test(callsUsed) || !/^\d+$/.test(cap) || ceiling.invalid) {
      failClosed('plan needs integer --calls-used and --cap')
    }
    printJson(planScheduledCapture({
      planned: parsed.planned,
      plannedKnown: parsed.plannedKnown,
      callsUsed: Number(callsUsed),
      cap: Number(cap),
      ceiling: ceiling.present ? ceiling.value : DEFAULT_CALL_CEILING,
      dryRunOnly: rest.includes('--dry-run-only'),
    }))
    return
  }
  if (command === 'line') {
    const reason = readFlag(rest, '--reason') || ''
    const status = readFlag(rest, '--status')
    const ceiling = optionalIntFlag(rest, '--ceiling')
    const safeReason = SUMMARY_REASONS.has(reason) ? reason : (reason ? 'bad-args' : '')
    process.stdout.write(`${buildCloseCaptureSummaryLine({
      status: status || 'skipped',
      reason: safeReason,
      ceiling: ceiling.present ? ceiling.value : DEFAULT_CALL_CEILING,
      ceilingHit: safeReason === 'cap-ceiling' || rest.includes('--ceiling-hit'),
      cap: Number(readFlag(rest, '--cap') || 0),
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
    const ceiling = optionalIntFlag(rest, '--ceiling')
    const reserved = optionalIntFlag(rest, '--reserved-calls')
    const readFailed = rest.includes('--read-failed')
    if (cap == null || !/^\d+$/.test(cap) || !/^\d+$/.test(raisedBy) || !/^\d+$/.test(planned)
      || !/^\d+$/.test(callsUsed) || !/^\d+$/.test(extraErrors) || ceiling.invalid || reserved.invalid
      || (readFailed && !reserved.present)) {
      failClosed('finalize needs integer fields')
    }
    const safeReason = SUMMARY_REASONS.has(reason) ? reason : ''
    const summary = summarizeCaptureOutput(readStdin(), {
      cap: Number(cap),
      capRaises: Number(raisedBy),
      ceiling: ceiling.present ? ceiling.value : DEFAULT_CALL_CEILING,
      ceilingHit: safeReason === 'cap-ceiling' || rest.includes('--ceiling-hit'),
      plannedFallback: Number(planned),
      recordCalls: rest.includes('--record-calls'),
      dryRunOnly: rest.includes('--dry-run-only'),
      reason: safeReason,
      extraErrors: Number(extraErrors),
      readFailed,
      reservedCalls: reserved.present ? reserved.value : 0,
    })
    if (rest.includes('--record-calls')) {
      if (!usageFile) failClosed('missing --usage-file')
      const runId = readFlag(rest, '--run') || ''
      const day = readFlag(rest, '--day')
      if (day != null && path.basename(usageFile, path.extname(usageFile)) !== day) {
        failClosed('usage day mismatch')
      }
      if (runId && !/^[A-Za-z0-9_-]+$/.test(runId)) failClosed('usage run id rejected')
      const totalCalls = Number(callsUsed) + summary.recordedCalls
      const nextCap = Number(cap)
      const fileDay = path.basename(usageFile, path.extname(usageFile))
      try {
        writeUsageFile(usageFile, {
          callsUsed: totalCalls,
          cap: nextCap,
          runId,
          day: day || '',
        })
      } catch {
        failClosed('usage write did not land')
      }
      const landed = landedUsage(fs.readFileSync(usageFile, 'utf8'), {
        calls: totalCalls,
        cap: nextCap,
        day: day || '',
        runId,
        fileDay,
      })
      if (!landed.ok) failClosed('usage write did not land')
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
