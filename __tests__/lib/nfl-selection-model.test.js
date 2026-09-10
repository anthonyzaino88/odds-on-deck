import { calculateNFLNHLEdges } from '../../lib/edge-nfl-nhl.js'
import { calculateNFLEdges } from '../../lib/edge-nfl.js'
import {
  NFL_SELECTION_MODEL_VERSION,
  NFL_TOTALS_INELIGIBLE_REASON,
  calculateNFLSelection,
  decisiveConditionalProbability,
  displayCappedGap,
  estimatedEvAtDecimalOdds,
  evaluateDataThroughDate,
  evaluateNflDataEligibility,
  evaluateQuotedPrice,
  isQualifyingNflSelection,
  modelVersusTwoWayMarketGap,
  nflTotalOutcomeProbabilities,
  selectCompatibleQuote,
  shrinkSeasonWinPct,
  snapshotsAreCompatible,
  toPublicNflGameLines,
  twoWayHomeWinProbability,
} from '../../lib/nfl-selection-model.js'

const NOW = new Date('2025-12-15T18:00:00.000Z')

function eligibleTeam(abbr, record, extras = {}) {
  return {
    abbr,
    last10Record: record,
    season: '2025',
    statsKind: 'season',
    statsCapturedAt: '2025-12-12T00:00:00.000Z',
    dataThrough: '2025-12-12T00:00:00.000Z',
    ...extras,
  }
}

function evenH2h(overrides = {}) {
  return {
    id: 'odd-h2h-1',
    gameId: 'g-nfl-1',
    book: 'DraftKings',
    market: 'h2h',
    priceHome: -110,
    priceAway: -110,
    ts: '2025-12-15T17:00:00.000Z',
    ...overrides,
  }
}

function evenTotals(overrides = {}) {
  return {
    id: 'odd-tot-1',
    gameId: 'g-nfl-1',
    book: 'DraftKings',
    market: 'totals',
    total: 44.5,
    priceHome: -110,
    priceAway: -110,
    ts: '2025-12-15T17:00:00.000Z',
    ...overrides,
  }
}

/** Documented reproduction of the retired shared NFL/NHL heuristic. */
function legacySharedHeuristic(homeTeam, awayTeam, { homeAdvantage = 0.03 } = {}) {
  const homeStrength = legacyTeamStrength(homeTeam, true)
  const awayStrength = legacyTeamStrength(awayTeam, false)
  const strengthDiff = homeStrength - awayStrength + homeAdvantage
  const homeWin = 1 / (1 + Math.exp(-8 * strengthDiff))
  return {
    homeWin: Math.max(0.20, Math.min(0.80, homeWin)),
    awayWin: Math.max(0.20, Math.min(0.80, 1 - homeWin)),
  }
}

function legacyTeamStrength(team, isHome) {
  if (!team) return 0.5
  let strength = 0.5
  let factors = 0
  const recordStrength = legacyVenueWinPct(isHome ? team.homeRecord : team.awayRecord)
    ?? legacyVenueWinPct(team.last10Record)
  if (recordStrength != null) {
    strength += (recordStrength - 0.5) * 0.4
    factors++
  }
  const venueStrength = legacyVenueWinPct(isHome ? team.homeRecord : team.awayRecord)
  if (venueStrength != null) {
    strength += (venueStrength - 0.5) * 0.2
    factors++
  }
  if (factors === 0) return 0.5
  return Math.max(0.2, Math.min(0.8, strength))
}

function legacyVenueWinPct(record) {
  if (!record) return null
  const [wins, losses] = record.split('-').map(Number)
  if (isNaN(wins) || isNaN(losses) || wins + losses === 0) return null
  return wins / (wins + losses)
}

