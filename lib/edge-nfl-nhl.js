// NHL edge calculation (NFL is routed out — see lib/edge-nfl.js).
// Moneyline uses shrunk goal differential. Totals keep the existing heuristic.
// Split records are ignored: ESPN no longer sends NHL home/away splits.

import { removeMlVig, removeTotalVig, normalizeToAmericanOdds } from './implied.js'
import { calculateNFLEdges } from './edge-nfl.js'
import { evaluateMatchupTeamStatsForEdge, interpretTeamSeasonStats } from './team-performance-stats.js'

export const NHL_MODEL_VERSION = 'nhl-gd-v0.2.0'
export const MODEL_VERSION = NHL_MODEL_VERSION
export const LEGACY_NHL_HEURISTIC_VERSIONS = Object.freeze(['nfl-nhl-v0.1.0'])
/** PR #59 merge. Date fallback only when an NHL edge-model row has no modelRun. */
export const NHL_GD_MODEL_CUTOVER = '2026-10-27T15:02:00.000Z'

export const NHL_GD_PRIOR_GAMES = 20
export const NHL_HOME_ICE = 0.14
export const NHL_HOME_ICE_PROB = 1 / (1 + Math.exp(-NHL_HOME_ICE))
export const NHL_MARKET_BLEND = 0.35
export const NHL_MAX_MODEL_MARKET_GAP = 0.08
export const NHL_ML_PROB_FLOOR = 0.25
export const NHL_ML_PROB_CEILING = 0.75
export const NHL_ML_EDGE_CAP = 0.05
export const NHL_TOTAL_EDGE_CAP = 0.10
export const NHL_MIN_GAMES_PLAYED = 5
export const NHL_EQUAL_STRENGTH_GD_EPS = 1e-9
/** ~0.5 percentage point of the pure home-ice probability. */
export const NHL_EQUAL_STRENGTH_PROB_EPS = 0.005

export const NHL_SKIP_REASONS = Object.freeze({
  CLAMP_HIT: 'clamp_hit',
  GAP_GT_0_08: 'gap_gt_0.08',
  MISSING_GOAL_DIFF: 'missing_goal_differential',
  DEGENERATE_EQUAL_STRENGTH: 'degenerate_equal_strength',
  INSUFFICIENT_GAMES_PLAYED: 'insufficient_games_played',
})

export function isLegacyNhlHeuristicVersion(modelRun) {
  return LEGACY_NHL_HEURISTIC_VERSIONS.includes(String(modelRun || ''))
}

function normalizeSport(sport) {
  return String(sport || '').toLowerCase().trim()
}

function nhlModelRunFrom(record) {
  if (!record || typeof record !== 'object') return ''
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : null
  return record.modelRun || record.modelVersion
    || payload?.modelRun || payload?.modelVersion
    || ''
}

function isNhlEdgeModelPickShape(record) {
  const source = String(record?.source || '').toLowerCase().trim()
  if (source === 'game_line') return true
  const type = String(record?.propType || record?.type || '').toLowerCase().trim()
  return type === 'moneyline' || type === 'total' || type === 'totals' || type === 'h2h' || type === 'ml'
}

function nhlRecordInstant(record) {
  for (const key of ['ts', 'timestamp', 'createdAt', 'completedAt']) {
    const raw = record?.[key]
    if (raw == null || raw === '') continue
    const date = raw instanceof Date ? raw : new Date(raw)
    if (!Number.isNaN(date.getTime())) return date
  }
  return null
}

/**
 * NHL-only. NFL rows that still carry nfl-nhl-v0.1.0 stay on the NFL
 * legacy path (isLegacyNflHeuristicVersion / isLegacyNflPublishedRow).
 *
 * Prefer modelRun. When an NHL moneyline / total / game_line row has no
 * version, fall back to the PR #59 merge instant. Player props are not
 * date-filtered.
 */
export function isLegacyNhlModelRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (normalizeSport(record.sport) !== 'nhl') return false

  const modelRun = nhlModelRunFrom(record)
  if (modelRun) return isLegacyNhlHeuristicVersion(modelRun)
  if (!isNhlEdgeModelPickShape(record)) return false

  const at = nhlRecordInstant(record)
  if (!at) return false
  return at.getTime() < new Date(NHL_GD_MODEL_CUTOVER).getTime()
}

export function isLegacyNhlHeuristicSnapshot(edge, sport) {
  return isLegacyNhlModelRecord({
    ...(edge && typeof edge === 'object' ? edge : {}),
    sport: sport || edge?.sport,
  })
}

