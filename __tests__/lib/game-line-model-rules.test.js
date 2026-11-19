import {
  ALLOWED_PREGAME_INPUTS,
  PICK_LOCK_LEAD_MINUTES,
  PUBLISH_MIN_AVG_CLV,
  PUBLISH_MIN_BEAT_CLOSE_SHARE,
  PUBLISH_MIN_DEV_FOLDS,
  PUBLISH_MIN_HOLDOUT_FOLDS,
  PUBLISH_MIN_SAMPLE,
  publishBarsStatus,
  sampleSizeStatus,
  splitWalkForwardFolds,
} from '../../lib/game-line-model-rules.js'

describe('game-line model rules constants', () => {
  test('lock is 60 minutes before start and the sample bar is 200', () => {
    expect(PICK_LOCK_LEAD_MINUTES).toBe(60)
    expect(PUBLISH_MIN_SAMPLE).toBe(200)
    expect(PUBLISH_MIN_AVG_CLV).toBe(0.01)
    expect(PUBLISH_MIN_BEAT_CLOSE_SHARE).toBe(0.52)
    expect(ALLOWED_PREGAME_INPUTS).toEqual(expect.arrayContaining([
      'matchup_history',
      'recent_form',
      'rest_travel',
      'injuries',
      'starters_qb',
      'home_away',
    ]))
  })

  test('publishBarsStatus stays false until every bar clears', () => {
    expect(sampleSizeStatus(199).code).toBe('SAMPLE_TOO_SMALL')
    expect(publishBarsStatus({
      sample: 200,
      holdoutFolds: PUBLISH_MIN_HOLDOUT_FOLDS,
      devFolds: PUBLISH_MIN_DEV_FOLDS,
      avgClv: 0.012,
      beatCloseShare: 0.55,
      brierBeatsClose: true,
      logLossBeatsClose: true,
    }).eligibleForPublic).toBe(true)
    expect(publishBarsStatus({
      sample: 200,
      holdoutFolds: PUBLISH_MIN_HOLDOUT_FOLDS,
      avgClv: 0.012,
      beatCloseShare: 0.55,
      brierBeatsClose: true,
      logLossBeatsClose: false,
    }).eligibleForPublic).toBe(false)
    expect(publishBarsStatus({
      sample: 200,
      holdoutFolds: PUBLISH_MIN_HOLDOUT_FOLDS,
      devFolds: 3,
      avgClv: 0.012,
      beatCloseShare: 0.55,
      brierBeatsClose: true,
      logLossBeatsClose: true,
    }).eligibleForPublic).toBe(false)
  })

  test('the first fold is warmup, the next four are development, the rest are holdout', () => {
    const split = splitWalkForwardFolds([
      'nfl-2025-w10',
      'nfl-2025-w2',
      'nfl-2025-w1',
      'nfl-2025-w3',
      'nfl-2025-w4',
      'nfl-2025-w5',
      'nfl-2025-w6',
      'nfl-2025-w7',
      'nfl-2025-w8',
      'nfl-2025-w9',
    ])
    expect(split.warmup).toEqual(['nfl-2025-w1'])
    expect(split.development).toEqual([
      'nfl-2025-w2',
      'nfl-2025-w3',
      'nfl-2025-w4',
      'nfl-2025-w5',
    ])
    expect(split.holdout[0]).toBe('nfl-2025-w6')
    expect(split.holdout).toContain('nfl-2025-w10')
  })

  test('NFL Monday keys and leftover week keys sort on one timeline', () => {
    const split = splitWalkForwardFolds([
      'nfl-2025-w10',
      'nfl-2025-12-29',
      'nfl-2025-09-08',
      'nfl-2025-2025-09-15',
      'nhl-2025-10-14',
    ])
    expect(split.all).toEqual([
      'nfl-2025-09-08',
      'nfl-2025-2025-09-15',
      'nhl-2025-10-14',
      'nfl-2025-w10',
      'nfl-2025-12-29',
    ])
  })
})
