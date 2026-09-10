/**
 * Second-pass read-only nflverse study: richer free features, chronological
 * OOS fits, and totals vs closing total_line.
 *
 * Research only. Does not write production Supabase, call The Odds API,
 * regrade picks, merge, or flip public NFL eligibility.
 *
 * Fitted coefficients use expanding prior seasons only. A market blend
 * uses the close as an input and cannot be described as beating the market.
 */

import { removeMlVig, removeTotalVig } from '../implied.js'
import {
  NFL_HFA_LOGIT,
  estimatedEvAtDecimalOdds,
  nflTotalOutcomeProbabilities,
  shrinkSeasonWinPct,
  twoWayHomeWinProbability,
} from '../nfl-selection-model.js'
import { toDecimalOdds } from '../odds-units.js'
import {
  DEFAULT_MIN_TEAM_GAMES,
  NFLVERSE_STUDY_CONSTRAINTS,
  binaryLogLoss,
  brierScore,
  filterStudyGames,
  flatStakeProfit,
  isChronologicallyBefore,
  momentStats,
  parseNflverseGames,
  sha256Hex,
  summarizeStakeSeries,
} from './nflverse-games-study.js'

export const RICH_STUDY_CONSTRAINTS = NFLVERSE_STUDY_CONSTRAINTS
export const RICH_STUDY_PUBLIC_ELIGIBLE = false

export const PPG_SHRINKAGE_GAMES = 4
export const FALLBACK_LEAGUE_PPG = 22
export const FALLBACK_TOTALS_SD = 14
export const DEFAULT_MIN_FIT_GAMES = 200
export const LOGISTIC_L2 = 1e-2
export const PREREGISTERED_BLEND_WEIGHT = 0.5
export const INDOOR_ROOFS = Object.freeze(['dome', 'closed'])

export const PREREGISTERED_STAKE = Object.freeze({
  unit: 1,
  moneyline: 'bet_positive_ev_at_close',
  totals: 'bet_positive_ev_at_close',
  skipIfEvLte0: true,
  tiesAndPushesRefund: true,
  note: 'Declared before looking at holdout ROI. Not chosen after seeing results.',
})

export const ML_CANDIDATE_IDS = Object.freeze([
  'shrunk_winpct',
  'winpct_pd',
  'winpct_pd_context',
  'market_blend',
])

export const ML_CONTEXT_FEATURES = Object.freeze([
  'intercept',
  'winpct_logit',
  'pd_pg_diff',
  'rest_diff',
  'div_game',
  'is_indoor',
  'weather_present',
  'wind_10',
  'temp_60_20',
])

export const ML_PD_FEATURES = Object.freeze([
  'intercept',
  'winpct_logit',
  'pd_pg_diff',
])

function mean(values) {
  const finite = values.filter((v) => Number.isFinite(v))
  if (!finite.length) return null
  return finite.reduce((sum, v) => sum + v, 0) / finite.length
}

function sigmoid(z) {
  if (z >= 0) {
    const ez = Math.exp(-z)
    return 1 / (1 + ez)
  }
  const ez = Math.exp(z)
  return ez / (1 + ez)
}

function clipUnit(p) {
  if (!Number.isFinite(p)) return null
  return Math.min(1 - 1e-6, Math.max(1e-6, p))
}

export function isIndoorRoof(roof) {
  return INDOOR_ROOFS.includes(String(roof || '').toLowerCase())
}

export function emptyTeamScoring() {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    gamesPlayed: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    ppg: null,
    papg: null,
    pdpg: null,
  }
}

export function applyScoringGame(record, pointsFor, pointsAgainst) {
  const next = { ...record }
  next.gamesPlayed += 1
  next.pointsFor += pointsFor
  next.pointsAgainst += pointsAgainst
  next.pointDiff = next.pointsFor - next.pointsAgainst
  const tied = pointsFor === pointsAgainst
  if (tied) next.ties += 1
  else if (pointsFor > pointsAgainst) next.wins += 1
  else next.losses += 1
  next.ppg = next.pointsFor / next.gamesPlayed
  next.papg = next.pointsAgainst / next.gamesPlayed
  next.pdpg = next.pointDiff / next.gamesPlayed
  return next
}

/**
 * Season-to-date W-L and scoring using only earlier same-season games.
 */
export function seasonToDateScoring(game, completedGames) {
  const records = {
    [game.homeTeam]: emptyTeamScoring(),
    [game.awayTeam]: emptyTeamScoring(),
  }

  for (const prior of completedGames) {
    if (prior.season !== game.season) continue
    if (prior.gameId === game.gameId) continue
    if (!prior.completed) continue
    if (!isChronologicallyBefore(prior, game)) continue

    if (prior.homeTeam === game.homeTeam || prior.homeTeam === game.awayTeam) {
      records[prior.homeTeam] = applyScoringGame(
        records[prior.homeTeam] || emptyTeamScoring(),
        prior.homeScore,
        prior.awayScore,
      )
    }
    if (prior.awayTeam === game.homeTeam || prior.awayTeam === game.awayTeam) {
      records[prior.awayTeam] = applyScoringGame(
        records[prior.awayTeam] || emptyTeamScoring(),
        prior.awayScore,
        prior.homeScore,
      )
    }
  }

  return {
    home: records[game.homeTeam] || emptyTeamScoring(),
    away: records[game.awayTeam] || emptyTeamScoring(),
  }
}

