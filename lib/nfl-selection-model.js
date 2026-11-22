/**
 * NFL moneyline, spread, and game-total selection model.
 *
 * Isolated from the shared NFL/NHL heuristic in lib/edge-nfl-nhl.js.
 * This module is an unvalidated research heuristic with explicit eligibility
 * gates. It is not a historically calibrated predictor.
 *
 * Public NFL recommendations stay disabled until a chronological out-of-sample
 * study exists. An honest empty board is the intended product state.
 *
 * See docs/nfl-selection-model.md and docs/game-line-model-rules.md.
 */

import { removeMlVig, removeTotalVig, normalizeToAmericanOdds, estimatedEvAtDecimalOdds } from './implied.js'
import { toAmericanOdds, toDecimalOdds } from './odds-units.js'
import { interpretTeamSeasonStats, parseRecordString } from './team-performance-stats.js'
import { buildNflPregameFeatures, hasMissingNewerFinal } from './nfl-pregame-features.js'
import { parseRecordInstant } from './parse-record-instant.js'

export const NFL_SELECTION_MODEL_V101 = 'nfl-selection-v1.0.1'
export const NFL_SELECTION_MODEL_VERSION = 'nfl-selection-v1.1.0'
export const LEGACY_NFL_HEURISTIC_VERSIONS = Object.freeze(['nfl-nhl-v0.1.0'])
export const NFL_MODEL_VALIDATION_STATUS = 'unvalidated'
export const NFL_DEVIG_METHOD = 'proportional'

/**
 * Keep 35% of the raw model–market gap, then clamp the rest.
 * Unvalidated safeguard so a 12-4 vs 4-12 W-L heuristic cannot print
 * a 25pp win-probability gap. Strong evidence (starting QB out) raises
 * the clamp from 8pp to 12pp. Not a fitted shrinkage parameter.
 */
export const NFL_MARKET_BLEND = 0.35
export const NFL_MAX_MODEL_MARKET_GAP = 0.08
export const NFL_MAX_MODEL_MARKET_GAP_WITH_EVIDENCE = 0.12
export const NFL_ML_PROB_FLOOR = 0.20
export const NFL_ML_PROB_CEILING = 0.80

/** Unvalidated NFL scoring / margin SD. Not estimated in this repo. */
export const NFL_TOTAL_SD = 13.5
export const NFL_MARGIN_SD = 13.5
export const NFL_HOME_SCORING_BOOST = 1.5
export const NFL_PD_LOGIT_SCALE = 0.03
export const NFL_PD_PRIOR_GAMES = 16
export const NFL_FORM_LOGIT_SCALE = 0.12
export const NFL_REST_SHORT_WEEK_LOGIT = -0.04
export const NFL_REST_BYE_LOGIT = 0.03
export const NFL_QB_OUT_LOGIT = 0.28
export const NFL_QB_QUESTIONABLE_LOGIT = 0.08
export const NFL_SKILL_OUT_LOGIT = 0.03
export const NFL_H2H_LOGIT_SCALE = 0.04

/**
 * Operational freshness window for the ESPN fetch clock (Team.statsCapturedAt).
 * Not a fitted predictive parameter.
 *
 * v1.1.0 rebuilt season stats use a different data-through rule: last-kickoff
 * age is not compared to this window. Those rows are stale only when the
 * completed-game pool has a newer same-season FINAL the rebuild missed.
 * v1.0.1 and callers that omit a completed-game pool still use this window
 * on dataThrough so existing Team-row checks stay conservative.
 *
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
  'season point differential (avgPointsLast10 / allowed are season PPG)',
  'home/away (one HFA logit, not venue records)',
  'pre-lock recent form, rest, matchup history when rebuilt from finals',
  'pre-lock ESPN injuries and starting QB when timestamps are ≤ lock',
  'two-way moneyline quote used at prediction time (market blend + clamp)',
])

export const NFL_ML_INPUTS_NOT_USED = Object.freeze([
  'venue (home/away) records as a second strength factor',
  'treating last10Record as a genuine last-10 window',
  'weather',
  'efficiency / EPA / DVOA',
  'a fitted home-field, blend, or logistic scale',
  'the closing line (score only, never an input)',
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

export function isPreviousNflSelectionModel(modelRun) {
  return String(modelRun || '') === NFL_SELECTION_MODEL_V101
}

export function shrinkPointDifferential(pointsForPerGame, pointsAgainstPerGame, gamesPlayed) {
  const pf = Number(pointsForPerGame)
  const pa = Number(pointsAgainstPerGame)
  const gp = Number(gamesPlayed)
  if (!Number.isFinite(pf) || !Number.isFinite(pa) || !Number.isFinite(gp) || gp <= 0) return null
  return (pf - pa) * (gp / (gp + NFL_PD_PRIOR_GAMES))
}

/**
 * Season PPG columns are already per-game. Box-score rebuilds pass totals.
 * Treat values in (8, 50) as already per-game; otherwise divide by GP.
 */