function legacyTotalsEdge(predictedTotal, marketTotal) {
  const diff = predictedTotal - marketTotal
  if (Math.abs(diff) <= 0.3) return { overEdge: null, underEdge: null }
  const edgeStrength = Math.min(0.12, Math.abs(diff) * 0.03)
  return diff > 0
    ? { overEdge: edgeStrength, underEdge: -edgeStrength }
    : { overEdge: -edgeStrength, underEdge: edgeStrength }
}

describe('confirmed legacy NFL heuristic failures (documentation)', () => {
  test('missing team data still produced a ~5.97pp home ML edge vs an even market', () => {
    const { homeWin } = legacySharedHeuristic({}, {}, { homeAdvantage: 0.03 })
    expect(homeWin).toBeCloseTo(0.5597, 3)
    expect(homeWin - 0.5).toBeCloseTo(0.0597, 3)
  })

  test('1-0 home vs 0-1 away reached the 80/20 cap via venue double-counting', () => {
    const { homeWin, awayWin } = legacySharedHeuristic(
      { homeRecord: '1-0' },
      { awayRecord: '0-1' },
    )
    expect(homeWin).toBe(0.80)
    expect(awayWin).toBe(0.20)
  })

  test('totals edge ignored the market over probability (50% vs 70% stayed 9%)', () => {
    const evenMarket = legacyTotalsEdge(47.5, 44.5)
    const skewedMarket = legacyTotalsEdge(47.5, 44.5)
    expect(evenMarket.overEdge).toBeCloseTo(0.09, 8)
    expect(skewedMarket.overEdge).toBe(evenMarket.overEdge)
  })
})

describe('NFL eligibility and moneyline safeguards', () => {
  test('missing data cannot create a qualifying selection', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: { abbr: 'KC' },
      away: { abbr: 'DEN' },
    }, [evenH2h()], { now: NOW })

    expect(selection.moneyline.reason).toBe('missing_season')
    expect(selection.moneyline.model).toBeNull()
    expect(selection.eligibility.eligibleForPublic).toBe(false)
    expect(isQualifyingNflSelection(selection.moneyline.home?.evaluation, {
      dataEligible: selection.moneyline.eligibility.dataEligible,
      eligibleForPublic: selection.moneyline.eligibility.eligibleForPublic,
    })).toBe(false)

    const persisted = calculateNFLEdges({
      id: 'g-nfl-1',
      sport: 'nfl',
      home: { abbr: 'KC' },
      away: { abbr: 'DEN' },
    }, [evenH2h()])
    expect(persisted.edgeMlHome).toBeNull()
    expect(persisted.edgeMlAway).toBeNull()
    expect(persisted.modelRun).toBe(NFL_SELECTION_MODEL_VERSION)
  })

  test('tiny samples cannot generate unjustified extreme confidence', () => {
    const game = {
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '1-0', { homeRecord: '1-0' }),
      away: eligibleTeam('DEN', '0-1', { awayRecord: '0-1' }),
    }
    const selection = calculateNFLSelection(game, [evenH2h()], { now: NOW })
    expect(selection.moneyline.reason).toBe('early_season_insufficient_sample')
    expect(selection.moneyline.model).toBeNull()
    expect(selection.moneyline.home).toBeNull()

    const shrunkHome = shrinkSeasonWinPct(1, 1)
    const shrunkAway = shrinkSeasonWinPct(0, 1)
    const guarded = twoWayHomeWinProbability(shrunkHome, shrunkAway)
    expect(guarded.pHomeWin).toBeLessThan(0.65)
    expect(guarded.pHomeWin).toBeGreaterThan(0.50)
    expect(guarded.pHomeWin + guarded.pAwayWin + guarded.pTie).toBeCloseTo(1, 8)
  })

  test('production remains unvalidated even with a full season sample', () => {
    const game = {
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }
    const selection = calculateNFLSelection(game, [evenH2h()], { now: NOW })
    expect(selection.moneyline.eligibility.dataEligible).toBe(true)
    expect(selection.moneyline.eligibility.eligibleForPublic).toBe(false)
    expect(selection.moneyline.eligibility.reason).toBe('unvalidated_heuristic')
    expect(toPublicNflGameLines(selection)).toEqual([])
  })

  test('stale or mismatched snapshots are rejected', () => {
    const stale = evaluateNflDataEligibility({
      home: interpretEligible('KC', '12-4', { capturedAt: '2025-01-01T00:00:00.000Z' }),
      away: interpretEligible('DEN', '4-12'),
      game: { season: '2025' },
      now: NOW,
      market: 'moneyline',
    })
    expect(stale.ok).toBe(false)
    expect(stale.reason).toBe('stale_team_data')

    const mismatchedSeason = evaluateNflDataEligibility({
      home: interpretEligible('KC', '12-4', { season: '2024' }),
      away: interpretEligible('DEN', '4-12'),
      game: { season: '2025' },
      now: NOW,
      market: 'moneyline',
    })
    expect(mismatchedSeason.reason).toBe('season_mismatch')

    expect(snapshotsAreCompatible(
      { gameId: 'g-1', market: 'h2h', oddsSnapshotId: 'odd-a', quotedAt: '2025-12-15T17:00:00.000Z' },
      { gameId: 'g-1', market: 'h2h', id: 'odd-b', ts: '2025-12-15T17:00:00.000Z' },
    )).toEqual({ ok: false, reason: 'odds_snapshot_mismatch' })

    expect(snapshotsAreCompatible(
      { gameId: 'g-1', market: 'h2h', quotedAt: '2025-12-15T12:00:00.000Z' },
      { gameId: 'g-1', market: 'h2h', ts: '2025-12-15T17:00:00.000Z' },
    )).toEqual({ ok: false, reason: 'stale_or_mismatched_quote' })
  })
})

