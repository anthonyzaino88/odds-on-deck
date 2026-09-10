/**
 * Parlay integrity + Featured quality gates.
 *
 * Correlation used to key "same player" off playerId, but the generator
 * filled playerId from propId (unique per line). Geno under 1.5 and Geno
 * over 0.5 then looked like two players. Identity is player name + game.
 *
 * Featured would rather return [] than ship a juice or contradictory card.
 */
import { isJuiceTrap } from './juice-traps.js'
import { isAmericanOddsInPublishedBand, toDecimalOdds } from './odds-units.js'
import { calculateQualityScore } from './quality-score.js'

export const FEATURED_MAX_LEG_PROBABILITY = 0.67
export const FEATURED_MIN_LEG_PROBABILITY = 0.40
export const FEATURED_UNDER_15_MAX_PROBABILITY = 0.60
/** Reject clear -EV; allow float noise around a fair 0. */
export const FEATURED_MIN_EV = -0.01

const GAME_BET_TYPES = new Set(['moneyline', 'h2h', 'spread', 'spreads', 'total', 'totals'])

const MAX_BETS_BY_LEG_COUNT = {
  2: 200,
  3: 100,
  4: 50,
  5: 30,
  6: 25,
}

const MAX_ODDS_BY_MODE = {
  safe: 10,
  balanced: 30,
  value: 50,
}

export function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isGameLevelBet(bet) {
  if (!bet) return false
  if (GAME_BET_TYPES.has(String(bet.betType || '').toLowerCase())) return true
  if (GAME_BET_TYPES.has(String(bet.type || '').toLowerCase())) return true
  return false
}

/**
 * Stable same-player key. Never uses propId — that is unique per line.
 */
export function playerCorrelationKey(bet) {
  if (!bet || isGameLevelBet(bet)) return null
  const name = normalizePlayerName(bet.playerName)
  if (!name) return null
  return `${String(bet.gameId || '').toLowerCase()}::${name}`
}

export function playerMarketKey(bet) {
  const playerKey = playerCorrelationKey(bet)
  if (!playerKey) return null
  const market = String(bet.propType || bet.type || '').toLowerCase().trim()
  if (!market || market === 'prop' || market === 'player_prop') return null
  return `${playerKey}::${market}`
}

export function hasSamePlayerConflict(legs) {
  if (!Array.isArray(legs)) return false
  const keys = legs.map(playerCorrelationKey).filter(Boolean)
  return new Set(keys).size < keys.length
}

export function hasSameMarketConflict(legs) {
  if (!Array.isArray(legs)) return false
  const keys = legs.map(playerMarketKey).filter(Boolean)
  return new Set(keys).size < keys.length
}

export function hasContradictoryGameLines(legs) {
  if (!Array.isArray(legs)) return false

  const byGame = new Map()
  for (const leg of legs) {
    const gid = leg?.gameId
    if (!gid) continue
    if (!byGame.has(gid)) byGame.set(gid, [])
    byGame.get(gid).push(leg)
  }

  for (const gameLegs of byGame.values()) {
    const types = new Set(gameLegs.map((leg) => String(leg.betType || '').toLowerCase()))
    if (types.has('moneyline') && types.has('spread')) return true
    if (types.has('moneyline') && types.has('total')) return true

    const moneylines = gameLegs.filter((leg) => {
      const t = String(leg.betType || '').toLowerCase()
      return t === 'moneyline' || t === 'h2h'
    })
    if (moneylines.length > 1) return true

    const totals = gameLegs.filter((leg) => {
      const t = String(leg.betType || '').toLowerCase()
      return t === 'total' || t === 'totals'
    })
    const totalPicks = new Set(
      totals.map((leg) => String(leg.selection || leg.pick || '').toLowerCase().trim())
    )
    if (totalPicks.has('over') && totalPicks.has('under')) return true

    const gameLevel = gameLegs.filter((leg) => isGameLevelBet(leg))
    const teams = gameLevel.map((leg) => leg.team).filter(Boolean)
    if (teams.length > 0 && new Set(teams).size < teams.length) return true
  }

  return false
}

