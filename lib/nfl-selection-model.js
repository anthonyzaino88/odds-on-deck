/**
 * NFL moneyline and game-total selection model.
 *
 * Isolated from the shared NFL/NHL heuristic in lib/edge-nfl-nhl.js.
 * This module is an unvalidated research heuristic with explicit eligibility
 * gates. It is not a historically calibrated predictor.
 *
 * Public NFL recommendations stay disabled until a chronological out-of-sample
 * study exists. An honest empty board is the intended product state.
 *
 * See docs/nfl-selection-model.md for formulas, inputs, and blockers.
 */

import { removeMlVig, removeTotalVig, normalizeToAmericanOdds, estimatedEvAtDecimalOdds } from './implied.js'
import { toAmericanOdds, toDecimalOdds } from './odds-units.js'
import { interpretTeamSeasonStats, parseRecordString } from './team-performance-stats.js'

export const NFL_SELECTION_MODEL_VERSION = 'nfl-selection-v1.0.1'
export const LEGACY_NFL_HEURISTIC_VERSIONS = Object.freeze(['nfl-nhl-v0.1.0'])
export const NFL_MODEL_VALIDATION_STATUS = 'unvalidated'
export const NFL_DEVIG_METHOD = 'proportional'

/**
 * Operational freshness window for both statsCapturedAt and dataThrough.
 * Not a fitted predictive parameter.
 *
 * Policy: a statistic is current only if (1) its data-through timestamp is
 * a real date, (2) it is not in the future, (3) it is no older than this
 * window relative to prediction time, (4) it is consistent with the game
 * season, and (5) a later fetch timestamp cannot resurrect older numbers.
 * Invalid dates are rejected — they are not treated as missing-but-ok.
 */
export const NFL_STATS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const NFL_DATA_THROUGH_MAX_AGE_MS = NFL_STATS_MAX_AGE_MS

/**
 * Refuse a win% point estimate below this season sample.
 * With n < 4 the MLE lives on a handful of atoms ({0, 1/3, 1/2, 2/3, 1}).
 * This is a mathematical ineligibility gate, not a slate-clearing threshold.
 */
export const NFL_MIN_GAMES_FOR_RESEARCH_ML = 4

/**
 * Beta(8, 8) equivalent: shrink a season win rate toward 0.5.
 * Safeguard against extreme MLEs — not a fitted prior and not used to
 * manufacture a public pick.
 */
export const NFL_WIN_PCT_PRIOR_GAMES = 16
export const NFL_WIN_PCT_PRIOR_WINS = 8

/**
 * Conventional home logit (~53% if teams are equal after shrinkage).
 * Unvalidated here. Applied only when both teams have research-eligible
 * season samples. Markets already price home-field advantage; this term
 * must never be the sole source of a qualifying edge when team data is
 * missing.
 */
export const NFL_HFA_LOGIT = 0.12

/** UI-only. Never stored as the model's actual gap and never used for EV. */
export const NFL_DISPLAY_EDGE_CAP = 0.10

export const SNAPSHOT_MAX_SKEW_MS = 30 * 60 * 1000

export const NFL_ML_INPUTS_USED = Object.freeze([
  'season win-loss record (column last10Record is a season record from ESPN)',
  'games played, season id, data-through date, stats captured-at',
  'two-way moneyline quote used at prediction time',
])

export const NFL_ML_INPUTS_NOT_USED = Object.freeze([
  'venue (home/away) records as a second strength factor',
  'genuine last-10 game windows (those columns are season averages)',
  'quarterback identity or quality',
  'injuries',
  'weather',
  'efficiency / EPA / DVOA',
  'point differential (available but unused until validated)',
  'a fitted home-field or logistic scale',
])

export const NFL_TOTALS_INELIGIBLE_REASON = 'missing_validated_scoring_distribution'

export function isLegacyNflHeuristicVersion(modelRun) {
  return LEGACY_NFL_HEURISTIC_VERSIONS.includes(String(modelRun || ''))
}

export function isCurrentNflSelectionModel(modelRun) {
  return String(modelRun || '') === NFL_SELECTION_MODEL_VERSION
}

/**
 * Production never sets eligibleForPublic. Tests may inject a validated
 * status to exercise data gates without flipping the public board.
 */
export function evaluateNflPublicEligibility({
  dataEligibility,
  modelValidationStatus = NFL_MODEL_VALIDATION_STATUS,
} = {}) {
  if (!dataEligibility?.ok) {
    return {
      eligibleForPublic: false,
      reason: dataEligibility?.reason || 'ineligible',
    }
  }
  if (modelValidationStatus !== 'validated') {
    return {
      eligibleForPublic: false,
      reason: 'unvalidated_heuristic',
    }
  }
  return { eligibleForPublic: true, reason: null }
}

