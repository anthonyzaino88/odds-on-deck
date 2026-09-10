/**
 * Read-only offline study of nflverse / Lee Sharpe games.csv.
 *
 * Research only. Does not write production Supabase, call The Odds API,
 * regrade picks, merge, or flip public NFL eligibility.
 *
 * Empirical totals parameters are from nflverse game scores. They are
 * not production-validated for betting.
 */

import { createHash } from 'crypto'
import { removeMlVig } from '../implied.js'
import {
  NFL_HFA_LOGIT,
  NFL_MIN_GAMES_FOR_RESEARCH_ML,
  NFL_WIN_PCT_PRIOR_GAMES,
  NFL_WIN_PCT_PRIOR_WINS,
  estimatedEvAtDecimalOdds,
  nflTotalOutcomeProbabilities,
  shrinkSeasonWinPct,
  twoWayHomeWinProbability,
} from '../nfl-selection-model.js'
import { toDecimalOdds } from '../odds-units.js'

export const NFLVERSE_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'

export const NFLVERSE_STUDY_PUBLIC_ELIGIBLE = false
export const NFLVERSE_STUDY_WRITES_PRODUCTION_DB = false
export const NFLVERSE_STUDY_USES_ODDS_API = false
export const NFLVERSE_STUDY_REGRADES_PICKS = false
export const NFLVERSE_STUDY_MERGES = false

export const NFLVERSE_STUDY_CONSTRAINTS = Object.freeze({
  eligibleForPublic: NFLVERSE_STUDY_PUBLIC_ELIGIBLE,
  writesProductionDb: NFLVERSE_STUDY_WRITES_PRODUCTION_DB,
  usesOddsApi: NFLVERSE_STUDY_USES_ODDS_API,
  regradesPicks: NFLVERSE_STUDY_REGRADES_PICKS,
  merges: NFLVERSE_STUDY_MERGES,
})

export const REGULAR_SEASON_TYPE = 'REG'
export const PLAYOFF_GAME_TYPES = Object.freeze(['WC', 'DIV', 'CON', 'SB'])

export const DEFAULT_MIN_TEAM_GAMES = NFL_MIN_GAMES_FOR_RESEARCH_ML
export const PROBABILITY_CLIP = 1e-6
export const TOTALS_OOS_MIN_TRAIN = 30
export const INTEGER_LINE_PUSH_MIN = 30
export const INTEGER_LINE_PUSH_MAX = 60

const EMPTY_RECORD = Object.freeze({
  wins: 0,
  losses: 0,
  ties: 0,
  gamesPlayed: 0,
})

/**
 * RFC-style CSV parse. Handles quoted fields and escaped quotes.
 * Does not execute network I/O.
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    if (c !== '\r') field += c
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  if (rows.length === 0) return []
  const header = rows[0].map((name) => String(name).trim())
  return rows.slice(1)
    .filter((cells) => cells.some((cell) => String(cell ?? '').trim() !== ''))
    .map((cells) => {
      const record = {}
      header.forEach((name, index) => {
        record[name] = cells[index] == null ? '' : String(cells[index])
      })
      return record
    })
}

export function sha256Hex(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

export function parseOptionalNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseNflverseGames(textOrRows) {
  const rows = typeof textOrRows === 'string' ? parseCsv(textOrRows) : (textOrRows || [])
  return rows.map(normalizeNflverseRow).filter((game) => game.gameId && Number.isFinite(game.season))
}

function normalizeNflverseRow(row) {
  const homeScore = parseOptionalNumber(row.home_score)
  const awayScore = parseOptionalNumber(row.away_score)
  const completed = Number.isFinite(homeScore) && Number.isFinite(awayScore)
  const total = completed
    ? homeScore + awayScore
    : parseOptionalNumber(row.total)
  const result = completed
    ? homeScore - awayScore
    : parseOptionalNumber(row.result)

  return {
    gameId: String(row.game_id || '').trim(),
    season: parseOptionalNumber(row.season),
    gameType: String(row.game_type || '').trim().toUpperCase(),
    week: parseOptionalNumber(row.week),
    gameday: String(row.gameday || '').trim(),
    weekday: String(row.weekday || '').trim(),
    gametime: String(row.gametime || '').trim(),
    awayTeam: String(row.away_team || '').trim(),
    homeTeam: String(row.home_team || '').trim(),
    awayScore,
    homeScore,
    location: String(row.location || '').trim() || 'Home',
    result,
    total,
    overtime: parseOptionalNumber(row.overtime),
    awayMoneyline: parseOptionalNumber(row.away_moneyline),
    homeMoneyline: parseOptionalNumber(row.home_moneyline),
    totalLine: parseOptionalNumber(row.total_line),
    underOdds: parseOptionalNumber(row.under_odds),
    overOdds: parseOptionalNumber(row.over_odds),
    awayRest: parseOptionalNumber(row.away_rest),
    homeRest: parseOptionalNumber(row.home_rest),
    divGame: parseOptionalNumber(row.div_game),
    roof: String(row.roof || '').trim().toLowerCase(),
    temp: parseOptionalNumber(row.temp),
    wind: parseOptionalNumber(row.wind),
    completed,
  }
}

export function isPlayoffGameType(gameType) {
  return PLAYOFF_GAME_TYPES.includes(String(gameType || '').toUpperCase())
}

export function filterStudyGames(games, {
  includePlayoffs = false,
  minSeason = null,
  maxSeason = null,
} = {}) {
  return (games || []).filter((game) => {
    if (!Number.isFinite(game.season)) return false
    if (minSeason != null && game.season < minSeason) return false
    if (maxSeason != null && game.season > maxSeason) return false
    if (game.gameType === REGULAR_SEASON_TYPE) return true
    if (includePlayoffs && isPlayoffGameType(game.gameType)) return true
    return false
  })
}

/**
 * Strict chronology for season-to-date features.
 * A prior game is used only when its gameday is earlier, or the same
 * gameday with both kickoff times present and the prior time earlier.
 * Missing times never count as "before" on the same date — that avoids
 * leaking same-slate results.
 */
