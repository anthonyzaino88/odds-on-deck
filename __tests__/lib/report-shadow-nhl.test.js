import { PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import { clvFromOdds } from '../../lib/closing-line.js'
import {
  formatShadowNhlSummary,
  runReportShadowNhl,
} from '../../scripts/report-shadow-nhl.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function gradedShadow(overrides = {}) {
  return {
    id: 'pv-nhl-1',
    status: 'completed',
    result: 'correct',
    prediction: 'over',
    propType: 'player_shots_on_goal',
    threshold: 2.5,
    odds: 150,
    edge: 0.05,
    qualityScore: 48,
    sport: 'nhl',
    source: PUBLISHED_SOURCE,
    notes: SHADOW_PUBLISHED_COHORT_TAG,
    completedAt: '2026-10-16T04:00:00.000Z',
    closeOdds: 130,
    closeLine: 2.5,
    closeBook: 'FanDuel',
    closeCapturedAt: '2026-10-15T23:00:00.000Z',
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
            or() { return query },
            ilike() { return query },
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

describe('formatShadowNhlSummary', () => {
  test('prints W-L-P, units/ROI, and CLV beat-rate', () => {
    const formatted = formatShadowNhlSummary({
      record: '4–2–1',
      units: 1.25,
      roi: 0.208,
      clv: {
        sample: 7,
        withClose: 6,
        sameLine: 5,
        lineMoved: 1,
        beatClose: 3,
        pctBeatClose: 0.6,
        avgClvProb: 0.015,
      },
    })
    expect(formatted.record).toBe('Record: 4–2–1')
    expect(formatted.units).toMatch(/\+1\.25u/)
    expect(formatted.units).toMatch(/\+20\.8%/)
    expect(formatted.clv).toMatch(/beat close 60\.0%/)
  })
})

describe('runReportShadowNhl', () => {
  test('is read-only and summarizes only the shadow NHL cohort', async () => {
    const log = memoryLog()
    const result = await runReportShadowNhl({
      createClient: () => mockClient({
        rows: [
          gradedShadow(),
          gradedShadow({
            id: 'pv-nhl-2',
            odds: 140,
            closeOdds: 160,
            result: 'incorrect',
          }),
          gradedShadow({
            id: 'pv-nhl-archive',
            notes: 'tier:elite',
            closeOdds: 100,
          }),
        ],
      }),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.picks).toHaveLength(2)
    expect(result.summary.record).toBe('1–1')
    expect(result.clv.withClose).toBe(2)
    expect(result.clv.beatClose).toBe(1)
    expect(result.clv.avgClvProb).toBeCloseTo((
      clvFromOdds(150, 130).clvProb
      + clvFromOdds(140, 160).clvProb
    ) / 2, 8)
    expect(log.lines.join('\n')).toMatch(/SHADOW NHL PUBLISHED/)
    expect(log.lines.join('\n')).toMatch(/cohort:shadow-published/)
    expect(log.lines.join('\n')).toMatch(/Does not write/)
    expect(log.lines.join('\n')).toMatch(/Does not call The Odds API/)
  })

  test('falls back to zeros when 007 columns are missing', async () => {
    const log = memoryLog()
    const result = await runReportShadowNhl({
      createClient: () => mockClient({
        error: { code: '42703', message: 'column closeOdds does not exist' },
        fallbackRows: [gradedShadow({ closeOdds: undefined })],
      }),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.clv.withClose).toBe(0)
    expect(result.clv.avgClvProb).toBeNull()
    expect(log.lines.join('\n')).toMatch(/007 SQL/)
  })
})
