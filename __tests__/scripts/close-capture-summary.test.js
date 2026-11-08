import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  CAP_RAISE,
  DEFAULT_CALL_CAP,
  MAX_CALLS_PER_RUN,
  MAX_CREDITS_PER_RUN,
  callsToRecord,
  closeCaptureRepeatingTriggers,
  closeCaptureTaskSpec,
  containCapturedChild,
  DEFAULT_CALL_CEILING,
  easternNow,
  expandRepeatingTrigger,
  formatUsageText,
  isQuietEtMinute,
  nextQuietDeadline,
  orphanShouldKill,
  parseCaptureOutput,
  acceptFinalizeUsage,
  confirmUsageWrite,
  NATIVE_EXIT_SENTINEL,
  recordedUsageTotal,
  parseUsageText,
  planScheduledCapture,
  runNativeCommand,
  remainingUntilDeadline,
  scheduledCaptureDecision,
  settleCapturedChild,
  summarizeCaptureOutput,
  windowsTimeZoneOk,
  WINDOWS_TRIGGER_LIMIT,
  writeUsageFile,
} from '../../scripts/ops/close-capture-summary.mjs'

const helper = path.join(process.cwd(), 'scripts', 'ops', 'close-capture-summary.mjs')

function runHelper(args, input = '') {
  return spawnSync(process.execPath, [helper, ...args], {
    input,
    encoding: 'utf8',
  })
}

const SAMPLE = [
  'Odds API HTTP calls this run: 4',
  'ODDS_CREDITS_USED=99',
  'GAME LINES: 1 sport call(s), markets=h2h,totals, 2 credit(s) each.',
  '  game-line KC_at_BUF proposed=4 inserted=3 skipped=1 failed=0',
  '  game-line BUF_at_NYJ proposed=2 inserted=2 skipped=0 failed=1',
  'CLOSE_CAPTURE_STATUS=partial',
  'CLOSE_CAPTURE_CAPTURED=3 CLOSE_CAPTURE_SKIPPED_BUDGET=2 CLOSE_CAPTURE_SKIPPED_QUIET=0 CLOSE_CAPTURE_SKIPPED_WINDOW=1 CLOSE_CAPTURE_CREDITS=8',
  'SKIPPED_ALREADY_CLOSED=0',
  'ODDS_BUDGET_STATUS=close_cap',
  'CREDITS_USED=9',
  'CALLS_USED=3',
  '❌ fetch failed ODDS_API_KEY=super-secret-key',
].join('\n')