export function isChronologicallyBefore(prior, game) {
  if (!prior?.gameday || !game?.gameday) return false
  if (prior.gameday < game.gameday) return true
  if (prior.gameday > game.gameday) return false
  if (prior.gametime && game.gametime) return prior.gametime < game.gametime
  return false
}

export function emptyTeamRecord() {
  return { ...EMPTY_RECORD }
}

export function applyGameToRecord(record, teamWon, tied) {
  const next = { ...record }
  next.gamesPlayed += 1
  if (tied) next.ties += 1
  else if (teamWon) next.wins += 1
  else next.losses += 1
  return next
}

/**
 * Season-to-date W-L-T for each team using only earlier completed games
 * in the same season. Ties increment gamesPlayed but not wins — the same
 * treatment as parsing an ESPN W-L-T string in the production heuristic.
 */
export function seasonToDateRecords(game, completedGames) {
  const season = game.season
  const records = {
    [game.homeTeam]: emptyTeamRecord(),
    [game.awayTeam]: emptyTeamRecord(),
  }

  for (const prior of completedGames) {
    if (prior.season !== season) continue
    if (prior.gameId === game.gameId) continue
    if (!prior.completed) continue
    if (!isChronologicallyBefore(prior, game)) continue

    const tied = prior.homeScore === prior.awayScore
    if (prior.homeTeam === game.homeTeam || prior.homeTeam === game.awayTeam) {
      records[prior.homeTeam] = applyGameToRecord(
        records[prior.homeTeam] || emptyTeamRecord(),
        prior.homeScore > prior.awayScore,
        tied,
      )
    }
    if (prior.awayTeam === game.homeTeam || prior.awayTeam === game.awayTeam) {
      records[prior.awayTeam] = applyGameToRecord(
        records[prior.awayTeam] || emptyTeamRecord(),
        prior.awayScore > prior.homeScore,
        tied,
      )
    }
  }

  return {
    home: records[game.homeTeam] || emptyTeamRecord(),
    away: records[game.awayTeam] || emptyTeamRecord(),
  }
}

export function sampleSizesBySeason(games) {
  const bySeason = new Map()
  for (const game of games) {
    const row = bySeason.get(game.season) || {
      season: game.season,
      scheduled: 0,
      completed: 0,
      regularSeason: 0,
      playoffs: 0,
      withClosingMl: 0,
      withTotalLine: 0,
      integerTotalLine: 0,
      ties: 0,
    }
    row.scheduled += 1
    if (game.gameType === REGULAR_SEASON_TYPE) row.regularSeason += 1
    if (isPlayoffGameType(game.gameType)) row.playoffs += 1
    if (game.completed) {
      row.completed += 1
      if (game.homeScore === game.awayScore) row.ties += 1
    }
    if (game.homeMoneyline != null && game.awayMoneyline != null) row.withClosingMl += 1
    if (game.totalLine != null) row.withTotalLine += 1
    if (game.totalLine != null && Number.isInteger(game.totalLine)) row.integerTotalLine += 1
    bySeason.set(game.season, row)
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season)
}

export function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo)
}

export function momentStats(values) {
  const n = values.length
  if (n === 0) {
    return { n: 0, mean: null, variance: null, sd: null, skewness: null, excessKurtosis: null }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / n
  if (n < 2) {
    return { n, mean, variance: null, sd: null, skewness: null, excessKurtosis: null }
  }
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const v of values) {
    const d = v - mean
    m2 += d * d
    m3 += d * d * d
    m4 += d * d * d * d
  }
  const variance = m2 / (n - 1)
  const sd = Math.sqrt(variance)
  const g1 = n < 3 || m2 === 0 ? null : (Math.sqrt(n) * m3) / (m2 ** 1.5)
  const g2 = n < 4 || m2 === 0 ? null : (n * m4) / (m2 * m2) - 3
  return { n, mean, variance, sd, skewness: g1, excessKurtosis: g2 }
}

/**
 * Empirical Normal parameters of completed game totals.
 * Label: empirical from nflverse, not production-validated for betting.
 */