export function shrinkPpg(points, gamesPlayed, leaguePpg, k = PPG_SHRINKAGE_GAMES) {
  const pf = Number(points)
  const g = Number(gamesPlayed)
  const prior = Number.isFinite(leaguePpg) ? leaguePpg : FALLBACK_LEAGUE_PPG
  if (!Number.isFinite(pf) || !Number.isFinite(g) || g < 0) return null
  return (pf + k * prior) / (g + k)
}

export function projectGameTotal(home, away, leaguePpg) {
  const homeOff = shrinkPpg(home.pointsFor, home.gamesPlayed, leaguePpg)
  const homeDef = shrinkPpg(home.pointsAgainst, home.gamesPlayed, leaguePpg)
  const awayOff = shrinkPpg(away.pointsFor, away.gamesPlayed, leaguePpg)
  const awayDef = shrinkPpg(away.pointsAgainst, away.gamesPlayed, leaguePpg)
  if ([homeOff, homeDef, awayOff, awayDef].some((v) => v == null)) return null
  return (homeOff + awayDef + awayOff + homeDef) / 2
}

export function solveLinearSystem(matrix, vector) {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null
    if (pivot !== col) {
      const tmp = a[col]
      a[col] = a[pivot]
      a[pivot] = tmp
    }
    const diag = a[col][col]
    for (let c = col; c <= n; c++) a[col][c] /= diag
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = a[r][col]
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c]
    }
  }
  return a.map((row) => row[n])
}

function designMatrix(rows, names, read) {
  return rows.map((row) => names.map((name) => Number(read(row)[name] || 0)))
}

export function fitLogisticRegression(X, y, { l2 = LOGISTIC_L2, maxIter = 20 } = {}) {
  if (!X.length || X.length !== y.length) return null
  const p = X[0].length
  let beta = Array(p).fill(0)
  for (let iter = 0; iter < maxIter; iter++) {
    const W = []
    const z = []
    for (let i = 0; i < y.length; i++) {
      const xb = X[i].reduce((sum, v, j) => sum + v * beta[j], 0)
      const phat = clipUnit(sigmoid(xb))
      const w = phat * (1 - phat)
      W.push(w)
      z.push(xb + (y[i] - phat) / w)
    }
    const next = weightedLeastSquares(X, W, z, l2)
    if (!next) return { beta, ok: false, iterations: iter }
    beta = next
  }
  return { beta, ok: true, iterations: maxIter }
}

export function fitOrdinaryLeastSquares(X, y, { l2 = LOGISTIC_L2 } = {}) {
  if (!X.length || X.length !== y.length) return null
  const W = X.map(() => 1)
  const beta = weightedLeastSquares(X, W, y, l2)
  if (!beta) return null
  return { beta, ok: true }
}

function weightedLeastSquares(X, W, z, l2) {
  const n = X.length
  const p = X[0].length
  const A = Array.from({ length: p }, () => Array(p).fill(0))
  const b = Array(p).fill(0)
  for (let i = 0; i < n; i++) {
    const wi = W[i]
    for (let j = 0; j < p; j++) {
      b[j] += wi * X[i][j] * z[i]
      for (let k = 0; k < p; k++) {
        A[j][k] += wi * X[i][j] * X[i][k]
      }
    }
  }
  for (let j = 0; j < p; j++) A[j][j] += l2
  return solveLinearSystem(A, b)
}

function predictLogit(features, names, beta) {
  if (!beta) return null
  let xb = 0
  for (let i = 0; i < names.length; i++) xb += (Number(features[names[i]]) || 0) * beta[i]
  return clipUnit(sigmoid(xb))
}

export function beatsClosingMarket({
  logLoss,
  brier,
  primaryRoi,
  marketLogLoss,
  marketBrier,
  usesClosingMarket = false,
} = {}) {
  if (usesClosingMarket) {
    return {
      beats: false,
      betterScores: false,
      profitable: Number.isFinite(primaryRoi) ? primaryRoi > 0 : false,
      reason: 'uses_closing_market_as_input',
    }
  }
  if ([logLoss, brier, primaryRoi, marketLogLoss, marketBrier].some((v) => !Number.isFinite(v))) {
    return { beats: false, betterScores: false, profitable: false, reason: 'incomplete_metrics' }
  }
  const betterScores = logLoss < marketLogLoss && brier < marketBrier
  const profitable = primaryRoi > 0
  return {
    beats: betterScores && profitable,
    betterScores,
    profitable,
    reason: betterScores && profitable
      ? null
      : (!betterScores ? 'worse_or_equal_probability_scores' : 'nonpositive_primary_roi'),
  }
}

export function buildMlFeatures(game, scoring) {
  const homeShrunk = shrinkSeasonWinPct(scoring.home.wins, scoring.home.gamesPlayed)
  const awayShrunk = shrinkSeasonWinPct(scoring.away.wins, scoring.away.gamesPlayed)
  const twoWay = twoWayHomeWinProbability(homeShrunk, awayShrunk)
  if (!twoWay) return null

  const weatherPresent = game.temp != null && game.wind != null ? 1 : 0
  const restDiff = (game.homeRest ?? 7) - (game.awayRest ?? 7)
  const winpctLogit = Math.log(twoWay.pHomeWin / (1 - twoWay.pHomeWin))

  return {
    intercept: 1,
    winpct_logit: winpctLogit,
    pd_pg_diff: (scoring.home.pdpg ?? 0) - (scoring.away.pdpg ?? 0),
    rest_diff: restDiff,
    div_game: game.divGame ? 1 : 0,
    is_indoor: isIndoorRoof(game.roof) ? 1 : 0,
    weather_present: weatherPresent,
    wind_10: weatherPresent ? game.wind / 10 : 0,
    temp_60_20: weatherPresent ? (game.temp - 60) / 20 : 0,
    homeShrunkWinPct: homeShrunk,
    awayShrunkWinPct: awayShrunk,
    pShrunkHome: twoWay.pHomeWin,
    pShrunkAway: twoWay.pAwayWin,
  }
}

