import { mapLiveGameData } from '../../lib/vendors/stats.js'
import {
  hasExplicitMlbFinalStatus,
  hasExplicitMlbLiveStatus,
  isEspnCompletedFinal,
  isRecentMlbFinalForRecheck,
  mergeActiveAndRecentFinalGames,
  mlbPayloadLooksLive,
  parseEspnMlbSummary,
  reconcileMlbAndEspnStatus,
  resolveMlbLinescoreStatus,
  resolveMlbStatusForUpdate,
  shouldConfirmMlbFinalWithEspn,
} from '../../lib/mlb-live-status.js'
import {
  ESPN_SUMMARY_LAA_ATH_LIVE,
  ESPN_SUMMARY_TOR_BAL_FINAL,
  LINESCORE_ONLY_TOR_BAL,
  SCHEDULE_GAME_CIN_ATL_WALKOFF_FINAL,
  SCHEDULE_GAME_LAA_ATH_LIVE,
  SCHEDULE_GAME_TOR_BAL_FINAL,
  SCHEDULE_GAME_TOR_BAL_POSTPONED,
} from '../fixtures/mlb-schedule-linescore.fixture.js'

function liveNinth({ status, inningHalf = 'Bottom', inningState, outs = 2, balls = 1, strikes = 2 } = {}) {
  return {
    currentInning: 9,
    inningHalf,
    inningState,
    outs,
    balls,
    strikes,
    teams: { home: { runs: 1 }, away: { runs: 1 } },
    offense: {
      batter: { id: 111 },
      first: { id: 222 },
    },
    defense: {
      pitcher: { id: 333 },
    },
    status,
  }
}

describe('resolveMlbLinescoreStatus — 9th inning live never becomes final', () => {
  test('9th inning Live with missing codedGameState stays in_progress', () => {
    const payload = liveNinth({
      status: { abstractGameState: 'Live' },
    })
    expect(resolveMlbLinescoreStatus(payload)).toBe('in_progress')
    expect(mapLiveGameData(payload).status).toBe('in_progress')
  })

  test('9th inning abstract Live + detailed In Progress is in_progress', () => {
    const payload = liveNinth({
      status: {
        abstractGameState: 'Live',
        detailedState: 'In Progress',
        abstractGameCode: 'L',
      },
    })
    expect(resolveMlbLinescoreStatus(payload)).toBe('in_progress')
    expect(mapLiveGameData(payload).status).toBe('in_progress')
  })

  test('Bottom 9th coded I is in_progress', () => {
    const payload = liveNinth({
      inningHalf: 'Bottom',
      status: {
        codedGameState: 'I',
        abstractGameState: 'Live',
        detailedState: 'In Progress',
      },
    })
    expect(resolveMlbLinescoreStatus(payload)).toBe('in_progress')
    expect(mapLiveGameData(payload).status).toBe('in_progress')
    expect(mapLiveGameData(payload).inningHalf).toBe('Bottom')
  })

  test('Mid 9th is in_progress', () => {
    const payload = liveNinth({
      inningHalf: 'Top',
      inningState: 'Middle',
      outs: 3,
      balls: 0,
      strikes: 0,
      status: { abstractGameState: 'Live', detailedState: 'In Progress' },
    })
    expect(resolveMlbLinescoreStatus(payload)).toBe('in_progress')
    const mapped = mapLiveGameData(payload)
    expect(mapped.status).toBe('in_progress')
    expect(mapped.inningHalf).toBe('Middle')
  })

  test('unknown 9th-inning state without status signals is unknown, not in_progress', () => {
    const payload = liveNinth({
      status: {},
    })
    expect(resolveMlbLinescoreStatus(payload)).toBe('unknown')
    expect(mapLiveGameData(payload).status).toBe('unknown')
  })

  test('no status object at all in the 9th is unknown, not in_progress', () => {
    const payload = liveNinth()
    delete payload.status
    expect(resolveMlbLinescoreStatus(payload)).toBe('unknown')
    expect(mapLiveGameData(payload).status).toBe('unknown')
  })
})