function interpretEligible(abbr, record, extras = {}) {
  return {
    abbr,
    statsKind: 'season',
    season: extras.season || '2025',
    capturedAt: extras.capturedAt || '2025-12-12T00:00:00.000Z',
    dataThrough: extras.dataThrough || '2025-12-12T00:00:00.000Z',
    wins: Number(record.split('-')[0]),
    losses: Number(record.split('-')[1]),
    gamesPlayed: Number(record.split('-')[0]) + Number(record.split('-')[1]),
  }
}

describe('NFL totals probability (library only — production stays ineligible)', () => {
  test('over, under, and push probabilities sum to one', () => {
    const integer = nflTotalOutcomeProbabilities({ mean: 44, variance: 64, line: 44 })
    expect(integer.ok).toBe(true)
    expect(integer.pOver + integer.pUnder + integer.pPush).toBeCloseTo(1, 8)
    expect(integer.pPush).toBeGreaterThan(0)

    const half = nflTotalOutcomeProbabilities({ mean: 44, variance: 64, line: 44.5 })
    expect(half.pOver + half.pUnder + half.pPush).toBeCloseTo(1, 8)
    expect(half.pPush).toBeCloseTo(0, 8)
  })

  test('higher total lines cannot increase the model over probability', () => {
    const low = nflTotalOutcomeProbabilities({ mean: 45, variance: 81, line: 43.5 })
    const mid = nflTotalOutcomeProbabilities({ mean: 45, variance: 81, line: 45.5 })
    const high = nflTotalOutcomeProbabilities({ mean: 45, variance: 81, line: 47.5 })
    expect(mid.pOver).toBeLessThan(low.pOver)
    expect(high.pOver).toBeLessThan(mid.pOver)
  })

  test('exact integer totals settle as pushes in the distribution', () => {
    const atLine = nflTotalOutcomeProbabilities({ mean: 40, variance: 36, line: 40 })
    expect(atLine.pPush).toBeGreaterThan(0.05)
    const halfLine = nflTotalOutcomeProbabilities({ mean: 40, variance: 36, line: 40.5 })
    expect(halfLine.pPush).toBeCloseTo(0, 8)
  })

  test('production NFL totals stay ineligible without a fitted distribution', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [evenTotals({ priceAway: -200, priceHome: 170 })], { now: NOW })

    expect(selection.totals.reason).toBe(NFL_TOTALS_INELIGIBLE_REASON)
    expect(selection.totals.over).toBeNull()
    expect(selection.totals.eligibility.eligibleForPublic).toBe(false)
    expect(calculateNFLEdges({
      sport: 'nfl',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [evenTotals()]).edgeTotalO).toBeNull()
  })

  test('changing the market over price does not invent a fixed 9% totals edge', () => {
    const even = calculateNFLSelection({
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [evenTotals()], { now: NOW })
    const skewed = calculateNFLSelection({
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [evenTotals({ priceAway: -300, priceHome: 240 })], { now: NOW })

    expect(even.totals.over).toBeNull()
    expect(skewed.totals.over).toBeNull()
    expect(even.totals.reason).toBe(NFL_TOTALS_INELIGIBLE_REASON)
    expect(skewed.totals.reason).toBe(NFL_TOTALS_INELIGIBLE_REASON)
  })

  test('missing moneyline odds do not automatically disable valid totals', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [evenTotals()], {
      now: NOW,
      modelValidationStatus: 'validated',
      totalsDistribution: { mean: 47, variance: 64, line: 44.5 },
    })

    expect(selection.moneyline.quote.oddsSnapshotId).toBeNull()
    expect(selection.totals.eligibility.dataEligible).toBe(true)
    expect(selection.totals.model.ok).toBe(true)
    expect(selection.totals.over.model.pWin + selection.totals.under.model.pWin + selection.totals.over.model.pPush)
      .toBeCloseTo(1, 8)
    expect(selection.totals.over.evaluation.modelVsMarketGap).not.toBeNull()
  })
})