export function fitEmpiricalTotalsDistribution(totals, { label = 'in_sample_descriptive' } = {}) {
  const values = (totals || []).filter((v) => Number.isFinite(v))
  const stats = momentStats(values)
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted.length ? sorted[0] : null
  const max = sorted.length ? sorted[sorted.length - 1] : null
  const diagnostics = totalsDiagnostics(sorted, stats)

  return {
    label,
    validationStatus: 'empirical_from_nflverse_not_production_validated',
    productionValidatedForBetting: false,
    distribution: 'normal_continuity_corrected',
    n: stats.n,
    mean: stats.mean,
    variance: stats.variance,
    sd: stats.sd,
    min,
    max,
    median: quantile(sorted, 0.5),
    q25: quantile(sorted, 0.25),
    q75: quantile(sorted, 0.75),
    skewness: stats.skewness,
    excessKurtosis: stats.excessKurtosis,
    diagnostics,
  }
}

function standardNormalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2))
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

function totalsDiagnostics(sorted, stats) {
  if (!sorted.length || !Number.isFinite(stats.mean) || !Number.isFinite(stats.sd) || !(stats.sd > 0)) {
    return {
      kolmogorovSmirnov: null,
      integerLinePush: [],
      histogram10pt: [],
    }
  }

  let ks = 0
  for (let i = 0; i < sorted.length; i++) {
    const ecdfLo = i / sorted.length
    const ecdfHi = (i + 1) / sorted.length
    const z = (sorted[i] - stats.mean) / stats.sd
    const cdf = standardNormalCdf(z)
    ks = Math.max(ks, Math.abs(ecdfHi - cdf), Math.abs(ecdfLo - cdf))
  }

  const integerLinePush = []
  for (let line = INTEGER_LINE_PUSH_MIN; line <= INTEGER_LINE_PUSH_MAX; line++) {
    const empirical = sorted.filter((v) => v === line).length / sorted.length
    const fitted = nflTotalOutcomeProbabilities({
      mean: stats.mean,
      variance: stats.variance,
      line,
    })
    integerLinePush.push({
      line,
      empiricalPPush: empirical,
      normalContinuityPPush: fitted.ok ? fitted.pPush : null,
    })
  }

  const histogram10pt = []
  const start = Math.floor((sorted[0] - 5) / 10) * 10
  const end = Math.ceil((sorted[sorted.length - 1] + 5) / 10) * 10
  for (let lo = start; lo < end; lo += 10) {
    const hi = lo + 10
    const observed = sorted.filter((v) => v >= lo && v < hi).length
    const zLo = (lo - stats.mean) / stats.sd
    const zHi = (hi - stats.mean) / stats.sd
    const expected = (standardNormalCdf(zHi) - standardNormalCdf(zLo)) * sorted.length
    histogram10pt.push({
      bin: `${lo}-${hi - 1}`,
      observed,
      expectedNormal: expected,
    })
  }

  return { kolmogorovSmirnov: ks, integerLinePush, histogram10pt }
}

export function chronologicalTotalsFits(completedGames, { minTrain = TOTALS_OOS_MIN_TRAIN } = {}) {
  const bySeason = new Map()
  for (const game of completedGames) {
    if (!Number.isFinite(game.total)) continue
    const list = bySeason.get(game.season) || []
    list.push(game)
    bySeason.set(game.season, list)
  }

  const seasons = [...bySeason.keys()].sort((a, b) => a - b)
  const holdouts = []
  for (const season of seasons) {
    const trainGames = completedGames.filter((game) => game.season < season && Number.isFinite(game.total))
    if (trainGames.length < minTrain) continue
    const trainTotals = trainGames.map((game) => game.total)
    const holdoutGames = bySeason.get(season) || []
    const holdoutTotals = holdoutGames.map((game) => game.total).filter(Number.isFinite)
    if (!holdoutTotals.length) continue

    const fit = fitEmpiricalTotalsDistribution(trainTotals, {
      label: `oos_train_before_season_${season}`,
    })
    const holdoutMean = holdoutTotals.reduce((sum, v) => sum + v, 0) / holdoutTotals.length
    const maeVsTrainMean = holdoutTotals.reduce((sum, v) => sum + Math.abs(v - fit.mean), 0) / holdoutTotals.length

    let logLik = 0
    const twoPiVar = 2 * Math.PI * fit.variance
    for (const total of holdoutTotals) {
      const z = total - fit.mean
      logLik += -0.5 * (Math.log(twoPiVar) + (z * z) / fit.variance)
    }

    const integerLineGames = holdoutGames.filter((game) => (
      game.totalLine != null && Number.isInteger(game.totalLine) && Number.isFinite(game.total)
    ))
    let empiricalPushes = 0
    let predictedPushMass = 0
    for (const game of integerLineGames) {
      if (game.total === game.totalLine) empiricalPushes += 1
      const fitted = nflTotalOutcomeProbabilities({
        mean: fit.mean,
        variance: fit.variance,
        line: game.totalLine,
      })
      if (fitted.ok) predictedPushMass += fitted.pPush
    }

    holdouts.push({
      holdoutSeason: season,
      nTrain: trainTotals.length,
      nHoldout: holdoutTotals.length,
      trainMean: fit.mean,
      trainSd: fit.sd,
      holdoutMean,
      maeVsTrainMean,
      holdoutNormalLogLik: logLik,
      nIntegerClosingLines: integerLineGames.length,
      empiricalIntegerPushRate: integerLineGames.length ? empiricalPushes / integerLineGames.length : null,
      predictedIntegerPushRate: integerLineGames.length ? predictedPushMass / integerLineGames.length : null,
      trainFit: fit,
    })
  }

  return holdouts
}

