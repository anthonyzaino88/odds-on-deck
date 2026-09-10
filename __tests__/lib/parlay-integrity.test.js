import {
  assembleParlays,
  combinationPassesIntegrity,
  FEATURED_LEG_COUNT,
  hasSameMarketConflict,
  hasSamePlayerConflict,
  isFeaturedQualityLeg,
  isFeaturedWorthyParlay,
  mapCachePropToParlayBet,
  normalizePlayerName,
  playerCorrelationKey,
} from '../../lib/parlay-integrity.js'
import {
  isPublishedEligibleProp,
  TODAYS_BOARD_MIN_PUBLISHED,
} from '../../lib/published-picks.js'

const GAME_ID = 'SEA_at_TEN_2025-09-10'

function cacheProp(name, overrides = {}) {
  const type = overrides.type || 'player_pass_tds'
  const pick = overrides.pick || 'over'
  const threshold = overrides.threshold ?? 0.5
  const odds = overrides.odds ?? 1.91
  return {
    propId: `${GAME_ID}-${name}-${type}-${threshold}`,
    gameId: GAME_ID,
    playerName: name,
    team: 'SEA',
    type,
    pick,
    threshold,
    odds,
    probability: overrides.probability ?? 1 / odds,
    edge: overrides.edge ?? 0,
    confidence: overrides.confidence || 'medium',
    qualityScore: overrides.qualityScore ?? 45,
    sport: overrides.sport || 'nfl',
    bookmaker: 'DraftKings',
    ...overrides,
    propId: overrides.propId || `${GAME_ID}-${name}-${type}-${threshold}`,
    probability: overrides.probability ?? 1 / (overrides.odds ?? odds),
  }
}

function genoUnder15(overrides = {}) {
  return cacheProp('Geno Smith', {
    type: 'player_pass_tds',
    pick: 'under',
    threshold: 1.5,
    odds: 1.40,
    probability: 0.71,
    edge: 0,
    ...overrides,
  })
}

function genoOver05(overrides = {}) {
  return cacheProp('Geno Smith', {
    type: 'player_pass_tds',
    pick: 'over',
    threshold: 0.5,
    odds: 1.44,
    probability: 0.69,
    edge: 0,
    ...overrides,
  })
}

function camUnder15(overrides = {}) {
  return cacheProp('Cam Ward', {
    type: 'player_pass_tds',
    pick: 'under',
    threshold: 1.5,
    odds: 1.42,
    probability: 0.70,
    edge: 0,
    ...overrides,
  })
}

function saneProp(name, overrides = {}) {
  return cacheProp(name, {
    type: overrides.type || 'player_pass_yds',
    pick: 'over',
    threshold: overrides.threshold ?? 199.5,
    odds: 1.91,
    probability: 1 / 1.91,
    edge: 0,
    ...overrides,
  })
}

/** Published-eligible fixture: edge > 0, QS ≥ 40, odds in band, MLB/NFL prop. */
function publishedProp(name, overrides = {}) {
  return cacheProp(name, {
    type: overrides.type || 'player_pass_yds',
    pick: overrides.pick || 'over',
    threshold: overrides.threshold ?? 199.5,
    odds: overrides.odds ?? 1.91,
    probability: overrides.probability ?? 1 / (overrides.odds ?? 1.91),
    edge: overrides.edge ?? 0.04,
    qualityScore: overrides.qualityScore ?? 45,
    sport: overrides.sport || 'nfl',
    ...overrides,
  })
}

describe('player identity', () => {
  test('normalizes punctuation and parentheticals', () => {
    expect(normalizePlayerName('Geno Smith (SEA)')).toBe('geno smith')
    expect(normalizePlayerName('  Geno   Smith  ')).toBe('geno smith')
  })

  test('keys same player on name + game, never propId', () => {
    const under = mapCachePropToParlayBet(genoUnder15())
    const over = mapCachePropToParlayBet(genoOver05())

    expect(under.propId).not.toBe(over.propId)
    expect(under.playerId).toBe(over.playerId)
    expect(under.playerId).toBe(playerCorrelationKey(under))
    expect(under.playerId).not.toContain('player_pass_tds-1.5')
    expect(under.playerId).not.toContain('player_pass_tds-0.5')
  })
})

