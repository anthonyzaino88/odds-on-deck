import {
  buildRestorePreview,
  parseDnpBackupJson,
  parseRestoreDnpArgs,
  restorePayloadFromBackupRow,
  summarizeRestorePreviews,
} from '../../lib/restore-dnp-grades.js'
import { runRestoreDnpGrades } from '../../scripts/restore-dnp-grades.js'

function backupRow(overrides = {}) {
  return {
    id: 'pv-vinnie',
    playerName: 'Vinnie Pasquantino',
    propType: 'batter_hits',
    gameIdRef: 'KC_at_HOU_2026-09-17',
    result: 'incorrect',
    status: 'completed',
    actualValue: 0,
    notes: 'Validated: OVER 0.5 → Actual: 0',
    completedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  }
}

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

describe('restore-dnp-grades CLI flags', () => {
  test('defaults to dry-run; --backup or positional path is required', () => {
    expect(parseRestoreDnpArgs([])).toMatchObject({ apply: false, dryRun: true, backup: null })
    expect(parseRestoreDnpArgs(['--backup', 'backup.json'])).toMatchObject({
      apply: false,
      backup: 'backup.json',
    })
    expect(parseRestoreDnpArgs(['backup.json', '--apply'])).toMatchObject({
      apply: true,
      dryRun: false,
      backup: 'backup.json',
    })
  })
})

describe('restore payload / preview', () => {
  test('restores only grade fields from the backup snapshot', () => {
    const payload = restorePayloadFromBackupRow(backupRow({ edge: 0.05, playerName: 'Vinnie Pasquantino' }))
    expect(payload).toEqual({
      result: 'incorrect',
      status: 'completed',
      actualValue: 0,
      notes: 'Validated: OVER 0.5 → Actual: 0',
      completedAt: '2026-09-18T00:00:00.000Z',
    })
    expect(payload.playerName).toBeUndefined()
    expect(payload.edge).toBeUndefined()
  })

  test('skips unchanged and missing current rows', () => {
    const row = backupRow()
    const unchanged = buildRestorePreview(row, row)
    expect(unchanged.skip).toBe(true)
    expect(unchanged.skipReason).toBe('unchanged')

    const missing = buildRestorePreview(row, null)
    expect(missing.skip).toBe(true)
    expect(missing.skipReason).toBe('missing_current')

    const ready = buildRestorePreview(row, { ...row, result: 'void', status: 'manual_closed', actualValue: null })
    expect(ready.skip).toBe(false)
    expect(ready.oldResult).toBe('void')
    expect(ready.newResult).toBe('incorrect')
  })

  test('parses backup JSON arrays', () => {
    expect(parseDnpBackupJson(JSON.stringify([backupRow(), { noId: true }]))).toHaveLength(1)
    expect(() => parseDnpBackupJson('{')).toThrow(/Invalid backup JSON/)
    expect(() => parseDnpBackupJson('{"ok":true}')).toThrow(/array/)
  })
})

describe('runRestoreDnpGrades', () => {
  function mockClient(currentRows, updates) {
    return {
      from() {
        const query = {
          select() { return query },
          in() { return Promise.resolve({ data: currentRows, error: null }) },
          eq() { return Promise.resolve({ error: null }) },
          update(payload) {
            updates.push(payload)
            return query
          },
        }
        return query
      },
    }
  }

  test('dry-run prints restorations and never writes', async () => {
    const updates = []
    const log = memoryLog()
    const result = await runRestoreDnpGrades({
      argv: ['--backup', 'backup.json'],
      log,
      createClient: () => mockClient([{
        ...backupRow(),
        result: 'void',
        status: 'manual_closed',
        actualValue: null,
      }], updates),
      fileExists: () => true,
      readFile: () => JSON.stringify([backupRow()]),
    })
    expect(result.summary.ready).toBe(1)
    expect(result.applied).toBe(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/DRY-RUN/)
    expect(log.lines.join('\n')).toMatch(/void\/manual_closed -> incorrect\/completed/)
  })

  test('--apply writes the backed-up grade fields', async () => {
    const updates = []
    const result = await runRestoreDnpGrades({
      argv: ['--apply', '--backup', 'backup.json'],
      log: memoryLog(),
      createClient: () => mockClient([{
        ...backupRow(),
        result: 'void',
        status: 'manual_closed',
        actualValue: null,
      }], updates),
      fileExists: () => true,
      readFile: () => JSON.stringify([backupRow()]),
    })
    expect(result.applied).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      result: 'incorrect',
      status: 'completed',
      actualValue: 0,
    })
  })

  test('missing backup path exits 1 without connecting', async () => {
    const result = await runRestoreDnpGrades({
      argv: [],
      log: memoryLog(),
      createClient: () => { throw new Error('should not connect') },
    })
    expect(result.exitCode).toBe(1)
    expect(result.summary.total).toBe(0)
  })
})

describe('restore summary', () => {
  test('counts ready vs skipped', () => {
    const previews = [
      buildRestorePreview(backupRow(), { ...backupRow(), result: 'void', status: 'manual_closed' }),
      buildRestorePreview(backupRow({ id: 'same' }), backupRow({ id: 'same' })),
    ]
    expect(summarizeRestorePreviews(previews)).toMatchObject({
      total: 2,
      ready: 1,
      skipped: 1,
      unchanged: 1,
    })
  })
})
