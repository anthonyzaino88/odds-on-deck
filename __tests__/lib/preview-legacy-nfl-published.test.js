import {
  parsePreviewLegacyNflArgs,
  formatPublishedSummaryLine,
  runPreviewLegacyNflPublished,
} from '../../scripts/preview-legacy-nfl-published.js'
import { PUBLISHED_SOURCE } from '../../lib/published-picks.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function publishedRow(overrides = {}) {
  return {
    id: 'pv-legacy-1',
    status: 'completed',
    result: 'correct',
    prediction: 'over',
    propType: 'receptions',
    threshold: 4.5,
    odds: 150,
    edge: 0.24,
    qualityScore: 42,
    sport: 'nfl',
    source: PUBLISHED_SOURCE,
    timestamp: '2025-11-02T16:00:00.000Z',
    completedAt: '2025-11-03T12:00:00.000Z',
    playerName: 'Legacy WR',
    probability: 0.508,
    gameIdRef: 'game-legacy',
    ...overrides,
  }
}

function fakeClient(rows) {
  const calls = []
  return {
    calls,
    from() {
      const query = {
        select: (cols) => { calls.push(['select', cols]); return query },
        eq: (...args) => { calls.push(['eq', ...args]); return query },
        in: (...args) => { calls.push(['in', ...args]); return query },
        gt: (...args) => { calls.push(['gt', ...args]); return query },
        gte: (...args) => { calls.push(['gte', ...args]); return query },
        not: (...args) => { calls.push(['not', ...args]); return query },
        order: (...args) => { calls.push(['order', ...args]); return query },
        range: async () => ({ data: rows, error: null }),
      }
      return query
    },
  }
}

describe('preview-legacy-nfl-published CLI', () => {
  test('is always dry-run; --apply is not a write switch', () => {
    expect(parsePreviewLegacyNflArgs([])).toMatchObject({ dryRun: true, apply: false })
    expect(parsePreviewLegacyNflArgs(['--dry-run'])).toMatchObject({ dryRun: true })
    expect(parsePreviewLegacyNflArgs(['--apply'])).toMatchObject({ apply: true, dryRun: true })
  })

  test('formats a Published summary line with units and ROI', () => {
    expect(formatPublishedSummaryLine({
      record: '328–331',
      decided: 659,
      units: 2.52,
      roi: 0.0038,
    })).toBe('328–331   659 decided   +2.52u   ROI 0.38%')
  })
})

describe('runPreviewLegacyNflPublished', () => {
  test('--help and --apply never query the database', async () => {
    const helpLog = memoryLog()
    const help = await runPreviewLegacyNflPublished({
      argv: ['--help'],
      createClient: () => { throw new Error('should not connect') },
      log: helpLog,
    })
    expect(help.exitCode).toBe(0)
    expect(helpLog.lines.join('\n')).toMatch(/Read-only/)

    const applyLog = memoryLog()
    const apply = await runPreviewLegacyNflPublished({
      argv: ['--apply'],
      createClient: () => { throw new Error('should not connect') },
      log: applyLog,
    })
    expect(apply.exitCode).toBe(2)
    expect(applyLog.lines.join('\n')).toMatch(/never writes/)
  })

  test('prints before / after and the exact excluded rows', async () => {
    const rows = [
      publishedRow(),
      publishedRow({
        id: 'pv-modern',
        playerName: 'Modern WR',
        timestamp: '2026-09-10T16:00:00.000Z',
        result: 'incorrect',
        odds: -110,
        edge: 0.02,
        probability: 0.49,
      }),
    ]
    const log = memoryLog()
    const result = await runPreviewLegacyNflPublished({
      argv: [],
      createClient: () => fakeClient(rows),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].id).toBe('pv-legacy-1')
    expect(result.comparison.before.correct).toBe(1)
    expect(result.comparison.before.incorrect).toBe(1)
    expect(result.comparison.after.incorrect).toBe(1)
    expect(result.comparison.after.correct).toBe(0)
    const text = log.lines.join('\n')
    expect(text).toMatch(/READ-ONLY/)
    expect(text).toMatch(/pv-legacy-1/)
    expect(text).toMatch(/Legacy WR/)
    expect(text).not.toMatch(/pv-modern/)
  })
})