/**
 * Historical shared entry point. NFL is routed to the isolated model.
 * NHL uses the shrunk-GD moneyline (NHL_MODEL_VERSION).
 */
export function calculateNFLNHLEdges(game, odds, options) {
  const sport = game?.sport?.toLowerCase()
  if (sport === 'nfl') {
    return calculateNFLEdges(game, odds, options)
  }
  return calculateNHLEdges(game, odds, options)
}

/**
 * Calculate game edges for NHL using team performance data
 * @param {object} game - Game data with teams
 * @param {object} odds - Odds data for the game
 * @returns {object} Edge calculations
 */
export function calculateNHLEdges(game, odds, { now = new Date() } = {}) {
  const sport = 'nhl'
  
  console.log(`\n📊 Calculating ${sport.toUpperCase()} edges for ${game.away?.abbr} @ ${game.home?.abbr}`)

  const eligibility = evaluateMatchupTeamStatsForEdge(game?.home, game?.away, { sport, now })
  if (!eligibility.ok) {
    console.log(`  ⏭️  Skipping NHL edge: ${eligibility.reason}`)
    return createSkippedEdges(eligibility.reason)
  }
  
  try {
    // Get market probabilities from odds
    const marketProbs = getMarketProbabilities(odds)
    
    if (!marketProbs.mlHome || !marketProbs.mlAway) {
      console.log('  ⚠️  No moneyline odds available')
      return createNullEdges()
    }
    
    const model = calculateNhlWinProbabilities(game.home, game.away)
    if (!model.ok) {
      console.log(`  ⏭️  Skipping NHL edge: ${model.reason}`)
      return createSkippedEdges(model.reason, buildNhlModelPayload(model))
    }

    console.log(`  Market: Home ${(marketProbs.mlHome * 100).toFixed(1)}% | Away ${(marketProbs.mlAway * 100).toFixed(1)}%`)
    console.log(`  GD*: Home ${model.homeGd.toFixed(3)} | Away ${model.awayGd.toFixed(3)}`)
    console.log(`  Our Model: Home ${(model.homeWin * 100).toFixed(1)}% | Away ${(model.awayWin * 100).toFixed(1)}%`)

    if (model.homeWin < NHL_ML_PROB_FLOOR || model.homeWin > NHL_ML_PROB_CEILING) {
      console.log(`  ⏭️  Skipping NHL edge: ${NHL_SKIP_REASONS.CLAMP_HIT}`)
      return createSkippedEdges(NHL_SKIP_REASONS.CLAMP_HIT, buildNhlModelPayload(model))
    }

    const modelMarketGap = Math.abs(model.homeWin - marketProbs.mlHome)
    if (modelMarketGap > NHL_MAX_MODEL_MARKET_GAP) {
      console.log(`  ⏭️  Skipping NHL edge: ${NHL_SKIP_REASONS.GAP_GT_0_08} (|model-m|=${modelMarketGap.toFixed(3)})`)
      return createSkippedEdges(NHL_SKIP_REASONS.GAP_GT_0_08, buildNhlModelPayload(model))
    }

    const blendedHome = marketProbs.mlHome + NHL_MARKET_BLEND * (model.homeWin - marketProbs.mlHome)
    const blendedAway = marketProbs.mlAway + NHL_MARKET_BLEND * (model.awayWin - marketProbs.mlAway)
    console.log(`  Blended: Home ${(blendedHome * 100).toFixed(1)}% | Away ${(blendedAway * 100).toFixed(1)}%`)

    // Calculate predicted total and over/under edges
    const totalsPrediction = predictGameTotal(game.home, game.away, sport)
    const totalsEdges = calculateTotalsEdges(totalsPrediction, marketProbs)
    
    if (totalsPrediction.predictedTotal) {
      console.log(`  Total: Our ${totalsPrediction.predictedTotal.toFixed(1)} vs Market ${marketProbs.total || 'N/A'}`)
    }
    
    // Calculate edges (blended probability - market probability)
    const edges = {
      edgeMlHome: capEdge(blendedHome - marketProbs.mlHome, NHL_ML_EDGE_CAP),
      edgeMlAway: capEdge(blendedAway - marketProbs.mlAway, NHL_ML_EDGE_CAP),
      edgeTotalO: totalsEdges.overEdge,
      edgeTotalU: totalsEdges.underEdge,
      modelRun: NHL_MODEL_VERSION,
      payload: buildNhlModelPayload(model, { blendedProb: blendedHome }),
    }
    
    // Only include edges if they're meaningful
    // ML: 2% threshold (more conservative for game outcomes)
    // Totals: 1% threshold (lower since scoring is more predictable)
    if (Math.abs(edges.edgeMlHome) < 0.02) edges.edgeMlHome = null
    if (Math.abs(edges.edgeMlAway) < 0.02) edges.edgeMlAway = null
    if (edges.edgeTotalO && Math.abs(edges.edgeTotalO) < 0.01) edges.edgeTotalO = null
    if (edges.edgeTotalU && Math.abs(edges.edgeTotalU) < 0.01) edges.edgeTotalU = null
    
    console.log(`  Edges: Home ${edges.edgeMlHome ? (edges.edgeMlHome * 100).toFixed(1) + '%' : 'none'} | Away ${edges.edgeMlAway ? (edges.edgeMlAway * 100).toFixed(1) + '%' : 'none'}`)
    if (edges.edgeTotalO || edges.edgeTotalU) {
      console.log(`  Totals: Over ${edges.edgeTotalO ? (edges.edgeTotalO * 100).toFixed(1) + '%' : 'none'} | Under ${edges.edgeTotalU ? (edges.edgeTotalU * 100).toFixed(1) + '%' : 'none'}`)
    }
    
    return edges
    
  } catch (error) {
    console.error('  ❌ Error calculating edges:', error.message)
    return createNullEdges()
  }
}

