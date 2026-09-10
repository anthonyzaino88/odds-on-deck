import {
  GAME_LINE_CAP,
  GAME_LINE_MIN_EDGE,
  decorateGameLine,
  gameLineEdgeWhy,
  gradeGameLineFromScores,
  isApprovedNflGameLine,
  isGameLineRecord,
  isPublicGameLine,
  partitionGameLines,
  selectGameLines,
} from '../../lib/game-lines.js'
import {
  NFL_SELECTION_MODEL_VERSION,
  nflGameLineSnapshotIsPublic,
} from '../../lib/nfl-selection-model.js'

function futureTime(hours = 3) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function line(overrides = {}) {
  return {
    gameId: 'g-1',
    type: 'moneyline',
    pick: 'NYY',
    team: 'NYY',
    homeTeam: 'NYY',
    awayTeam: 'BOS',
    edge: 0.06,
    odds: -120,
    sport: 'mlb',
    status: 'scheduled',
    gameTime: futureTime(),
    ...overrides,
  }
}

describe('selectGameLines', () => {
  test('returns moneyline and totals separately from props', () => {
    const rows = [
      line({ type: 'moneyline', pick: 'NYY', edge: 0.09 }),
      line({ type: 'total', pick: 'over', threshold: 8.5, edge: 0.07 }),
      line({ type: 'player_prop', pick: 'over', threshold: 1.5, edge: 0.20, playerName: 'Judge' }),
    ]
    const selected = selectGameLines(rows)
    expect(selected.every((row) => row.type === 'moneyline' || row.type === 'total')).toBe(true)
    expect(selected.map((row) => row.type).sort()).toEqual(['moneyline', 'total'])

    const { moneylines, totals } = partitionGameLines(selected)
    expect(moneylines).toHaveLength(1)
    expect(totals).toHaveLength(1)
    expect(moneylines[0].pick).toBe('NYY')
    expect(totals[0].pick).toBe('over')
  })

  test('empty slate is honest — no padding', () => {
    expect(selectGameLines([])).toEqual([])
    expect(selectGameLines(null)).toEqual([])
    expect(selectGameLines([
      line({ edge: 0 }),
      line({ edge: 0.02 }),
      line({ type: 'player_prop', playerName: 'Pad' }),
    ])).toEqual([])
  })

  test('holds NHL and unapproved NFL off the public section', () => {
    const rows = [
      line({ sport: 'nhl', edge: 0.20, pick: 'BOS' }),
      line({ sport: 'mlb', edge: 0.08, pick: 'NYY' }),
      line({ sport: 'nfl', type: 'total', pick: 'under', threshold: 44.5, edge: 0.06 }),
      line({
        sport: 'nfl',
        type: 'moneyline',
        pick: 'KC',
        edge: 0.09,
        eligibleForPublic: true,
        modelRun: NFL_SELECTION_MODEL_VERSION,
      }),
    ]
    const selected = selectGameLines(rows)
    expect(selected.every((row) => row.sport === 'mlb' || row.sport === 'nfl')).toBe(true)
    expect(selected.some((row) => row.sport === 'nhl')).toBe(false)
    expect(selected.map((row) => row.pick)).toEqual(['KC', 'NYY'])
    expect(selected.some((row) => row.pick === 'under')).toBe(false)
  })

  test('rejects legacy NFL heuristic rows even with a large stored edge', () => {
    expect(isPublicGameLine(line({
      sport: 'nfl',
      edge: 0.20,
      modelRun: 'nfl-nhl-v0.1.0',
      eligibleForPublic: true,
    }))).toBe(false)
  })

  test('isApprovedNflGameLine matches nflGameLineSnapshotIsPublic gates', () => {
    const currentPick = line({
      sport: 'nfl',
      edge: 0.09,
      modelRun: NFL_SELECTION_MODEL_VERSION,
      eligibleForPublic: true,
    })
    const currentPayload = {
      sport: 'nfl',
      modelRun: NFL_SELECTION_MODEL_VERSION,
      payload: { eligibility: { eligibleForPublic: true } },
    }
    const staleModel = line({
      sport: 'nfl',
      edge: 0.20,
      modelRun: 'nfl-selection-v1.0.0',
      eligibleForPublic: true,
    })
    const currentButIneligible = line({
      sport: 'nfl',
      edge: 0.20,
      modelRun: NFL_SELECTION_MODEL_VERSION,
      eligibleForPublic: false,
      payload: { eligibility: { eligibleForPublic: false } },
    })
    const payloadFalseTopTrue = {
      sport: 'nfl',
      modelRun: NFL_SELECTION_MODEL_VERSION,
      eligibleForPublic: true,
      payload: { eligibility: { eligibleForPublic: false } },
    }

    expect(isApprovedNflGameLine(currentPick)).toBe(true)
    expect(nflGameLineSnapshotIsPublic(currentPick)).toBe(true)
    expect(isApprovedNflGameLine(currentPayload)).toBe(true)
    expect(nflGameLineSnapshotIsPublic(currentPayload)).toBe(true)

    expect(isApprovedNflGameLine(staleModel)).toBe(false)
    expect(nflGameLineSnapshotIsPublic(staleModel)).toBe(false)
    expect(isApprovedNflGameLine(currentButIneligible)).toBe(false)
    expect(nflGameLineSnapshotIsPublic(currentButIneligible)).toBe(false)
    expect(isApprovedNflGameLine(payloadFalseTopTrue)).toBe(false)
    expect(nflGameLineSnapshotIsPublic(payloadFalseTopTrue)).toBe(false)

    expect(isApprovedNflGameLine(line({ sport: 'mlb', edge: 0.09 }))).toBe(false)
  })

  test('drops final / live games and ranks by edge with a short cap', () => {
    const rows = [
      line({ pick: 'Low', edge: 0.05 }),
      line({ pick: 'High', edge: 0.12 }),
      line({ pick: 'Final', status: 'final', edge: 0.30 }),
      line({ pick: 'Live', status: 'in_progress', edge: 0.22 }),
      ...Array.from({ length: 10 }, (_, i) => line({ pick: `Pad${i}`, edge: 0.051 + i * 0.001, gameId: `g-${i}` })),
    ]
    const selected = selectGameLines(rows)
    expect(selected.every((row) => row.pick !== 'Final' && row.pick !== 'Live')).toBe(true)
    expect(selected[0].pick).toBe('High')
    expect(selected.length).toBeLessThanOrEqual(GAME_LINE_CAP)
  })

  test('requires the generatePicksFromSupabase min edge floor', () => {
    expect(GAME_LINE_MIN_EDGE).toBe(0.05)
    expect(isPublicGameLine(line({ edge: 0.049 }))).toBe(false)
    expect(isPublicGameLine(line({ edge: 0.05 }))).toBe(true)
  })
})