describe('price, edge, and display-cap separation', () => {
  test('changing quoted prices changes estimated EV', () => {
    const plus100 = evaluateQuotedPrice({ pWin: 0.55, pLoss: 0.45, odds: 100 })
    const minus110 = evaluateQuotedPrice({ pWin: 0.55, pLoss: 0.45, odds: -110 })
    const decimalPlus100 = evaluateQuotedPrice({ pWin: 0.55, pLoss: 0.45, odds: 2.0 })

    expect(plus100.decimalOdds).toBe(2)
    expect(plus100.estimatedEv).toBeCloseTo(0.10, 8)
    expect(minus110.estimatedEv).toBeLessThan(plus100.estimatedEv)
    expect(decimalPlus100.estimatedEv).toBeCloseTo(plus100.estimatedEv, 8)
    expect(estimatedEvAtDecimalOdds(0.55, 0.45, minus110.decimalOdds)).toBe(minus110.estimatedEv)
  })

  test('a display cap is not the model estimate', () => {
    const { displayGap, isCapped } = displayCappedGap(0.18)
    expect(displayGap).toBeCloseTo(0.10, 8)
    expect(isCapped).toBe(true)
  })
})

describe('snapshot matching', () => {
  const quotedAt = '2025-12-15T17:00:00.000Z'
  const basePred = {
    gameId: 'g-1',
    market: 'totals',
    book: 'DraftKings',
    line: 44.5,
    oddsSnapshotId: 'odd-tot-1',
    quotedAt,
    requiresQuoteMatch: true,
    priceOver: -110,
    priceUnder: -110,
  }
  const baseQuote = {
    id: 'odd-tot-1',
    gameId: 'g-1',
    market: 'totals',
    book: 'DraftKings',
    total: 44.5,
    ts: quotedAt,
    priceAway: -110,
    priceHome: -110,
  }

  test('normalizes quote.total and quote.line before comparison', () => {
    expect(snapshotsAreCompatible(basePred, baseQuote).ok).toBe(true)
    expect(snapshotsAreCompatible(
      { ...basePred, line: undefined, total: 44.5 },
      { ...baseQuote, total: undefined, line: 44.5 },
    ).ok).toBe(true)
  })

  test('rejects mismatched totals, books, events, and prices', () => {
    expect(snapshotsAreCompatible(basePred, { ...baseQuote, total: 45 })).toEqual({
      ok: false,
      reason: 'line_mismatch',
    })
    expect(snapshotsAreCompatible(basePred, { ...baseQuote, book: 'FanDuel' })).toEqual({
      ok: false,
      reason: 'book_mismatch',
    })
    expect(snapshotsAreCompatible(basePred, { ...baseQuote, gameId: 'g-2' })).toEqual({
      ok: false,
      reason: 'event_mismatch',
    })
    expect(snapshotsAreCompatible(basePred, { ...baseQuote, market: 'h2h' })).toEqual({
      ok: false,
      reason: 'market_mismatch',
    })
    expect(snapshotsAreCompatible(basePred, { ...baseQuote, priceAway: -130 })).toEqual({
      ok: false,
      reason: 'price_mismatch',
    })
  })

  test('rejects missing metadata and does not let an ID bypass freshness', () => {
    expect(snapshotsAreCompatible(
      { ...basePred, quotedAt: undefined },
      { ...baseQuote, ts: undefined },
    ).reason).toBe('missing_quote_timestamp')

    expect(snapshotsAreCompatible(basePred, {
      ...baseQuote,
      total: undefined,
      line: undefined,
    }).reason).toBe('missing_line')

    const staleSameId = selectCompatibleQuote(
      [{ ...baseQuote, ts: '2025-12-15T20:00:00.000Z' }],
      basePred,
    )
    expect(staleSameId).toBeNull()
    expect(snapshotsAreCompatible(
      basePred,
      { ...baseQuote, ts: '2025-12-15T20:00:00.000Z' },
    ).reason).toBe('stale_or_mismatched_quote')
  })

  test('incompatible snapshots stay rejected even when the id matches', () => {
    expect(selectCompatibleQuote(
      [{ ...baseQuote, total: 47.5 }],
      basePred,
    )).toBeNull()
  })
})