export function isQualifyingNflSelection(evaluation, eligibility) {
  return Boolean(
    eligibility?.dataEligible
    && eligibility?.eligibleForPublic
    && Number.isFinite(evaluation?.estimatedEv)
    && evaluation.estimatedEv > 0,
  )
}

export function shrinkSeasonWinPct(wins, gamesPlayed) {
  const winsN = Number(wins)
  const gamesN = Number(gamesPlayed)
  if (!Number.isFinite(winsN) || !Number.isFinite(gamesN) || gamesN < 0) return null
  return (winsN + NFL_WIN_PCT_PRIOR_WINS) / (gamesN + NFL_WIN_PCT_PRIOR_GAMES)
}

export function twoWayHomeWinProbability(homeShrunkWinPct, awayShrunkWinPct) {
  const home = clampOpenUnit(homeShrunkWinPct)
  const away = clampOpenUnit(awayShrunkWinPct)
  if (home == null || away == null) return null
  const logit = Math.log(home / (1 - home)) - Math.log(away / (1 - away)) + NFL_HFA_LOGIT
  const homeWin = 1 / (1 + Math.exp(-logit))
  return {
    pHomeWin: homeWin,
    pAwayWin: 1 - homeWin,
    pTie: 0,
  }
}

export { estimatedEvAtDecimalOdds }

export function evaluateQuotedPrice({ pWin, pLoss, pPush = 0, odds }) {
  const decimalOdds = toDecimalOdds(odds)
  const americanOdds = toAmericanOdds(odds)
  const impliedRaw = decimalOdds != null && decimalOdds > 1 ? 1 / decimalOdds : null
  const estimatedEv = estimatedEvAtDecimalOdds(pWin, pLoss, decimalOdds)
  return {
    decimalOdds,
    americanOdds,
    impliedRaw,
    estimatedEv,
    pPush: Number(pPush) || 0,
  }
}

export function displayCappedGap(gap) {
  if (!Number.isFinite(gap)) return { displayGap: null, isCapped: false }
  const displayGap = Math.max(-NFL_DISPLAY_EDGE_CAP, Math.min(NFL_DISPLAY_EDGE_CAP, gap))
  return { displayGap, isCapped: displayGap !== gap }
}