describe('Geno-style same-player / same-market conflicts', () => {
  test('flags under 1.5 + over 0.5 pass TDs on the same player', () => {
    const legs = [
      mapCachePropToParlayBet(genoUnder15()),
      mapCachePropToParlayBet(genoOver05()),
      mapCachePropToParlayBet(camUnder15()),
    ]

    expect(hasSamePlayerConflict(legs)).toBe(true)
    expect(hasSameMarketConflict(legs)).toBe(true)
    expect(combinationPassesIntegrity(legs, 'single_game')).toBe(false)
  })

  test('regression: propId-as-playerId would have missed the Geno card', () => {
    const broken = [
      {
        ...mapCachePropToParlayBet(genoUnder15()),
        playerId: 'SEA_at_TEN_2025-09-10-Geno Smith-player_pass_tds-1.5',
      },
      {
        ...mapCachePropToParlayBet(genoOver05()),
        playerId: 'SEA_at_TEN_2025-09-10-Geno Smith-player_pass_tds-0.5',
      },
      {
        ...mapCachePropToParlayBet(camUnder15()),
        playerId: 'SEA_at_TEN_2025-09-10-Cam Ward-player_pass_tds-1.5',
      },
    ]

    const oldIds = broken.map((leg) => leg.playerId)
    expect(new Set(oldIds).size).toBe(oldIds.length)
    expect(hasSamePlayerConflict(broken)).toBe(true)
    expect(combinationPassesIntegrity(broken, 'single_game')).toBe(false)
  })

  test('blocks two lines on the same player even when markets differ', () => {
    const legs = [
      mapCachePropToParlayBet(saneProp('Geno Smith', { type: 'player_pass_tds', threshold: 1.5 })),
      mapCachePropToParlayBet(saneProp('Geno Smith', { type: 'player_pass_yds', threshold: 229.5 })),
      mapCachePropToParlayBet(saneProp('Cam Ward')),
    ]
    expect(hasSamePlayerConflict(legs)).toBe(true)
    expect(combinationPassesIntegrity(legs, 'single_game')).toBe(false)
  })

  test('allows three different players in the same game', () => {
    const legs = [
      mapCachePropToParlayBet(saneProp('Geno Smith')),
      mapCachePropToParlayBet(saneProp('Cam Ward')),
      mapCachePropToParlayBet(saneProp('Tony Pollard', { type: 'player_rush_yds', threshold: 64.5 })),
    ]
    expect(hasSamePlayerConflict(legs)).toBe(false)
    expect(combinationPassesIntegrity(legs, 'single_game')).toBe(true)
  })

  test('does not skip integrity when only one combination exists', () => {
    const parlays = assembleParlays(
      [
        mapCachePropToParlayBet(genoUnder15()),
        mapCachePropToParlayBet(genoOver05()),
        mapCachePropToParlayBet(camUnder15()),
      ],
      { legCount: 3, type: 'single_game', featured: false, maxParlays: 5 }
    )
    expect(parlays).toEqual([])
  })
})