function priorSeasonTotalsStats(completedGames, season) {
  const prior = completedGames.filter((game) => game.season === season - 1 && Number.isFinite(game.total))
  if (prior.length < 2) {
    return {
      season: season - 1,
      n: prior.length,
      leaguePpg: FALLBACK_LEAGUE_PPG,
      sd: FALLBACK_TOTALS_SD,
      source: 'unfitted_fallback',
    }
  }
  const stats = momentStats(prior.map((game) => game.total))
  return {
    season: season - 1,
    n: stats.n,
    leaguePpg: stats.mean / 2,
    sd: stats.sd,
    source: 'prior_season',
  }
}

function pickPositiveEvSide(evHome, evAway) {
  if (evHome == null && evAway == null) return null
  if (evHome != null && evHome > 0 && (evAway == null || evHome >= evAway)) return 'home'
  if (evAway != null && evAway > 0 && (evHome == null || evAway > evHome)) return 'away'
  return null
}

function scoreBinarySeries(rows, pKey, yKey = 'y') {
  const decisive = rows.filter((row) => row[yKey] === 0 || row[yKey] === 1)
  return {
    n: decisive.length,
    logLoss: mean(decisive.map((row) => binaryLogLoss(row[yKey], row[pKey]))),
    brier: mean(decisive.map((row) => brierScore(row[yKey], row[pKey]))),
  }
}

export function collectRichRows(games, { minTeamGames = DEFAULT_MIN_TEAM_GAMES } = {}) {
  const completed = games.filter((game) => game.completed)
  const rows = []

  for (const game of games) {
    if (!game.completed) continue
    const scoring = seasonToDateScoring(game, completed)
    if (scoring.home.gamesPlayed < minTeamGames || scoring.away.gamesPlayed < minTeamGames) continue

    const features = buildMlFeatures(game, scoring)
    if (!features) continue

    const tied = game.homeScore === game.awayScore
    const homeWon = game.homeScore > game.awayScore
    const market = game.homeMoneyline != null && game.awayMoneyline != null
      ? removeMlVig(game.homeMoneyline, game.awayMoneyline)
      : null
    const totalsMarket = game.overOdds != null && game.underOdds != null
      ? removeTotalVig(game.overOdds, game.underOdds, game.totalLine)
      : null
    const priorTotals = priorSeasonTotalsStats(completed, game.season)
    const projectedTotal = projectGameTotal(scoring.home, scoring.away, priorTotals.leaguePpg)

    rows.push({
      game,
      scoring,
      features,
      tied,
      homeWon,
      yHome: tied ? null : (homeWon ? 1 : 0),
      yOver: game.totalLine == null || !Number.isFinite(game.total)
        ? null
        : (game.total === game.totalLine ? null : (game.total > game.totalLine ? 1 : 0)),
      marketFairPHome: market?.homeFairProb ?? null,
      totalsMarketFairPOver: totalsMarket?.overFairProb ?? null,
      projectedTotal,
      priorTotals,
    })
  }

  return rows
}

function fitMlCandidate(candidateId, trainRows) {
  const decisive = trainRows.filter((row) => row.yHome === 0 || row.yHome === 1)
  if (candidateId === 'shrunk_winpct') {
    return { candidateId, kind: 'unfitted_structural', featureNames: [], beta: null, nTrain: decisive.length }
  }
  if (candidateId === 'market_blend') {
    return {
      candidateId,
      kind: 'market_blend',
      usesClosingMarket: true,
      blendWeight: PREREGISTERED_BLEND_WEIGHT,
      featureNames: ML_CONTEXT_FEATURES,
      nTrain: decisive.length,
    }
  }

  const names = candidateId === 'winpct_pd' ? ML_PD_FEATURES : ML_CONTEXT_FEATURES
  const usable = decisive.filter((row) => row.features)
  if (usable.length < 2) {
    return { candidateId, kind: 'insufficient_train', featureNames: names, beta: null, nTrain: usable.length }
  }
  const X = designMatrix(usable, names, (row) => row.features)
  const y = usable.map((row) => row.yHome)
  const fit = fitLogisticRegression(X, y)
  return {
    candidateId,
    kind: fit?.ok ? 'expanding_prior_seasons' : 'fit_failed_fallback',
    featureNames: names,
    beta: fit?.beta || null,
    nTrain: usable.length,
  }
}

function predictMl(candidate, row) {
  if (candidate.candidateId === 'shrunk_winpct' || !candidate.beta) {
    if (candidate.candidateId === 'shrunk_winpct' || candidate.kind === 'insufficient_train' || candidate.kind === 'fit_failed_fallback') {
      if (candidate.candidateId !== 'market_blend') return row.features.pShrunkHome
    }
  }
  if (candidate.candidateId === 'market_blend') {
    const structural = candidate.beta
      ? predictLogit(row.features, candidate.featureNames, candidate.beta)
      : row.features.pShrunkHome
    const market = row.marketFairPHome
    if (!Number.isFinite(market) || !Number.isFinite(structural)) return null
    const w = candidate.blendWeight
    return clipUnit((1 - w) * structural + w * market)
  }
  return predictLogit(row.features, candidate.featureNames, candidate.beta) ?? row.features.pShrunkHome
}