describe('resolveMlbLinescoreStatus — real Final and Live payloads', () => {
  test('TOR@BAL 824785 schedule Final is final despite leftover balls/strikes', () => {
    const mapped = mapLiveGameData(SCHEDULE_GAME_TOR_BAL_FINAL)
    expect(mapped.status).toBe('final')
    expect(mapped.inning).toBe(9)
    expect(mapped.outs).toBe(3)
    expect(mapped.balls).toBe(2)
    expect(mapped.strikes).toBe(3)
    expect(mapped.awayScore).toBe(2)
    expect(mapped.homeScore).toBe(4)
    expect(mapped.mlbStatus.codedGameState).toBe('F')
  })

  test('CIN@ATL 824868 walk-off Final in the 10th stays final', () => {
    const mapped = mapLiveGameData(SCHEDULE_GAME_CIN_ATL_WALKOFF_FINAL)
    expect(mapped.status).toBe('final')
    expect(mapped.inning).toBe(10)
    expect(mapped.outs).toBe(1)
    expect(mapped.homeScore).toBe(3)
    expect(mapped.awayScore).toBe(2)
  })

  test('LAA@ATH 824951 Live payload stays in_progress', () => {
    const mapped = mapLiveGameData(SCHEDULE_GAME_LAA_ATH_LIVE)
    expect(mapped.status).toBe('in_progress')
    expect(mapped.inning).toBe(6)
    expect(mapped.inningHalf).toBe('Bottom')
    expect(mapped.outs).toBe(0)
    expect(mapped.homeScore).toBe(5)
    expect(mapped.awayScore).toBe(3)
  })

  test('per-game linescore without status cannot pass as in_progress', () => {
    expect(LINESCORE_ONLY_TOR_BAL.status).toBeUndefined()
    expect(resolveMlbLinescoreStatus(LINESCORE_ONLY_TOR_BAL)).toBe('unknown')
    expect(mapLiveGameData(LINESCORE_ONLY_TOR_BAL).status).toBe('unknown')
  })
})

describe('resolveMlbLinescoreStatus — true finals and terminal codes', () => {
  test('coded F + detailed Final is final', () => {
    const payload = liveNinth({
      outs: 3,
      balls: 0,
      strikes: 0,
      status: {
        codedGameState: 'F',
        abstractGameState: 'Final',
        detailedState: 'Final',
      },
    })
    expect(resolveMlbLinescoreStatus(payload)).toBe('final')
    expect(mapLiveGameData(payload).status).toBe('final')
  })

  test('Game Over / coded O is final', () => {
    const payload = {
      currentInning: 9,
      inningHalf: 'Bottom',
      outs: 3,
      teams: { home: { runs: 4 }, away: { runs: 2 } },
      status: {
        codedGameState: 'O',
        abstractGameState: 'Final',
        detailedState: 'Game Over',
      },
    }
    expect(resolveMlbLinescoreStatus(payload)).toBe('final')
    expect(hasExplicitMlbFinalStatus(payload.status)).toBe(true)
  })

  test('completed early is final', () => {
    expect(resolveMlbLinescoreStatus({
      currentInning: 6,
      status: { detailedState: 'Completed Early: Rain', abstractGameState: 'Final' },
    })).toBe('final')
  })

  test('abstract Final without codedGameState is still final', () => {
    expect(resolveMlbLinescoreStatus({
      currentInning: 9,
      outs: 3,
      status: { abstractGameState: 'Final', detailedState: 'Final' },
    })).toBe('final')
  })

  test('postponed is postponed even when abstractGameCode is F', () => {
    expect(resolveMlbLinescoreStatus({
      status: SCHEDULE_GAME_TOR_BAL_POSTPONED.status,
    })).toBe('postponed')
    expect(hasExplicitMlbFinalStatus(SCHEDULE_GAME_TOR_BAL_POSTPONED.status)).toBe(false)
  })

  test('suspended is suspended, not inferred in_progress or final', () => {
    expect(resolveMlbLinescoreStatus({
      currentInning: 6,
      outs: 1,
      status: {
        codedGameState: 'U',
        abstractGameState: 'Live',
        detailedState: 'Suspended',
      },
    })).toBe('suspended')
  })
})

