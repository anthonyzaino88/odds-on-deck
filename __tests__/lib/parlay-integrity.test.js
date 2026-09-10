import {
  assembleParlays,
  combinationPassesIntegrity,
  hasSameMarketConflict,
  hasSamePlayerConflict,
  isFeaturedQualityLeg,
  isFeaturedWorthyParlay,
  mapCachePropToParlayBet,
  normalizePlayerName,
  playerCorrelationKey,
} from '../../lib/parlay-integrity.js'

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

describe('Featured quality — empty over junk', () => {
  test('rejects the live Geno + Cam Ward juice SGP as Featured', () => {
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

  test('rejects juice-heavy favorites with edge≈0 even when players differ', () => {
    const juiceA = mapCachePropToParlayBet(cacheProp('Geno Smith', {
      type: 'player_pass_tds',
      pick: 'under',
      threshold: 1.5,
      odds: 1.40,
      probability: 0.71,
      edge: 0,
    }))
    const juiceB = mapCachePropToParlayBet(cacheProp('Cam Ward', {
      type: 'player_pass_tds',
      pick: 'under',
      threshold: 1.5,
      odds: 1.36,
      probability: 0.735,
      edge: 0,
    }))
    const juiceC = mapCachePropToParlayBet(cacheProp('Tony Pollard', {
      type: 'player_rush_tds',
      pick: 'under',
      threshold: 0.5,
      odds: 1.33,
      probability: 0.75,
      edge: 0,
    }))

    expect(isFeaturedQualityLeg(juiceA)).toBe(false)
    expect(isFeaturedQualityLeg(juiceB)).toBe(false)
    expect(isFeaturedQualityLeg(juiceC)).toBe(false)

    const parlays = assembleParlays([juiceA, juiceB, juiceC], {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })
    expect(parlays).toEqual([])
  })

  test('rejects a -EV card even if integrity passes', () => {
    const legs = [
      mapCachePropToParlayBet(saneProp('Geno Smith', { odds: 1.91, probability: 0.48 })),
      mapCachePropToParlayBet(saneProp('Cam Ward', { odds: 1.91, probability: 0.48 })),
      mapCachePropToParlayBet(saneProp('Tony Pollard', {
        type: 'player_rush_yds',
        threshold: 64.5,
        odds: 1.91,
        probability: 0.48,
      })),
    ]
    const [parlay] = assembleParlays(legs, {
      legCount: 3,
      type: 'single_game',
      featured: false,
      maxParlays: 1,
    })
    expect(parlay).toBeDefined()
    expect(parlay.expectedValue).toBeLessThan(0)
    expect(isFeaturedWorthyParlay(parlay)).toBe(false)
    expect(assembleParlays(legs, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })).toEqual([])
  })

  test('keeps a sane three-player SGP when lines are in band and EV is not negative', () => {
    const legs = [
      mapCachePropToParlayBet(saneProp('Geno Smith')),
      mapCachePropToParlayBet(saneProp('Cam Ward')),
      mapCachePropToParlayBet(saneProp('Tony Pollard', { type: 'player_rush_yds', threshold: 64.5 })),
    ]
    const parlays = assembleParlays(legs, {
      legCount: 3,
      type: 'single_game',
      featured: true,
      maxParlays: 1,
    })
    expect(parlays).toHaveLength(1)
    expect(parlays[0].legs.map((leg) => leg.playerName).sort()).toEqual([
      'Cam Ward',
      'Geno Smith',
      'Tony Pollard',
    ])
    expect(hasSamePlayerConflict(parlays[0].legs)).toBe(false)
  })

  test('does not pad Featured with leftover juice when mixed with one sane trio', () => {
    const bets = [
      mapCachePropToParlayBet(genoUnder15()),
      mapCachePropToParlayBet(genoOver05()),
      mapCachePropToParlayBet(camUnder15()),
      mapCachePropToParlayBet(saneProp('Geno Smith')),
      mapCachePropToParlayBet(saneProp('Cam Ward')),
      mapCachePropToParlayBet(saneProp('Tony Pollard', { type: 'player_rush_yds', threshold: 64.5 })),
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
      expect(parlay.legs.every(isFeaturedQualityLeg)).toBe(true)
      const genoTds = parlay.legs.filter((leg) => (
        leg.playerName === 'Geno Smith' && leg.propType === 'player_pass_tds'
      ))
      expect(genoTds.length).toBeLessThan(2)
    }
  })
})