function clipProbability(p) {
  if (!Number.isFinite(p)) return null
  return Math.min(1 - PROBABILITY_CLIP, Math.max(PROBABILITY_CLIP, p))
}

export function binaryLogLoss(y, p) {
  const prob = clipProbability(p)
  if (prob == null || (y !== 0 && y !== 1)) return null
  return -(y * Math.log(prob) + (1 - y) * Math.log(1 - prob))
}

export function brierScore(y, p) {
  const prob = clipProbability(p)
  if (prob == null || (y !== 0 && y !== 1)) return null
  const d = prob - y
  return d * d
}

export function flatStakeProfit(won, americanOdds, { push = false } = {}) {
  if (push) return 0
  const decimal = toDecimalOdds(americanOdds)
  if (decimal == null || decimal <= 1) return null
  return won ? decimal - 1 : -1
}

export function summarizeStakeSeries(profits) {
  const values = (profits || []).filter((v) => Number.isFinite(v))
  const n = values.length
  const profit = values.reduce((sum, v) => sum + v, 0)
  return {
    n,
    profit,
    roi: n ? profit / n : null,
  }
}

function mean(values) {
  const finite = values.filter((v) => Number.isFinite(v))
  if (!finite.length) return null
  return finite.reduce((sum, v) => sum + v, 0) / finite.length
}

/**
 * Documented moneyline baseline: season-to-date win% with the production
 * shrinkage prior and conventional home-field logit. Compared to nflverse
 * closing moneylines (not The Odds API).
 */
export function evaluateMoneylineBaseline(games, {
  minTeamGames = DEFAULT_MIN_TEAM_GAMES,
} = {}) {
  const completed = games.filter((game) => game.completed)
  const evaluations = []

  for (const game of games) {
    if (!game.completed) continue
    if (game.homeMoneyline == null || game.awayMoneyline == null) continue

    const prior = seasonToDateRecords(game, completed)
    const homeGames = prior.home.gamesPlayed
    const awayGames = prior.away.gamesPlayed
    if (homeGames < minTeamGames || awayGames < minTeamGames) continue

    const homeShrunk = shrinkSeasonWinPct(prior.home.wins, prior.home.gamesPlayed)
    const awayShrunk = shrinkSeasonWinPct(prior.away.wins, prior.away.gamesPlayed)
    const model = twoWayHomeWinProbability(homeShrunk, awayShrunk)
    if (!model) continue

    const market = removeMlVig(game.homeMoneyline, game.awayMoneyline)
    const tied = game.homeScore === game.awayScore
    const homeWon = game.homeScore > game.awayScore
    const yHome = tied ? null : (homeWon ? 1 : 0)

    const modelLogLoss = yHome == null ? null : binaryLogLoss(yHome, model.pHomeWin)
    const marketLogLoss = yHome == null ? null : binaryLogLoss(yHome, market.homeFairProb)
    const modelBrier = yHome == null ? null : brierScore(yHome, model.pHomeWin)
    const marketBrier = yHome == null ? null : brierScore(yHome, market.homeFairProb)

    const homeDec = toDecimalOdds(game.homeMoneyline)
    const awayDec = toDecimalOdds(game.awayMoneyline)
    const evHome = estimatedEvAtDecimalOdds(model.pHomeWin, model.pAwayWin, homeDec)
    const evAway = estimatedEvAtDecimalOdds(model.pAwayWin, model.pHomeWin, awayDec)

    const modelSide = model.pHomeWin > 0.5 ? 'home' : (model.pHomeWin < 0.5 ? 'away' : null)
    let valueSide = null
    if (evHome != null && evAway != null) {
      if (evHome > 0 && evHome >= evAway) valueSide = 'home'
      else if (evAway > 0 && evAway > evHome) valueSide = 'away'
    }

    const marketImpliedHome = 1 / homeDec
    const marketImpliedAway = 1 / awayDec
    let marketFavorite = null
    if (Number.isFinite(marketImpliedHome) && Number.isFinite(marketImpliedAway)) {
      if (marketImpliedHome > marketImpliedAway) marketFavorite = 'home'
      else if (marketImpliedAway > marketImpliedHome) marketFavorite = 'away'
    }

    evaluations.push({
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      gameday: game.gameday,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homePrior: prior.home,
      awayPrior: prior.away,
      homeShrunkWinPct: homeShrunk,
      awayShrunkWinPct: awayShrunk,
      modelPHome: model.pHomeWin,
      modelPAway: model.pAwayWin,
      marketFairPHome: market.homeFairProb,
      marketFairPAway: market.awayFairProb,
      homeMoneyline: game.homeMoneyline,
      awayMoneyline: game.awayMoneyline,
      tied,
      yHome,
      modelLogLoss,
      marketLogLoss,
      modelBrier,
      marketBrier,
      evHome,
      evAway,
      modelSide,
      valueSide,
      marketFavorite,
      modelPreferredProfit: modelSide
        ? flatStakeProfit(
          modelSide === 'home' ? homeWon : !homeWon && !tied,
          modelSide === 'home' ? game.homeMoneyline : game.awayMoneyline,
          { push: tied },
        )
        : null,
      valueBetProfit: valueSide
        ? flatStakeProfit(
          valueSide === 'home' ? homeWon : !homeWon && !tied,
          valueSide === 'home' ? game.homeMoneyline : game.awayMoneyline,
          { push: tied },
        )
        : null,
      marketFavoriteProfit: marketFavorite
        ? flatStakeProfit(
          marketFavorite === 'home' ? homeWon : !homeWon && !tied,
          marketFavorite === 'home' ? game.homeMoneyline : game.awayMoneyline,
          { push: tied },
        )
        : null,
    })
  }

  const decisive = evaluations.filter((row) => !row.tied)
  const bySeasonMap = new Map()
  for (const row of evaluations) {
    const list = bySeasonMap.get(row.season) || []
    list.push(row)
    bySeasonMap.set(row.season, list)
  }

  return {
    baseline: 'season_to_date_win_pct_shrinkage_plus_conventional_hfa',
    shrinkage: {
      priorWins: NFL_WIN_PCT_PRIOR_WINS,
      priorGames: NFL_WIN_PCT_PRIOR_GAMES,
      formula: 'pHat = (wins + 8) / (gamesPlayed + 16)',
    },
    homeFieldLogit: NFL_HFA_LOGIT,
    homeFieldNote: 'Conventional ~53% home logit from the unvalidated production heuristic. Not fitted here.',
    minTeamGames,
    nEvaluated: evaluations.length,
    nDecisive: decisive.length,
    nTies: evaluations.length - decisive.length,
    logLoss: {
      model: mean(decisive.map((row) => row.modelLogLoss)),
      market: mean(decisive.map((row) => row.marketLogLoss)),
      n: decisive.filter((row) => row.modelLogLoss != null && row.marketLogLoss != null).length,
    },
    brier: {
      model: mean(decisive.map((row) => row.modelBrier)),
      market: mean(decisive.map((row) => row.marketBrier)),
      n: decisive.filter((row) => row.modelBrier != null && row.marketBrier != null).length,
    },
    flatStake: {
      definition: {
        stake: '1 unit',
        win: 'decimalOdds - 1',
        loss: '-1',
        push: '0 (regular-season tie refunds the stake)',
        modelPreferred: 'Bet the side with model P > 0.5. Skip exact 0.5.',
        modelPositiveEv: 'Bet the side with estimated EV > 0 at the closing price. Skip if both <= 0.',
        marketFavorite: 'Bet the closing favorite by raw implied probability. Comparison baseline, not a model.',
      },
      modelPreferred: summarizeStakeSeries(evaluations.map((row) => row.modelPreferredProfit)),
      modelPositiveEv: summarizeStakeSeries(evaluations.map((row) => row.valueBetProfit)),
      marketFavorite: summarizeStakeSeries(evaluations.map((row) => row.marketFavoriteProfit)),
    },
    calibration: calibrationTable(decisive),
    bySeason: [...bySeasonMap.entries()].sort((a, b) => a[0] - b[0]).map(([season, rows]) => {
      const dec = rows.filter((row) => !row.tied)
      return {
        season,
        nEvaluated: rows.length,
        nDecisive: dec.length,
        logLossModel: mean(dec.map((row) => row.modelLogLoss)),
        logLossMarket: mean(dec.map((row) => row.marketLogLoss)),
        brierModel: mean(dec.map((row) => row.modelBrier)),
        brierMarket: mean(dec.map((row) => row.marketBrier)),
        modelPreferred: summarizeStakeSeries(rows.map((row) => row.modelPreferredProfit)),
        modelPositiveEv: summarizeStakeSeries(rows.map((row) => row.valueBetProfit)),
      }
    }),
    evaluations,
  }
}