export function seasonPointsPerGame(points, gamesPlayed) {
  const value = Number(points)
  const gp = Number(gamesPlayed)
  if (!Number.isFinite(value)) return null
  if (value > 8 && value < 50) return value
  if (!Number.isFinite(gp) || gp <= 0) return null
  return value / gp
}

export function clampUnitProbability(value, {
  floor = NFL_ML_PROB_FLOOR,
  ceiling = NFL_ML_PROB_CEILING,
} = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(ceiling, Math.max(floor, n))
}

/**
 * Blend `blend` of the model toward the market, then clamp the leftover
 * gap. The 20/80 floor must not reopen a gap the market clamp already
 * closed. Without a market the raw model is still floored/ceiled.
 */
export function blendModelProbTowardMarket(modelProb, marketProb, {
  blend = NFL_MARKET_BLEND,
  maxGap = NFL_MAX_MODEL_MARKET_GAP,
  strongEvidence = false,
} = {}) {
  const model = Number(modelProb)
  if (!Number.isFinite(model)) return { p: null, raw: null, blended: null, clamped: false }
  const market = Number(marketProb)
  if (!Number.isFinite(market)) {
    const capped = clampUnitProbability(model)
    return { p: capped, raw: model, blended: model, clamped: capped !== model, maxGap: null }
  }
  const blended = market + blend * (model - market)
  const cap = strongEvidence ? NFL_MAX_MODEL_MARKET_GAP_WITH_EVIDENCE : maxGap
  const gap = blended - market
  const limited = market + Math.max(-cap, Math.min(cap, gap))
  const floored = clampUnitProbability(limited)
  const p = Math.abs(floored - market) > cap + 1e-12 ? limited : floored
  return {
    p,
    raw: model,
    blended,
    clamped: p !== blended || Math.abs(gap) > cap,
    maxGap: cap,
    market,
  }
}

/** Beasley–Springer–Moro inverse normal. Domain (0, 1). */
export function standardNormalInvCdf(p) {
  const n = Number(p)
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637]
  const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833]
  const c = [
    0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
    0.0276438810333863, 0.0038405729373609, 0.0003951896511919,
    0.0000321767881768, 0.0000002888167364, 0.0000003960315187,
  ]
  const y = n - 0.5
  if (Math.abs(y) < 0.42) {
    const r = y * y
    const num = y * (((a[3] * r + a[2]) * r + a[1]) * r + a[0])
    const den = ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1)
    return num / den
  }
  let r = n
  if (y > 0) r = 1 - n
  r = Math.log(-Math.log(r))
  let x = c[0]
  for (let i = 1; i < c.length; i++) x = x * r + c[i]
  return y < 0 ? -x : x
}

export function expectedMarginFromHomeWinProb(pHome, sd = NFL_MARGIN_SD) {
  const z = standardNormalInvCdf(pHome)
  if (z == null || !(sd > 0)) return null
  return z * sd
}