describe('Featured quality — Published-eligible 3-leg or empty', () => {
  test('FEATURED_LEG_COUNT is the Published board floor, not a forked 2', () => {
    expect(FEATURED_LEG_COUNT).toBe(TODAYS_BOARD_MIN_PUBLISHED)
    expect(FEATURED_LEG_COUNT).toBe(3)
  })

  test('Geno regression: live juice SGP is not Featured', () => {
    const parlays = assembleParlays(
      [
        mapCachePropToParlayBet(genoUnder15()),
        mapCachePropToParlayBet(genoOver05()),
        mapCachePropToParlayBet(camUnder15()),
      ],
      { legCount: 3, type: 'single_game', featured: true, maxParlays: 1 }
    )
    expect(parlays).toEqual([])
  })

  test('rejects edge=0 even when odds, QS, and players look sane', () => {
    const legs = [
      mapCachePropToParlayBet(saneProp('Geno Smith', { edge: 0, qualityScore: 45 })),
      mapCachePropToParlayBet(saneProp('Cam Ward', { edge: 0, qualityScore: 45 })),
      mapCachePropToParlayBet(saneProp('Tony Pollard', {
        type: 'player_rush_yds',
        threshold: 64.5,
        edge: 0,
        qualityScore: 45,
      })),
    ]
    expect(legs.every((leg) => isPublishedEligibleProp(leg))).toBe(false)
    expect(legs.every((leg) => isFeaturedQualityLeg(leg))).toBe(false)
    expect(assembleParlays(legs, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })).toEqual([])
  })

  test('rejects juice traps and out-of-band prices', () => {
    const juiceTrap = mapCachePropToParlayBet(cacheProp('Tony Pollard', {
      type: 'player_rush_tds',
      pick: 'under',
      threshold: 0.5,
      odds: 1.91,
      edge: 0.08,
      qualityScore: 50,
    }))
    const outOfBand = mapCachePropToParlayBet(cacheProp('Geno Smith', {
      type: 'player_pass_tds',
      pick: 'under',
      threshold: 1.5,
      odds: 1.40,
      probability: 0.71,
      edge: 0.06,
      qualityScore: 50,
    }))
    const juiceC = mapCachePropToParlayBet(cacheProp('Cam Ward', {
      type: 'player_pass_tds',
      pick: 'under',
      threshold: 1.5,
      odds: -250,
      probability: 0.71,
      edge: 0.05,
      qualityScore: 48,
    }))

    expect(isFeaturedQualityLeg(juiceTrap)).toBe(false)
    expect(isFeaturedQualityLeg(outOfBand)).toBe(false)
    expect(isFeaturedQualityLeg(juiceC)).toBe(false)

    const parlays = assembleParlays([juiceTrap, outOfBand, juiceC], {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })
    expect(parlays).toEqual([])
  })

  test('rejects game lines / sides / totals even when they look Published-shaped', () => {
    const moneyline = {
      id: 'ml-sea',
      gameId: GAME_ID,
      betType: 'moneyline',
      type: 'moneyline',
      selection: 'SEA',
      pick: 'SEA',
      odds: 1.91,
      probability: 0.52,
      edge: 0.10,
      qualityScore: 80,
      sport: 'nfl',
      team: 'SEA',
    }
    const total = {
      id: 'tot-sea',
      gameId: GAME_ID,
      betType: 'total',
      type: 'total',
      selection: 'over',
      pick: 'over',
      threshold: 44.5,
      odds: 1.91,
      probability: 0.52,
      edge: 0.08,
      qualityScore: 70,
      sport: 'nfl',
    }
    const prop = mapCachePropToParlayBet(publishedProp('Geno Smith'))

    expect(isFeaturedQualityLeg(moneyline)).toBe(false)
    expect(isFeaturedQualityLeg(total)).toBe(false)
    expect(assembleParlays([moneyline, total, prop], {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })).toEqual([])
  })

  test('returns empty when fewer than 3 Published-eligible legs exist', () => {
    const two = [
      mapCachePropToParlayBet(publishedProp('Geno Smith')),
      mapCachePropToParlayBet(publishedProp('Cam Ward')),
    ]
    expect(assembleParlays(two, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })).toEqual([])
    expect(assembleParlays(two, {
      legCount: 2,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })).toEqual([])
  })

  test('happy path: 3 Published-eligible props ship a Featured card', () => {
    const legs = [
      mapCachePropToParlayBet(publishedProp('Geno Smith')),
      mapCachePropToParlayBet(publishedProp('Cam Ward')),
      mapCachePropToParlayBet(publishedProp('Tony Pollard', {
        type: 'player_rush_yds',
        threshold: 64.5,
      })),
    ]
    expect(legs.every((leg) => isPublishedEligibleProp(leg))).toBe(true)
    expect(legs.every(isFeaturedQualityLeg)).toBe(true)

    const parlays = assembleParlays(legs, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })
    expect(parlays).toHaveLength(1)
    expect(parlays[0].legs).toHaveLength(FEATURED_LEG_COUNT)
    expect(parlays[0].legs.every(isFeaturedQualityLeg)).toBe(true)
    expect(parlays[0].legs.map((leg) => leg.playerName).sort()).toEqual([
      'Cam Ward',
      'Geno Smith',
      'Tony Pollard',
    ])
    expect(hasSamePlayerConflict(parlays[0].legs)).toBe(false)
    expect(isFeaturedWorthyParlay(parlays[0])).toBe(true)
  })

  test('does not apply explorer maxOdds caps to Featured', () => {
    const legs = [
      mapCachePropToParlayBet(publishedProp('Geno Smith', {
        odds: 3.0,
        probability: 0.40,
        edge: 0.06,
      })),
      mapCachePropToParlayBet(publishedProp('Cam Ward', {
        odds: 3.0,
        probability: 0.40,
        edge: 0.05,
      })),
      mapCachePropToParlayBet(publishedProp('Tony Pollard', {
        type: 'player_rush_yds',
        threshold: 64.5,
        odds: 3.0,
        probability: 0.40,
        edge: 0.04,
      })),
    ]
    const featured = assembleParlays(legs, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      filterMode: 'safe',
      maxParlays: 1,
    })
    expect(featured).toHaveLength(1)
    expect(featured[0].totalOdds).toBeGreaterThan(10)
    expect(featured[0].legs.every(isFeaturedQualityLeg)).toBe(true)
  })

  test('does not keep a looser prob/EV Featured bar — Published eligibility is the only filter', () => {
    // Old #20 bar rejected probability > 0.67. A Published-eligible 70%
    // favorite in-band must still ship when the other two legs clear too.
    const highProb = mapCachePropToParlayBet(publishedProp('Geno Smith', {
      odds: 1.61,
      probability: 0.70,
      edge: 0.05,
    }))
    const midA = mapCachePropToParlayBet(publishedProp('Cam Ward'))
    const midB = mapCachePropToParlayBet(publishedProp('Tony Pollard', {
      type: 'player_rush_yds',
      threshold: 64.5,
    }))

    expect(isFeaturedQualityLeg(highProb)).toBe(true)
    expect(isPublishedEligibleProp(highProb)).toBe(true)

    const parlays = assembleParlays([highProb, midA, midB], {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })
    expect(parlays).toHaveLength(1)
  })

  test('does not pad Featured with leftover juice when mixed with one Published trio', () => {
    const bets = [
      mapCachePropToParlayBet(genoUnder15()),
      mapCachePropToParlayBet(genoOver05()),
      mapCachePropToParlayBet(camUnder15()),
      mapCachePropToParlayBet(publishedProp('Geno Smith')),
      mapCachePropToParlayBet(publishedProp('Cam Ward')),
      mapCachePropToParlayBet(publishedProp('Tony Pollard', {
        type: 'player_rush_yds',
        threshold: 64.5,
      })),
    ]
    const parlays = assembleParlays(bets, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 5,
    })
    expect(parlays.length).toBeGreaterThan(0)
    for (const parlay of parlays) {
      expect(hasSamePlayerConflict(parlay.legs)).toBe(false)
      expect(parlay.legs).toHaveLength(FEATURED_LEG_COUNT)
      expect(parlay.legs.every(isFeaturedQualityLeg)).toBe(true)
      expect(parlay.legs.every((leg) => isPublishedEligibleProp(leg))).toBe(true)
      const genoTds = parlay.legs.filter((leg) => (
        leg.playerName === 'Geno Smith' && leg.propType === 'player_pass_tds'
      ))
      expect(genoTds.length).toBeLessThan(2)
    }
  })

  test('rejects NHL and stale / expired / already-started legs', () => {
    const now = new Date('2026-09-10T18:00:00Z')
    const nhl = mapCachePropToParlayBet(publishedProp('Auston Matthews', {
      sport: 'nhl',
      type: 'player_shots_on_goal',
      threshold: 3.5,
    }))
    const stale = mapCachePropToParlayBet(publishedProp('Geno Smith', { isStale: true }))
    const expired = mapCachePropToParlayBet(publishedProp('Cam Ward', {
      expiresAt: '2026-09-10T17:00:00Z',
    }))
    const started = mapCachePropToParlayBet(publishedProp('Tony Pollard', {
      type: 'player_rush_yds',
      threshold: 64.5,
      gameTime: '2026-09-10T17:00:00Z',
    }))

    expect(isFeaturedQualityLeg(nhl, now)).toBe(false)
    expect(isFeaturedQualityLeg(stale, now)).toBe(false)
    expect(isFeaturedQualityLeg(expired, now)).toBe(false)
    expect(isFeaturedQualityLeg(started, now)).toBe(false)
  })
})