function evaluateMlHoldout(rows, candidate) {
  const scored = []
  for (const row of rows) {
    if (row.game.homeMoneyline == null || row.game.awayMoneyline == null) continue
    const pHome = predictMl(candidate, row)
    if (!Number.isFinite(pHome)) continue
    const pAway = 1 - pHome
    const homeDec = toDecimalOdds(row.game.homeMoneyline)
    const awayDec = toDecimalOdds(row.game.awayMoneyline)
    const evHome = estimatedEvAtDecimalOdds(pHome, pAway, homeDec)
    const evAway = estimatedEvAtDecimalOdds(pAway, pHome, awayDec)
    const valueSide = pickPositiveEvSide(evHome, evAway)
    const preferred = pHome > 0.5 ? 'home' : (pHome < 0.5 ? 'away' : null)
    scored.push({
      gameId: row.game.gameId,
      season: row.game.season,
      y: row.yHome,
      tied: row.tied,
      pHome,
      marketPHome: row.marketFairPHome,
      homePriorPdpg: row.scoring.home.pdpg,
      awayPriorPdpg: row.scoring.away.pdpg,
      features: row.features,
      valueSide,
      preferred,
      primaryProfit: valueSide
        ? flatStakeProfit(
          valueSide === 'home' ? row.homeWon : !row.homeWon && !row.tied,
          valueSide === 'home' ? row.game.homeMoneyline : row.game.awayMoneyline,
          { push: row.tied },
        )
        : null,
      preferredProfit: preferred
        ? flatStakeProfit(
          preferred === 'home' ? row.homeWon : !row.homeWon && !row.tied,
          preferred === 'home' ? row.game.homeMoneyline : row.game.awayMoneyline,
          { push: row.tied },
        )
        : null,
    })
  }

  const decisive = scored.filter((row) => row.y === 0 || row.y === 1)
  const scores = scoreBinarySeries(decisive, 'pHome')
  const marketScores = scoreBinarySeries(decisive, 'marketPHome')
  const primary = summarizeStakeSeries(scored.map((row) => row.primaryProfit))
  const verdict = beatsClosingMarket({
    logLoss: scores.logLoss,
    brier: scores.brier,
    primaryRoi: primary.roi,
    marketLogLoss: marketScores.logLoss,
    marketBrier: marketScores.brier,
    usesClosingMarket: candidate.candidateId === 'market_blend',
  })

  return {
    candidateId: candidate.candidateId,
    usesClosingMarket: candidate.candidateId === 'market_blend',
    fit: {
      kind: candidate.kind,
      nTrain: candidate.nTrain,
      featureNames: candidate.featureNames,
      coefficients: candidate.beta && candidate.featureNames
        ? Object.fromEntries(candidate.featureNames.map((name, i) => [name, candidate.beta[i]]))
        : null,
      blendWeight: candidate.blendWeight ?? null,
    },
    nEvaluated: scored.length,
    nDecisive: decisive.length,
    logLoss: scores.logLoss,
    brier: scores.brier,
    marketLogLoss: marketScores.logLoss,
    marketBrier: marketScores.brier,
    primaryStake: {
      rule: PREREGISTERED_STAKE.moneyline,
      ...primary,
    },
    secondaryModelPreferred: summarizeStakeSeries(scored.map((row) => row.preferredProfit)),
    beatsClosingMarket: verdict,
    evaluations: scored,
  }
}

function fitTotalsCalibration(trainRows) {
  const usable = trainRows.filter((row) => Number.isFinite(row.projectedTotal) && Number.isFinite(row.game.total))
  if (usable.length < 5) {
    return { a: 0, b: 1, nTrain: usable.length, kind: 'identity_fallback' }
  }
  const X = usable.map((row) => [1, row.projectedTotal])
  const y = usable.map((row) => row.game.total)
  const fit = fitOrdinaryLeastSquares(X, y)
  if (!fit?.beta) return { a: 0, b: 1, nTrain: usable.length, kind: 'identity_fallback' }
  return { a: fit.beta[0], b: fit.beta[1], nTrain: usable.length, kind: 'expanding_prior_seasons' }
}