describe('explicit live / final helpers', () => {
  test('Live abstract is live even when codedGameState is missing', () => {
    expect(hasExplicitMlbLiveStatus({ abstractGameState: 'Live' })).toBe(true)
    expect(hasExplicitMlbFinalStatus({ abstractGameState: 'Live' })).toBe(false)
  })

  test('mlbPayloadLooksLive detects in-inning state but ignores leftover count at outs=3', () => {
    expect(mlbPayloadLooksLive({
      inning: 9,
      inningHalf: 'Bottom',
      outs: 2,
      balls: 1,
      strikes: 2,
    })).toBe(true)
    expect(mlbPayloadLooksLive({
      inning: 9,
      inningHalf: 'Middle',
      outs: 3,
      balls: 0,
      strikes: 0,
    })).toBe(true)
    expect(mlbPayloadLooksLive({
      inning: 9,
      inningHalf: 'Bottom',
      outs: 3,
      balls: 0,
      strikes: 0,
    })).toBe(false)
    expect(mlbPayloadLooksLive({
      inning: 9,
      inningHalf: 'Top',
      outs: 3,
      balls: 2,
      strikes: 3,
      currentBatterId: '664770',
      currentPitcherId: '552640',
    })).toBe(false)
  })
})

describe('ESPN summary parse', () => {
  test('STATUS_IN_PROGRESS Bottom 9th is in_progress', () => {
    const parsed = parseEspnMlbSummary({
      header: {
        competitions: [{
          status: {
            period: 9,
            type: {
              name: 'STATUS_IN_PROGRESS',
              completed: false,
              shortDetail: 'Bot 9th',
            },
          },
          competitors: [
            { homeAway: 'away', score: '1' },
            { homeAway: 'home', score: '1' },
          ],
        }],
      },
    })
    expect(parsed).toMatchObject({
      status: 'in_progress',
      completed: false,
      statusType: 'STATUS_IN_PROGRESS',
      inning: 9,
      inningHalf: 'Bottom',
      homeScore: 1,
      awayScore: 1,
    })
  })

  test('STATUS_FINAL completed=true is final', () => {
    const parsed = parseEspnMlbSummary(ESPN_SUMMARY_TOR_BAL_FINAL)
    expect(parsed.status).toBe('final')
    expect(parsed.completed).toBe(true)
    expect(parsed.statusType).toBe('STATUS_FINAL')
    expect(parsed.homeScore).toBe(4)
    expect(parsed.awayScore).toBe(2)
    expect(isEspnCompletedFinal(parsed)).toBe(true)
  })

  test('completed alone without STATUS_FINAL is not final', () => {
    const parsed = parseEspnMlbSummary({
      header: {
        competitions: [{
          status: {
            period: 0,
            type: { name: 'STATUS_POSTPONED', completed: true, shortDetail: 'Postponed' },
          },
          competitors: [
            { homeAway: 'away', score: '0' },
            { homeAway: 'home', score: '0' },
          ],
        }],
      },
    })
    expect(parsed.status).not.toBe('final')
    expect(isEspnCompletedFinal(parsed)).toBe(false)
  })

  test('real ESPN live header stays in_progress', () => {
    const parsed = parseEspnMlbSummary(ESPN_SUMMARY_LAA_ATH_LIVE)
    expect(parsed.status).toBe('in_progress')
    expect(parsed.inning).toBe(6)
    expect(parsed.inningHalf).toBe('Bottom')
  })
})

