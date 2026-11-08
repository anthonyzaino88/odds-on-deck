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
  closeCaptureTaskTriggers,
  easternNow,
  formatUsageText,
  isQuietEtMinute,
  parseCaptureOutput,
  parseUsageText,
  planScheduledCapture,
  summarizeCaptureOutput,
} from '../../scripts/ops/close-capture-summary.js'

const helper = path.join(process.cwd(), 'scripts', 'ops', 'close-capture-summary.js')

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
    expect(parseUsageText('')).toEqual({
      ok: true,
      missing: true,
      callsUsed: 0,
      cap: DEFAULT_CALL_CAP,
    })
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

  test('task triggers are :04 :16 :26 :36 :46 :56 in the ET hour windows', () => {
    const lines = closeCaptureTaskTriggers()
    const minutes = new Set(lines.map((line) => line.slice(-2)))
    expect([...minutes].sort()).toEqual(['04', '16', '26', '36', '46', '56'])
    const byDay = {}
    for (const line of lines) {
      const [day, time] = line.split(' ')
      const hour = Number(time.slice(0, 2))
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(hour)
    }
    expect(Math.min(...byDay.Sunday)).toBe(9)
    expect(Math.max(...byDay.Sunday)).toBe(23)
    expect(Math.min(...byDay.Saturday)).toBe(12)
    expect(Math.max(...byDay.Saturday)).toBe(23)
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      expect(Math.min(...byDay[day])).toBe(18)
      expect(Math.max(...byDay[day])).toBe(23)
    }
    expect(lines).toHaveLength((15 + 12 + (6 * 5)) * 6)
    expect(lines.some((line) => line.endsWith(':05') || line.endsWith(':15') || line.endsWith(':00'))).toBe(false)
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
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