function evaluateTotalsHoldout(rows, calibration) {
  const scored = []
  for (const row of rows) {
    if (row.game.totalLine == null || !Number.isFinite(row.projectedTotal)) continue
    const meanTotal = calibration.a + calibration.b * row.projectedTotal
    const variance = row.priorTotals.sd * row.priorTotals.sd
    const outcomes = nflTotalOutcomeProbabilities({
      mean: meanTotal,
      variance,
      line: row.game.totalLine,
    })
    if (!outcomes.ok) continue

    const overDec = toDecimalOdds(row.game.overOdds)
    const underDec = toDecimalOdds(row.game.underOdds)
    const evOver = estimatedEvAtDecimalOdds(outcomes.pOver, outcomes.pUnder, overDec)
    const evUnder = estimatedEvAtDecimalOdds(outcomes.pUnder, outcomes.pOver, underDec)
    const valueSide = pickPositiveEvSide(evOver, evUnder)
    const pushed = row.game.total === row.game.totalLine
    const overWon = row.game.total > row.game.totalLine

    scored.push({
      gameId: row.game.gameId,
      season: row.game.season,
      y: row.yOver,
      pOver: outcomes.pOver,
      pOverDecisive: outcomes.pOver + outcomes.pUnder > 0
        ? outcomes.pOver / (outcomes.pOver + outcomes.pUnder)
        : null,
      pPush: outcomes.pPush,
      marketPOver: row.totalsMarketFairPOver,
      projectedTotal: row.projectedTotal,
      calibratedMean: meanTotal,
      sigma: row.priorTotals.sd,
      sigmaSource: row.priorTotals.source,
      line: row.game.totalLine,
      actualTotal: row.game.total,
      absError: Number.isFinite(row.game.total) ? Math.abs(row.game.total - meanTotal) : null,
      primaryProfit: valueSide && row.game.overOdds != null
        ? flatStakeProfit(
          valueSide === 'home' ? overWon : !overWon && !pushed,
          valueSide === 'home' ? row.game.overOdds : row.game.underOdds,
          { push: pushed },
        )
        : null,
    })
  }

  const withMarket = scored.filter((row) => row.y === 0 || row.y === 1)
  const modelScores = {
    n: withMarket.length,
    logLoss: mean(withMarket.map((row) => binaryLogLoss(row.y, row.pOverDecisive))),
    brier: mean(withMarket.map((row) => brierScore(row.y, row.pOverDecisive))),
  }
  const marketScores = {
    n: withMarket.filter((row) => Number.isFinite(row.marketPOver)).length,
    logLoss: mean(withMarket.map((row) => binaryLogLoss(row.y, row.marketPOver))),
    brier: mean(withMarket.map((row) => brierScore(row.y, row.marketPOver))),
  }
  const primary = summarizeStakeSeries(scored.map((row) => row.primaryProfit))
  const realSigma = scored.filter((row) => row.sigmaSource === 'prior_season')
  const verdict = beatsClosingMarket({
    logLoss: modelScores.logLoss,
    brier: modelScores.brier,
    primaryRoi: primary.roi,
    marketLogLoss: marketScores.logLoss,
    marketBrier: marketScores.brier,
    usesClosingMarket: false,
  })

  return {
    calibration,
    nEvaluated: scored.length,
    nWithMarketOdds: scored.filter((row) => row.primaryProfit != null || Number.isFinite(row.marketPOver)).length,
    nPriorSeasonSigma: realSigma.length,
    mae: mean(scored.map((row) => row.absError)),
    maeVsLine: mean(scored.map((row) => (
      Number.isFinite(row.actualTotal) && Number.isFinite(row.line)
        ? Math.abs(row.actualTotal - row.line)
        : null
    ))),
    logLoss: modelScores.logLoss,
    brier: modelScores.brier,
    marketLogLoss: marketScores.logLoss,
    marketBrier: marketScores.brier,
    primaryStake: {
      rule: PREREGISTERED_STAKE.totals,
      ...primary,
    },
    beatsClosingMarket: verdict,
    evaluations: scored,
  }
}

export function runNflverseRichFeaturesStudy({
  csvText,
  games: providedGames = null,
  includePlayoffs = false,
  minSeason = null,
  maxSeason = null,
  minTeamGames = DEFAULT_MIN_TEAM_GAMES,
  minFitGames = DEFAULT_MIN_FIT_GAMES,
  sourceUrl = null,
  sourcePath = null,
} = {}) {
  const parsed = providedGames || parseNflverseGames(csvText || '')
  const filtered = filterStudyGames(parsed, { includePlayoffs, minSeason, maxSeason })
  const completed = filtered.filter((game) => game.completed)
  const rows = collectRichRows(filtered, { minTeamGames })
  const seasons = [...new Set(rows.map((row) => row.game.season))].sort((a, b) => a - b)

  const mlByCandidate = Object.fromEntries(ML_CANDIDATE_IDS.map((id) => [id, []]))
  const totalsHoldouts = []
  const fitLog = []

  for (const season of seasons) {
    const holdout = rows.filter((row) => row.game.season === season)
    const train = rows.filter((row) => row.game.season < season)
    const nTrainDecisive = train.filter((row) => row.yHome === 0 || row.yHome === 1).length
    const canFit = nTrainDecisive >= minFitGames

    for (const candidateId of ML_CANDIDATE_IDS) {
      let candidate = fitMlCandidate(candidateId, canFit ? train : [])
      if (candidateId === 'market_blend') {
        const context = fitMlCandidate('winpct_pd_context', canFit ? train : [])
        candidate = {
          ...candidate,
          beta: context.beta,
          featureNames: context.featureNames,
          kind: `blend_w=${PREREGISTERED_BLEND_WEIGHT}_plus_${context.kind}`,
          nTrain: context.nTrain,
        }
      }
      if (!canFit && candidateId !== 'shrunk_winpct' && candidateId !== 'market_blend') {
        candidate = {
          ...candidate,
          kind: 'insufficient_train',
          beta: null,
        }
      }
      const evaluated = evaluateMlHoldout(holdout, candidate)
      evaluated.holdoutSeason = season
      mlByCandidate[candidateId].push(evaluated)
      fitLog.push({ season, candidateId, ...evaluated.fit, nHoldout: evaluated.nEvaluated })
    }

    const totalsFit = fitTotalsCalibration(canFit ? train : [])
    const totalsEval = evaluateTotalsHoldout(holdout, totalsFit)
    totalsEval.holdoutSeason = season
    totalsHoldouts.push(totalsEval)
  }

  const mlSummaries = ML_CANDIDATE_IDS.map((id) => poolMlCandidate(id, mlByCandidate[id]))
  const totalsSummary = poolTotals(totalsHoldouts)
  const sampleSizes = richSampleSizes(filtered, rows)

  return {
    study: 'nflverse-rich-features-offline-study',
    generatedAt: new Date().toISOString(),
    constraints: { ...RICH_STUDY_CONSTRAINTS },
    stakeRule: PREREGISTERED_STAKE,
    source: {
      url: sourceUrl,
      path: sourcePath,
      sha256: csvText ? sha256Hex(csvText) : null,
      parsedRows: parsed.length,
      filteredRows: filtered.length,
      completedRows: completed.length,
      includePlayoffs,
      minSeason,
      maxSeason,
      minTeamGames,
      minFitGames,
      fitProtocol: 'expanding_prior_seasons',
    },
    sampleSizes,
    moneyline: {
      disclaimer: 'Research candidates vs nflverse closes. Not production-validated. Public board stays off.',
      candidates: mlSummaries,
      anyIndependentBeat: mlSummaries.some((row) => row.beatsClosingMarket.beats),
    },
    totals: {
      disclaimer: 'Season-to-date shrunk PPG projection + prior-season σ, Normal continuity-corrected onto the closing total_line. Empirical from nflverse, not production-validated for betting.',
      method: {
        projectedTotal: '(home_off + away_def + away_off + home_def) / 2 with k=4 shrinkage to prior-season league PPG',
        sigma: 'sd of completed game totals in season S-1 (fallback 14 if no prior season)',
        distribution: 'normal_continuity_corrected',
        calibration: 'expanding OLS: a + b * projectedTotal, identity fallback when n_train is small',
      },
      overall: totalsSummary,
      bySeason: totalsHoldouts.map(slimTotalsSeason),
    },
    fitLog: fitLog.map((row) => ({
      season: row.season,
      candidateId: row.candidateId,
      kind: row.kind,
      nTrain: row.nTrain,
      nHoldout: row.nHoldout,
      coefficients: row.coefficients,
    })),
  }
}

