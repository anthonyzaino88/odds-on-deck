import { PUBLISHED_SOURCE } from '../../lib/published-picks.js'
import { clvFromOdds } from '../../lib/closing-line.js'
import {
  formatClvSummary,
  runReportPublishedClv,
} from '../../scripts/report-published-clv.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function gradedPublished(overrides = {}) {
  return {
    id: 'pv-1',
    status: 'completed',
    result: 'correct',
    prediction: 'over',
    propType: 'batter_hits',
    threshold: 0.5,
    odds: 150,
    edge: 0.05,
    qualityScore: 48,
    sport: 'mlb',
    source: PUBLISHED_SOURCE,
    notes: 'cohort:published',
    completedAt: '2026-07-16T04:00:00.000Z',
    closeOdds: 130,
    closeLine: 0.5,
    closeBook: 'FanDuel',
    closeCapturedAt: '2026-07-15T23:00:00.000Z',
    ...overrides,
  }
}

function mockClient({ rows = [], error = null, fallbackRows = null } = {}) {
  let selectCount = 0
  return {
    from() {
      return {
        select(cols) {
          selectCount += 1
          const useFallback = error && fallbackRows && !String(cols).includes('closeOdds')
          const terminal = Promise.resolve({
            data: useFallback ? fallbackRows : (error && selectCount === 1 ? null : rows),
            error: error && selectCount === 1 && String(cols).includes('closeOdds') ? error : null,
          })
          const query = {
            eq() { return query },
            in() { return query },
            gt() { return query },
            gte() { return query },
            not() { return query },
            order() { return query },
            range() { return terminal },
          }
          return query
        },
        update() {
          throw new Error('report must not write')
        },
      }
    },
  }
}

describe('formatClvSummary', () => {
  test('prints avg CLV in probability points and beat-close percent', () => {
    const formatted = formatClvSummary({
      sample: 10,
      withClose: 8,
      beatClose: 5,
      pctBeatClose: 5 / 8,
      avgClvProb: 0.0215,
    })
    expect(formatted.avg).toBe('+2.15pp')
    expect(formatted.beat).toBe('62.5%')
    expect(formatted.line).toMatch(/8 with close \/ 10 Published/)
    expect(formatted.line).toMatch(/beat close 62.5%/)
  })
})

describe('runReportPublishedClv', () => {
  test('is read-only and summarizes CLV from stored closes', async () => {
    const log = memoryLog()
    const result = await runReportPublishedClv({
      createClient: () => mockClient({
        rows: [
          gradedPublished(),
          gradedPublished({
            id: 'pv-2',
            odds: 140,
            closeOdds: 160,
            result: 'incorrect',
          }),
          gradedPublished({
            id: 'pv-3',
            source: 'user_saved',
            closeOdds: 100,
          }),
        ],
      }),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.published).toHaveLength(2)
    expect(result.summary.withClose).toBe(2)
    expect(result.summary.beatClose).toBe(1)
    expect(result.summary.avgClvProb).toBeCloseTo((
      clvFromOdds(150, 130).clvProb
      + clvFromOdds(140, 160).clvProb
    ) / 2, 8)
    expect(log.lines.join('\n')).toMatch(/PUBLISHED CLV/)
    expect(log.lines.join('\n')).toMatch(/Does not write/)
  })

  test('falls back to zeros when 007 columns are missing', async () => {
    const log = memoryLog()
    const result = await runReportPublishedClv({
      createClient: () => mockClient({
        error: { code: '42703', message: 'column closeOdds does not exist' },
        fallbackRows: [gradedPublished({ closeOdds: undefined })],
      }),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.summary.withClose).toBe(0)
    expect(result.summary.avgClvProb).toBeNull()
    expect(log.lines.join('\n')).toMatch(/007 SQL/)
  })
})