describe('data-through freshness', () => {
  const now = NOW

  test('rejects invalid, missing, future, and stale data-through values', () => {
    expect(evaluateDataThroughDate({
      dataThrough: null,
      season: '2025',
      now,
    }).reason).toBe('missing_data_through')
    expect(evaluateDataThroughDate({
      dataThrough: 'not-a-date',
      season: '2025',
      now,
    }).reason).toBe('invalid_data_through')
    expect(evaluateDataThroughDate({
      dataThrough: '2025-12-16T00:00:00.000Z',
      season: '2025',
      now,
    }).reason).toBe('data_through_in_future')
    expect(evaluateDataThroughDate({
      dataThrough: '2025-11-01T00:00:00.000Z',
      season: '2025',
      now,
    }).reason).toBe('stale_data_through')
  })

  test('a recent fetch cannot make old statistics current', () => {
    expect(evaluateDataThroughDate({
      dataThrough: '2025-11-01T00:00:00.000Z',
      capturedAt: '2025-12-14T00:00:00.000Z',
      season: '2025',
      now,
    }).reason).toBe('stale_data_through')
    expect(evaluateDataThroughDate({
      dataThrough: '2025-12-09T00:00:00.000Z',
      capturedAt: '2025-12-16T12:00:00.000Z',
      season: '2025',
      now,
    }).reason).toBe('data_through_older_than_fetch_window')
  })

  test('rejects data-through that is not in the game season', () => {
    expect(evaluateDataThroughDate({
      dataThrough: '2025-12-12T00:00:00.000Z',
      capturedAt: '2025-12-12T00:00:00.000Z',
      season: '2024',
      now,
    }).reason).toBe('data_through_season_mismatch')
  })

  test('accepts a current in-season data-through', () => {
    expect(evaluateDataThroughDate({
      dataThrough: '2025-12-12T00:00:00.000Z',
      capturedAt: '2025-12-12T00:00:00.000Z',
      season: '2025',
      now,
    })).toEqual({ ok: true, reason: null })
  })
})