function poolMlCandidate(candidateId, seasons) {
  const evaluations = seasons.flatMap((season) => season.evaluations || [])
  const decisive = evaluations.filter((row) => row.y === 0 || row.y === 1)
  const scores = scoreBinarySeries(decisive, 'pHome')
  const marketScores = scoreBinarySeries(decisive, 'marketPHome')
  const primary = summarizeStakeSeries(evaluations.map((row) => row.primaryProfit))
  const usesClose = candidateId === 'market_blend'
  const verdict = beatsClosingMarket({
    logLoss: scores.logLoss,
    brier: scores.brier,
    primaryRoi: primary.roi,
    marketLogLoss: marketScores.logLoss,
    marketBrier: marketScores.brier,
    usesClosingMarket: usesClose,
  })
  return {
    candidateId,
    usesClosingMarket: usesClose,
    nEvaluated: evaluations.length,
    nDecisive: decisive.length,
    logLoss: scores.logLoss,
    brier: scores.brier,
    marketLogLoss: marketScores.logLoss,
    marketBrier: marketScores.brier,
    primaryStake: { rule: PREREGISTERED_STAKE.moneyline, ...primary },
    secondaryModelPreferred: summarizeStakeSeries(evaluations.map((row) => row.preferredProfit)),
    beatsClosingMarket: verdict,
    bySeason: seasons.map((season) => ({
      season: season.holdoutSeason,
      nEvaluated: season.nEvaluated,
      nDecisive: season.nDecisive,
      logLoss: season.logLoss,
      brier: season.brier,
      marketLogLoss: season.marketLogLoss,
      marketBrier: season.marketBrier,
      primaryRoi: season.primaryStake.roi,
      primaryN: season.primaryStake.n,
      fitKind: season.fit.kind,
      coefficients: season.fit.coefficients,
    })),
  }
}

function poolTotals(seasons) {
  const evaluations = seasons.flatMap((season) => season.evaluations || [])
  const decisive = evaluations.filter((row) => row.y === 0 || row.y === 1)
  const primary = summarizeStakeSeries(evaluations.map((row) => row.primaryProfit))
  const verdict = beatsClosingMarket({
    logLoss: mean(decisive.map((row) => binaryLogLoss(row.y, row.pOverDecisive))),
    brier: mean(decisive.map((row) => brierScore(row.y, row.pOverDecisive))),
    primaryRoi: primary.roi,
    marketLogLoss: mean(decisive.map((row) => binaryLogLoss(row.y, row.marketPOver))),
    marketBrier: mean(decisive.map((row) => brierScore(row.y, row.marketPOver))),
  })
  return {
    nEvaluated: evaluations.length,
    nDecisive: decisive.length,
    mae: mean(evaluations.map((row) => row.absError)),
    maeVsLine: mean(evaluations.map((row) => (
      Number.isFinite(row.actualTotal) && Number.isFinite(row.line)
        ? Math.abs(row.actualTotal - row.line)
        : null
    ))),
    logLoss: mean(decisive.map((row) => binaryLogLoss(row.y, row.pOverDecisive))),
    brier: mean(decisive.map((row) => brierScore(row.y, row.pOverDecisive))),
    marketLogLoss: mean(decisive.map((row) => binaryLogLoss(row.y, row.marketPOver))),
    marketBrier: mean(decisive.map((row) => brierScore(row.y, row.marketPOver))),
    primaryStake: { rule: PREREGISTERED_STAKE.totals, ...primary },
    beatsClosingMarket: verdict,
  }
}