/**
 * Season W-L-OTL from ESPN GP + last10Record (season record).
 * last10Record is often W-L only; OTL = GP - W - L when GP is present.
 * Split records are ignored.
 */
export function deriveNhlSeasonRecord(team) {
  const interpreted = interpretTeamSeasonStats(team)
  const wins = Number.isFinite(interpreted.wins) ? interpreted.wins : 0
  const losses = Number.isFinite(interpreted.losses) ? interpreted.losses : 0
  const espnGp = interpreted.gamesPlayed
  const recordGames = wins + losses + (Number.isFinite(interpreted.otl) ? interpreted.otl : 0)
  const gamesPlayed = Number.isFinite(espnGp) && espnGp > 0 ? espnGp : (recordGames > 0 ? recordGames : null)

  let otl = Number.isFinite(interpreted.otl) ? interpreted.otl : 0
  if (Number.isFinite(gamesPlayed) && gamesPlayed > 0) {
    otl = Math.max(0, gamesPlayed - wins - losses)
  }

  const ptsPct = Number.isFinite(gamesPlayed) && gamesPlayed > 0
    ? (2 * wins + otl) / (2 * gamesPlayed)
    : null

  return { wins, losses, otl, gamesPlayed, ptsPct }
}

/**
 * Shrunk goal differential per game: GD* = (GD/GP) * GP/(GP+20).
 * GF/GA come from the season PPG columns (avgPointsLast10 / Allowed).
 */
export function shrunkGoalDifferential(team) {
  return nhlTeamEdgeInputs(team).shrunkGd
}

export function nhlTeamEdgeInputs(team) {
  const { gamesPlayed } = deriveNhlSeasonRecord(team)
  const gfPerGame = Number(team?.avgPointsLast10)
  const gaPerGame = Number(team?.avgPointsAllowedLast10)
  const gp = Number.isFinite(gamesPlayed) ? gamesPlayed : null
  const gf = Number.isFinite(gfPerGame) ? gfPerGame : null
  const ga = Number.isFinite(gaPerGame) ? gaPerGame : null
  const shrunkGd = gp != null && gp > 0 && gf != null && ga != null
    ? (gf - ga) * (gp / (gp + NHL_GD_PRIOR_GAMES))
    : null
  return { gamesPlayed: gp, gfPerGame: gf, gaPerGame: ga, shrunkGd }
}

export function buildNhlModelPayload(model, { blendedProb = null } = {}) {
  return {
    sport: 'nhl',
    modelVersion: NHL_MODEL_VERSION,
    home: model?.home || null,
    away: model?.away || null,
    rawModelProb: Number.isFinite(model?.homeWin) ? model.homeWin : null,
    blendedProb: Number.isFinite(blendedProb) ? blendedProb : null,
  }
}

/**
 * p_home = 1 / (1 + e^-(1.0*(GD*_home - GD*_away) + 0.14))
 * Even GD* → ~53.5% home ice. No strength clamp.
 */