describe('reconcileMlbAndEspnStatus', () => {
  test('prefers ESPN in_progress over MLB final', () => {
    const reconciled = reconcileMlbAndEspnStatus(
      {
        status: 'final',
        homeScore: 1,
        awayScore: 1,
        inning: 9,
        inningHalf: 'Bottom',
        outs: 2,
        mlbStatus: { abstractGameState: 'Live' },
      },
      {
        status: 'in_progress',
        homeScore: 1,
        awayScore: 1,
        inning: 9,
        inningHalf: 'Bottom',
      },
    )
    expect(reconciled.status).toBe('in_progress')
    expect(reconciled.source).toBe('espn-override')
  })

  test('keeps in_progress when MLB final has no explicit Final and payload looks live', () => {
    const reconciled = reconcileMlbAndEspnStatus({
      status: 'final',
      inning: 9,
      inningHalf: 'Top',
      outs: 2,
      balls: 2,
      strikes: 1,
      mlbStatus: { abstractGameState: 'Live' },
    }, null)
    expect(reconciled.status).toBe('in_progress')
    expect(reconciled.source).toBe('live-payload-guard')
  })

  test('does not override a true Final when ESPN is also final', () => {
    const reconciled = reconcileMlbAndEspnStatus(
      {
        status: 'final',
        inning: 9,
        outs: 3,
        mlbStatus: { codedGameState: 'F', detailedState: 'Final' },
      },
      { status: 'final', inning: 9, statusType: 'STATUS_FINAL', completed: true },
    )
    expect(reconciled.status).toBe('final')
  })

  test('does not flip a walk-off Final to in_progress without ESPN live', () => {
    const reconciled = reconcileMlbAndEspnStatus({
      status: 'final',
      inning: 9,
      inningHalf: 'Bottom',
      outs: 1,
      mlbStatus: { codedGameState: 'F', abstractGameState: 'Final', detailedState: 'Final' },
    }, null)
    expect(reconciled.status).toBe('final')
  })

  test('uses ESPN when MLB is still scheduled but ESPN is live', () => {
    const reconciled = reconcileMlbAndEspnStatus(
      { status: 'scheduled', homeScore: 0, awayScore: 0 },
      { status: 'in_progress', homeScore: 0, awayScore: 1, inning: 3, inningHalf: 'Top' },
    )
    expect(reconciled.status).toBe('in_progress')
    expect(reconciled.awayScore).toBe(1)
  })

  test('ESPN upgrades unknown MLB status only when STATUS_FINAL and completed', () => {
    const mapped = mapLiveGameData(LINESCORE_ONLY_TOR_BAL)
    expect(mapped.status).toBe('unknown')
    const espn = parseEspnMlbSummary(ESPN_SUMMARY_TOR_BAL_FINAL)
    const upgraded = reconcileMlbAndEspnStatus(mapped, espn)
    expect(upgraded.status).toBe('final')
    expect(upgraded.source).toBe('espn-upgrade')

    const refused = reconcileMlbAndEspnStatus(mapped, {
      status: 'final',
      completed: true,
      statusType: 'STATUS_POSTPONED',
    })
    expect(refused.status).toBe('unknown')
  })

  test('ESPN does not upgrade an explicit live 9th to final', () => {
    const live = mapLiveGameData(liveNinth({
      status: {
        codedGameState: 'I',
        abstractGameState: 'Live',
        detailedState: 'In Progress',
      },
    }))
    const reconciled = reconcileMlbAndEspnStatus(live, {
      status: 'final',
      statusType: 'STATUS_FINAL',
      completed: true,
      homeScore: 1,
      awayScore: 1,
      inning: 9,
    })
    expect(reconciled.status).toBe('in_progress')
  })
})