function slimTotalsSeason(season) {
  return {
    season: season.holdoutSeason,
    nEvaluated: season.nEvaluated,
    mae: season.mae,
    logLoss: season.logLoss,
    brier: season.brier,
    marketLogLoss: season.marketLogLoss,
    marketBrier: season.marketBrier,
    primaryRoi: season.primaryStake.roi,
    primaryN: season.primaryStake.n,
    calibration: season.calibration,
    beats: season.beatsClosingMarket.beats,
  }
}

function richSampleSizes(games, rows) {
  const bySeason = new Map()
  for (const game of games) {
    const row = bySeason.get(game.season) || {
      season: game.season,
      scheduled: 0,
      completed: 0,
      withClosingMl: 0,
      withOuOdds: 0,
      withWeather: 0,
      mlRows: 0,
    }
    row.scheduled += 1
    if (game.completed) row.completed += 1
    if (game.homeMoneyline != null && game.awayMoneyline != null) row.withClosingMl += 1
    if (game.overOdds != null && game.underOdds != null) row.withOuOdds += 1
    if (game.temp != null && game.wind != null) row.withWeather += 1
    bySeason.set(game.season, row)
  }
  for (const row of rows) {
    const season = bySeason.get(row.game.season)
    if (season) season.mlRows += 1
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season)
}

function fmt(value, digits = 4) {
  if (value == null || Number.isNaN(value)) return '—'
  if (typeof value === 'number') return value.toFixed(digits)
  return String(value)
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function markdownTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

export function renderRichStudyMarkdown(result) {
  const src = result.source || {}
  const ml = result.moneyline || {}
  const totals = result.totals || {}

  const sizeRows = (result.sampleSizes || []).map((row) => [
    row.season,
    row.scheduled,
    row.completed,
    row.withClosingMl,
    row.mlRows,
    row.withOuOdds,
    row.withWeather,
  ])

  const mlRows = (ml.candidates || []).map((row) => [
    row.candidateId,
    row.usesClosingMarket ? 'yes (uses close)' : 'no',
    row.nEvaluated,
    row.nDecisive,
    fmt(row.logLoss, 4),
    fmt(row.marketLogLoss, 4),
    fmt(row.brier, 4),
    fmt(row.marketBrier, 4),
    fmtPct(row.primaryStake.roi),
    row.primaryStake.n,
    row.beatsClosingMarket.beats ? 'yes' : `no (${row.beatsClosingMarket.reason})`,
  ])

  const totalsSeasonRows = (totals.bySeason || []).map((row) => [
    row.season,
    row.nEvaluated,
    fmt(row.mae, 2),
    fmt(row.logLoss, 4),
    fmt(row.marketLogLoss, 4),
    fmtPct(row.primaryRoi),
    row.primaryN ?? 0,
    row.calibration?.kind || '—',
    row.beats ? 'yes' : 'no',
  ])

  const beatLine = ml.anyIndependentBeat
    ? 'At least one **independent** candidate met the pre-registered beat rule on this sample. That still does not enable the public board.'
    : 'No independent candidate beat the close on the pre-registered rule (lower log-loss **and** lower Brier **and** +EV ROI > 0). The market blend is excluded from that claim because it uses the close as an input.'

  return `# nflverse rich-features study (research only, pass 2)

**Empirical from nflverse / Lee Sharpe \`games.csv\`. Not production-validated for betting.**

This is a second chronological pass on free nflverse fields. It does **not** enable public NFL selections, call The Odds API, write production Supabase, regrade picks, or merge.

| Constraint | Value |
| --- | --- |
| \`eligibleForPublic\` | \`${result.constraints.eligibleForPublic}\` |
| Production DB writes | \`${result.constraints.writesProductionDb}\` |
| The Odds API | \`${result.constraints.usesOddsApi}\` |
| Regrade picks | \`${result.constraints.regradesPicks}\` |
| Merge | \`${result.constraints.merges}\` |

Generated at: \`${result.generatedAt}\`

## Data

- Source URL: ${src.url ? `[${src.url}](${src.url})` : '— (local file only)'}
- Local path: ${src.path ? `\`${src.path}\`` : '—'}
- SHA-256: \`${src.sha256 || '—'}\`
- Parsed / filtered / completed: **${src.parsedRows ?? '—'}** / **${src.filteredRows ?? '—'}** / **${src.completedRows ?? '—'}**
- Fit protocol: **${src.fitProtocol}** (coefficients for season S use only seasons < S)
- Minimum prior games per team: **${src.minTeamGames}**
- Minimum train games before fitting extra coefficients: **${src.minFitGames}**

## Pre-registered stake rule

Declared before holdout ROI is inspected:

- Stake **1 unit** at the nflverse closing American price
- Bet the side with estimated EV > 0 at that close
- Skip if both sides have EV <= 0
- Ties / integer-total pushes refund (profit 0)
- Model-favorite betting is **secondary** and is not the claim

A candidate **beats the close** on this sample only if it has lower log-loss **and** lower Brier than the de-vig close **and** primary +EV ROI > 0. Market blends cannot beat the market by this definition.

## Methods

### Moneyline candidates

1. \`shrunk_winpct\` — pass-1 baseline: season-to-date win% with \`(wins+8)/(games+16)\` and HFA logit ${NFL_HFA_LOGIT}. No fitted coefficients.
2. \`winpct_pd\` — logistic on \`[intercept, winpct_logit, pd_pg_diff]\`. \`pd_pg_diff\` is season-to-date point differential per game (home minus away) from earlier same-season games only.
3. \`winpct_pd_context\` — same plus rest difference, division game, indoor roof (dome/closed), and weather when present (\`temp\`, \`wind\`; zeros plus a present flag when missing).
4. \`market_blend\` — \`${PREREGISTERED_BLEND_WEIGHT} * P_market + ${1 - PREREGISTERED_BLEND_WEIGHT} * P_winpct_pd_context\`. **Uses the closing moneyline. Documented as a blend, not an independent edge.**

Rest, division, roof, and weather are taken from the current nflverse row (known before kickoff). Scoring features never include the game being predicted or a later game.

### Totals

Season-to-date offense/defense PPG, shrunk with k=${PPG_SHRINKAGE_GAMES} toward prior-season league PPG (mean game total / 2):

\`projected = (home_off + away_def + away_off + home_def) / 2\`

σ is the prior season's completed-game-total standard deviation (fallback ${FALLBACK_TOTALS_SD} only when season S-1 is missing). Integer-line pushes use the production Normal continuity correction. An expanding OLS (\`a + b * projected\`) calibrates the mean when enough prior rows exist.

Production still does **not** receive this distribution. \`eligibleForPublic\` stays false.

## Sample sizes by season

${markdownTable(
    ['Season', 'Scheduled', 'Completed', 'With ML', 'ML rows', 'With O/U odds', 'With weather'],
    sizeRows,
  )}

## Moneyline vs nflverse closes

${beatLine}

${markdownTable(
    ['Candidate', 'Uses close?', 'n', 'Decisive', 'LL', 'LL mkt', 'Brier', 'Brier mkt', '+EV ROI', '+EV n', 'Beats close?'],
    mlRows,
  )}

### Expanding-fit coefficients (last holdout season with a fit)

${renderLastCoefficients(ml.candidates)}

## Totals vs closing total_line

Overall: n=${totals.overall?.nEvaluated ?? 0}, MAE vs model mean ${fmt(totals.overall?.mae, 2)}, MAE vs closing line ${fmt(totals.overall?.maeVsLine, 2)}, log-loss ${fmt(totals.overall?.logLoss, 4)} vs market ${fmt(totals.overall?.marketLogLoss, 4)}, Brier ${fmt(totals.overall?.brier, 4)} vs market ${fmt(totals.overall?.marketBrier, 4)}, primary +EV ROI ${fmtPct(totals.overall?.primaryStake?.roi)} (n=${totals.overall?.primaryStake?.n ?? 0}).

Beats close on the pooled sample? **${totals.overall?.beatsClosingMarket?.beats ? 'yes' : `no (${totals.overall?.beatsClosingMarket?.reason || 'n/a'})`}**

Single-season "yes" cells below are not a public-board enable. The pre-registered claim is the pooled row.

${totalsSeasonRows.length ? markdownTable(
    ['Season', 'n', 'MAE', 'LL', 'LL mkt', '+EV ROI', '+EV n', 'Calib', 'Beats?'],
    totalsSeasonRows,
  ) : '_No totals evaluations._'}

## Limitations

- Free nflverse consensus closes, not The Odds API quotes stored on the site.
- No QB, injuries, or efficiency metrics. Rest/weather coverage is incomplete (domes have no temp/wind).
- Expanding logistic / OLS coefficients are still a small linear model. They are not a validated betting system.
- \`market_blend\` uses the close. Better scores there are not an independent edge.
- First seasons fall back to the unfitted shrinkage baseline until ${src.minFitGames} prior evaluable games exist.
- Honest losing or worse-than-market numbers are reported as-is. **Do not enable live public ML/totals from this pass.**
- Ask before adding paid data.

## How to rerun

\`\`\`bash
node scripts/research/nflverse-rich-features-study.js --input /path/to/games.csv
\`\`\`

CI uses \`scripts/research/fixtures/nflverse-games-rich-snippet.csv\` (no network).
`
}