function calibrationTable(decisive) {
  const bins = [
    { label: '[0.00, 0.40)', lo: 0, hi: 0.40 },
    { label: '[0.40, 0.50)', lo: 0.40, hi: 0.50 },
    { label: '[0.50, 0.60)', lo: 0.50, hi: 0.60 },
    { label: '[0.60, 1.00]', lo: 0.60, hi: 1.000001 },
  ]
  return bins.map((bin) => {
    const rows = decisive.filter((row) => row.modelPHome >= bin.lo && row.modelPHome < bin.hi)
    return {
      bin: bin.label,
      n: rows.length,
      meanModelPHome: mean(rows.map((row) => row.modelPHome)),
      meanMarketPHome: mean(rows.map((row) => row.marketFairPHome)),
      homeWinRate: rows.length ? rows.filter((row) => row.yHome === 1).length / rows.length : null,
    }
  })
}

export function closingTotalLineDiagnostics(completedGames, totalsFit) {
  const withLine = completedGames.filter((game) => game.totalLine != null && Number.isFinite(game.total))
  const integerLine = withLine.filter((game) => Number.isInteger(game.totalLine))
  const pushes = integerLine.filter((game) => game.total === game.totalLine)
  let predicted = 0
  if (totalsFit?.variance > 0) {
    for (const game of integerLine) {
      const fitted = nflTotalOutcomeProbabilities({
        mean: totalsFit.mean,
        variance: totalsFit.variance,
        line: game.totalLine,
      })
      if (fitted.ok) predicted += fitted.pPush
    }
  }
  const absError = withLine.map((game) => Math.abs(game.total - game.totalLine))
  return {
    nWithClosingTotalLine: withLine.length,
    nIntegerClosingTotalLine: integerLine.length,
    empiricalIntegerPushRate: integerLine.length ? pushes.length / integerLine.length : null,
    predictedIntegerPushRate: integerLine.length && totalsFit?.variance > 0
      ? predicted / integerLine.length
      : null,
    meanAbsTotalVsLine: mean(absError),
    meanClosingLine: mean(withLine.map((game) => game.totalLine)),
    meanGameTotal: mean(withLine.map((game) => game.total)),
  }
}

