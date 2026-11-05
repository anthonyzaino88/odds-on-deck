import { readFileSync } from 'fs'
import { join } from 'path'
import {
  FINAL_SCORE_MISMATCH_REASONS,
  collectFinalScoreMismatches,
  flagFinalScoreMismatch,
  formatFinalScoreMismatchLine,
  parseReportFinalScoreArgs,
} from '../../lib/final-score-mismatch.js'
import { mapNHLGameDetail, mapNHLStatus } from '../../lib/vendors/nhl-stats.js'

const NJ_VGK = {
  id: 'NJ_at_VGK_2026-10-14',
  sport: 'nhl',
  status: 'final',
  espnGameId: '401772001',
  homeAbbr: 'VGK',
  awayAbbr: 'NJ',
  homeScore: 3,
  awayScore: 2,
}

function espnDetail({ home = '5', away = '2', statusName = 'STATUS_FINAL', statusId = '3' } = {}) {
  return {
    header: {
      id: '401772001',
      competitions: [{
        competitors: [
          { homeAway: 'home', score: home, team: { abbreviation: 'VGK' } },
          { homeAway: 'away', score: away, team: { abbreviation: 'NJ' } },
        ],
        status: { type: { id: statusId, name: statusName } },
      }],
    },
  }
}

describe('flagFinalScoreMismatch', () => {
  test('flags NJ@VGK when stored final disagrees with the ESPN box', () => {
    const source = mapNHLGameDetail(espnDetail({ home: '5', away: '2' }))
    expect(source).toMatchObject({
      status: 'final',
      homeScore: 5,
      awayScore: 2,
      homeAbbr: 'VGK',
      awayAbbr: 'NJ',
    })
    const flag = flagFinalScoreMismatch(NJ_VGK, source)
    expect(flag).toMatchObject({
      reason: FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE,
      gameId: NJ_VGK.id,
      stored: { homeScore: 3, awayScore: 2 },
      source: { homeScore: 5, awayScore: 2 },
    })
    expect(formatFinalScoreMismatchLine(flag)).toMatch(/NJ@VGK/)
    expect(formatFinalScoreMismatchLine(flag)).toMatch(/stored=2-3/)
    expect(formatFinalScoreMismatchLine(flag)).toMatch(/source=2-5/)
  })

  test('returns null when stored and source finals agree', () => {
    const source = mapNHLGameDetail(espnDetail({ home: '3', away: '2' }))
    expect(flagFinalScoreMismatch(NJ_VGK, source)).toBeNull()
  })

  test('flags a missing or non-final source without writing', () => {
    expect(flagFinalScoreMismatch(NJ_VGK, null).reason).toBe(
      FINAL_SCORE_MISMATCH_REASONS.SOURCE_MISSING,
    )
    const live = mapNHLGameDetail(espnDetail({
      statusName: 'STATUS_IN_PROGRESS',
      statusId: '2',
      home: '1',
      away: '0',
    }))
    expect(flagFinalScoreMismatch(NJ_VGK, live).reason).toBe(
      FINAL_SCORE_MISMATCH_REASONS.SOURCE_NOT_FINAL,
    )
    expect(flagFinalScoreMismatch({ ...NJ_VGK, status: 'in_progress' }, live)).toBeNull()
  })

  test('collects mismatches by game id or espnGameId', () => {
    const source = mapNHLGameDetail(espnDetail({ home: '4', away: '1' }))
    const flags = collectFinalScoreMismatches(
      [NJ_VGK],
      new Map([[NJ_VGK.espnGameId, source]]),
    )
    expect(flags).toHaveLength(1)
    expect(flags[0].reason).toBe(FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE)
  })
})

describe('mapNHLStatus halftime', () => {
  test('maps STATUS_HALFTIME instead of falling through to scheduled', () => {
    expect(mapNHLStatus({ type: { name: 'STATUS_HALFTIME' } })).toBe('halftime')
    expect(mapNHLStatus({ type: { id: '2', name: 'STATUS_HALFTIME' } })).toBe('halftime')
    expect(mapNHLStatus({ type: { id: '2', name: 'STATUS_END_PERIOD' } })).toBe('in_progress')
  })
})

describe('report-final-score-mismatch script', () => {
  test('is read-only and does not call The Odds API', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/report-final-score-mismatch.js'), 'utf8')
    expect(src).toMatch(/Does not write/)
    expect(src).toMatch(/Does not call The Odds API/)
    expect(src).not.toMatch(/from\('Game'\)[\s\S]{0,200}\.update\(/)
    expect(src).not.toMatch(/the-odds-api|ODDS_API_KEY/)
    expect(src).toMatch(/fetchNHLGameDetail/)
    expect(parseReportFinalScoreArgs(['--sport', 'nhl', '--gameId', NJ_VGK.id])).toMatchObject({
      sport: 'nhl',
      gameId: NJ_VGK.id,
      json: false,
    })
  })
})