function calculateNhlWinProbabilities(homeTeam, awayTeam) {
  const home = nhlTeamEdgeInputs(homeTeam)
  const away = nhlTeamEdgeInputs(awayTeam)
  const base = { home, away, homeGd: home.shrunkGd, awayGd: away.shrunkGd }

  if (
    (home.gamesPlayed != null && home.gamesPlayed < NHL_MIN_GAMES_PLAYED)
    || (away.gamesPlayed != null && away.gamesPlayed < NHL_MIN_GAMES_PLAYED)
  ) {
    return { ok: false, reason: NHL_SKIP_REASONS.INSUFFICIENT_GAMES_PLAYED, ...base }
  }

  if (home.shrunkGd == null || away.shrunkGd == null) {
    return { ok: false, reason: NHL_SKIP_REASONS.MISSING_GOAL_DIFF, ...base }
  }

  if (Math.abs(home.shrunkGd - away.shrunkGd) <= NHL_EQUAL_STRENGTH_GD_EPS) {
    return { ok: false, reason: NHL_SKIP_REASONS.DEGENERATE_EQUAL_STRENGTH, ...base }
  }

  const homeWin = 1 / (1 + Math.exp(-(1.0 * (home.shrunkGd - away.shrunkGd) + NHL_HOME_ICE)))
  if (Math.abs(homeWin - NHL_HOME_ICE_PROB) <= NHL_EQUAL_STRENGTH_PROB_EPS) {
    return {
      ok: false,
      reason: NHL_SKIP_REASONS.DEGENERATE_EQUAL_STRENGTH,
      ...base,
      homeWin,
      awayWin: 1 - homeWin,
    }
  }

  return {
    ok: true,
    homeWin,
    awayWin: 1 - homeWin,
    homeGd: home.shrunkGd,
    awayGd: away.shrunkGd,
    home,
    away,
  }
}

/**
 * Predict game total based on team offensive and defensive performance
 */
function predictGameTotal(homeTeam, awayTeam, sport) {
  try {
    // Need points per game data for both teams
    if (!homeTeam.avgPointsLast10 || !homeTeam.last10Record ||
        !awayTeam.avgPointsLast10 || !awayTeam.last10Record ||
        !homeTeam.avgPointsAllowedLast10 || !awayTeam.avgPointsAllowedLast10) {
      return { predictedTotal: null, homeExpected: null, awayExpected: null }
    }
    
    // Calculate games played to get per-game averages
    const homeGames = calculateGamesPlayed(homeTeam.last10Record)
    const awayGames = calculateGamesPlayed(awayTeam.last10Record)
    
    if (homeGames === 0 || awayGames === 0) {
      return { predictedTotal: null, homeExpected: null, awayExpected: null }
    }
    
    // avgPointsLast10 is already per-game (PPG), not a window total
    const homeOffense = homeTeam.avgPointsLast10
    const homeDefense = homeTeam.avgPointsAllowedLast10
    const awayOffense = awayTeam.avgPointsLast10
    const awayDefense = awayTeam.avgPointsAllowedLast10
    
    // Predict each team's score:
    // Home expected = average of (home offense, away defense)
    // Away expected = average of (away offense, home defense)
    const homeExpected = (homeOffense + awayDefense) / 2
    const awayExpected = (awayOffense + homeDefense) / 2
    
    // Add small home field scoring boost
    const homeBoost = sport === 'nfl' ? 1.5 : 0.2 // NFL: 1.5 pts, NHL: 0.2 goals
    const predictedTotal = homeExpected + awayExpected + homeBoost
    
    return {
      predictedTotal,
      homeExpected: homeExpected + homeBoost,
      awayExpected
    }
  } catch (error) {
    return { predictedTotal: null, homeExpected: null, awayExpected: null }
  }
}

/**
 * Calculate games played from record string
 */
function calculateGamesPlayed(record) {
  try {
    const parts = record.split('-').map(Number)
    if (isNaN(parts[0]) || isNaN(parts[1])) return 0
    return parts[0] + parts[1] + (parts[2] || 0)
  } catch (error) {
    return 0
  }
}

/**
 * Calculate over/under edges based on predicted total vs market line
 */