function renderLastCoefficients(candidates = []) {
  const lines = []
  for (const candidate of candidates) {
    if (candidate.usesClosingMarket) continue
    const fitted = [...(candidate.bySeason || [])].reverse().find((row) => row.coefficients)
    if (!fitted) {
      lines.push(`- \`${candidate.candidateId}\`: no fitted season (insufficient prior games or unfitted baseline).`)
      continue
    }
    const coeffs = Object.entries(fitted.coefficients)
      .map(([name, value]) => `${name}=${fmt(value, 3)}`)
      .join(', ')
    lines.push(`- \`${candidate.candidateId}\` (fit for ${fitted.season} on earlier seasons): ${coeffs}`)
  }
  return lines.join('\n') || '_No fitted coefficients._'
}

export function parseRichStudyArgs(argv = []) {
  const args = {
    input: null,
    url: 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',
    cache: null,
    includePlayoffs: false,
    minSeason: null,
    maxSeason: null,
    minTeamGames: DEFAULT_MIN_TEAM_GAMES,
    minFitGames: DEFAULT_MIN_FIT_GAMES,
    report: 'docs/research/nflverse-rich-features-study.md',
    json: null,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--include-playoffs') {
      args.includePlayoffs = true
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    const numeric = {
      '--min-season': 'minSeason',
      '--max-season': 'maxSeason',
      '--min-team-games': 'minTeamGames',
      '--min-fit-games': 'minFitGames',
    }
    const paths = {
      '--input': 'input',
      '--url': 'url',
      '--cache': 'cache',
      '--report': 'report',
      '--json': 'json',
    }
    if (numeric[token] && next) {
      args[numeric[token]] = Number(next)
      i += 1
      continue
    }
    if (paths[token] && next) {
      args[paths[token]] = next
      i += 1
    }
  }

  return args
}