describe('recent-final self-heal window', () => {
  const now = Date.parse('2026-09-16T04:25:00.000Z')

  test('includes a final updated 20 minutes ago', () => {
    expect(isRecentMlbFinalForRecheck({
      status: 'final',
      lastUpdate: '2026-09-16T04:05:00.000Z',
    }, { now })).toBe(true)
  })

  test('excludes a final updated yesterday', () => {
    expect(isRecentMlbFinalForRecheck({
      status: 'final',
      lastUpdate: '2026-09-15T02:00:00.000Z',
    }, { now })).toBe(false)
  })

  test('mergeActiveAndRecentFinalGames de-dupes and only keeps recent finals', () => {
    const active = [{ id: 'live-1', status: 'in_progress' }]
    const finals = [
      { id: 'sticky-1', status: 'final', lastUpdate: '2026-09-16T04:10:00.000Z' },
      { id: 'old-1', status: 'final', lastUpdate: '2026-09-15T01:00:00.000Z' },
      { id: 'live-1', status: 'in_progress' },
    ]
    const merged = mergeActiveAndRecentFinalGames(active, finals, { now })
    expect(merged.map(g => g.id)).toEqual(['live-1', 'sticky-1'])
  })

  test('shouldConfirmMlbFinalWithEspn is true for final, unknown, and 9th+', () => {
    expect(shouldConfirmMlbFinalWithEspn({ status: 'final' })).toBe(true)
    expect(shouldConfirmMlbFinalWithEspn({ status: 'unknown' })).toBe(true)
    expect(shouldConfirmMlbFinalWithEspn({ status: 'in_progress', inning: 9 })).toBe(true)
    expect(shouldConfirmMlbFinalWithEspn({ status: 'in_progress', inning: 10 })).toBe(true)
    expect(shouldConfirmMlbFinalWithEspn({ status: 'in_progress', inning: 6 })).toBe(false)
    expect(shouldConfirmMlbFinalWithEspn({ status: 'scheduled' })).toBe(false)
  })

  test('recheck does not flip a real Final with leftover balls/strikes back to in_progress', () => {
    const mapped = mapLiveGameData(SCHEDULE_GAME_TOR_BAL_FINAL)
    const espn = parseEspnMlbSummary(ESPN_SUMMARY_TOR_BAL_FINAL)
    expect(reconcileMlbAndEspnStatus(mapped, espn).status).toBe('final')
    expect(reconcileMlbAndEspnStatus(mapped, null).status).toBe('final')
  })

  test('recheck does not flip a walk-off Final back to in_progress when ESPN is final', () => {
    const mapped = mapLiveGameData(SCHEDULE_GAME_CIN_ATL_WALKOFF_FINAL)
    const espn = parseEspnMlbSummary({
      header: {
        competitions: [{
          status: {
            period: 10,
            type: { name: 'STATUS_FINAL', completed: true, shortDetail: 'Final/10' },
          },
          competitors: [
            { homeAway: 'away', score: '2' },
            { homeAway: 'home', score: '3' },
          ],
        }],
      },
    })
    expect(mapped.outs).toBe(1)
    expect(reconcileMlbAndEspnStatus(mapped, espn).status).toBe('final')
    expect(reconcileMlbAndEspnStatus(mapped, null).status).toBe('final')
  })

  test('unknown status keeps the previous DB status so the row stays selectable', () => {
    expect(resolveMlbStatusForUpdate({ status: 'unknown' }, 'in_progress')).toBe('in_progress')
    expect(resolveMlbStatusForUpdate({ status: 'final' }, 'in_progress')).toBe('final')
  })
})

describe('incident payload MIA @ ARI 2026-09-15', () => {
  test('linescore Live / Bottom 9 / 2 outs maps to in_progress not final', () => {
    const mapped = mapLiveGameData({
      currentInning: 9,
      inningHalf: 'Bottom',
      inningState: 'Bottom',
      outs: 2,
      balls: 1,
      strikes: 2,
      teams: { home: { runs: 1 }, away: { runs: 1 } },
      status: {
        abstractGameState: 'Live',
        detailedState: 'In Progress',
      },
    })
    expect(mapped.status).toBe('in_progress')
    expect(mapped.inning).toBe(9)
    expect(mapped.inningHalf).toBe('Bottom')
    expect(mapped.outs).toBe(2)
    expect(mapped.homeScore).toBe(1)
    expect(mapped.awayScore).toBe(1)
  })
})