export function coverProbabilitiesFromMargin({ mean, sd = NFL_MARGIN_SD, spread }) {
  if (!Number.isFinite(mean) || !Number.isFinite(spread) || !(sd > 0)) {
    return { ok: false, pHomeCover: null, pAwayCover: null, pPush: null }
  }
  const line = -Number(spread)
  const integer = Number.isInteger(Number(spread))
  if (!integer) {
    const pHomeCover = 1 - standardNormalCdf((line - mean) / sd)
    return {
      ok: true,
      pHomeCover,
      pAwayCover: 1 - pHomeCover,
      pPush: 0,
      mean,
      sd,
      spread,
    }
  }
  const pHomeCover = 1 - standardNormalCdf((line + 0.5 - mean) / sd)
  const pAwayCover = standardNormalCdf((line - 0.5 - mean) / sd)
  const pPush = Math.max(0, 1 - pHomeCover - pAwayCover)
  return { ok: true, pHomeCover, pAwayCover, pPush, mean, sd, spread }
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
  if (typeof value === 'number') {
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : null
  }
  const instant = parseRecordInstant(value)
  if (!instant) return null
  const ms = instant.getTime()
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
 * data-through must be a real timestamp, not future, and consistent with
 * the NFL season year.
 *
 * When a non-empty `completedGames` pool is supplied (v1.1.0 shadow path),
 * wall-clock age of the last kickoff is ignored. A bye or Thursday rest
 * then passes. The row is stale only if that pool has a newer same-season
 * FINAL for this team that kicked off before the evaluated game and is not
 * in `dataThrough`.
 *
 * An empty array is not a pool: a failed Game load must not skip freshness.
 * Without a completed-game pool, keep the 7-day window so a later fetch
 * cannot resurrect older Team-row numbers.
 */
export function evaluateDataThroughDate({
  dataThrough,
  capturedAt,
  season,
  now = new Date(),
  completedGames,
  team,
  evaluatedGame,
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

  const seasonYear = parseSeasonYear(season)
  if (seasonYear != null && !dataThroughMatchesSeason(throughMs, seasonYear)) {
    return { ok: false, reason: 'data_through_season_mismatch' }
  }

  if (Array.isArray(completedGames) && completedGames.length > 0) {
    if (hasMissingNewerFinal(completedGames, team, {
      dataThrough,
      season,
      evaluatedGame,
    })) {
      return { ok: false, reason: 'stale_data_through' }
    }
    return { ok: true, reason: null }
  }

  if ((nowMs - throughMs) > NFL_DATA_THROUGH_MAX_AGE_MS) {
    return { ok: false, reason: 'stale_data_through' }
  }

  const capturedMs = parseTimestamp(capturedAt)
  if (capturedMs != null && (capturedMs - throughMs) > NFL_DATA_THROUGH_MAX_AGE_MS) {
    return { ok: false, reason: 'data_through_older_than_fetch_window' }
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
  completedGames,
} = {}) {
  const totalsMarket = market === 'totals'

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
    completedGames,
    team: game?.home || home,
    evaluatedGame: game,
  })
  if (!homeThrough.ok) return homeThrough
  const awayThrough = evaluateDataThroughDate({
    dataThrough: away.dataThrough,
    capturedAt: away.capturedAt,
    season: awaySeason || gameSeason,
    now,
    completedGames,
    team: game?.away || away,
    evaluatedGame: game,
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

  if (home.statsKind && home.statsKind !== 'season' && home.statsKind !== 'season_from_finals') {
    return { ok: false, reason: 'mismatched_stat_window' }
  }
  if (away.statsKind && away.statsKind !== 'season' && away.statsKind !== 'season_from_finals') {
    return { ok: false, reason: 'mismatched_stat_window' }
  }

  if (
    totalsMarket
    && !hasExplicitTotalsDistribution(totalsDistribution)
    && !hasSeasonScoringAverages(home, away)
  ) {
    return { ok: false, reason: NFL_TOTALS_INELIGIBLE_REASON }
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
 * Full NFL evaluation. Moneyline, spreads, and totals are independent:
 * missing moneyline odds do not disable a totals path (and vice versa).
 */
export function calculateNFLSelection(game, odds = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  const lockAt = options.lockAt || now
  const modelVersion = options.modelVersion || NFL_SELECTION_MODEL_VERSION
  const useV11 = modelVersion !== NFL_SELECTION_MODEL_V101
  const completedGames = options.completedGames || game?.completedGames || []
  const quotes = indexQuotes(odds)

  let homeStats = interpretTeamSeasonStats(game?.home, options.homeStats)
  let awayStats = interpretTeamSeasonStats(game?.away, options.awayStats)

  const features = options.features
    || (useV11
      ? buildNflPregameFeatures({
        game,
        completedGames,
        injuries: options.injuries || game?.pregameInjuries || game?.injuries || [],
        lockAt,
      })
      : null)

  if (useV11 && features && completedGames.length) {
    homeStats = mergeRebuiltSeasonStats(homeStats, features.home?.rebuiltSeason)
    awayStats = mergeRebuiltSeasonStats(awayStats, features.away?.rebuiltSeason)
  }

  const inputSnapshot = {
    id: options.inputSnapshotId || createNflInputSnapshotId(game?.id, now),
    season: game?.season ?? homeStats.season ?? awayStats.season ?? null,
    statsKind: homeStats.statsKind || 'season',
    home: homeStats,
    away: awayStats,
    capturedAt: now.toISOString(),
    dataThrough: homeStats.dataThrough || awayStats.dataThrough || null,
    lockAt: parseTimestamp(lockAt) != null ? new Date(parseTimestamp(lockAt)).toISOString() : null,
    features: features
      ? {
        strongEvidence: features.strongEvidence,
        homeFormGames: features.home?.form?.games || 0,
        awayFormGames: features.away?.form?.games || 0,
        homeRestDays: features.home?.rest?.restDays ?? null,
        awayRestDays: features.away?.rest?.restDays ?? null,
        matchupGames: features.matchup?.games || 0,
        homeQbOut: Boolean(features.home?.injuries?.qbOut),
        awayQbOut: Boolean(features.away?.injuries?.qbOut),
        homeStartingQB: features.home?.startingQB || null,
        awayStartingQB: features.away?.startingQB || null,
      }
      : null,
  }

  const evalOptions = {
    ...options,
    lockAt,
    modelVersion,
    features,
    useV11,
    completedGames: useV11 && completedGames.length ? completedGames : undefined,
  }

  const moneyline = evaluateNflMoneyline({
    game,
    homeStats,
    awayStats,
    quote: quotes.h2h,
    now: lockAt,
    options: evalOptions,
  })

  const totals = evaluateNflTotals({
    game,
    homeStats,
    awayStats,
    quote: quotes.totals,
    now: lockAt,
    options: evalOptions,
  })

  const spreads = evaluateNflSpreads({
    game,
    homeStats,
    awayStats,
    quote: quotes.spreads,
    moneyline,
    now: lockAt,
    options: evalOptions,
  })

  const eligibility = {
    moneyline: moneyline.eligibility,
    totals: totals.eligibility,
    spreads: spreads.eligibility,
    eligibleForPublic: Boolean(
      moneyline.eligibility.eligibleForPublic
      || totals.eligibility.eligibleForPublic
      || spreads.eligibility.eligibleForPublic,
    ),
    reasons: [
      moneyline.eligibility.reason,
      totals.eligibility.reason,
      spreads.eligibility.reason,
    ].filter(Boolean),
  }

  return {
    modelVersion,
    validationStatus: options.modelValidationStatus || NFL_MODEL_VALIDATION_STATUS,
    sport: 'nfl',
    gameId: game?.id || null,
    createdAt: now.toISOString(),
    inputSnapshot,
    moneyline,
    totals,
    spreads,
    eligibility,
    inputsUsed: NFL_ML_INPUTS_USED,
    inputsNotUsed: NFL_ML_INPUTS_NOT_USED,
  }
}

export function createNflInputSnapshotId(gameId, now = new Date()) {
  const ts = now instanceof Date ? now.toISOString() : String(now)
  return `nfl-input:${gameId || 'unknown'}:${ts}`
}

/**
 * Row-level prediction ↔ quote pairing stored beside the full payload.
 * One EdgeSnapshot row can hold ML + totals; moneyline quote wins when both exist.
 */
export function nflPredictionQuotePairing(selection) {
  const mlQuote = selection?.moneyline?.quote || null
  const totQuote = selection?.totals?.quote || null
  const primary = quoteHasIdentity(mlQuote) ? mlQuote : totQuote
  return {
    modelVersion: selection?.modelVersion || NFL_SELECTION_MODEL_VERSION,
    inputSnapshotId: selection?.inputSnapshot?.id || null,
    oddsSnapshotId: primary?.oddsSnapshotId || null,
    quotedAt: primary?.quotedAt || null,
    eventId: selection?.gameId || primary?.gameId || null,
    book: primary?.book || null,
    market: primary?.market || null,
    line: primary?.line ?? null,
    decimalOddsHome: primary?.decimalOddsHome ?? null,
    decimalOddsAway: primary?.decimalOddsAway ?? null,
    decimalOddsOver: primary?.decimalOddsOver ?? null,
    decimalOddsUnder: primary?.decimalOddsUnder ?? null,
    moneyline: mlQuote,
    totals: totQuote,
  }
}

export function toPersistedNflEdgeSnapshot(selection) {
  const pairing = nflPredictionQuotePairing(selection)
  return {
    gameId: selection?.gameId || null,
    edgeMlHome: null,
    edgeMlAway: null,
    edgeTotalO: null,
    edgeTotalU: null,
    ourTotal: null,
    modelRun: selection?.modelVersion || NFL_SELECTION_MODEL_VERSION,
    payload: publicIneligibleNflPayload(selection),
    oddsSnapshotId: pairing.oddsSnapshotId,
    inputSnapshotId: pairing.inputSnapshotId,
    quotedAt: pairing.quotedAt,
    eligibleForPublic: false,
  }
}

/**
 * Production EdgeSnapshot insert. Forces public-ineligible even if a caller
 * injected a validated research status. Does not emit phantom edge floats.
 */
export function toNflEdgeSnapshotInsert(selection, { id } = {}) {
  const persisted = toPersistedNflEdgeSnapshot(selection)
  if (id) persisted.id = id
  return persisted
}

function publicIneligibleNflPayload(selection) {
  if (!selection || typeof selection !== 'object') return selection
  return {
    ...selection,
    eligibility: {
      ...(selection.eligibility || {}),
      eligibleForPublic: false,
    },
    moneyline: selection.moneyline
      ? {
        ...selection.moneyline,
        eligibility: {
          ...(selection.moneyline.eligibility || {}),
          eligibleForPublic: false,
        },
      }
      : selection.moneyline,
    totals: selection.totals
      ? {
        ...selection.totals,
        eligibility: {
          ...(selection.totals.eligibility || {}),
          eligibleForPublic: false,
        },
      }
      : selection.totals,
    spreads: selection.spreads
      ? {
        ...selection.spreads,
        eligibility: {
          ...(selection.spreads.eligibility || {}),
          eligibleForPublic: false,
        },
      }
      : selection.spreads,
  }
}

function quoteHasIdentity(quote) {
  return Boolean(quote && (quote.oddsSnapshotId || quote.quotedAt || quote.book))
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
    completedGames: options.completedGames,
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
  const raw = twoWayHomeWinProbability(homeShrunk, awayShrunk)
  if (!raw) {
    return { ...empty, eligibility: { ...eligibility, dataEligible: false, eligibleForPublic: false, reason: 'missing_team_data' } }
  }

  const marketFair = quote?.priceHome != null && quote?.priceAway != null
    ? deVigMoneyline(quote.priceHome, quote.priceAway)
    : null

  let pHome = raw.pHomeWin
  let extraLogit = 0
  if (options.useV11 !== false && options.modelVersion !== NFL_SELECTION_MODEL_V101) {
    extraLogit = extraLogitFromFeatures(homeStats, awayStats, options.features)
    pHome = logitToProb(probToLogit(pHome) + extraLogit)
    const shrunk = blendModelProbTowardMarket(pHome, marketFair?.homeFairProb, {
      strongEvidence: Boolean(options.features?.strongEvidence),
    })
    pHome = shrunk.p
  }

  const model = {
    pHomeWin: pHome,
    pAwayWin: 1 - pHome,
    pTie: 0,
    rawPHomeWin: raw.pHomeWin,
    extraLogit,
  }

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

function evaluateNflTotals({ game, homeStats, awayStats, quote, now, options }) {
  const totalsDistribution = options.totalsDistribution
    || (options.modelVersion === NFL_SELECTION_MODEL_V101
      ? null
      : researchTotalsDistribution(homeStats, awayStats, quote?.total ?? quote?.line))
  const dataEligibility = evaluateNflDataEligibility({
    home: homeStats,
    away: awayStats,
    game,
    now,
    market: 'totals',
    totalsDistribution,
    completedGames: options.completedGames,
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
  if (!hasExplicitTotalsDistribution(totalsDistribution)) {
    return {
      ...empty,
      eligibility: {
        dataEligible: false,
        eligibleForPublic: false,
        reason: NFL_TOTALS_INELIGIBLE_REASON,
      },
      reason: NFL_TOTALS_INELIGIBLE_REASON,
    }
  }

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

  let pOver = outcomes.pOver
  let pUnder = outcomes.pUnder
  const pPush = outcomes.pPush
  if (options.useV11 !== false && options.modelVersion !== NFL_SELECTION_MODEL_V101) {
    const blended = blendConditionalTowardMarket({
      pWin: pOver,
      pLoss: pUnder,
      pPush,
      marketFairProb: marketFair?.overFairProb,
      strongEvidence: Boolean(options.features?.strongEvidence),
    })
    pOver = blended.pWin
    pUnder = blended.pLoss
  }

  const overSide = buildTotalSide({
    pick: 'over',
    pWin: pOver,
    pLoss: pUnder,
    pPush,
    quote,
    price: quote?.priceOver,
    marketFairProb: marketFair?.overFairProb ?? null,
    line,
    game,
    eligibility,
  })
  const underSide = buildTotalSide({
    pick: 'under',
    pWin: pUnder,
    pLoss: pOver,
    pPush,
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
    model: { ...outcomes, pOver, pUnder, pPush },
    quote: serializeQuote(quote, 'totals', line),
    marketFair,
    over: overSide,
    under: underSide,
  }
}

function evaluateNflSpreads({ game, homeStats, awayStats, quote, moneyline, now, options }) {
  const dataEligibility = evaluateNflDataEligibility({
    home: homeStats,
    away: awayStats,
    game,
    now,
    market: 'spreads',
    completedGames: options.completedGames,
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
    quote: serializeQuote(quote, 'spreads', quote?.spread ?? quote?.line ?? null),
  }

  if (options.modelVersion === NFL_SELECTION_MODEL_V101) {
    return {
      ...empty,
      eligibility: {
        dataEligible: false,
        eligibleForPublic: false,
        reason: 'spreads_not_in_v1_0_1',
      },
      reason: 'spreads_not_in_v1_0_1',
    }
  }
  if (!dataEligibility.ok) return empty
  if (!Number.isFinite(Number(quote?.spread ?? quote?.line))) {
    return { ...empty, eligibility: { ...eligibility, dataEligible: false, reason: 'missing_spread' }, reason: 'missing_spread' }
  }

  const pHome = moneyline?.model?.pHomeWin
  const mean = expectedMarginFromHomeWinProb(pHome, NFL_MARGIN_SD)
  const spread = Number(quote.spread ?? quote.line)
  const cover = coverProbabilitiesFromMargin({ mean, sd: NFL_MARGIN_SD, spread })
  if (!cover.ok) {
    return { ...empty, eligibility: { ...eligibility, dataEligible: false, reason: 'missing_margin_model' }, reason: 'missing_margin_model' }
  }

  const marketFair = quote?.priceHome != null && quote?.priceAway != null
    ? deVigMoneyline(quote.priceHome, quote.priceAway)
    : null

  const blended = blendConditionalTowardMarket({
    pWin: cover.pHomeCover,
    pLoss: cover.pAwayCover,
    pPush: cover.pPush,
    marketFairProb: marketFair?.homeFairProb,
    strongEvidence: Boolean(options.features?.strongEvidence),
  })

  const homeSide = buildSpreadSide({
    side: 'home',
    pick: game?.home?.abbr || 'HOME',
    opponent: game?.away?.abbr || 'AWAY',
    pWin: blended.pWin,
    pLoss: blended.pLoss,
    pPush: blended.pPush,
    quote,
    price: quote?.priceHome,
    marketFairProb: marketFair?.homeFairProb ?? null,
    spread,
    game,
    eligibility,
  })
  const awaySide = buildSpreadSide({
    side: 'away',
    pick: game?.away?.abbr || 'AWAY',
    opponent: game?.home?.abbr || 'HOME',
    pWin: blended.pLoss,
    pLoss: blended.pWin,
    pPush: blended.pPush,
    quote,
    price: quote?.priceAway,
    marketFairProb: marketFair?.awayFairProb ?? null,
    spread: spread != null ? -spread : null,
    game,
    eligibility,
  })

  return {
    eligibility,
    reason: eligibility.reason,
    model: { ...cover, pHomeCover: blended.pWin, pAwayCover: blended.pLoss, expectedMargin: mean },
    quote: serializeQuote(quote, 'spreads', spread),
    marketFair,
    home: homeSide,
    away: awaySide,
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
    reasoning: 'Unvalidated NFL research model (market-blended). Not a public recommendation.',
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
    reasoning: 'Unvalidated NFL totals research model (Normal scoring + market blend). Not a public recommendation.',
  }
}

function buildSpreadSide({
  side, pick, opponent, pWin, pLoss, pPush, quote, price, marketFairProb, spread, game, eligibility,
}) {
  const priced = evaluateQuotedPrice({ pWin, pLoss, pPush, odds: price })
  const vsMarket = modelVersusTwoWayMarketGap({ pWin, pPush, marketFairProb })
  return {
    market: 'spreads',
    side,
    pick,
    team: pick,
    opponent,
    homeTeam: game?.home?.abbr || 'HOME',
    awayTeam: game?.away?.abbr || 'AWAY',
    line: spread,
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
      ...serializeQuote(quote, 'spreads', spread),
      americanOdds: priced.americanOdds,
      decimalOdds: priced.decimalOdds,
    },
    eligibility,
    reasoning: 'Unvalidated NFL spread research model (market-blended). Not a public recommendation.',
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
  const spreadRow = rows.find((row) => (
    row.market === 'spreads' || row.market === 'spread'
  ) && (row.spread != null || row.line != null) && (row.priceHome != null || row.priceAway != null))

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
    spreads: spreadRow
      ? {
        id: spreadRow.id || null,
        gameId: spreadRow.gameId || null,
        book: spreadRow.book || null,
        market: 'spreads',
        spread: spreadRow.spread ?? spreadRow.line,
        line: spreadRow.spread ?? spreadRow.line,
        priceHome: spreadRow.priceHome,
        priceAway: spreadRow.priceAway,
        ts: spreadRow.ts || spreadRow.quotedAt || null,
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
    ...quotePriceUnits(quote, market),
  }
}

function quotePriceUnits(quote, market) {
  if (market === 'totals') {
    const over = quote.priceOver ?? quote.priceAway
    const under = quote.priceUnder ?? quote.priceHome
    return {
      americanOddsOver: toAmericanOdds(over),
      americanOddsUnder: toAmericanOdds(under),
      decimalOddsOver: toDecimalOdds(over),
      decimalOddsUnder: toDecimalOdds(under),
    }
  }
  return {
    americanOddsHome: toAmericanOdds(quote.priceHome),
    americanOddsAway: toAmericanOdds(quote.priceAway),
    decimalOddsHome: toDecimalOdds(quote.priceHome),
    decimalOddsAway: toDecimalOdds(quote.priceAway),
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

function hasSeasonScoringAverages(home, away) {
  const homePf = seasonPointsPerGame(home?.seasonPointsFor ?? home?.pointsForPerGame, home?.gamesPlayed)
  const homePa = seasonPointsPerGame(home?.seasonPointsAgainst ?? home?.pointsAgainstPerGame, home?.gamesPlayed)
  const awayPf = seasonPointsPerGame(away?.seasonPointsFor ?? away?.pointsForPerGame, away?.gamesPlayed)
  const awayPa = seasonPointsPerGame(away?.seasonPointsAgainst ?? away?.pointsAgainstPerGame, away?.gamesPlayed)
  return [homePf, homePa, awayPf, awayPa].every((value) => Number.isFinite(value) && value > 0)
}

function researchTotalsDistribution(home, away, line) {
  if (!hasSeasonScoringAverages(home, away)) return null
  const homePf = seasonPointsPerGame(home.seasonPointsFor ?? home.pointsForPerGame, home.gamesPlayed)
  const homePa = seasonPointsPerGame(home.seasonPointsAgainst ?? home.pointsAgainstPerGame, home.gamesPlayed)
  const awayPf = seasonPointsPerGame(away.seasonPointsFor ?? away.pointsForPerGame, away.gamesPlayed)
  const awayPa = seasonPointsPerGame(away.seasonPointsAgainst ?? away.pointsAgainstPerGame, away.gamesPlayed)
  const mean = (homePf + awayPa) / 2 + (awayPf + homePa) / 2 + NFL_HOME_SCORING_BOOST
  return {
    mean,
    variance: NFL_TOTAL_SD * NFL_TOTAL_SD,
    line: Number.isFinite(Number(line)) ? Number(line) : mean,
    source: 'season_scoring_unvalidated',
  }
}

function mergeRebuiltSeasonStats(base, rebuilt) {
  if (!rebuilt || !rebuilt.gamesPlayed) return base
  return {
    ...base,
    wins: rebuilt.wins,
    losses: rebuilt.losses,
    otl: rebuilt.otl,
    ties: rebuilt.ties,
    gamesPlayed: rebuilt.gamesPlayed,
    seasonPointsFor: rebuilt.pointsForPerGame,
    seasonPointsAgainst: rebuilt.pointsAgainstPerGame,
    dataThrough: rebuilt.dataThrough || base.dataThrough,
    // Keep Team.statsCapturedAt (ESPN fetch). Rebuilt lastUpdate is not a fetch.
    capturedAt: base.capturedAt,
    resultAvailableAt: rebuilt.resultAvailableAt || null,
    statsKind: rebuilt.statsKind || base.statsKind,
    last10Record: rebuilt.last10Record || base.last10Record,
  }
}

function extraLogitFromFeatures(homeStats, awayStats, features) {
  let logit = 0
  const homePd = shrinkPointDifferential(
    seasonPointsPerGame(homeStats?.seasonPointsFor ?? homeStats?.pointsForPerGame, homeStats?.gamesPlayed),
    seasonPointsPerGame(homeStats?.seasonPointsAgainst ?? homeStats?.pointsAgainstPerGame, homeStats?.gamesPlayed),
    homeStats?.gamesPlayed,
  )
  const awayPd = shrinkPointDifferential(
    seasonPointsPerGame(awayStats?.seasonPointsFor ?? awayStats?.pointsForPerGame, awayStats?.gamesPlayed),
    seasonPointsPerGame(awayStats?.seasonPointsAgainst ?? awayStats?.pointsAgainstPerGame, awayStats?.gamesPlayed),
    awayStats?.gamesPlayed,
  )
  if (homePd != null && awayPd != null) logit += NFL_PD_LOGIT_SCALE * (homePd - awayPd)

  const homeForm = features?.home?.form
  const awayForm = features?.away?.form
  if (homeForm?.games >= 2 && awayForm?.games >= 2
    && Number.isFinite(homeForm.winPct) && Number.isFinite(awayForm.winPct)) {
    logit += NFL_FORM_LOGIT_SCALE * (homeForm.winPct - awayForm.winPct)
  }

  if (features?.home?.rest?.shortWeek) logit += NFL_REST_SHORT_WEEK_LOGIT
  if (features?.away?.rest?.shortWeek) logit -= NFL_REST_SHORT_WEEK_LOGIT
  if (features?.home?.rest?.byeLike) logit += NFL_REST_BYE_LOGIT
  if (features?.away?.rest?.byeLike) logit -= NFL_REST_BYE_LOGIT

  if (features?.home?.injuries?.qbOut) logit -= NFL_QB_OUT_LOGIT
  if (features?.away?.injuries?.qbOut) logit += NFL_QB_OUT_LOGIT
  if (features?.home?.injuries?.qbQuestionable) logit -= NFL_QB_QUESTIONABLE_LOGIT
  if (features?.away?.injuries?.qbQuestionable) logit += NFL_QB_QUESTIONABLE_LOGIT
  const homeSkill = Number(features?.home?.injuries?.skillOut) || 0
  const awaySkill = Number(features?.away?.injuries?.skillOut) || 0
  logit += NFL_SKILL_OUT_LOGIT * (awaySkill - homeSkill)

  const h2h = features?.matchup
  if (h2h?.games >= 2) {
    logit += NFL_H2H_LOGIT_SCALE * ((h2h.homeWins / h2h.games) - 0.5)
  }
  return logit
}

function blendConditionalTowardMarket({ pWin, pLoss, pPush = 0, marketFairProb, strongEvidence = false }) {
  const push = Number(pPush) || 0
  const decisive = 1 - push
  if (!(decisive > 0)) {
    return { pWin, pLoss, pPush: push }
  }
  const conditional = Number(pWin) / decisive
  const shrunk = blendModelProbTowardMarket(conditional, marketFairProb, { strongEvidence })
  const next = Number.isFinite(shrunk.p) ? shrunk.p : conditional
  return {
    pWin: next * decisive,
    pLoss: (1 - next) * decisive,
    pPush: push,
  }
}

function probToLogit(p) {
  const n = clampOpenUnit(p)
  if (n == null) return 0
  return Math.log(n / (1 - n))
}

function logitToProb(logit) {
  return 1 / (1 + Math.exp(-Number(logit)))
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
  if (value === 'spread' || value === 'spreads') return 'spreads'
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
    line: firstFiniteNumber(quote.line, quote.total, quote.spread),
    total: firstFiniteNumber(quote.total, quote.line),
    spread: firstFiniteNumber(quote.spread, quote.line),
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
