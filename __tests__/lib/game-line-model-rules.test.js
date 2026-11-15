import {
  ALLOWED_PREGAME_INPUTS,
  PICK_LOCK_LEAD_MINUTES,
  PUBLISH_MIN_AVG_CLV,
  PUBLISH_MIN_BEAT_CLOSE_SHARE,
  PUBLISH_MIN_SAMPLE,
  publishBarsStatus,
  sampleSizeStatus,
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
      holdoutFolds: 4,
      avgClv: 0.012,
      beatCloseShare: 0.55,
      brierBeatsClose: true,
      logLossBeatsClose: true,
    }).eligibleForPublic).toBe(true)
    expect(publishBarsStatus({
      sample: 200,
      holdoutFolds: 4,
      avgClv: 0.012,
      beatCloseShare: 0.55,
      brierBeatsClose: true,
      logLossBeatsClose: false,
    }).eligibleForPublic).toBe(false)
  })
})