export function combinationPassesIntegrity(legs, type = 'multi_game') {
  if (!Array.isArray(legs) || legs.length < 2) return false

  const uniqueGames = new Set(legs.map((leg) => leg.gameId))
  if (type === 'single_game' && uniqueGames.size > 1) return false

  if (hasSamePlayerConflict(legs)) return false
  if (hasSameMarketConflict(legs)) return false
  if (hasContradictoryGameLines(legs)) return false
  return true
}

export function filterCombinationsByIntegrity(combinations, type = 'multi_game') {
  if (!Array.isArray(combinations)) return []
  return combinations.filter((combo) => combinationPassesIntegrity(combo, type))
}

function propLikeForJuice(leg) {
  return {
    pick: leg.selection || leg.pick,
    prediction: leg.selection || leg.pick,
    threshold: leg.threshold,
    type: leg.propType || leg.type,
    propType: leg.propType || leg.type,
  }
}

export function isJuiceHeavyFavorite(leg) {
  if (!leg) return true
  if (!isAmericanOddsInPublishedBand(leg.odds)) return true
  const probability = Number(leg.probability)
  if (Number.isFinite(probability) && probability > FEATURED_MAX_LEG_PROBABILITY) return true
  return false
}

export function isFeaturedQualityLeg(leg) {
  if (!leg || typeof leg !== 'object') return false
  if (isJuiceTrap(propLikeForJuice(leg))) return false
  if (isJuiceHeavyFavorite(leg)) return false

  const probability = Number(leg.probability)
  if (!Number.isFinite(probability)) return false
  if (probability > FEATURED_MAX_LEG_PROBABILITY || probability < FEATURED_MIN_LEG_PROBABILITY) {
    return false
  }

  if (isGameLevelBet(leg)) return true

  const pick = String(leg.selection || leg.pick || '').toLowerCase().trim()
  const threshold = Number(leg.threshold)
  if (pick === 'under' && threshold === 1.5 && probability > FEATURED_UNDER_15_MAX_PROBABILITY) {
    return false
  }

  return true
}

export function isFeaturedWorthyParlay(parlay) {
  if (!parlay || !Array.isArray(parlay.legs) || parlay.legs.length < 2) return false
  if (!combinationPassesIntegrity(parlay.legs, parlay.type || 'multi_game')) return false
  if (!parlay.legs.every(isFeaturedQualityLeg)) return false

  const ev = Number(parlay.expectedValue)
  if (!Number.isFinite(ev) || ev < FEATURED_MIN_EV) return false
  return true
}

export function filterFeaturedParlays(parlays) {
  if (!Array.isArray(parlays)) return []
  return parlays.filter(isFeaturedWorthyParlay)
}

/**
 * Map a PlayerPropCache row (or test fixture) onto a parlay leg.
 * playerId is the name+game key — never propId.
 */
export function mapCachePropToParlayBet(prop) {
  if (!prop || typeof prop !== 'object') return null

  const gameId = prop.gameId
  const playerName = prop.playerName || null
  const propType = prop.type || prop.propType || 'prop'
  const pick = prop.pick || prop.selection
  const playerKey = playerCorrelationKey({
    playerName,
    gameId,
    betType: 'prop',
    type: propType,
  })

  return {
    id: `prop-${gameId}-${prop.propId || playerName}-${propType}-${pick}-${prop.threshold}`,
    gameId,
    betType: 'prop',
    selection: pick,
    pick,
    odds: prop.odds ?? -110,
    probability: prop.probability || 0.5,
    edge: prop.edge || 0,
    confidence: prop.confidence || 'low',
    qualityScore: prop.qualityScore || 0,
    team: prop.team,
    opponent: prop.opponent ?? null,
    playerId: playerKey,
    playerName,
    propType,
    type: propType,
    threshold: prop.threshold,
    gameTime: prop.gameTime,
    reasoning: prop.reasoning,
    sport: prop.sport || 'mlb',
    bookmaker: prop.bookmaker,
    propId: prop.propId,
  }
}

export function generateCombinations(bets, legCount) {
  const combinations = []
  if (!Array.isArray(bets) || bets.length < legCount) return combinations

  function backtrack(start, current) {
    if (current.length === legCount) {
      combinations.push([...current])
      return
    }
    for (let i = start; i < bets.length; i += 1) {
      current.push(bets[i])
      backtrack(i + 1, current)
      current.pop()
    }
  }

  backtrack(0, [])
  return combinations
}