describe('integer-total gap uses conditional model probability', () => {
  test('compares P(win|decisive) to the two-way market and keeps EV unconditional', () => {
    const integer = nflTotalOutcomeProbabilities({ mean: 44, variance: 64, line: 44 })
    const half = nflTotalOutcomeProbabilities({ mean: 44, variance: 64, line: 44.5 })
    expect(integer.pPush).toBeGreaterThan(0)
    expect(half.pPush).toBeCloseTo(0, 8)

    const integerCond = decisiveConditionalProbability(integer.pOver, integer.pPush)
    expect(integerCond.ok).toBe(true)
    expect(integerCond.value).toBeGreaterThan(integer.pOver)
    expect(integerCond.value + decisiveConditionalProbability(integer.pUnder, integer.pPush).value)
      .toBeCloseTo(1, 8)

    const integerGap = modelVersusTwoWayMarketGap({
      pWin: integer.pOver,
      pPush: integer.pPush,
      marketFairProb: 0.5,
    })
    expect(integerGap.gap).toBeCloseTo(integerCond.value - 0.5, 8)
    expect(integerGap.gap).not.toBeCloseTo(integer.pOver - 0.5, 5)

    const ev = estimatedEvAtDecimalOdds(integer.pOver, integer.pUnder, 2)
    expect(ev).toBeCloseTo(integer.pOver * 1 - integer.pUnder, 8)

    const halfCond = decisiveConditionalProbability(half.pOver, half.pPush)
    expect(halfCond.value).toBeCloseTo(half.pOver, 8)
    expect(modelVersusTwoWayMarketGap({
      pWin: half.pOver,
      pPush: half.pPush,
      marketFairProb: 0.5,
    }).gap).toBeCloseTo(half.pOver - 0.5, 8)
  })

  test('zero decisive probability leaves the gap unavailable', () => {
    expect(decisiveConditionalProbability(0, 1)).toEqual({
      ok: false,
      reason: 'zero_decisive_probability',
      value: null,
    })
    expect(modelVersusTwoWayMarketGap({
      pWin: 0,
      pPush: 1,
      marketFairProb: 0.5,
    }).reason).toBe('zero_decisive_probability')
  })

  test('production totals stay disabled even when the library can score an integer line', () => {
    const selection = calculateNFLSelection({
      sport: 'nfl',
      season: '2025',
      home: eligibleTeam('KC', '12-4'),
      away: eligibleTeam('DEN', '4-12'),
    }, [evenTotals({ total: 44 })], {
      now: NOW,
      totalsDistribution: { mean: 44, variance: 64, line: 44 },
    })
    expect(selection.totals.eligibility.eligibleForPublic).toBe(false)
    expect(selection.totals.reason).toBe('unvalidated_heuristic')
    expect(selection.totals.over.evaluation.conditionalPWin)
      .toBeGreaterThan(selection.totals.over.model.pWin)
    expect(toPublicNflGameLines(selection)).toEqual([])
  })
})

describe('shared entry point routes NFL away from the NHL heuristic', () => {
  test('calculateNFLNHLEdges(sport=nfl) does not emit the missing-data 5.97pp edge', () => {
    const result = calculateNFLNHLEdges({
      sport: 'nfl',
      home: { abbr: 'KC' },
      away: { abbr: 'DEN' },
    }, [evenH2h()])
    expect(result.modelRun).toBe(NFL_SELECTION_MODEL_VERSION)
    expect(result.edgeMlHome).toBeNull()
    expect(result.selection.moneyline.reason).toBeTruthy()
  })
})