describe('close capture schedule parsing', () => {
  test('quiet minutes are 05 through 15 ET', () => {
    expect(isQuietEtMinute(4)).toBe(false)
    expect(isQuietEtMinute(5)).toBe(true)
    expect(isQuietEtMinute(15)).toBe(true)
    expect(isQuietEtMinute(16)).toBe(false)
    expect(easternNow(new Date('2026-11-08T18:05:00.000Z'))).toMatchObject({
      date: '2026-11-08',
      minute: 5,
      quiet: true,
    })
    expect(easternNow(new Date('2026-11-08T18:04:00.000Z')).quiet).toBe(false)
    expect(easternNow(new Date('2026-11-08T18:16:00.000Z')).quiet).toBe(false)
    expect(easternNow(new Date('2026-07-15T04:05:00.000Z')).quiet).toBe(true)
    expect(easternNow(new Date('2026-07-15T04:04:00.000Z')).quiet).toBe(false)
  })

  test('usage file is line 1 calls and optional cap=N, default 20', () => {
    expect(parseUsageText(null)).toEqual({
      ok: true,
      missing: true,
      callsUsed: 0,
      cap: DEFAULT_CALL_CAP,
      runId: '',
    })
    expect(parseUsageText('7\ncap=40\nrun=abc\n')).toMatchObject({
      ok: true,
      callsUsed: 7,
      cap: 40,
      runId: 'abc',
    })
    expect(parseUsageText('')).toMatchObject({ ok: false, reason: 'usage-unreadable' })
    expect(parseUsageText('   \n')).toMatchObject({ ok: false, reason: 'usage-unreadable' })
    expect(parseUsageText('7\n')).toMatchObject({ ok: true, callsUsed: 7, cap: 20 })
    expect(parseUsageText('7\ncap=40\n')).toMatchObject({ ok: true, callsUsed: 7, cap: 40 })
    expect(parseUsageText('nope\n')).toMatchObject({ ok: false, reason: 'usage-unreadable' })
    expect(parseUsageText('1\ncap=abc\n')).toMatchObject({ ok: false, reason: 'usage-unreadable' })
    expect(parseUsageText(formatUsageText({ callsUsed: 3, cap: 40 }))).toMatchObject({
      callsUsed: 3,
      cap: 40,
    })
  })

  test('a full cap with a planned dry run raises by 20 and apply uses min(10, remaining)', () => {
    const raised = planScheduledCapture({
      planned: 6,
      plannedKnown: true,
      callsUsed: 20,
      cap: 20,
    })
    expect(raised).toMatchObject({
      action: 'apply',
      raisedBy: CAP_RAISE,
      cap: 40,
      remaining: 20,
      maxCalls: MAX_CALLS_PER_RUN,
      maxCredits: MAX_CREDITS_PER_RUN,
    })
    expect(planScheduledCapture({
      planned: 6,
      plannedKnown: true,
      callsUsed: 13,
      cap: 20,
    })).toMatchObject({
      action: 'apply',
      raisedBy: 0,
      cap: 20,
      maxCalls: 7,
    })
    expect(planScheduledCapture({
      planned: 0,
      plannedKnown: true,
      callsUsed: 20,
      cap: 20,
    })).toMatchObject({
      action: 'exit',
      reason: 'nothing-planned',
      raisedBy: 0,
      cap: 20,
    })
    expect(planScheduledCapture({
      planned: 4,
      plannedKnown: true,
      callsUsed: 0,
      cap: 0,
      dryRunOnly: true,
    })).toMatchObject({
      action: 'dry-run-only',
      raisedBy: 0,
      cap: 0,
      maxCalls: 0,
    })
    expect(planScheduledCapture({
      plannedKnown: false,
      callsUsed: 0,
      cap: 20,
    })).toMatchObject({ action: 'exit', reason: 'plan-unknown', raisedBy: 0 })
  })

  test('CALLS_USED is added, and a missing line falls back to the dry-run plan', () => {
    expect(callsToRecord({ callsUsedPresent: true, callsUsed: 3, planned: 9 })).toBe(3)
    expect(callsToRecord({ callsUsedPresent: true, callsUsed: 0, planned: 9 })).toBe(0)
    expect(callsToRecord({ callsUsedPresent: false, callsUsed: 0, planned: 9 })).toBe(9)
    expect(callsToRecord({
      callsUsedPresent: true,
      callsUsed: 2,
      planned: 4,
      readFailed: true,
      reservedCalls: 10,
    })).toBe(10)
  })

  test('summary keeps counts and drops secret text', () => {
    const parsed = parseCaptureOutput(SAMPLE)
    expect(parsed).toMatchObject({
      planned: 4,
      plannedKnown: true,
      callsUsed: 3,
      callsUsedPresent: true,
      status: 'partial',
      captured: 3,
      credits: 9,
      budgetStatus: 'close_cap',
      errors: 1,
      gameLine: { proposed: 6, inserted: 5, skipped: 1, failed: 1 },
    })
    expect(parsed.skipped).toEqual({
      CLOSE_CAPTURE_SKIPPED_BUDGET: 2,
      CLOSE_CAPTURE_SKIPPED_WINDOW: 1,
    })
    const summary = summarizeCaptureOutput(SAMPLE, {
      stamp: '2026-11-08 18:16:00 ET',
      cap: 40,
      capRaises: 20,
      plannedFallback: 4,
      recordCalls: true,
      now: new Date('2026-11-08T23:16:00.000Z'),
    })
    expect(summary.recordedCalls).toBe(3)
    expect(summary.line).toContain('2026-11-08 18:16:00 ET')
    expect(summary.line).toContain('CLOSE_CAPTURE_STATUS=partial')
    expect(summary.line).toContain('CAPTURED=3')
    expect(summary.line).toContain('game_line_proposed=6')
    expect(summary.line).toContain('game_line_inserted=5')
    expect(summary.line).toContain('game_line_skipped=1')
    expect(summary.line).toContain('game_line_failed=1')
    expect(summary.line).toContain('CLOSE_CAPTURE_SKIPPED_BUDGET=2')
    expect(summary.line).toContain('CLOSE_CAPTURE_SKIPPED_WINDOW=1')
    expect(summary.line).not.toContain('SKIPPED_QUIET')
    expect(summary.line).not.toContain('SKIPPED_ALREADY_CLOSED')
    expect(summary.line).toContain('calls=3')
    expect(summary.line).toContain('credits=9')
    expect(summary.line).toContain('cap=40')
    expect(summary.line).toContain('cap_raises=20')
    expect(summary.line).toContain('ODDS_BUDGET_STATUS=close_cap')
    expect(summary.line).toContain('errors=1')
    expect(summary.line).not.toContain('super-secret-key')
    expect(JSON.stringify(parsed)).not.toContain('super-secret-key')

    const missingCalls = summarizeCaptureOutput(
      'Odds API HTTP calls this run: 4\nCLOSE_CAPTURE_STATUS=ok\n',
      { recordCalls: true, plannedFallback: 4, stamp: '2026-11-08 18:16:00 ET' },
    )
    expect(missingCalls.recordedCalls).toBe(4)
    expect(missingCalls.line).toContain('calls=4')

    const ledger = summarizeCaptureOutput(
      'Odds API HTTP calls this run: 1\nODDS_BUDGET_STATUS=ledger_unreadable\nCALLS_USED=1\n',
      { recordCalls: true, stamp: '2026-11-08 18:16:00 ET' },
    )
    expect(ledger.line).toContain('ODDS_BUDGET_STATUS=ledger_unreadable')
  })

  test('repeating triggers stay under the Windows limit and land on :04/:16', () => {
    const spec = closeCaptureTaskSpec()
    expect(spec.count).toBe(6)
    expect(spec.count).toBeLessThanOrEqual(WINDOWS_TRIGGER_LIMIT)
    expect(WINDOWS_TRIGGER_LIMIT).toBe(48)
    expect(spec.executionTimeLimitSeconds).toBe((48 * 60) + 50)
    expect(spec.windowsTimeZone).toBe('Eastern Standard Time')
    expect(spec.enabledByDefault).toBe(false)
    const triggers = closeCaptureRepeatingTriggers()
    expect(triggers.map((trigger) => trigger.minute).sort((a, b) => a - b)).toEqual([4, 16, 26, 36, 46, 56])
    const fires = triggers.flatMap((trigger) => expandRepeatingTrigger(trigger))
    const minutes = new Set(fires.map((fire) => fire.minute))
    expect([...minutes].sort((a, b) => a - b)).toEqual([4, 16, 26, 36, 46, 56])
    expect(fires.some((fire) => fire.hour === 9 && fire.minute === 4)).toBe(true)
    expect(fires.some((fire) => fire.hour === 23 && fire.minute === 56)).toBe(true)
    expect(fires.some((fire) => fire.hour === 0 || fire.minute === 14 || fire.minute === 5)).toBe(false)
  })

  test('the wrapper gate keeps Sunday 09-23, Saturday 12-23, and weekdays 18-23', () => {
    expect(scheduledCaptureDecision(new Date('2026-11-08T14:04:00.000Z'))).toMatchObject({
      weekday: 'Sunday', hour: 9, minute: 4, allowed: true,
    })
    expect(scheduledCaptureDecision(new Date('2026-11-08T13:56:00.000Z')).allowed).toBe(false)
    expect(scheduledCaptureDecision(new Date('2026-11-09T04:56:00.000Z'))).toMatchObject({
      weekday: 'Sunday', hour: 23, minute: 56, allowed: true,
    })
    expect(scheduledCaptureDecision(new Date('2026-11-08T14:14:00.000Z')).allowed).toBe(false)
    expect(scheduledCaptureDecision(new Date('2026-11-07T17:16:00.000Z'))).toMatchObject({
      weekday: 'Saturday', hour: 12, minute: 16, allowed: true,
    })
    expect(scheduledCaptureDecision(new Date('2026-11-07T16:56:00.000Z')).allowed).toBe(false)
    expect(scheduledCaptureDecision(new Date('2026-11-09T23:04:00.000Z'))).toMatchObject({
      weekday: 'Monday', hour: 18, minute: 4, allowed: true,
    })
    expect(scheduledCaptureDecision(new Date('2026-11-09T22:56:00.000Z')).allowed).toBe(false)
    expect(scheduledCaptureDecision(new Date('2026-07-15T22:46:00.000Z'))).toMatchObject({
      weekday: 'Wednesday', hour: 18, minute: 46, allowed: true,
    })
    expect(scheduledCaptureDecision(new Date('2026-07-15T21:46:00.000Z')).allowed).toBe(false)
  })

  test('the quiet deadline is :04:50 ET in both EST and EDT', () => {
    const est = nextQuietDeadline(new Date('2026-11-08T23:04:01.000Z'))
    expect(easternNow(new Date('2026-11-08T23:04:01.000Z'))).toMatchObject({ hour: 18, minute: 4, second: 1 })
    expect(est.iso).toBe('2026-11-08T23:04:50.000Z')
    expect(est.remainingMs).toBe(49_000)
    const later = nextQuietDeadline(new Date('2026-11-08T23:16:00.000Z'))
    expect(later.iso).toBe('2026-11-09T00:04:50.000Z')
    const due = nextQuietDeadline(new Date('2026-11-08T23:04:50.000Z'))
    expect(due.iso).toBe('2026-11-08T23:04:50.000Z')
    expect(due.remainingMs).toBe(0)
    const edt = nextQuietDeadline(new Date('2026-07-15T22:04:01.000Z'))
    expect(easternNow(new Date('2026-07-15T22:04:01.000Z'))).toMatchObject({ hour: 18, minute: 4, second: 1 })
    expect(edt.iso).toBe('2026-07-15T22:04:50.000Z')
    const frozen = '2026-11-08T23:04:50.000Z'
    const afterQuiet = remainingUntilDeadline(frozen, new Date('2026-11-08T23:06:00.000Z'))
    expect(afterQuiet).toMatchObject({ ok: true, iso: frozen, remainingMs: 0 })
    expect(nextQuietDeadline(new Date('2026-11-08T23:06:00.000Z')).iso).toBe('2026-11-09T00:04:50.000Z')
    expect(afterQuiet.iso).not.toBe(nextQuietDeadline(new Date('2026-11-08T23:06:00.000Z')).iso)
  })

  test('a timeout waits out an async kill before reading output', async () => {
    let alive = true
    const order = []
    const settled = await settleCapturedChild({
      timedOut: true,
      reservedCalls: 10,
      kill() {
        order.push('kill')
        setTimeout(() => { alive = false }, 20)
      },
      waitForExit() {
        order.push('wait')
        return new Promise((resolve) => {
          const timer = setInterval(() => {
            if (!alive) {
              clearInterval(timer)
              order.push('exited')
              resolve(true)
            }
          }, 5)
        })
      },
      readOutput() {
        order.push('read')
        if (alive) throw new Error('still running')
        throw new Error('sharing violation')
      },
      clearOwnership() { order.push('clear') },
      release() { order.push('release') },
    })
    expect(order).toEqual(['kill', 'wait', 'exited', 'read', 'clear', 'release'])
    expect(settled).toMatchObject({ exited: true, readFailed: true, text: '', calls: 10 })
    const readOutput = jest.fn()
    const stuck = await settleCapturedChild({
      timedOut: true,
      reservedCalls: 10,
      kill() {},
      waitForExit: async () => false,
      readOutput,
      clearOwnership() { throw new Error('cleared before exit') },
      release() { throw new Error('released before exit') },
    })
    expect(readOutput).not.toHaveBeenCalled()
    expect(stuck).toMatchObject({ exited: false, readFailed: true, calls: 10 })
  })

  test('a failed job assign does not resume the child', () => {
    const resume = jest.fn(() => true)
    const kill = jest.fn()
    const recordPid = jest.fn()
    const startSuspended = jest.fn(() => ({ pid: 42 }))
    const missed = containCapturedChild({
      jobReady: true,
      startSuspended,
      assign: () => false,
      recordPid,
      resume,
      kill,
    })
    expect(missed).toMatchObject({ ran: false, resumed: false, reason: 'assign-failed' })
    expect(startSuspended).toHaveBeenCalledTimes(1)
    expect(recordPid).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(kill).toHaveBeenCalledTimes(1)
    const noJob = containCapturedChild({
      jobReady: false,
      startSuspended,
      assign: () => true,
      recordPid,
      resume,
      kill,
    })
    expect(noJob.ran).toBe(false)
    expect(startSuspended).toHaveBeenCalledTimes(1)
  })

  test('a stale lock kills only when the pid and start time both match', () => {
    const lock = 'pid=42\r\nstartTicks=100\r\n'
    expect(orphanShouldKill(lock, { pid: 42, startTicks: '100' })).toBe(true)
    expect(orphanShouldKill(lock, { pid: 42, startTicks: '101' })).toBe(false)
    expect(orphanShouldKill(lock, { pid: 7, startTicks: '100' })).toBe(false)
    expect(orphanShouldKill('pid=42\r\n', { pid: 42, startTicks: '100' })).toBe(false)
    expect(orphanShouldKill('', { pid: 42, startTicks: '100' })).toBe(false)
  })

  test('auto-raise stays +20 and stops at the hard ceiling', () => {
    expect(DEFAULT_CALL_CEILING).toBe(80)
    expect(planScheduledCapture({
      planned: 4,
      plannedKnown: true,
      callsUsed: 80,
      cap: 80,
    })).toMatchObject({
      action: 'exit',
      reason: 'cap-ceiling',
      raisedBy: 0,
      cap: 80,
      ceilingHit: true,
    })
    expect(planScheduledCapture({
      planned: 4,
      plannedKnown: true,
      callsUsed: 70,
      cap: 70,
      ceiling: 80,
    })).toMatchObject({
      action: 'apply',
      cap: 80,
      raisedBy: 10,
      ceilingHit: true,
      maxCalls: 10,
    })
    expect(planScheduledCapture({
      planned: 4,
      plannedKnown: true,
      callsUsed: 20,
      cap: 20,
      ceiling: 30,
    })).toMatchObject({
      action: 'apply',
      cap: 30,
      raisedBy: 10,
      ceilingHit: true,
    })
    const blocked = summarizeCaptureOutput('Odds API HTTP calls this run: 4\n', {
      reason: 'cap-ceiling',
      cap: 80,
      ceiling: 80,
      stamp: '2026-11-08 18:16:00 ET',
    })
    expect(blocked.line).toContain('reason=cap-ceiling')
    expect(blocked.line).toContain('cap_ceiling=80')
    expect(planScheduledCapture({
      planned: 4,
      plannedKnown: true,
      callsUsed: 20,
      cap: 20,
      dryRunOnly: true,
    }).raisedBy).toBe(0)
  })

  test('usage writes are a temp file renamed into place', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clv-atomic-'))
    const file = path.join(dir, '2026-11-08.txt')
    writeUsageFile(file, { callsUsed: 8, cap: 40 })
    writeUsageFile(file, { callsUsed: 9, cap: 40 })
    expect(fs.readFileSync(file, 'utf8')).toBe('9\ncap=40\n')
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([])
    fs.writeFileSync(file, '')
    expect(parseUsageText(fs.readFileSync(file, 'utf8'))).toMatchObject({
      ok: false,
      reason: 'usage-unreadable',
    })
    fs.writeFileSync(file, 'not-a-count\n')
    expect(parseUsageText(fs.readFileSync(file, 'utf8')).ok).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('the Windows time zone must be Eastern Standard Time', () => {
    expect(windowsTimeZoneOk('Eastern Standard Time')).toBe(true)
    expect(windowsTimeZoneOk('Eastern Daylight Time')).toBe(false)
    expect(windowsTimeZoneOk('UTC')).toBe(false)
  })

  test('the task scripts register a disabled repeating task and kill Node by the deadline', () => {
    const register = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'register-close-capture-task.ps1'), 'utf8')
    const wrapper = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'scheduled-close-capture.ps1'), 'utf8')
    const enabledAt = register.indexOf('$settings.Enabled = $false')
    const registerAt = register.lastIndexOf('Register-ScheduledTask')
    expect(enabledAt).toBeGreaterThan(-1)
    expect(registerAt).toBeGreaterThan(enabledAt)
    expect(register).not.toContain('Disable-ScheduledTask')
    expect(register).not.toContain('Enable-ScheduledTask')
    expect(register).toContain('RepetitionInterval')
    expect(register).toContain('RepetitionDuration')
    expect(register).toContain('$daily.Repetition = $once.Repetition')
    expect(register).toContain('-Once')
    expect(register.split(/\r?\n/).filter((line) => {
      const code = line.trim()
      return !code.startsWith('#') && code.includes('-Daily') && code.includes('-RepetitionInterval')
    })).toEqual([])
    expect(register).toContain('executionTimeLimitSeconds')
    expect(register).toContain('Eastern Standard Time')
    expect(register).toContain('-gt 48')
    expect(wrapper).toContain('Eastern Standard Time')
    expect(wrapper).toContain('--deadline')
    expect(wrapper).toContain('Stop-Process')
    expect(wrapper).toContain('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE')
    expect(wrapper).toContain('CREATE_SUSPENDED')
    expect(wrapper).toContain('SupportsShouldProcess')
    expect(wrapper).toContain('pid=')
    expect(wrapper).toContain('startTicks=')
    expect(wrapper).toContain('Clear-LockPid')
    expect(wrapper).toContain('schedule-now')
    expect(wrapper).toContain("'remaining'")
    expect(wrapper.match(/HelperArgs @\('deadline'\)/g)).toHaveLength(1)
    expect(wrapper).not.toMatch(/catch\s*\{[^}]*\$jobHandle = \[IntPtr\]::Zero/)
    const assignAt = wrapper.indexOf('[CloseCaptureJob]::Assign(')
    const recordAt = wrapper.indexOf('Write-LockPid -Lock')
    const resumeAt = wrapper.indexOf('[CloseCaptureJob]::Resume(')
    expect(assignAt).toBeGreaterThan(-1)
    expect(recordAt).toBeGreaterThan(assignAt)
    expect(resumeAt).toBeGreaterThan(recordAt)
    expect(wrapper).toContain('function Get-DeadlineRemaining')
    expect(wrapper).not.toContain('Get-DeadlineRemainingMs')
    expect(wrapper).toContain('--read-failed')
    expect(wrapper).toContain('--reserved-calls')
    expect(wrapper).toContain('$plan.maxCalls')
    const timeoutAt = wrapper.indexOf('if ($wait -ne 0)')
    const confirmAt = wrapper.indexOf('Wait-CapturedExit -Started $started', timeoutAt)
    const readAt = wrapper.indexOf('ReadAllText', confirmAt)
    const clearAt = wrapper.indexOf('Clear-LockPid -Lock $Lock', readAt)
    const releaseAt = wrapper.indexOf('[CloseCaptureJob]::Release', readAt)
    expect(confirmAt).toBeGreaterThan(timeoutAt)
    expect(readAt).toBeGreaterThan(confirmAt)
    expect(wrapper.lastIndexOf('try {', readAt)).toBeGreaterThan(confirmAt)
    expect(wrapper.indexOf('} catch {', readAt)).toBeGreaterThan(readAt)
    expect(clearAt).toBeGreaterThan(readAt)
    expect(releaseAt).toBeGreaterThan(readAt)
    const productionFlags = "'--nfl-all', '--nhl-all', '--game-lines', '--spreads'"
    expect(wrapper).toContain(`${productionFlags}, '--dry-run'`)
    expect(wrapper).toContain(`${productionFlags}, '--apply'`)
    expect(wrapper).toContain('close-capture-summary.mjs')
    expect(register).toContain('close-capture-summary.mjs')
    expect(wrapper).not.toContain('close-capture-summary.js')
    expect(register).not.toContain('close-capture-summary.js')
    for (const source of [wrapper, register]) {
      const calls = [...source.matchAll(/& node\b/g)]
      expect(calls.length).toBeGreaterThan(0)
      for (const match of calls) {
        const before = source.slice(0, match.index)
        const continueAt = before.lastIndexOf("$ErrorActionPreference = 'Continue'")
        const stopAt = before.lastIndexOf("$ErrorActionPreference = 'Stop'")
        expect(continueAt).toBeGreaterThan(stopAt)
        const lineStart = source.lastIndexOf('\n', match.index - 1) + 1
        const previousLine = source.slice(source.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1).trim()
        expect(previousLine).toBe('$global:LASTEXITCODE = -999')
        const after = source.slice(match.index)
        const restoreAt = after.indexOf('$ErrorActionPreference = $preference')
        expect(restoreAt).toBeGreaterThan(-1)
        expect(after.slice(0, restoreAt)).toContain('$global:LASTEXITCODE -ne 0')
      }
    }
    const writes = [...wrapper.matchAll(/'write-usage'/g)]
    expect(writes.length).toBe(2)
    for (const match of writes) {
      expect(wrapper.slice(match.index, match.index + 700)).toContain('Test-UsageFile')
    }
    const usageRecordAt = wrapper.lastIndexOf("'--record-calls'")
    const afterRecord = wrapper.slice(usageRecordAt, usageRecordAt + 1800)
    const preciseAt = afterRecord.indexOf('Test-UsageFile')
    const fallbackAt = afterRecord.indexOf('$fallbackUsed')
    expect(afterRecord.indexOf('recorded-calls')).toBeGreaterThan(-1)
    expect(preciseAt).toBeGreaterThan(afterRecord.indexOf('recorded-calls'))
    expect(fallbackAt).toBeGreaterThan(preciseAt)
    expect(afterRecord.slice(fallbackAt)).toContain('$plan.maxCalls')
    expect(afterRecord.slice(fallbackAt)).toContain('Test-UsageFile')
  })

  test('a prior LASTEXITCODE of 0 with no update must fail', () => {
    const stale = runNativeCommand({
      priorExit: 0,
      invoke() {},
    })
    expect(NATIVE_EXIT_SENTINEL).toBe(-999)
    expect(stale).toEqual({ ok: false, code: -999 })
    const fresh = runNativeCommand({
      priorExit: 0,
      invoke({ setExit }) { setExit(0) },
    })
    expect(fresh).toEqual({ ok: true, code: 0 })
  })

  test('a mocked write-usage that writes no file must fail', () => {
    const missed = confirmUsageWrite({
      write: () => ({ exitCode: 0 }),
      readFile: () => null,
      requested: { calls: 20, cap: 40, day: '2026-11-08', runId: 'run-a' },
    })
    expect(missed).toMatchObject({ ok: false, reason: 'missing' })
  })

  test('an old 20/20 usage file is not a write of cap 40', () => {
    const stale = confirmUsageWrite({
      write: () => ({ exitCode: 0 }),
      readFile: () => ({ text: '20\ncap=20\n', fileDay: '2026-11-08' }),
      requested: { calls: 20, cap: 40, day: '2026-11-08', runId: 'run-new' },
    })
    expect(stale.ok).toBe(false)
    expect(stale.reason).toBe('cap')
    const landed = confirmUsageWrite({
      write: () => ({ exitCode: 0 }),
      readFile: () => ({
        text: '20\ncap=40\nrun=run-new\n',
        fileDay: '2026-11-08',
      }),
      requested: { calls: 20, cap: 40, day: '2026-11-08', runId: 'run-new' },
    })
    expect(landed).toMatchObject({ ok: true, reason: '' })
  })

  test('a no-op finalize must not be accepted', () => {
    let text = '4\ncap=40\n'
    let fallbackCalls = null
    const noop = acceptFinalizeUsage({
      finalize: () => ({ exitCode: 0, text: 'CLOSE_CAPTURE_STATUS=ok calls=2 cap=40' }),
      readFile: () => ({ text, fileDay: '2026-11-08' }),
      writeFallback(calls) {
        fallbackCalls = calls
        return { exitCode: 0 }
      },
      prior: 4,
      used: 2,
      reserved: 10,
      cap: 40,
      day: '2026-11-08',
      runId: 'run-1',
    })
    expect(noop.accepted).toBe(false)
    expect(noop.ok).toBe(false)
    expect(fallbackCalls).toBe(14)
    expect(recordedUsageTotal({
      prior: 4,
      raw: 'CALLS_USED=2\n',
      planned: 3,
      reservedCalls: 10,
    })).toEqual({ used: 2, total: 6 })

    text = '4\ncap=40\nrun=run-1\n'
    const charged = acceptFinalizeUsage({
      finalize: () => ({ exitCode: 0, text: 'CLOSE_CAPTURE_STATUS=ok calls=2 cap=40' }),
      readFile: () => ({ text, fileDay: '2026-11-08' }),
      writeFallback(calls) {
        text = `${calls}\ncap=40\nrun=run-1\n`
        return { exitCode: 0 }
      },
      prior: 4,
      used: 2,
      reserved: 10,
      cap: 40,
      day: '2026-11-08',
      runId: 'run-1',
    })
    expect(charged.accepted).toBe(false)
    expect(charged.ok).toBe(true)
    expect(charged.fallback).toBe(true)
    expect(charged.calls).toBe(14)
    expect(text).toBe('14\ncap=40\nrun=run-1\n')

    let wroteFallback = false
    const precise = acceptFinalizeUsage({
      finalize: () => ({ exitCode: 0, text: 'CLOSE_CAPTURE_STATUS=ok calls=2 cap=40' }),
      readFile: () => ({ text: '6\ncap=40\nrun=run-1\n', fileDay: '2026-11-08' }),
      writeFallback() {
        wroteFallback = true
        return { exitCode: 0 }
      },
      prior: 4,
      used: 2,
      reserved: 10,
      cap: 40,
      day: '2026-11-08',
      runId: 'run-1',
    })
    expect(precise).toMatchObject({ ok: true, accepted: true, fallback: false, calls: 6 })
    expect(wroteFallback).toBe(false)
  })

  test('the helper module does not warn about a typeless package.json', () => {
    const result = runHelper(['triggers'])
    expect(result.status).toBe(0)
    expect(result.stderr || '').not.toMatch(/MODULE_TYPELESS_PACKAGE_JSON/)
    expect(JSON.parse(result.stdout).triggers.length).toBeGreaterThan(0)
  })

  test('.local usage and logs stay gitignored', () => {
    const ignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')
    expect(ignore).toMatch(/^\/\.local\/$/m)
  })

  test('the helper CLI plans, redacts, and writes usage', () => {
    const raised = runHelper(
      ['plan', '--calls-used', '20', '--cap', '20'],
      'Odds API HTTP calls this run: 3\nCALLS_USED=0\nODDS_API_KEY=super-secret-key\n',
    )
    expect(raised.status).toBe(0)
    expect(raised.stdout).not.toContain('super-secret-key')
    expect(raised.stderr).not.toContain('super-secret-key')
    expect(JSON.parse(raised.stdout)).toMatchObject({
      action: 'apply',
      maxCalls: 10,
      maxCredits: 150,
      cap: 40,
      raisedBy: 20,
    })

    const leaked = runHelper(['plan', '--apiKey=super-secret-key'])
    expect(leaked.status).not.toBe(0)
    expect(`${leaked.stdout}\n${leaked.stderr}`).not.toContain('super-secret-key')
    expect(leaked.stderr).toContain('unknown argument --apiKey')

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clv-cap-'))
    const file = path.join(dir, '2026-11-08.txt')
    const written = runHelper(['write-usage', '--file', file, '--calls', '4', '--cap', '40'])
    expect(written.status).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).toBe('4\ncap=40\n')
    const read = runHelper(['read-usage', '--file', file])
    expect(JSON.parse(read.stdout)).toMatchObject({ callsUsed: 4, cap: 40, ok: true })

    const finalized = runHelper(
      ['finalize', '--cap', '40', '--raised-by', '20', '--planned', '3', '--calls-used', '4', '--usage-file', file, '--record-calls'],
      'Odds API HTTP calls this run: 3\nCLOSE_CAPTURE_STATUS=ok\nCLOSE_CAPTURE_CAPTURED=1\nCALLS_USED=2\nCREDITS_USED=6\n',
    )
    expect(finalized.status).toBe(0)
    expect(finalized.stdout).toContain('calls=2')
    expect(finalized.stdout).toContain('cap_raises=20')
    expect(fs.readFileSync(file, 'utf8')).toBe('6\ncap=40\n')
    fs.writeFileSync(file, '')
    const empty = runHelper(['read-usage', '--file', file])
    expect(JSON.parse(empty.stdout)).toMatchObject({ ok: false, reason: 'usage-unreadable' })
    const missing = runHelper(['read-usage', '--file', path.join(dir, 'missing.txt')])
    expect(JSON.parse(missing.stdout)).toMatchObject({ ok: true, missing: true, callsUsed: 0 })
    const capped = runHelper(
      ['plan', '--calls-used', '80', '--cap', '80', '--ceiling', '80'],
      'Odds API HTTP calls this run: 2\n',
    )
    expect(JSON.parse(capped.stdout)).toMatchObject({ action: 'exit', reason: 'cap-ceiling', raisedBy: 0 })
    const leakedCeiling = runHelper(['plan', '--calls-used', '1', '--cap', '20', '--ceiling', 'nope'])
    expect(leakedCeiling.status).not.toBe(0)
    expect(`${leakedCeiling.stdout}\n${leakedCeiling.stderr}`).not.toContain('nope')
    const triggers = runHelper(['triggers'])
    expect(JSON.parse(triggers.stdout).count).toBeLessThanOrEqual(48)
    const tz = runHelper(['assert-tz', '--id', 'Pacific Standard Time'])
    expect(tz.stdout).not.toContain('Pacific')
    expect(JSON.parse(tz.stdout)).toMatchObject({ ok: false, reason: 'timezone' })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