export function runNflverseGamesStudy({
  csvText,
  games: providedGames = null,
  includePlayoffs = false,
  minSeason = null,
  maxSeason = null,
  minTeamGames = DEFAULT_MIN_TEAM_GAMES,
  totalsOosMinTrain = TOTALS_OOS_MIN_TRAIN,
  sourceUrl = null,
  sourcePath = null,
} = {}) {
  const parsed = providedGames || parseNflverseGames(csvText || '')
  const filtered = filterStudyGames(parsed, { includePlayoffs, minSeason, maxSeason })
  const completed = filtered.filter((game) => game.completed)
  const completedTotals = completed
    .map((game) => game.total)
    .filter((value) => Number.isFinite(value))

  const totalsInSample = fitEmpiricalTotalsDistribution(completedTotals, {
    label: 'in_sample_descriptive_all_filtered_completed_games',
  })
  const totalsOos = chronologicalTotalsFits(completed, { minTrain: totalsOosMinTrain })
  const totalsVsMarket = closingTotalLineDiagnostics(completed, totalsInSample)
  const moneyline = evaluateMoneylineBaseline(filtered, { minTeamGames })
  const sizes = sampleSizesBySeason(filtered)

  for (const row of sizes) {
    row.mlEvaluable = moneyline.bySeason.find((season) => season.season === row.season)?.nEvaluated || 0
  }

  return {
    study: 'nflverse-games-offline-study',
    generatedAt: new Date().toISOString(),
    constraints: { ...NFLVERSE_STUDY_CONSTRAINTS },
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
      totalsOosMinTrain,
    },
    sampleSizes: sizes,
    totals: {
      disclaimer: 'Empirical from nflverse game scores. Not production-validated for betting. Production NFL totals stay ineligible (missing_validated_scoring_distribution).',
      inSample: totalsInSample,
      chronologicalOos: totalsOos,
      versusClosingLine: totalsVsMarket,
    },
    moneyline,
  }
}

