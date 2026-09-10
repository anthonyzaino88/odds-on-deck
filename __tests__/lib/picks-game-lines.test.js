import { buildGameLinePicksFromSnapshots } from '../../lib/picks.js'
import {
  NFL_SELECTION_MODEL_VERSION,
  calculateNFLSelection,
} from '../../lib/nfl-selection-model.js'

const NOW = new Date('2025-12-15T18:00:00.000Z')

function eligibleTeam(abbr, record) {
  return {
    abbr,
    last10Record: record,
    season: '2025',
    statsKind: 'season',
    statsCapturedAt: '2025-12-12T00:00:00.000Z',
    dataThrough: '2025-12-12T00:00:00.000Z',
  }
}

const quote = {
  id: 'odd-h2h-1',
  gameId: 'g-nfl-1',
  book: 'DraftKings',
  market: 'h2h',
  priceHome: -110,
  priceAway: -110,
  ts: '2025-12-15T17:00:00.000Z',
}

function validatedNflSelection() {
  return calculateNFLSelection({
    id: 'g-nfl-1',
    sport: 'nfl',
    season: '2025',
    date: '2025-12-21T18:00:00.000Z',
    home: eligibleTeam('KC', '12-4'),
    away: eligibleTeam('DEN', '4-12'),
  }, [quote], {
    now: NOW,
    modelValidationStatus: 'validated',
  })
}

describe('buildGameLinePicksFromSnapshots', () => {
  test('public NFL probabilities match stored model output', () => {
    const selection = validatedNflSelection()
    const storedHome = selection.moneyline.home.model.pWin
    const picks = buildGameLinePicksFromSnapshots({
      game: {
        id: 'g-nfl-1',
        sport: 'nfl',
        date: '2025-12-21T18:00:00.000Z',
        status: 'scheduled',
        home: { abbr: 'KC' },
        away: { abbr: 'DEN' },
      },
      edge: {
        modelRun: NFL_SELECTION_MODEL_VERSION,
        payload: selection,
        edgeMlHome: 0.10,
      },
      oddsRows: [quote],
    })

    expect(picks.length).toBeGreaterThan(0)
    const home = picks.find((pick) => pick.pick === 'KC')
    expect(home.probability).toBe(storedHome)
    expect(home.modelPWin).toBe(storedHome)
    expect(home.probability).not.toBeCloseTo(
      (110 / 210) + (selection.moneyline.home.evaluation.modelVsMarketGap || 0),
      5,
    )
    expect(home.edge).toBe(selection.moneyline.home.evaluation.modelVsMarketGap)
    expect(home.edgeIsDisplayCap).toBe(false)
  })

  test('legacy NFL heuristic snapshots are not presented as new-model output', () => {
    const picks = buildGameLinePicksFromSnapshots({
      game: {
        id: 'g-nfl-1',
        sport: 'nfl',
        home: { abbr: 'KC' },
        away: { abbr: 'DEN' },
      },
      edge: {
        modelRun: 'nfl-nhl-v0.1.0',
        edgeMlHome: 0.0597,
        edgeMlAway: -0.0597,
      },
      oddsRows: [quote],
    })
    expect(picks).toEqual([])
  })

  test('the same quote id with a stale timestamp is rejected', () => {
    const selection = validatedNflSelection()
    const picks = buildGameLinePicksFromSnapshots({
      game: {
        id: 'g-nfl-1',
        sport: 'nfl',
        home: { abbr: 'KC' },
        away: { abbr: 'DEN' },
      },
      edge: { modelRun: NFL_SELECTION_MODEL_VERSION, payload: selection },
      oddsRows: [{ ...quote, ts: '2025-12-15T20:00:00.000Z' }],
    })
    expect(picks).toEqual([])
  })

  test('a later odds snapshot is rejected instead of being paired with the prediction', () => {
    const selection = validatedNflSelection()
    const picks = buildGameLinePicksFromSnapshots({
      game: {
        id: 'g-nfl-1',
        sport: 'nfl',
        home: { abbr: 'KC' },
        away: { abbr: 'DEN' },
      },
      edge: { modelRun: NFL_SELECTION_MODEL_VERSION, payload: selection },
      oddsRows: [{ ...quote, id: 'odd-h2h-later', ts: '2025-12-15T20:00:00.000Z' }],
    })
    expect(picks).toEqual([])
  })

  test('MLB reconstruction is unchanged (still implied + stored edge)', () => {
    const picks = buildGameLinePicksFromSnapshots({
      game: {
        id: 'g-mlb-1',
        sport: 'mlb',
        date: '2025-09-10T23:00:00.000Z',
        status: 'scheduled',
        home: { abbr: 'NYY' },
        away: { abbr: 'BOS' },
      },
      edge: {
        modelRun: 'v0.1.0',
        edgeMlHome: 0.06,
      },
      oddsRows: [{
        market: 'h2h',
        priceHome: -110,
        priceAway: -110,
        ts: '2025-09-10T16:00:00.000Z',
      }],
    })

    expect(picks).toHaveLength(1)
    expect(picks[0].pick).toBe('NYY')
    expect(picks[0].probability).toBeCloseTo(Math.min(0.85, (110 / 210) + 0.06), 8)
    expect(picks[0].edge).toBe(0.06)
  })

  test('unvalidated production NFL payload stays off the public list', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [quote], { now: NOW })

    const picks = buildGameLinePicksFromSnapshots({
      game: { id: 'g-nfl-1', sport: 'nfl', home: { abbr: 'KC' }, away: { abbr: 'DEN' } },
      edge: { modelRun: NFL_SELECTION_MODEL_VERSION, payload: selection },
      oddsRows: [quote],
    })
    expect(selection.moneyline.eligibility.eligibleForPublic).toBe(false)
    expect(picks).toEqual([])
  })

  test('a mismatched totals quote does not disable an independently valid moneyline', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      date: '2025-12-21T18:00:00.000Z',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [quote, {
      id: 'odd-tot-1',
      gameId: 'g-nfl-1',
      book: 'DraftKings',
      market: 'totals',
      total: 44.5,
      priceHome: -110,
      priceAway: -110,
      ts: '2025-12-15T17:00:00.000Z',
    }], {
      now: NOW,
      modelValidationStatus: 'validated',
      totalsDistribution: { mean: 47, variance: 64, line: 44.5 },
    })

    const picks = buildGameLinePicksFromSnapshots({
      game: {
        id: 'g-nfl-1',
        sport: 'nfl',
        date: '2025-12-21T18:00:00.000Z',
        status: 'scheduled',
        home: { abbr: 'KC' },
        away: { abbr: 'DEN' },
      },
      edge: { modelRun: NFL_SELECTION_MODEL_VERSION, payload: selection },
      oddsRows: [
        quote,
        {
          id: 'odd-tot-1',
          gameId: 'g-nfl-1',
          book: 'DraftKings',
          market: 'totals',
          total: 47.5,
          priceHome: -110,
          priceAway: -110,
          ts: '2025-12-15T17:00:00.000Z',
        },
      ],
    })

    expect(picks.some((pick) => pick.type === 'moneyline' && pick.pick === 'KC')).toBe(true)
    expect(picks.some((pick) => pick.type === 'total')).toBe(false)
  })
})