function calculateTotalsEdges(prediction, marketProbs) {
  // If we don't have a prediction or market line, return null
  if (!prediction.predictedTotal || !marketProbs.total || 
      !marketProbs.totalOver || !marketProbs.totalUnder) {
    return { overEdge: null, underEdge: null }
  }
  
  const ourTotal = prediction.predictedTotal
  const marketTotal = marketProbs.total
  const diff = ourTotal - marketTotal
  
  // If our predicted total is significantly higher than market, Over has edge
  // If our predicted total is significantly lower than market, Under has edge
  
  // Use a sigmoid function to convert point difference to probability shift
  // For NFL: 3 point difference = moderate edge, 7+ = strong edge
  // For NHL: 0.3 goal difference = moderate edge, 0.7+ = strong edge
  
  let overEdge = null
  let underEdge = null
  
  if (diff > 0.3) {
    // Our total is higher than market - Over has edge
    // Calculate edge as a function of the difference
    const edgeStrength = Math.min(0.12, Math.abs(diff) * 0.03) // 3% per point/goal difference, cap at 12%
    overEdge = capEdge(edgeStrength)
    underEdge = capEdge(-edgeStrength)
  } else if (diff < -0.3) {
    // Our total is lower than market - Under has edge
    const edgeStrength = Math.min(0.12, Math.abs(diff) * 0.03)
    underEdge = capEdge(edgeStrength)
    overEdge = capEdge(-edgeStrength)
  }
  
  // Apply minimum threshold (1% for totals - lower than ML since scoring is more predictable)
  if (overEdge && Math.abs(overEdge) < 0.01) overEdge = null
  if (underEdge && Math.abs(underEdge) < 0.01) underEdge = null
  
  return { overEdge, underEdge }
}

/**
 * Extract market probabilities from odds
 */
function getMarketProbabilities(odds) {
  if (!odds || odds.length === 0) {
    return {
      mlHome: null,
      mlAway: null,
      totalOver: null,
      totalUnder: null,
      total: null
    }
  }
  
  // Find h2h odds
  const h2hOdds = odds.filter(o => o.market === 'h2h')
  const totalOdds = odds.filter(o => o.market === 'totals')
  
  let mlProbs = { mlHome: null, mlAway: null }
  if (h2hOdds.length > 0) {
    const bestH2h = h2hOdds[0]
    if (bestH2h.priceHome && bestH2h.priceAway) {
      const homeOdds = normalizeToAmericanOdds(bestH2h.priceHome)
      const awayOdds = normalizeToAmericanOdds(bestH2h.priceAway)
      const fairOdds = removeMlVig(homeOdds, awayOdds)
      mlProbs.mlHome = fairOdds.homeFairProb
      mlProbs.mlAway = fairOdds.awayFairProb
    }
  }
  
  let totalProbs = { totalOver: null, totalUnder: null, total: null }
  if (totalOdds.length > 0) {
    const bestTotal = totalOdds[0]
    if (bestTotal.priceHome && bestTotal.priceAway && bestTotal.total) {
      const overOdds = normalizeToAmericanOdds(bestTotal.priceAway)
      const underOdds = normalizeToAmericanOdds(bestTotal.priceHome)
      const fairOdds = removeTotalVig(overOdds, underOdds, bestTotal.total)
      totalProbs.totalOver = fairOdds.overFairProb
      totalProbs.totalUnder = fairOdds.underFairProb
      totalProbs.total = bestTotal.total
    }
  }
  
  return { ...mlProbs, ...totalProbs }
}

/**
 * Cap edge values. ML uses ±5%; totals keep the legacy ±10%.
 */
function capEdge(edge, cap = NHL_TOTAL_EDGE_CAP) {
  if (edge === null || isNaN(edge)) return null
  return Math.max(-cap, Math.min(cap, edge))
}

/**
 * Create null edges object
 */
function createNullEdges(payload = null) {
  return {
    edgeMlHome: null,
    edgeMlAway: null,
    edgeTotalO: null,
    edgeTotalU: null,
    modelRun: NHL_MODEL_VERSION,
    payload,
    skipped: false,
    skipReason: null,
  }
}

function createSkippedEdges(reason, payload = null) {
  return {
    ...createNullEdges(payload),
    skipped: true,
    skipReason: reason,
  }
}

/**
 * NHL EdgeSnapshot insert. Reuses the existing payload JSON column —
 * no schema change. Never writes the retired nfl-nhl-v0.1.0 id.
 */
export function toNhlEdgeSnapshotInsert(edges, { id, gameId } = {}) {
  const row = {
    gameId: gameId || null,
    edgeMlHome: edges?.edgeMlHome ?? null,
    edgeMlAway: edges?.edgeMlAway ?? null,
    edgeTotalO: edges?.edgeTotalO ?? null,
    edgeTotalU: edges?.edgeTotalU ?? null,
    modelRun: NHL_MODEL_VERSION,
    payload: edges?.payload || null,
  }
  if (id) row.id = id
  return row
}