export function parseTimestamp(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * P(win | decisive) = P(win) / (1 − P(push)).
 * Two-way posted markets are already conditional on a decisive result.
 * A zero decisive mass is ineligible for a gap (not treated as 0 or 1).
 */
export function decisiveConditionalProbability(pWin, pPush = 0) {
  const win = Number(pWin)
  const push = Number(pPush)
  if (!Number.isFinite(win) || win < 0 || win > 1) {
    return { ok: false, reason: 'invalid_model_probability', value: null }
  }
  if (!Number.isFinite(push) || push < 0 || push > 1) {
    return { ok: false, reason: 'invalid_push_probability', value: null }
  }
  const decisive = 1 - push
  if (!(decisive > 0)) {
    return { ok: false, reason: 'zero_decisive_probability', value: null }
  }
  return { ok: true, reason: null, value: win / decisive }
}

/**
 * Gap vs a two-way de-vigged market uses the conditional win probability.
 * Estimated EV stays unconditional: P(win)×(d−1) − P(loss).
 */
export function modelVersusTwoWayMarketGap({ pWin, pPush = 0, marketFairProb }) {
  if (!Number.isFinite(Number(marketFairProb))) {
    return { gap: null, conditionalPWin: null, reason: 'missing_market_probability' }
  }
  const conditional = decisiveConditionalProbability(pWin, pPush)
  if (!conditional.ok) {
    return { gap: null, conditionalPWin: null, reason: conditional.reason }
  }
  return {
    gap: conditional.value - Number(marketFairProb),
    conditionalPWin: conditional.value,
    reason: null,
  }
}

/**
 * data-through must be a real timestamp, not future, not older than the
 * freshness window, consistent with the NFL season year, and not older
 * than a recent fetch by more than that window.
 */
export function evaluateDataThroughDate({
  dataThrough,
  capturedAt,
  season,
  now = new Date(),
} = {}) {
  if (dataThrough == null || dataThrough === '') {
    return { ok: false, reason: 'missing_data_through' }
  }
  const throughMs = parseTimestamp(dataThrough)
  if (throughMs == null) {
    return { ok: false, reason: 'invalid_data_through' }
  }

  const nowMs = now instanceof Date ? now.getTime() : parseTimestamp(now)
  if (nowMs == null) {
    return { ok: false, reason: 'invalid_prediction_time' }
  }
  if (throughMs > nowMs) {
    return { ok: false, reason: 'data_through_in_future' }
  }
  if ((nowMs - throughMs) > NFL_DATA_THROUGH_MAX_AGE_MS) {
    return { ok: false, reason: 'stale_data_through' }
  }

  const capturedMs = parseTimestamp(capturedAt)
  if (capturedMs != null && (capturedMs - throughMs) > NFL_DATA_THROUGH_MAX_AGE_MS) {
    return { ok: false, reason: 'data_through_older_than_fetch_window' }
  }

  const seasonYear = parseSeasonYear(season)
  if (seasonYear != null && !dataThroughMatchesSeason(throughMs, seasonYear)) {
    return { ok: false, reason: 'data_through_season_mismatch' }
  }

  return { ok: true, reason: null }
}

/**
 * Discrete NFL total outcomes from an explicit Normal approximation.
 * Production does not supply fitted (mean, variance) — callers without
 * those parameters stay ineligible. Tests inject known parameters.
 *
 * Integer line L: P(push) = P(T = L). Half-lines cannot push.
 * Higher lines cannot increase P(over).
 */
export function nflTotalOutcomeProbabilities({ mean, variance, line }) {
  if (!Number.isFinite(mean) || !Number.isFinite(variance) || variance <= 0 || !Number.isFinite(line)) {
    return {
      ok: false,
      reason: NFL_TOTALS_INELIGIBLE_REASON,
      pOver: null,
      pUnder: null,
      pPush: null,
    }
  }

  const pmf = integerTotalPmfs(mean, variance)
  let pOver = 0
  let pUnder = 0
  let pPush = 0
  for (const { k, p } of pmf) {
    if (k > line) pOver += p
    else if (k < line) pUnder += p
    else pPush += p
  }

  const sum = pOver + pUnder + pPush
  if (!(sum > 0)) {
    return {
      ok: false,
      reason: NFL_TOTALS_INELIGIBLE_REASON,
      pOver: null,
      pUnder: null,
      pPush: null,
    }
  }

  return {
    ok: true,
    reason: null,
    pOver: pOver / sum,
    pUnder: pUnder / sum,
    pPush: pPush / sum,
    mean,
    variance,
    line,
    distribution: 'normal_continuity_corrected',
    validationStatus: 'unvalidated_parameters',
  }
}

export function evaluateNflDataEligibility({
  home,
  away,
  game,
  now = new Date(),
  market,
  totalsDistribution = null,
} = {}) {
  if (market === 'totals') {
    if (!hasExplicitTotalsDistribution(totalsDistribution)) {
      return { ok: false, reason: NFL_TOTALS_INELIGIBLE_REASON }
    }
    return { ok: true, reason: null }
  }

  if (!home || !away) return { ok: false, reason: 'missing_team_data' }

  const homeSeason = home.season ?? null
  const awaySeason = away.season ?? null
  const gameSeason = game?.season ?? null
  if (!homeSeason || !awaySeason || !gameSeason) {
    return { ok: false, reason: 'missing_season' }
  }
  if (String(homeSeason) !== String(gameSeason) || String(awaySeason) !== String(gameSeason)) {
    return { ok: false, reason: 'season_mismatch' }
  }

  if (!home.capturedAt || !away.capturedAt) {
    return { ok: false, reason: 'unknown_data_freshness' }
  }
  if (isStale(home.capturedAt, now) || isStale(away.capturedAt, now)) {
    return { ok: false, reason: 'stale_team_data' }
  }

  const homeThrough = evaluateDataThroughDate({
    dataThrough: home.dataThrough,
    capturedAt: home.capturedAt,
    season: homeSeason || gameSeason,
    now,
  })
  if (!homeThrough.ok) return homeThrough
  const awayThrough = evaluateDataThroughDate({
    dataThrough: away.dataThrough,
    capturedAt: away.capturedAt,
    season: awaySeason || gameSeason,
    now,
  })
  if (!awayThrough.ok) return awayThrough

  const homeGames = Number(home.gamesPlayed)
  const awayGames = Number(away.gamesPlayed)
  if (!Number.isFinite(homeGames) || !Number.isFinite(awayGames) || homeGames <= 0 || awayGames <= 0) {
    return { ok: false, reason: 'missing_team_data' }
  }
  if (homeGames < NFL_MIN_GAMES_FOR_RESEARCH_ML || awayGames < NFL_MIN_GAMES_FOR_RESEARCH_ML) {
    return { ok: false, reason: 'early_season_insufficient_sample' }
  }

  if (home.statsKind && home.statsKind !== 'season') {
    return { ok: false, reason: 'mismatched_stat_window' }
  }
  if (away.statsKind && away.statsKind !== 'season') {
    return { ok: false, reason: 'mismatched_stat_window' }
  }

  return { ok: true, reason: null }
}

export function snapshotsAreCompatible(predictionSnapshot, quote) {
  if (!predictionSnapshot || !quote) {
    return { ok: false, reason: 'missing_snapshot' }
  }

  const predicted = normalizeQuoteShape(predictionSnapshot)
  const quoted = normalizeQuoteShape(quote)

  if (predicted.gameId || quoted.gameId) {
    if (!predicted.gameId || !quoted.gameId || String(predicted.gameId) !== String(quoted.gameId)) {
      return { ok: false, reason: 'event_mismatch' }
    }
  }

  if (predicted.market || quoted.market) {
    if (!predicted.market || !quoted.market || predicted.market !== quoted.market) {
      return { ok: false, reason: 'market_mismatch' }
    }
  }

  if (predicted.book || quoted.book) {
    if (!predicted.book || !quoted.book || String(predicted.book) !== String(quoted.book)) {
      return { ok: false, reason: 'book_mismatch' }
    }
  }

  const totalsMarket = predicted.market === 'totals' || quoted.market === 'totals'
  if (totalsMarket) {
    if (predicted.line == null || quoted.line == null) {
      return { ok: false, reason: 'missing_line' }
    }
    if (predicted.line !== quoted.line) {
      return { ok: false, reason: 'line_mismatch' }
    }
  } else if (predicted.line != null && quoted.line != null && predicted.line !== quoted.line) {
    return { ok: false, reason: 'line_mismatch' }
  }

  if (predicted.oddsSnapshotId || quoted.id) {
    if (!predicted.oddsSnapshotId || !quoted.id
      || String(predicted.oddsSnapshotId) !== String(quoted.id)) {
      return { ok: false, reason: 'odds_snapshot_mismatch' }
    }
  }

  if (hasCapturedPrices(predicted) && !pricesMatch(predicted, quoted)) {
    return { ok: false, reason: 'price_mismatch' }
  }

  const predictedAt = parseTimestamp(predicted.quotedAt)
  const quotedAt = parseTimestamp(quoted.ts)
  const requireTime = predicted.requiresQuoteMatch || totalsMarket || Boolean(predicted.oddsSnapshotId)
  if (requireTime && (predictedAt == null || quotedAt == null)) {
    return { ok: false, reason: 'missing_quote_timestamp' }
  }
  if (predictedAt != null && quotedAt != null) {
    const skew = Math.abs(predictedAt - quotedAt)
    if (skew > SNAPSHOT_MAX_SKEW_MS) {
      return { ok: false, reason: 'stale_or_mismatched_quote' }
    }
  } else if (predictedAt != null || quotedAt != null) {
    return { ok: false, reason: 'missing_quote_timestamp' }
  }

  return { ok: true, reason: null }
}

export function selectCompatibleQuote(oddsRows, snapshot) {
  const rows = Array.isArray(oddsRows) ? oddsRows : []
  if (!snapshot) return null

  const candidates = snapshot.oddsSnapshotId
    ? rows.filter((row) => String(row.id) === String(snapshot.oddsSnapshotId))
    : rows
  if (snapshot.oddsSnapshotId && candidates.length === 0) return null

  return candidates.find((row) => snapshotsAreCompatible(snapshot, row).ok) || null
}

/**
 * Shared public-NFL gate for EdgeSnapshot rows and mapped board picks.
 * Requires the current model allowlist. Eligibility is true only when the
 * stored payload says so, or (for already-mapped pick rows) the copied
 * eligibleForPublic flag is true. Production never sets that flag.
 */
export function nflGameLineMeetsPublicGates(record) {
  if (!record || typeof record !== 'object') return false
  const modelRun = record.modelRun || record.modelVersion
  if (!isCurrentNflSelectionModel(modelRun)) return false
  const payload = parseEdgePayload(record)
  if (payload?.eligibility?.eligibleForPublic === true) return true
  if (payload == null && record.eligibleForPublic === true) return true
  return false
}

export function nflGameLineSnapshotIsPublic(edge) {
  return nflGameLineMeetsPublicGates(edge)
}

export function parseEdgePayload(edge) {
  if (!edge || typeof edge !== 'object') return null
  if (edge.payload && typeof edge.payload === 'object') return edge.payload
  if (typeof edge.payload === 'string') {
    try {
      return JSON.parse(edge.payload)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Full NFL evaluation. Moneyline and totals are independent: missing
 * moneyline odds do not disable a totals path (and vice versa).
 */
export function calculateNFLSelection(game, odds = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  const homeStats = interpretTeamSeasonStats(game?.home, options.homeStats)
  const awayStats = interpretTeamSeasonStats(game?.away, options.awayStats)
  const quotes = indexQuotes(odds)

  const inputSnapshot = {
    id: options.inputSnapshotId || null,
    season: game?.season ?? homeStats.season ?? awayStats.season ?? null,
    statsKind: 'season',
    home: homeStats,
    away: awayStats,
    capturedAt: now.toISOString(),
    dataThrough: homeStats.dataThrough || awayStats.dataThrough || null,
  }

  const moneyline = evaluateNflMoneyline({
    game,
    homeStats,
    awayStats,
    quote: quotes.h2h,
    now,
    options,
  })

  const totals = evaluateNflTotals({
    game,
    quote: quotes.totals,
    now,
    options,
  })

  const eligibility = {
    moneyline: moneyline.eligibility,
    totals: totals.eligibility,
    eligibleForPublic: Boolean(
      moneyline.eligibility.eligibleForPublic || totals.eligibility.eligibleForPublic,
    ),
    reasons: [moneyline.eligibility.reason, totals.eligibility.reason].filter(Boolean),
  }

  return {
    modelVersion: NFL_SELECTION_MODEL_VERSION,
    validationStatus: options.modelValidationStatus || NFL_MODEL_VALIDATION_STATUS,
    sport: 'nfl',
    gameId: game?.id || null,
    createdAt: now.toISOString(),
    inputSnapshot,
    moneyline,
    totals,
    eligibility,
    inputsUsed: NFL_ML_INPUTS_USED,
    inputsNotUsed: NFL_ML_INPUTS_NOT_USED,
  }
}

export function toPersistedNflEdgeSnapshot(selection) {
  return {
    edgeMlHome: null,
    edgeMlAway: null,
    edgeTotalO: null,
    edgeTotalU: null,
    ourTotal: null,
    modelRun: NFL_SELECTION_MODEL_VERSION,
    payload: selection,
  }
}

/**
 * Public pick rows from a stored NFL contract + the quote captured with it.
 * Uses stored model probabilities. Does not reconstruct from capped edges.
 */
export function toPublicNflGameLines(selection, { minEdge = 0.05 } = {}) {
  if (!selection || selection.sport !== 'nfl') return []
  if (isLegacyNflHeuristicVersion(selection.modelVersion)) return []
  if (!isCurrentNflSelectionModel(selection.modelVersion)) return []

  const lines = []
  const ml = selection.moneyline
  if (ml?.eligibility?.eligibleForPublic && ml.home && ml.away) {
    pushSide(lines, ml.home, minEdge, selection)
    pushSide(lines, ml.away, minEdge, selection)
  }
  const totals = selection.totals
  if (totals?.eligibility?.eligibleForPublic && totals.over && totals.under) {
    pushSide(lines, totals.over, minEdge, selection)
    pushSide(lines, totals.under, minEdge, selection)
  }
  return lines
}

function pushSide(lines, side, minEdge, selection) {
  if (!side?.evaluation) return
  const gap = side.evaluation.modelVsMarketGap
  if (!Number.isFinite(gap) || gap < minEdge) return
  if (!isQualifyingNflSelection(side.evaluation, {
    dataEligible: side.eligibility?.dataEligible,
    eligibleForPublic: side.eligibility?.eligibleForPublic,
  })) return

  lines.push({
    gameId: selection.gameId,
    type: side.market === 'totals' ? 'total' : 'moneyline',
    pick: side.pick,
    team: side.team,
    opponent: side.opponent,
    homeTeam: side.homeTeam,
    awayTeam: side.awayTeam,
    threshold: side.line ?? null,
    edge: gap,
    edgeIsDisplayCap: false,
    modelVsMarketGap: gap,
    estimatedEv: side.evaluation.estimatedEv,
    odds: side.quote?.americanOdds ?? side.quote?.decimalOdds,
    probability: side.model.pWin,
    modelPWin: side.model.pWin,
    modelPLoss: side.model.pLoss,
    modelPPush: side.model.pPush,
    marketFairProb: side.marketFair.fairProb,
    deVigMethod: NFL_DEVIG_METHOD,
    confidence: null,
    reasoning: side.reasoning,
    sport: 'nfl',
    modelRun: NFL_SELECTION_MODEL_VERSION,
    eligibleForPublic: true,
    inputSnapshotId: selection.inputSnapshot?.id || null,
    oddsSnapshotId: side.quote?.oddsSnapshotId || null,
    quotedAt: side.quote?.quotedAt || null,
    bookmaker: side.quote?.book || null,
  })
}

function evaluateNflMoneyline({ game, homeStats, awayStats, quote, now, options }) {
  const dataEligibility = evaluateNflDataEligibility({
    home: homeStats,
    away: awayStats,
    game,
    now,
    market: 'moneyline',
  })
  const publicEligibility = evaluateNflPublicEligibility({
    dataEligibility,
    modelValidationStatus: options.modelValidationStatus,
  })
  const eligibility = {
    dataEligible: dataEligibility.ok,
    ...publicEligibility,
    reason: publicEligibility.reason || dataEligibility.reason,
  }

  const empty = {
    eligibility,
    reason: eligibility.reason,
    home: null,
    away: null,
    model: null,
    quote: serializeQuote(quote, 'h2h', null),
  }

  if (!dataEligibility.ok) return empty

  const homeShrunk = shrinkSeasonWinPct(homeStats.wins, homeStats.gamesPlayed)
  const awayShrunk = shrinkSeasonWinPct(awayStats.wins, awayStats.gamesPlayed)
  const model = twoWayHomeWinProbability(homeShrunk, awayShrunk)
  if (!model) {
    return { ...empty, eligibility: { ...eligibility, dataEligible: false, eligibleForPublic: false, reason: 'missing_team_data' } }
  }

  const marketFair = quote?.priceHome != null && quote?.priceAway != null
    ? deVigMoneyline(quote.priceHome, quote.priceAway)
    : null

  const homeSide = buildMlSide({
    side: 'home',
    pick: game?.home?.abbr || 'HOME',
    opponent: game?.away?.abbr || 'AWAY',
    pWin: model.pHomeWin,
    pLoss: model.pAwayWin,
    pPush: model.pTie,
    quote,
    price: quote?.priceHome,
    marketFairProb: marketFair?.homeFairProb ?? null,
    game,
    eligibility,
  })
  const awaySide = buildMlSide({
    side: 'away',
    pick: game?.away?.abbr || 'AWAY',
    opponent: game?.home?.abbr || 'HOME',
    pWin: model.pAwayWin,
    pLoss: model.pHomeWin,
    pPush: model.pTie,
    quote,
    price: quote?.priceAway,
    marketFairProb: marketFair?.awayFairProb ?? null,
    game,
    eligibility,
  })

  return {
    eligibility,
    reason: eligibility.reason,
    model,
    quote: serializeQuote(quote, 'h2h', null),
    marketFair,
    home: homeSide,
    away: awaySide,
    homeShrunkWinPct: homeShrunk,
    awayShrunkWinPct: awayShrunk,
  }
}

function evaluateNflTotals({ game, quote, now, options }) {
  const totalsDistribution = options.totalsDistribution || null
  const dataEligibility = evaluateNflDataEligibility({
    home: null,
    away: null,
    game,
    now,
    market: 'totals',
    totalsDistribution,
  })
  const publicEligibility = evaluateNflPublicEligibility({
    dataEligibility,
    modelValidationStatus: options.modelValidationStatus,
  })
  const eligibility = {
    dataEligible: dataEligibility.ok,
    ...publicEligibility,
    reason: publicEligibility.reason || dataEligibility.reason,
  }

  const empty = {
    eligibility,
    reason: eligibility.reason,
    over: null,
    under: null,
    model: null,
    quote: serializeQuote(quote, 'totals', quote?.total ?? null),
  }

  if (!dataEligibility.ok) return empty

  const line = Number(totalsDistribution.line ?? quote?.total)
  const outcomes = nflTotalOutcomeProbabilities({
    mean: totalsDistribution.mean,
    variance: totalsDistribution.variance,
    line,
  })
  if (!outcomes.ok) {
    return {
      ...empty,
      eligibility: {
        dataEligible: false,
        eligibleForPublic: false,
        reason: outcomes.reason,
      },
      reason: outcomes.reason,
    }
  }

  const marketFair = quote?.priceOver != null && quote?.priceUnder != null
    ? removeTotalVig(
      normalizeToAmericanOdds(quote.priceOver),
      normalizeToAmericanOdds(quote.priceUnder),
      line,
    )
    : null

  const overSide = buildTotalSide({
    pick: 'over',
    pWin: outcomes.pOver,
    pLoss: outcomes.pUnder,
    pPush: outcomes.pPush,
    quote,
    price: quote?.priceOver,
    marketFairProb: marketFair?.overFairProb ?? null,
    line,
    game,
    eligibility,
  })
  const underSide = buildTotalSide({
    pick: 'under',
    pWin: outcomes.pUnder,
    pLoss: outcomes.pOver,
    pPush: outcomes.pPush,
    quote,
    price: quote?.priceUnder,
    marketFairProb: marketFair?.underFairProb ?? null,
    line,
    game,
    eligibility,
  })

  return {
    eligibility,
    reason: eligibility.reason,
    model: outcomes,
    quote: serializeQuote(quote, 'totals', line),
    marketFair,
    over: overSide,
    under: underSide,
  }
}

function buildMlSide({
  side, pick, opponent, pWin, pLoss, pPush, quote, price, marketFairProb, game, eligibility,
}) {
  const priced = evaluateQuotedPrice({ pWin, pLoss, pPush, odds: price })
  const impliedRaw = priced.impliedRaw
  const vsMarket = modelVersusTwoWayMarketGap({ pWin, pPush, marketFairProb })
  return {
    market: 'h2h',
    side,
    pick,
    team: pick,
    opponent,
    homeTeam: game?.home?.abbr || 'HOME',
    awayTeam: game?.away?.abbr || 'AWAY',
    line: null,
    model: { pWin, pLoss, pPush },
    marketFair: {
      impliedRaw,
      fairProb: marketFairProb,
      deVigMethod: NFL_DEVIG_METHOD,
    },
    evaluation: {
      modelVsMarketGap: vsMarket.gap,
      estimatedEv: priced.estimatedEv,
      comparisonBasis: 'conditional_on_decisive_result',
      conditionalPWin: vsMarket.conditionalPWin,
      gapReason: vsMarket.reason,
    },
    quote: {
      ...serializeQuote(quote, 'h2h', null),
      americanOdds: priced.americanOdds,
      decimalOdds: priced.decimalOdds,
    },
    eligibility,
    reasoning: 'Unvalidated NFL season-record heuristic. Not a public recommendation.',
  }
}

function buildTotalSide({
  pick, pWin, pLoss, pPush, quote, price, marketFairProb, line, game, eligibility,
}) {
  const priced = evaluateQuotedPrice({ pWin, pLoss, pPush, odds: price })
  const vsMarket = modelVersusTwoWayMarketGap({ pWin, pPush, marketFairProb })
  const homeTeam = game?.home?.abbr || 'HOME'
  const awayTeam = game?.away?.abbr || 'AWAY'
  return {
    market: 'totals',
    pick,
    team: `${awayTeam} @ ${homeTeam}`,
    opponent: null,
    homeTeam,
    awayTeam,
    line,
    model: { pWin, pLoss, pPush },
    marketFair: {
      impliedRaw: priced.impliedRaw,
      fairProb: marketFairProb,
      deVigMethod: NFL_DEVIG_METHOD,
    },
    evaluation: {
      modelVsMarketGap: vsMarket.gap,
      estimatedEv: priced.estimatedEv,
      comparisonBasis: 'conditional_on_decisive_result',
      conditionalPWin: vsMarket.conditionalPWin,
      gapReason: vsMarket.reason,
    },
    quote: {
      ...serializeQuote(quote, 'totals', line),
      americanOdds: priced.americanOdds,
      decimalOdds: priced.decimalOdds,
    },
    eligibility,
    reasoning: 'NFL totals require a validated scoring distribution.',
  }
}

function deVigMoneyline(priceHome, priceAway) {
  const homeOdds = normalizeToAmericanOdds(priceHome)
  const awayOdds = normalizeToAmericanOdds(priceAway)
  return removeMlVig(homeOdds, awayOdds)
}

function indexQuotes(odds) {
  const rows = Array.isArray(odds) ? odds : []
  const h2hRow = rows.find((row) => row.market === 'h2h' && (row.priceHome != null || row.priceAway != null))
  const totalRow = rows.find((row) => (row.market === 'totals' || row.market === 'total') && row.total != null)

  return {
    h2h: h2hRow
      ? {
        id: h2hRow.id || null,
        gameId: h2hRow.gameId || null,
        book: h2hRow.book || null,
        market: 'h2h',
        priceHome: h2hRow.priceHome,
        priceAway: h2hRow.priceAway,
        ts: h2hRow.ts || h2hRow.quotedAt || null,
      }
      : null,
    totals: totalRow
      ? {
        id: totalRow.id || null,
        gameId: totalRow.gameId || null,
        book: totalRow.book || null,
        market: 'totals',
        total: totalRow.total,
        line: totalRow.total,
        priceOver: totalRow.priceOver ?? totalRow.priceAway,
        priceUnder: totalRow.priceUnder ?? totalRow.priceHome,
        ts: totalRow.ts || totalRow.quotedAt || null,
      }
      : null,
  }
}

function serializeQuote(quote, market, line) {
  if (!quote) {
    return {
      oddsSnapshotId: null,
      book: null,
      market,
      line: line ?? null,
      quotedAt: null,
      requiresQuoteMatch: true,
      gameId: null,
    }
  }
  return {
    oddsSnapshotId: quote.id || quote.oddsSnapshotId || null,
    book: quote.book || null,
    market,
    line: firstFiniteNumber(line, quote.line, quote.total),
    total: firstFiniteNumber(quote.total, line, quote.line),
    quotedAt: quote.ts || quote.quotedAt || null,
    requiresQuoteMatch: true,
    gameId: quote.gameId || null,
    priceHome: quote.priceHome ?? null,
    priceAway: quote.priceAway ?? null,
    priceOver: quote.priceOver ?? null,
    priceUnder: quote.priceUnder ?? null,
  }
}

function hasExplicitTotalsDistribution(distribution) {
  return Boolean(
    distribution
    && Number.isFinite(Number(distribution.mean))
    && Number.isFinite(Number(distribution.variance))
    && Number(distribution.variance) > 0,
  )
}

function isStale(capturedAt, now) {
  const at = parseTimestamp(capturedAt)
  const nowMs = now instanceof Date ? now.getTime() : parseTimestamp(now)
  if (at == null || nowMs == null) return true
  return (nowMs - at) > NFL_STATS_MAX_AGE_MS || at > nowMs
}

function parseSeasonYear(season) {
  if (season == null || season === '') return null
  const match = String(season).match(/(\d{4})/)
  if (!match) return null
  const year = Number(match[1])
  return Number.isFinite(year) ? year : null
}

function dataThroughMatchesSeason(throughMs, seasonYear) {
  const through = new Date(throughMs)
  const year = through.getUTCFullYear()
  const month = through.getUTCMonth()
  if (year === seasonYear) return true
  // NFL regular season / playoffs can land in Jan–Feb of the next calendar year.
  if (year === seasonYear + 1 && month <= 1) return true
  return false
}

function normalizeMarket(market) {
  const value = String(market || '').toLowerCase().trim()
  if (value === 'total' || value === 'totals') return 'totals'
  if (value === 'h2h' || value === 'ml' || value === 'moneyline') return 'h2h'
  return value || null
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function normalizeQuoteShape(quote) {
  return {
    gameId: quote.gameId || null,
    market: normalizeMarket(quote.market),
    book: quote.book || null,
    line: firstFiniteNumber(quote.line, quote.total),
    total: firstFiniteNumber(quote.total, quote.line),
    oddsSnapshotId: quote.oddsSnapshotId || quote.id || null,
    id: quote.id || quote.oddsSnapshotId || null,
    quotedAt: quote.quotedAt || quote.ts || null,
    ts: quote.ts || quote.quotedAt || null,
    requiresQuoteMatch: quote.requiresQuoteMatch === true,
    priceHome: quote.priceHome,
    priceAway: quote.priceAway,
    priceOver: quote.priceOver ?? quote.priceAway,
    priceUnder: quote.priceUnder ?? quote.priceHome,
  }
}

function hasCapturedPrices(quote) {
  return (
    quote.priceHome != null
    || quote.priceAway != null
    || quote.priceOver != null
    || quote.priceUnder != null
  )
}

function samePrice(left, right) {
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  return Number(left) === Number(right)
}

function pricesMatch(predicted, quoted) {
  if (predicted.market === 'totals' || quoted.market === 'totals') {
    const predOver = predicted.priceOver ?? predicted.priceAway
    const predUnder = predicted.priceUnder ?? predicted.priceHome
    const quoteOver = quoted.priceOver ?? quoted.priceAway
    const quoteUnder = quoted.priceUnder ?? quoted.priceHome
    if (predOver == null && predUnder == null) return true
    return samePrice(predOver, quoteOver) && samePrice(predUnder, quoteUnder)
  }
  if (predicted.priceHome == null && predicted.priceAway == null) return true
  return samePrice(predicted.priceHome, quoted.priceHome)
    && samePrice(predicted.priceAway, quoted.priceAway)
}

function clampOpenUnit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(1 - 1e-6, Math.max(1e-6, n))
}

function erf(x) {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

function standardNormalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

function integerTotalPmfs(mean, variance, { min = 0, max = 120 } = {}) {
  const sd = Math.sqrt(variance)
  const pmf = []
  for (let k = min; k <= max; k++) {
    const p = standardNormalCdf((k + 0.5 - mean) / sd) - standardNormalCdf((k - 0.5 - mean) / sd)
    pmf.push({ k, p: Math.max(0, p) })
  }
  const left = standardNormalCdf((min - 0.5 - mean) / sd)
  const right = 1 - standardNormalCdf((max + 0.5 - mean) / sd)
  if (pmf.length) {
    pmf[0].p += Math.max(0, left)
    pmf[pmf.length - 1].p += Math.max(0, right)
  }
  const total = pmf.reduce((sum, row) => sum + row.p, 0)
  if (!(total > 0)) return pmf
  return pmf.map((row) => ({ k: row.k, p: row.p / total }))
}

export { parseRecordString }