describe('isGameLineRecord', () => {
  test('tags moneyline / total and the game_line source', () => {
    expect(isGameLineRecord({ type: 'moneyline' })).toBe(true)
    expect(isGameLineRecord({ propType: 'total' })).toBe(true)
    expect(isGameLineRecord({ source: 'game_line', propType: 'batter_hits' })).toBe(true)
    expect(isGameLineRecord({ type: 'batter_hits', source: 'system_generated' })).toBe(false)
  })
})

describe('gameLineEdgeWhy / decorateGameLine', () => {
  test('explains edge in plain English and reuses a real matchup insight', () => {
    const ml = line({ edge: 0.062 })
    expect(gameLineEdgeWhy(ml)).toBe('Model sees 6.2% more than the price implies')

    const decorated = decorateGameLine(ml, { home: { abbr: 'NYY' } }, () => 'Hot streak: 8-2 recent form')
    expect(decorated.why).toBe('Model sees 6.2% more than the price implies')
    expect(decorated.matchupInsight).toBe('Hot streak: 8-2 recent form')
  })

  test('does not treat the generic edge fallback as matchup context', () => {
    const decorated = decorateGameLine(line(), {}, () => '6.0% edge vs market')
    expect(decorated.matchupInsight).toBeNull()
    expect(decorated.why).toMatch(/Model sees/)
  })
})

describe('gradeGameLineFromScores', () => {
  const game = {
    homeScore: 5,
    awayScore: 3,
    home: { abbr: 'NYY' },
    away: { abbr: 'BOS' },
  }

  test('grades moneyline and totals from final scores', () => {
    expect(gradeGameLineFromScores({ type: 'moneyline', pick: 'NYY' }, game)).toEqual({
      result: 'correct',
      actualValue: 5,
    })
    expect(gradeGameLineFromScores({ type: 'moneyline', prediction: 'BOS' }, game)).toEqual({
      result: 'incorrect',
      actualValue: 3,
    })
    expect(gradeGameLineFromScores({ type: 'total', pick: 'over', threshold: 7.5 }, game)).toEqual({
      result: 'correct',
      actualValue: 8,
    })
    expect(gradeGameLineFromScores({ type: 'total', pick: 'under', threshold: 7.5 }, game)).toEqual({
      result: 'incorrect',
      actualValue: 8,
    })
    expect(gradeGameLineFromScores({ type: 'total', pick: 'over', threshold: 8 }, game)).toEqual({
      result: 'push',
      actualValue: 8,
    })
  })

  test('NFL moneyline ties settle as pushes', () => {
    expect(gradeGameLineFromScores(
      { type: 'moneyline', pick: 'KC' },
      { homeScore: 17, awayScore: 17, home: { abbr: 'KC' }, away: { abbr: 'DEN' } },
    )).toEqual({ result: 'push', actualValue: 17 })
  })
})