function fmt(value, digits = 4) {
  if (value == null || Number.isNaN(value)) return '—'
  if (typeof value === 'number' && Number.isInteger(value) && digits === 0) return String(value)
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

export function renderStudyMarkdown(result) {
  const src = result.source || {}
  const ml = result.moneyline || {}
  const totals = result.totals || {}
  const inSample = totals.inSample || {}
  const vsLine = totals.versusClosingLine || {}

  const sizeRows = (result.sampleSizes || []).map((row) => [
    row.season,
    row.scheduled,
    row.completed,
    row.regularSeason,
    row.playoffs,
    row.withClosingMl,
    row.mlEvaluable,
    row.withTotalLine,
    row.integerTotalLine,
    row.ties,
  ])

  const oosRows = (totals.chronologicalOos || []).map((row) => [
    row.holdoutSeason,
    row.nTrain,
    row.nHoldout,
    fmt(row.trainMean, 2),
    fmt(row.trainSd, 2),
    fmt(row.holdoutMean, 2),
    fmt(row.maeVsTrainMean, 2),
    fmt(row.empiricalIntegerPushRate, 4),
    fmt(row.predictedIntegerPushRate, 4),
  ])

  const pushRows = (inSample.diagnostics?.integerLinePush || [])
    .filter((row) => row.line % 2 === 0)
    .map((row) => [
      row.line,
      fmt(row.empiricalPPush, 4),
      fmt(row.normalContinuityPPush, 4),
    ])

  const mlSeasonRows = (ml.bySeason || []).map((row) => [
    row.season,
    row.nEvaluated,
    row.nDecisive,
    fmt(row.logLossModel, 4),
    fmt(row.logLossMarket, 4),
    fmt(row.brierModel, 4),
    fmt(row.brierMarket, 4),
    fmtPct(row.modelPreferred?.roi),
    row.modelPreferred?.n ?? 0,
    fmtPct(row.modelPositiveEv?.roi),
    row.modelPositiveEv?.n ?? 0,
  ])

  const calRows = (ml.calibration || []).map((row) => [
    row.bin,
    row.n,
    fmt(row.meanModelPHome, 3),
    fmt(row.meanMarketPHome, 3),
    fmt(row.homeWinRate, 3),
  ])

  return `# nflverse offline games study (research only)

**Empirical from nflverse / Lee Sharpe \`games.csv\`. Not production-validated for betting.**

This artifact is a read-only study. It does **not** enable public NFL selections, call The Odds API, write production Supabase, regrade picks, or merge.

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
- SHA-256 of the CSV text: \`${src.sha256 || '—'}\`
- Parsed rows: **${src.parsedRows ?? '—'}**
- Filtered rows: **${src.filteredRows ?? '—'}** (regular season${src.includePlayoffs ? ' + playoffs' : ' only'})
- Completed rows: **${src.completedRows ?? '—'}**
- Season window: ${src.minSeason ?? 'min available'}–${src.maxSeason ?? 'max available'}
- Moneyline eligibility floor: both teams have **${src.minTeamGames}** prior same-season games (matches \`NFL_MIN_GAMES_FOR_RESEARCH_ML\`)

Unplayed games (missing scores) are excluded from totals fits and moneyline scoring. 2026 rows in a live nflverse file are typically scheduled-only.

## Methods

### Filters

1. Keep \`game_type = REG\`. Playoffs (\`WC\`, \`DIV\`, \`CON\`, \`SB\`) are off unless \`--include-playoffs\`.
2. Preseason is not present in this file and is never added.
3. Chronology uses \`gameday\` then \`gametime\`. A prior game counts only when it is strictly earlier. Same-day games without both kickoff times do **not** update each other (no same-slate leakage).

### Totals distribution

Completed game totals (home score + away score) are summarized as a Normal(mean, variance) and discretized with the production continuity correction (\`nflTotalOutcomeProbabilities\`). Integer line L: estimated P(push) = P(T = L). Half-lines have zero push mass.

**This is an empirical nflverse description, not a production-validated betting model.** Production continues to refuse NFL totals (\`missing_validated_scoring_distribution\`). These parameters are not written into \`EdgeSnapshot\` and are not injected into live selection.

Chronological OOS: for holdout season S, fit on seasons before S only (n_train >= ${TOTALS_OOS_MIN_TRAIN}).

### Moneyline baseline

Walk-forward season-to-date win percentage, then the unvalidated production shrinkage and home-field logit:

\`\`\`
pHat = (wins + ${NFL_WIN_PCT_PRIOR_WINS}) / (gamesPlayed + ${NFL_WIN_PCT_PRIOR_GAMES})
logit = log(pHat_home / (1 - pHat_home)) - log(pHat_away / (1 - pHat_away)) + ${NFL_HFA_LOGIT}
P(home) = 1 / (1 + exp(-logit))
P(tie)  = 0
\`\`\`

Ties increment \`gamesPlayed\` but not wins (same as parsing an ESPN W-L-T string). Closing moneylines are nflverse consensus closes, **not** Odds API quotes. Market probabilities are proportional de-vig (\`removeMlVig\`).

Log-loss and Brier are computed on **decisive** games only (two-way market is conditional on no tie). Ties are scored as pushes in ROI.

### Flat-stake ROI

Stake is **1 unit** at the nflverse closing American price.

| Rule | Bet | Skip |
| --- | --- | --- |
| Model preferred | Side with model P > 0.5 | Exact 0.5 |
| Model +EV | Side with estimated EV > 0 at the close | Both EV <= 0 |
| Market favorite | Closing favorite by raw implied probability | Even implied |

Profit: win = \`decimalOdds - 1\`, loss = \`-1\`, push (tie) = \`0\`. ROI = total profit / number of bets. These are historical closes, not a live betting system.

## Sample sizes by season

${markdownTable(
    ['Season', 'Scheduled', 'Completed', 'REG', 'Playoffs', 'With ML', 'ML evaluable', 'With total line', 'Integer line', 'Ties'],
    sizeRows,
  )}

ML evaluable = completed + both closing moneylines + both teams have at least ${src.minTeamGames} prior same-season games.

## Empirical game-total distribution

**Label: empirical from nflverse, not production-validated for betting.**

| Parameter | Value |
| --- | --- |
| n | ${inSample.n ?? '—'} |
| mean | ${fmt(inSample.mean, 3)} |
| variance (n−1) | ${fmt(inSample.variance, 3)} |
| sd | ${fmt(inSample.sd, 3)} |
| min / q25 / median / q75 / max | ${fmt(inSample.min, 1)} / ${fmt(inSample.q25, 1)} / ${fmt(inSample.median, 1)} / ${fmt(inSample.q75, 1)} / ${fmt(inSample.max, 1)} |
| skewness | ${fmt(inSample.skewness, 3)} |
| excess kurtosis | ${fmt(inSample.excessKurtosis, 3)} |
| KS vs Normal | ${fmt(inSample.diagnostics?.kolmogorovSmirnov, 4)} |
| Status | \`${inSample.validationStatus || 'empirical_from_nflverse_not_production_validated'}\` |

### Integer-line push handling

NFL scores are integers, so a posted integer total can push. Half-points cannot.

| Closing-line diagnostic | Value |
| --- | --- |
| Games with a closing total line | ${vsLine.nWithClosingTotalLine ?? '—'} |
| Integer closing lines | ${vsLine.nIntegerClosingTotalLine ?? '—'} |
| Empirical P(push \\| integer line) | ${fmt(vsLine.empiricalIntegerPushRate, 4)} |
| Normal continuity-corrected mean P(push) at those lines | ${fmt(vsLine.predictedIntegerPushRate, 4)} |
| Mean game total | ${fmt(vsLine.meanGameTotal, 2)} |
| Mean closing total line | ${fmt(vsLine.meanClosingLine, 2)} |
| MAE(game total, closing line) | ${fmt(vsLine.meanAbsTotalVsLine, 2)} |

Even-integer slice of P(T = L) vs the fitted Normal (in-sample, descriptive):

${pushRows.length ? markdownTable(['Line L', 'Empirical P(T=L)', 'Normal P(T=L)'], pushRows) : '_Insufficient totals to tabulate._'}

### Chronological out-of-sample totals (fit on earlier seasons only)

${oosRows.length ? markdownTable(
    ['Holdout', 'n train', 'n holdout', 'Train μ', 'Train σ', 'Holdout μ', 'MAE vs train μ', 'Emp. int. push', 'Pred. int. push'],
    oosRows,
  ) : '_Not enough earlier-season games to run a chronological totals split._'}

## Moneyline baseline vs nflverse closes

Evaluated games: **${ml.nEvaluated ?? 0}** (decisive **${ml.nDecisive ?? 0}**, ties **${ml.nTies ?? 0}**).

| Score | Model | Market (de-vig close) | n |
| --- | --- | --- | --- |
| Log-loss (lower is better) | ${fmt(ml.logLoss?.model, 4)} | ${fmt(ml.logLoss?.market, 4)} | ${ml.logLoss?.n ?? 0} |
| Brier (lower is better) | ${fmt(ml.brier?.model, 4)} | ${fmt(ml.brier?.market, 4)} | ${ml.brier?.n ?? 0} |

A higher model log-loss or Brier than the market means this shrinkage baseline is **worse** than the close as a probability. That is an expected result for a season-record heuristic.

### Flat-stake ROI (1 unit at the close)

| Rule | n bets | Profit (u) | ROI |
| --- | --- | --- | --- |
| Model preferred (P > 0.5) | ${ml.flatStake?.modelPreferred?.n ?? 0} | ${fmt(ml.flatStake?.modelPreferred?.profit, 2)} | ${fmtPct(ml.flatStake?.modelPreferred?.roi)} |
| Model +EV at the close | ${ml.flatStake?.modelPositiveEv?.n ?? 0} | ${fmt(ml.flatStake?.modelPositiveEv?.profit, 2)} | ${fmtPct(ml.flatStake?.modelPositiveEv?.roi)} |
| Market favorite (comparison) | ${ml.flatStake?.marketFavorite?.n ?? 0} | ${fmt(ml.flatStake?.marketFavorite?.profit, 2)} | ${fmtPct(ml.flatStake?.marketFavorite?.roi)} |

### Coarse calibration (decisive games, model P(home))

${calRows.length ? markdownTable(['Bin', 'n', 'Mean model P', 'Mean market P', 'Home win rate'], calRows) : '_No decisive evaluations._'}

### By season

${mlSeasonRows.length ? markdownTable(
    ['Season', 'n', 'Decisive', 'LL model', 'LL mkt', 'Brier model', 'Brier mkt', 'Pref ROI', 'Pref n', '+EV ROI', '+EV n'],
    mlSeasonRows,
  ) : '_No moneyline evaluations (need closing moneylines and four prior games per team)._'}

## Limitations

- **Not a green light for the public board.** \`eligibleForPublic\` stays false. This study does not change enable switches.
- Closing moneylines and totals are nflverse / Lee Sharpe consensus history, not the sportsbook quote the site would store from The Odds API. Do not treat these as CLV versus our production books.
- No quarterbacks, injuries, weather, rest beyond what is implicit in W-L, or efficiency metrics.
- Home-field \`0.12\` logit is conventional, not fitted. Neutral-site games still receive it when playoffs are included.
- Early-season games are dropped until both clubs have ${src.minTeamGames} prior games. That matches the production floor; it is not a claim that n ≥ ${src.minTeamGames} is sufficient.
- Moneyline coverage in nflverse is sparse before 2010. Sample-size columns show the holes; they are not filled in.
- The Normal totals fit ignores discrete scoring (3s, 7s, 8s) beyond a continuity correction. KS and push-rate gaps are expected.
- ROI uses closes, so it is not a bettable pre-game edge and includes vig. Honest losing ROIs are reported as-is.
- No paid data was used. **Ask before adding any paid feed.**

## How to rerun

See \`docs/research/README.md\`. Default path:

\`\`\`bash
node scripts/research/nflverse-games-study.js --input /path/to/games.csv
\`\`\`

CI uses \`scripts/research/fixtures/nflverse-games-snippet.csv\` and does not touch the network.
`
}

export function parseStudyArgs(argv = []) {
  const args = {
    input: null,
    url: NFLVERSE_GAMES_URL,
    cache: null,
    includePlayoffs: false,
    minSeason: null,
    maxSeason: null,
    minTeamGames: DEFAULT_MIN_TEAM_GAMES,
    report: 'docs/research/nflverse-games-study.md',
    json: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--include-playoffs') {
      args.includePlayoffs = true
      continue
    }
    if (token === '--input' && next) {
      args.input = next
      i += 1
      continue
    }
    if (token === '--url' && next) {
      args.url = next
      i += 1
      continue
    }
    if (token === '--cache' && next) {
      args.cache = next
      i += 1
      continue
    }
    if (token === '--min-season' && next) {
      args.minSeason = Number(next)
      i += 1
      continue
    }
    if (token === '--max-season' && next) {
      args.maxSeason = Number(next)
      i += 1
      continue
    }
    if (token === '--min-team-games' && next) {
      args.minTeamGames = Number(next)
      i += 1
      continue
    }
    if (token === '--report' && next) {
      args.report = next
      i += 1
      continue
    }
    if (token === '--json' && next) {
      args.json = next
      i += 1
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
    }
  }

  return args
}