function getConfidenceLevel(probability) {
  if (probability >= 0.70) return 'very_high'
  if (probability >= 0.55) return 'high'
  if (probability >= 0.45) return 'medium'
  if (probability >= 0.30) return 'low'
  return 'very_low'
}

export function calculateParlayMetrics(combinations) {
  if (!Array.isArray(combinations)) return []
  const parlays = []

  for (const combination of combinations) {
    let probability = 1
    let totalOdds = 1
    for (const bet of combination) {
      probability *= bet.probability || 0.5
      const decimalOdds = toDecimalOdds(bet.odds)
      if (decimalOdds == null || decimalOdds <= 1) {
        totalOdds = 0
        break
      }
      totalOdds *= decimalOdds
    }

    if (!Number.isFinite(totalOdds) || totalOdds <= 1) continue

    const impliedProbability = 1 / totalOdds
    const edge = (probability - impliedProbability) / impliedProbability
    const expectedValue = probability * totalOdds - 1
    const confidence = getConfidenceLevel(probability)
    const qualityScore = calculateQualityScore({
      probability,
      edge,
      confidence,
    })
    const uniqueGames = new Set(combination.map((bet) => bet.gameId))

    parlays.push({
      legs: combination,
      totalOdds,
      probability,
      edge,
      expectedValue,
      confidence,
      qualityScore,
      sport: combination[0].sport || 'mlb',
      type: uniqueGames.size === 1 ? 'single_game' : 'multi_game',
    })
  }

  return parlays
}

function rankParlays(parlays, filterMode, featured) {
  const ranked = [...parlays]
  if (featured) {
    // Do not sort Featured by raw hit rate — that prefers juice favorites.
    ranked.sort((a, b) => {
      const ev = (b.expectedValue || 0) - (a.expectedValue || 0)
      if (Math.abs(ev) > 0.005) return ev
      return (b.qualityScore || 0) - (a.qualityScore || 0)
    })
    return ranked
  }

  if (filterMode === 'safe') {
    ranked.sort((a, b) => b.probability - a.probability)
  } else if (filterMode === 'value') {
    ranked.sort((a, b) => b.expectedValue - a.expectedValue)
  } else {
    ranked.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
  }
  return ranked
}

/**
 * Pure assemble path used by the generator and by regression tests.
 * Always applies integrity (never skipped for small combination counts).
 */
export function assembleParlays(bets, options = {}) {
  const {
    legCount = 3,
    type = 'multi_game',
    filterMode = 'safe',
    maxParlays = 10,
    featured = false,
    gameId = null,
  } = options

  let pool = Array.isArray(bets) ? bets.filter(Boolean) : []
  if (gameId) pool = pool.filter((bet) => bet.gameId === gameId)
  if (featured) pool = pool.filter(isFeaturedQualityLeg)
  if (pool.length < legCount) return []

  const maxBets = MAX_BETS_BY_LEG_COUNT[legCount] || 30
  if (pool.length > maxBets) {
    pool = [...pool]
      .sort((a, b) => {
        if (featured) {
          const evA = (a.probability || 0.5) * (toDecimalOdds(a.odds) || 2) - 1
          const evB = (b.probability || 0.5) * (toDecimalOdds(b.odds) || 2) - 1
          if (Math.abs(evB - evA) > 0.01) return evB - evA
        }
        const probDiff = (b.probability || 0.5) - (a.probability || 0.5)
        if (!featured && Math.abs(probDiff) > 0.05) return probDiff
        const qualityDiff = (b.qualityScore || 0) - (a.qualityScore || 0)
        if (Math.abs(qualityDiff) > 0.1) return qualityDiff
        return (b.edge || 0) - (a.edge || 0)
      })
      .slice(0, maxBets)
  }

  const combinations = generateCombinations(pool, legCount)
  const valid = filterCombinationsByIntegrity(combinations, type)
  let parlays = calculateParlayMetrics(valid)

  if (type === 'single_game' && gameId) {
    parlays = parlays.filter((parlay) => parlay.legs.every((leg) => leg.gameId === gameId))
  }

  const maxOdds = MAX_ODDS_BY_MODE[filterMode] || 30
  parlays = parlays.filter((parlay) => parlay.totalOdds <= maxOdds)

  if (featured) {
    parlays = filterFeaturedParlays(parlays)
  }

  return rankParlays(parlays, filterMode, featured).slice(0, maxParlays)
}
