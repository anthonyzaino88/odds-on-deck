/**
 * Walk-forward game-line backtest.
 *
 * Replays each game using only rows timestamped at or before that game's
 * pick-lock. Scores frozen model probabilities against the saved no-vig
 * close. Read-only. Zero Odds API credits.
 *
 * See docs/game-line-model-rules.md.
 */

import { clvFromOdds, CLOSE_QUOTE_BOOK_ORDER } from './closing-line.js'
import { calculateNHLEdges, NHL_MODEL_VERSION } from './edge-nfl-nhl.js'
import { calculateGameEdges, MODEL_VERSION as MLB_MODEL_VERSION } from './edge.js'
import {
  CLOSE_MIN_LEAD_MINUTES,
  CLOSE_WINDOW_MINUTES,
  FORBIDDEN_LOOKAHEAD,
  GAME_LINE_MARKETS_IN_SCOPE,
  GAME_LINE_SPORTS_IN_SCOPE,
  LOCK_QUOTE_MAX_AGE_MS,
  LOG_LOSS_CLIP,
  PICK_LOCK_LEAD_MS,
  PROB_SUM_TOLERANCE,
  PUBLISH_MIN_AVG_CLV,
  PUBLISH_MIN_BEAT_CLOSE_SHARE,
  PUBLISH_MIN_DEV_FOLDS,
  PUBLISH_MIN_HOLDOUT_FOLDS,
  PUBLISH_MIN_SAMPLE,
  publishBarsStatus,
  sampleSizeStatus,
  splitWalkForwardFolds,
} from './game-line-model-rules.js'
import { LINE_SHOP_STALE_AFTER_MS } from './line-shopping.js'
import {
  calculateNFLSelection,
  NFL_SELECTION_MODEL_V101,
  NFL_SELECTION_MODEL_VERSION,
  parseTimestamp,
} from './nfl-selection-model.js'
import {
  buildNflPregameFeatures,
  frozenStartMs,
  gamesAvailableBeforeLock,
  isAtOrBeforeLock,
  isFinalStatus,
  rebuildTeamSeasonStats,
} from './nfl-pregame-features.js'
import { impliedProbabilityFromOdds } from './odds-units.js'

export {
  FORBIDDEN_LOOKAHEAD,
  GAME_LINE_MARKETS_IN_SCOPE,
  GAME_LINE_SPORTS_IN_SCOPE,
  NFL_SELECTION_MODEL_VERSION,
  NHL_MODEL_VERSION,
  MLB_MODEL_VERSION,
  PUBLISH_MIN_SAMPLE,
  sampleSizeStatus,
  publishBarsStatus,
  splitWalkForwardFolds,
}

const CLVCLOSE_PREFIX = 'clvclose:'
const ET = 'America/New_York'

export function parseBacktestArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => String(arg).startsWith('--')))
  const take = (name) => {
    const i = argv.indexOf(name)
    if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) return argv[i + 1]
    return null
  }
  const summary = flags.has('--summary') || flags.has('--dry-run') || !flags.has('--verbose')
  return {
    dryRun: flags.has('--dry-run') || flags.has('--summary') || summary,
    summary,
    verbose: flags.has('--verbose'),
    help: flags.has('--help') || flags.has('-h'),
    sport: (take('--sport') || 'all').toLowerCase(),
    market: (take('--market') || 'all').toLowerCase(),
    model: take('--model') || null,
  }
}

export function noVigPair(priceSide, priceOther) {
  const qSide = impliedProbabilityFromOdds(priceSide)
  const qOther = impliedProbabilityFromOdds(priceOther)
  if (qSide == null || qOther == null) return null
  const sum = qSide + qOther
  if (!(sum > 0)) return null
  return {
    side: qSide / sum,
    other: qOther / sum,
    underround: sum <= 1,
    sum,
  }
}

export function clipLogLossProb(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return null
  return Math.min(1 - LOG_LOSS_CLIP, Math.max(LOG_LOSS_CLIP, n))
}

export function logLoss(p, y) {
  const prob = clipLogLossProb(p)
  if (prob == null || (y !== 0 && y !== 1)) return null
  return -(y * Math.log(prob) + (1 - y) * Math.log(1 - prob))
}

export function brierScore(p, y) {
  const n = Number(p)
  if (!Number.isFinite(n) || (y !== 0 && y !== 1)) return null
  const clamped = Math.min(1, Math.max(0, n))
  return (clamped - y) ** 2
}

function bookRank(book) {
  const key = String(book || '').toLowerCase().trim()
  const index = CLOSE_QUOTE_BOOK_ORDER.indexOf(key)
  return index === -1 ? CLOSE_QUOTE_BOOK_ORDER.length : index
}

function normalizeMarketName(market) {
  const value = String(market || '').toLowerCase().trim()
  if (value === 'h2h' || value === 'ml' || value === 'moneyline') return 'moneyline'
  if (value === 'total' || value === 'totals') return 'totals'
  if (value === 'spread' || value === 'spreads') return 'spreads'
  return value || null
}

function oddsMarketKey(market) {
  const value = normalizeMarketName(market)
  if (value === 'moneyline') return 'h2h'
  return value
}

function hasPairedPrices(row, market) {
  const key = normalizeMarketName(market || row?.market)
  if (key === 'totals') {
    return Number.isFinite(Number(row?.priceHome))
      && Number.isFinite(Number(row?.priceAway))
      && Number.isFinite(Number(row?.total ?? row?.line))
  }
  if (key === 'spreads') {
    return Number.isFinite(Number(row?.priceHome))
      && Number.isFinite(Number(row?.priceAway))
      && Number.isFinite(Number(row?.spread ?? row?.line))
  }
  return Number.isFinite(Number(row?.priceHome)) && Number.isFinite(Number(row?.priceAway))
}

function quoteMs(row) {
  return parseTimestamp(row?.quotedAt || row?.quoted_at)
}

function captureMs(row) {
  return parseTimestamp(row?.ts || row?.snapshotAt || row?.snapshot_at || row?.capturedAt)
}

function isEligibleLockQuote(row, startMs, market) {
  if (!hasPairedPrices(row, market)) return false
  const capture = captureMs(row)
  const quote = quoteMs(row)
  if (capture == null || quote == null) return false
  if (quote > capture) return false
  if (quote >= startMs) return false
  if (capture >= startMs) return false
  if (capture - quote > (LOCK_QUOTE_MAX_AGE_MS || LINE_SHOP_STALE_AFTER_MS)) return false
  if (capture > startMs - PICK_LOCK_LEAD_MS) return false
  return true
}

function isEligibleCloseQuote(row, startMs, market) {
  if (!hasPairedPrices(row, market)) return false
  const capture = captureMs(row)
  const quote = quoteMs(row)
  if (capture == null || quote == null) return false
  if (quote > capture) return false
  if (quote >= startMs) return false
  if (capture >= startMs) return false
  const minLead = CLOSE_MIN_LEAD_MINUTES * 60 * 1000
  const window = CLOSE_WINDOW_MINUTES * 60 * 1000
  if (quote < startMs - window || quote > startMs - minLead) return false
  return true
}

function compareLockQuotes(a, b) {
  const cap = (captureMs(b) || 0) - (captureMs(a) || 0)
  if (cap) return cap
  const q = (quoteMs(b) || 0) - (quoteMs(a) || 0)
  if (q) return q
  return String(a.id || '').localeCompare(String(b.id || ''))
}

function compareCloseQuotes(a, b) {
  const aClose = String(a.id || '').startsWith(CLVCLOSE_PREFIX) ? 1 : 0
  const bClose = String(b.id || '').startsWith(CLVCLOSE_PREFIX) ? 1 : 0
  if (bClose !== aClose) return bClose - aClose
  const cap = (captureMs(b) || 0) - (captureMs(a) || 0)
  if (cap) return cap
  const q = (quoteMs(b) || 0) - (quoteMs(a) || 0)
  if (q) return q
  const book = bookRank(a.book) - bookRank(b.book)
  if (book) return book
  return String(a.id || '').localeCompare(String(b.id || ''))
}

export function pickLockTime(game, oddsRows, { market = 'moneyline' } = {}) {
  const start = frozenStartMs(game)
  if (start == null) return { lockAt: null, quote: null, reason: 'missing_start' }
  const key = oddsMarketKey(market)
  const candidates = (Array.isArray(oddsRows) ? oddsRows : [])
    .filter((row) => String(row.gameId) === String(game.id))
    .filter((row) => oddsMarketKey(row.market) === key)
    .filter((row) => isEligibleLockQuote(row, start, market))
    .sort(compareLockQuotes)
  const quote = candidates[0] || null
  if (!quote) return { lockAt: null, quote: null, reason: 'no_lock_quote', start }
  const lockAt = new Date(captureMs(quote)).toISOString()
  return { lockAt, quote, reason: null, start }
}

export function selectCloseQuote(closingRows, { game, market = 'moneyline', lockLine = null } = {}) {
  const start = frozenStartMs(game)
  if (start == null) return { quote: null, reason: 'missing_start' }
  const key = oddsMarketKey(market)
  const candidates = (Array.isArray(closingRows) ? closingRows : [])
    .filter((row) => String(row.gameId || row.game_id) === String(game.id))
    .filter((row) => oddsMarketKey(row.market) === key)
    .filter((row) => isEligibleCloseQuote(row, start, market))
    .sort(compareCloseQuotes)
  const quote = candidates[0] || null
  if (!quote) return { quote: null, reason: 'no_close_quote' }
  if ((key === 'totals' || key === 'spreads') && lockLine != null) {
    const closeLine = key === 'totals'
      ? Number(quote.total ?? quote.line)
      : Number(quote.spread ?? quote.line)
    if (Number.isFinite(closeLine) && Number(closeLine) !== Number(lockLine)) {
      return { quote, reason: 'line_moved', lineMoved: true }
    }
  }
  return { quote, reason: null, lineMoved: false }
}

export function assertNoLookAhead({ observedAt, dataThrough, lockAt, label = 'input' }) {
  if (!isAtOrBeforeLock(observedAt, lockAt) && observedAt != null && observedAt !== '') {
    return { ok: false, reason: `${label}_after_lock`, code: 'LOOK_AHEAD' }
  }
  if (dataThrough != null && dataThrough !== '' && !isAtOrBeforeLock(dataThrough, lockAt)) {
    return { ok: false, reason: `${label}_data_through_after_lock`, code: 'LOOK_AHEAD' }
  }
  return { ok: true, reason: null, code: null }
}

export function etFoldKey(game) {
  const start = frozenStartMs(game)
  if (start == null) return null
  const sport = String(game.sport || '').toLowerCase()
  const parts = etDateParts(start)
  if (!parts) return null
  if (sport === 'nfl') {
    return `nfl-${nflWeekEndingMondayKey(parts)}`
  }
  return `${sport}-${parts.year}-${parts.month}-${parts.day}`
}

function etDateParts(startMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(startMs))
  const get = (type) => parts.find((part) => part.type === type)?.value
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const weekday = get('weekday')
  if (!year || !month || !day || !weekday) return null
  return { year, month, day, weekday }
}

const ET_WEEKDAY_INDEX = Object.freeze({
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
})

/**
 * NFL week is Thursday through Monday. The fold key is the Monday that
 * *ends* that week, so MNF stays with that week's TNF/Sunday and not
 * the next Thursday.
 */
function nflWeekEndingMondayKey(parts) {
  const dow = ET_WEEKDAY_INDEX[parts.weekday]
  if (dow == null) return `${parts.year}-${parts.month}-${parts.day}`
  const offset = dow === 1 ? 0 : (8 - dow) % 7
  const ending = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + offset,
  ))
  const y = ending.getUTCFullYear()
  const m = String(ending.getUTCMonth() + 1).padStart(2, '0')
  const d = String(ending.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function sidePrice(row, side, market) {
  const key = normalizeMarketName(market || row?.market)
  if (key === 'totals') {
    if (side === 'over' || side === 'away') return row.priceAway ?? row.priceOver
    return row.priceHome ?? row.priceUnder
  }
  if (side === 'away' || side === 'under') return row.priceAway
  return row.priceHome
}

function gradeResult({ game, market, side, line }) {
  if (!isFinalStatus(game?.status)) return { outcome: null, reason: 'not_final' }
  const home = Number(game.homeScore ?? game.home_score)
  const away = Number(game.awayScore ?? game.away_score)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return { outcome: null, reason: 'missing_score' }
  const key = normalizeMarketName(market)
  if (key === 'moneyline') {
    if (home === away) return { outcome: 'push', y: null, winner: 'push' }
    const homeWin = home > away
    const win = side === 'home' ? homeWin : !homeWin
    return { outcome: win ? 'win' : 'loss', y: win ? 1 : 0, winner: homeWin ? 'home' : 'away' }
  }
  if (key === 'totals') {
    const total = home + away
    const L = Number(line)
    if (!Number.isFinite(L)) return { outcome: null, reason: 'missing_line' }
    if (total === L) return { outcome: 'push', y: null, winner: 'push' }
    const over = total > L
    const win = side === 'over' ? over : !over
    return { outcome: win ? 'win' : 'loss', y: win ? 1 : 0, winner: over ? 'over' : 'under' }
  }
  if (key === 'spreads') {
    const spread = Number(line)
    if (!Number.isFinite(spread)) return { outcome: null, reason: 'missing_line' }
    const margin = home - away
    const homeCover = margin + spread
    if (homeCover === 0) return { outcome: 'push', y: null, winner: 'push' }
    const homeWins = homeCover > 0
    const win = side === 'home' ? homeWins : !homeWins
    return { outcome: win ? 'win' : 'loss', y: win ? 1 : 0, winner: homeWins ? 'home' : 'away' }
  }
  return { outcome: null, reason: 'unknown_market' }
}

function pickBetSide(evaluation) {
  const homeGap = Number(evaluation?.home?.evaluation?.modelVsMarketGap)
  const awayGap = Number(evaluation?.away?.evaluation?.modelVsMarketGap)
  const overGap = Number(evaluation?.over?.evaluation?.modelVsMarketGap)
  const underGap = Number(evaluation?.under?.evaluation?.modelVsMarketGap)
  const sides = [
    { side: 'home', gap: homeGap, row: evaluation?.home },
    { side: 'away', gap: awayGap, row: evaluation?.away },
    { side: 'over', gap: overGap, row: evaluation?.over },
    { side: 'under', gap: underGap, row: evaluation?.under },
  ].filter((row) => Number.isFinite(row.gap) && row.gap > 0 && row.row)
  if (!sides.length) return { side: null, gap: null, row: null, noBet: true }
  sides.sort((a, b) => b.gap - a.gap)
  return { ...sides[0], noBet: false }
}

function modelProbForSide(evaluation, side) {
  if (side === 'home') return evaluation?.home?.model?.pWin ?? evaluation?.model?.pHomeWin
  if (side === 'away') return evaluation?.away?.model?.pWin ?? evaluation?.model?.pAwayWin
  if (side === 'over') return evaluation?.over?.model?.pWin ?? evaluation?.model?.pOver
  if (side === 'under') return evaluation?.under?.model?.pWin ?? evaluation?.model?.pUnder
  return null
}

function scoreOneBet({
  game,
  market,
  modelVersion,
  evaluation,
  lockQuote,
  close,
  lockAt,
}) {
  const bet = pickBetSide(evaluation)
  const lockLine = lockQuote?.total ?? lockQuote?.spread ?? lockQuote?.line ?? null
  const closeLine = close.quote?.total ?? close.quote?.spread ?? close.quote?.line ?? null
  const lineMoved = Boolean(close.lineMoved)
  const fold = etFoldKey(game)
  const homeProb = modelProbForSide(evaluation, market === 'totals' ? 'over' : 'home')
  const canonicalSide = market === 'totals' ? 'over' : 'home'
  const result = gradeResult({
    game,
    market,
    side: bet.side || canonicalSide,
    line: lockLine,
  })
  const canonicalResult = gradeResult({
    game,
    market,
    side: canonicalSide,
    line: lockLine,
  })

  const lockPrice = bet.side ? sidePrice(lockQuote, bet.side, market) : null
  const closePrice = bet.side && close.quote ? sidePrice(close.quote, bet.side, market) : null
  const clv = lockPrice != null && closePrice != null && !lineMoved
    ? clvFromOdds(lockPrice, closePrice)
    : { clvProb: null, beatClose: null }

  const canonicalClose = close.quote ? sidePrice(close.quote, canonicalSide, market) : null
  const canonicalCloseOther = close.quote
    ? sidePrice(close.quote, canonicalSide === 'over' ? 'under' : 'away', market)
    : null
  const novigClose = close.quote ? noVigPair(canonicalClose, canonicalCloseOther) : null

  const decided = canonicalResult.outcome === 'win' || canonicalResult.outcome === 'loss'
  const y = decided ? canonicalResult.y : null
  const p = Number(homeProb)
  const pClose = novigClose?.side ?? null

  return {
    gameId: game.id,
    sport: String(game.sport || '').toLowerCase(),
    market: normalizeMarketName(market),
    modelVersion,
    fold,
    lockAt,
    betSide: bet.side,
    noBet: bet.noBet,
    edge: bet.gap,
    lockLine,
    closeLine,
    lineMoved,
    outcome: result.outcome,
    y,
    pModel: Number.isFinite(p) ? p : null,
    pClose: Number.isFinite(Number(pClose)) ? Number(pClose) : null,
    clvProb: lineMoved ? null : clv.clvProb,
    beatClose: lineMoved ? null : clv.beatClose,
    brierModel: decided && Number.isFinite(p) ? brierScore(p, y) : null,
    brierClose: decided && Number.isFinite(Number(pClose)) ? brierScore(pClose, y) : null,
    logLossModel: decided && Number.isFinite(p) ? logLoss(p, y) : null,
    logLossClose: decided && Number.isFinite(Number(pClose)) ? logLoss(pClose, y) : null,
    skipReason: result.reason && result.outcome == null ? result.reason : null,
  }
}

function probabilitiesSumOk(evaluation, market) {
  if (market === 'totals') {
    const over = Number(evaluation?.over?.model?.pWin)
    const under = Number(evaluation?.under?.model?.pWin)
    const push = Number(evaluation?.over?.model?.pPush || 0)
    if (![over, under].every(Number.isFinite)) return false
    return Math.abs(over + under + push - 1) <= PROB_SUM_TOLERANCE
  }
  const home = Number(evaluation?.home?.model?.pWin ?? evaluation?.model?.pHomeWin)
  const away = Number(evaluation?.away?.model?.pWin ?? evaluation?.model?.pAwayWin)
  const push = Number(evaluation?.home?.model?.pPush || 0)
  if (![home, away].every(Number.isFinite)) return false
  return Math.abs(home + away + push - 1) <= PROB_SUM_TOLERANCE
}

function teamForGame(game, side) {
  if (side === 'home') return game.home || { id: game.homeId, abbr: game.homeAbbr || game.home_team }
  return game.away || { id: game.awayId, abbr: game.awayAbbr || game.away_team }
}

function applyRebuiltTeam(game, completed, lockAt) {
  const homeTeam = teamForGame(game, 'home')
  const awayTeam = teamForGame(game, 'away')
  const home = rebuildTeamSeasonStats(completed, homeTeam, { lockAt, season: game.season })
  const away = rebuildTeamSeasonStats(completed, awayTeam, { lockAt, season: game.season })
  return {
    ...game,
    home: {
      ...(typeof homeTeam === 'object' ? homeTeam : { abbr: homeTeam }),
      last10Record: home.last10Record,
      gamesPlayed: home.gamesPlayed,
      avgPointsLast10: home.pointsForPerGame,
      avgPointsAllowedLast10: home.pointsAgainstPerGame,
      statsDataThrough: home.dataThrough,
      statsCapturedAt: home.capturedAt,
      statsKind: 'season',
      season: game.season || home.season,
    },
    away: {
      ...(typeof awayTeam === 'object' ? awayTeam : { abbr: awayTeam }),
      last10Record: away.last10Record,
      gamesPlayed: away.gamesPlayed,
      avgPointsLast10: away.pointsForPerGame,
      avgPointsAllowedLast10: away.pointsAgainstPerGame,
      statsDataThrough: away.dataThrough,
      statsCapturedAt: away.capturedAt,
      statsKind: 'season',
      season: game.season || away.season,
    },
  }
}

function evaluateSportModel({
  game,
  lockQuote,
  market,
  lockAt,
  completedGames,
  injuries,
  modelVersion,
}) {
  const sport = String(game.sport || '').toLowerCase()
  const rebuilt = applyRebuiltTeam(game, completedGames, lockAt)
  if (sport === 'nfl') {
    const version = modelVersion || NFL_SELECTION_MODEL_VERSION
    const selection = calculateNFLSelection(rebuilt, [lockQuote], {
      now: lockAt,
      lockAt,
      modelVersion: version,
      completedGames,
      injuries,
    })
    if (market === 'moneyline') return { evaluation: selection.moneyline, modelVersion: selection.modelVersion, selection }
    if (market === 'totals') return { evaluation: selection.totals, modelVersion: selection.modelVersion, selection }
    if (market === 'spreads') return { evaluation: selection.spreads, modelVersion: selection.modelVersion, selection }
  }
  if (sport === 'nhl') {
    const edges = calculateNHLEdges(rebuilt, [lockQuote], { now: new Date(lockAt) })
    const fair = noVigPair(lockQuote.priceHome, lockQuote.priceAway)
    if (market === 'moneyline') {
      const pHome = fair && Number.isFinite(Number(edges.edgeMlHome))
        ? fair.side + Number(edges.edgeMlHome)
        : null
      const evaluation = {
        model: { pHomeWin: pHome, pAwayWin: pHome == null ? null : 1 - pHome },
        home: {
          model: { pWin: pHome, pLoss: pHome == null ? null : 1 - pHome, pPush: 0 },
          evaluation: { modelVsMarketGap: edges.edgeMlHome },
        },
        away: {
          model: { pWin: pHome == null ? null : 1 - pHome, pLoss: pHome, pPush: 0 },
          evaluation: { modelVsMarketGap: edges.edgeMlAway },
        },
      }
      return { evaluation, modelVersion: edges.modelRun || NHL_MODEL_VERSION, selection: edges }
    }
    if (market === 'totals') {
      const overFair = noVigPair(lockQuote.priceAway ?? lockQuote.priceOver, lockQuote.priceHome ?? lockQuote.priceUnder)
      const pOver = overFair && Number.isFinite(Number(edges.edgeTotalO))
        ? overFair.side + Number(edges.edgeTotalO)
        : null
      const evaluation = {
        over: {
          model: { pWin: pOver, pLoss: pOver == null ? null : 1 - pOver, pPush: 0 },
          evaluation: { modelVsMarketGap: edges.edgeTotalO },
        },
        under: {
          model: { pWin: pOver == null ? null : 1 - pOver, pLoss: pOver, pPush: 0 },
          evaluation: { modelVsMarketGap: edges.edgeTotalU },
        },
      }
      return { evaluation, modelVersion: edges.modelRun || NHL_MODEL_VERSION, selection: edges }
    }
  }
  if (sport === 'mlb') {
    const edges = calculateGameEdges(rebuilt, [lockQuote])
    const fair = noVigPair(lockQuote.priceHome, lockQuote.priceAway)
    if (market === 'moneyline') {
      const pHome = fair && Number.isFinite(Number(edges.edgeMlHome))
        ? fair.side + Number(edges.edgeMlHome)
        : null
      return {
        evaluation: {
          model: { pHomeWin: pHome, pAwayWin: pHome == null ? null : 1 - pHome },
          home: {
            model: { pWin: pHome, pLoss: pHome == null ? null : 1 - pHome, pPush: 0 },
            evaluation: { modelVsMarketGap: edges.edgeMlHome },
          },
          away: {
            model: { pWin: pHome == null ? null : 1 - pHome, pLoss: pHome, pPush: 0 },
            evaluation: { modelVsMarketGap: edges.edgeMlAway },
          },
        },
        modelVersion: edges.modelRun || MLB_MODEL_VERSION,
        selection: edges,
      }
    }
    if (market === 'totals') {
      const overFair = noVigPair(lockQuote.priceAway ?? lockQuote.priceOver, lockQuote.priceHome ?? lockQuote.priceUnder)
      const pOver = overFair && Number.isFinite(Number(edges.edgeTotalO))
        ? overFair.side + Number(edges.edgeTotalO)
        : null
      return {
        evaluation: {
          over: {
            model: { pWin: pOver, pLoss: pOver == null ? null : 1 - pOver, pPush: 0 },
            evaluation: { modelVsMarketGap: edges.edgeTotalO },
          },
          under: {
            model: { pWin: pOver == null ? null : 1 - pOver, pLoss: pOver, pPush: 0 },
            evaluation: { modelVsMarketGap: edges.edgeTotalU },
          },
        },
        modelVersion: edges.modelRun || MLB_MODEL_VERSION,
        selection: edges,
      }
    }
  }
  return { evaluation: null, modelVersion: null, selection: null, skipReason: 'unsupported_sport_market' }
}

export function summarizeBacktest(rows, {
  sport,
  market,
  modelVersion,
} = {}) {
  const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (sport && sport !== 'all' && row.sport !== sport) return false
    if (market && market !== 'all' && row.market !== market) return false
    if (modelVersion && row.modelVersion !== modelVersion) return false
    return true
  })
  const foldSplit = splitWalkForwardFolds(filtered.map((row) => row.fold))
  const holdoutSet = new Set(foldSplit.holdout)
  const holdoutRows = filtered.filter((row) => holdoutSet.has(row.fold))
  const clvRows = holdoutRows.filter((row) => Number.isFinite(row.clvProb) && !row.noBet && !row.lineMoved)
  const decidedBets = holdoutRows.filter((row) => !row.noBet && (row.outcome === 'win' || row.outcome === 'loss'))
  const scored = holdoutRows.filter((row) => Number.isFinite(row.brierModel) && Number.isFinite(row.brierClose))
  const folds = foldSplit.holdout
  const avg = (list, key) => {
    const nums = list.map((row) => Number(row[key])).filter(Number.isFinite)
    if (!nums.length) return null
    return nums.reduce((sum, n) => sum + n, 0) / nums.length
  }
  const avgClv = avg(clvRows, 'clvProb')
  const beatCloseShare = clvRows.length
    ? clvRows.filter((row) => row.beatClose).length / clvRows.length
    : null
  const brierModel = avg(scored, 'brierModel')
  const brierClose = avg(scored, 'brierClose')
  const logLossModel = avg(scored, 'logLossModel')
  const logLossClose = avg(scored, 'logLossClose')
  const wins = decidedBets.filter((row) => row.outcome === 'win').length
  const losses = decidedBets.filter((row) => row.outcome === 'loss').length
  const clvSample = clvRows.length
  const calibSample = scored.length
  const bars = publishBarsStatus({
    sample: Math.min(clvSample, calibSample),
    holdoutFolds: foldSplit.holdout.length,
    devFolds: foldSplit.development.length,
    avgClv,
    beatCloseShare,
    brierBeatsClose: brierModel != null && brierClose != null && brierModel < brierClose,
    logLossBeatsClose: logLossModel != null && logLossClose != null && logLossModel < logLossClose,
  })

  return {
    sport: sport || 'all',
    market: market || 'all',
    modelVersion: modelVersion || 'all',
    gamesConsidered: filtered.length,
    bets: clvRows.length,
    clvSample,
    calibSample,
    noBets: holdoutRows.filter((row) => row.noBet).length,
    lineMoved: holdoutRows.filter((row) => row.lineMoved).length,
    skipped: holdoutRows.filter((row) => row.skipReason).length,
    folds: folds.length,
    foldIds: folds,
    warmupFolds: foldSplit.warmup.length,
    developmentFolds: foldSplit.development.length,
    holdoutFolds: foldSplit.holdout.length,
    warmupFoldIds: foldSplit.warmup,
    developmentFoldIds: foldSplit.development,
    avgClv,
    beatCloseShare,
    beatClose: clvRows.filter((row) => row.beatClose).length,
    hitRate: (wins + losses) > 0 ? wins / (wins + losses) : null,
    wins,
    losses,
    pushes: holdoutRows.filter((row) => row.outcome === 'push').length,
    brierModel,
    brierClose,
    logLossModel,
    logLossClose,
    brierBeatsClose: brierModel != null && brierClose != null && brierModel < brierClose,
    logLossBeatsClose: logLossModel != null && logLossClose != null && logLossModel < logLossClose,
    sample: sampleSizeStatus(Math.min(clvSample, calibSample)),
    publish: bars,
    minSample: PUBLISH_MIN_SAMPLE,
    minHoldoutFolds: PUBLISH_MIN_HOLDOUT_FOLDS,
    minDevFolds: PUBLISH_MIN_DEV_FOLDS,
    minAvgClv: PUBLISH_MIN_AVG_CLV,
    minBeatCloseShare: PUBLISH_MIN_BEAT_CLOSE_SHARE,
  }
}

export function walkForwardBacktest(dataset = {}, options = {}) {
  const games = Array.isArray(dataset.games) ? [...dataset.games] : []
  const odds = dataset.odds || []
  const closingOdds = dataset.closingOdds || dataset.closing || []
  const injuries = dataset.injuries || []
  const sports = options.sport && options.sport !== 'all' ? [options.sport] : GAME_LINE_SPORTS_IN_SCOPE
  const markets = options.market && options.market !== 'all'
    ? [options.market]
    : GAME_LINE_MARKETS_IN_SCOPE
  const modelVersion = options.model || null

  const ordered = games
    .filter((game) => sports.includes(String(game.sport || '').toLowerCase()))
    .sort((a, b) => (frozenStartMs(a) || 0) - (frozenStartMs(b) || 0))

  const rows = []
  const skips = []
  const lookAheadRejected = []

  for (const game of ordered) {
    for (const market of markets) {
      if (String(game.sport || '').toLowerCase() !== 'nfl' && market === 'spreads') continue
      const lock = pickLockTime(game, odds, { market })
      if (!lock.lockAt) {
        skips.push({ gameId: game.id, market, reason: lock.reason || 'no_lock_quote' })
        continue
      }
      const completed = []
      for (const prior of gamesAvailableBeforeLock(games, lock.lockAt)) {
        if (prior.id === game.id) continue
        const check = assertNoLookAhead({
          observedAt: prior.resultAvailableAt || prior.lastUpdate || prior.archivedAt,
          dataThrough: prior.date,
          lockAt: lock.lockAt,
          label: 'prior_final',
        })
        if (!check.ok) {
          lookAheadRejected.push({ gameId: game.id, priorId: prior.id, ...check })
          continue
        }
        completed.push(prior)
      }

      const closeSource = [
        ...closingOdds,
        ...odds.filter((row) => String(row.id || '').startsWith(CLVCLOSE_PREFIX)),
      ]
      const close = selectCloseQuote(closeSource, {
        game,
        market,
        lockLine: lock.quote?.total ?? lock.quote?.spread ?? null,
      })

      const predicted = evaluateSportModel({
        game,
        lockQuote: lock.quote,
        market,
        lockAt: lock.lockAt,
        completedGames: completed,
        injuries: injuries.filter((row) => isAtOrBeforeLock(row.fetchedAt || row.observedAt, lock.lockAt)),
        modelVersion: modelVersion
          || (String(game.sport || '').toLowerCase() === 'nfl' ? NFL_SELECTION_MODEL_VERSION : null),
      })
      if (!predicted.evaluation) {
        skips.push({ gameId: game.id, market, reason: predicted.skipReason || 'no_model' })
        continue
      }
      if (!probabilitiesSumOk(predicted.evaluation, market)
        && String(game.sport || '').toLowerCase() === 'nfl') {
        skips.push({ gameId: game.id, market, reason: 'probability_sum' })
        continue
      }

      const scored = scoreOneBet({
        game,
        market,
        modelVersion: predicted.modelVersion,
        evaluation: predicted.evaluation,
        lockQuote: lock.quote,
        close,
        lockAt: lock.lockAt,
      })
      rows.push(scored)
    }
  }

  const byKey = new Map()
  for (const row of rows) {
    const key = `${row.sport}|${row.market}|${row.modelVersion}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(row)
  }
  const summaries = [...byKey.entries()].map(([key, list]) => {
    const [sport, market, version] = key.split('|')
    return summarizeBacktest(list, { sport, market, modelVersion: version })
  })

  return {
    rows,
    skips,
    lookAheadRejected,
    summaries,
    inventory: {
      games: ordered.length,
      odds: odds.length,
      closingOdds: closingOdds.length,
      injuries: injuries.length,
      scored: rows.length,
      skipped: skips.length,
      lookAheadRejected: lookAheadRejected.length,
    },
    nhlNotes: NHL_BACKTEST_NOTES,
    previousNflVersion: NFL_SELECTION_MODEL_V101,
  }
}

export const NHL_BACKTEST_NOTES = Object.freeze([
  'NHL moneyline skip guards still null totals for that game (documented since PR #59).',
  'NHL totals convert a point gap to a 3%-per-goal edge and do not blend to the market over/under probability.',
  'The harness rebuilds NHL W-L and GF/GA from pre-lock finals. Using the live Team row on an old game would look ahead; that is not done here.',
])

export function formatBacktestReport(result, { verbose = false } = {}) {
  const lines = []
  lines.push('GAME-LINE WALK-FORWARD (read-only, 0 Odds API credits)')
  lines.push(`games=${result.inventory.games} odds=${result.inventory.odds} closes=${result.inventory.closingOdds} scored=${result.inventory.scored} skipped=${result.inventory.skipped} lookAheadRejected=${result.inventory.lookAheadRejected || 0}`)
  if (!result.summaries.length) {
    lines.push('SAMPLE_TOO_SMALL: no scored games. Need lock quote + close + final for each market.')
  }
  for (const summary of result.summaries) {
    const sample = summary.sample
    lines.push('')
    lines.push(`${summary.sport.toUpperCase()} ${summary.market} ${summary.modelVersion}`)
    lines.push(`  ${sample.label}`)
    if (!sample.ok) {
      lines.push(`  ${sample.code}`)
      if (sample.code !== 'SAMPLE_TOO_SMALL') lines.push('  SAMPLE_TOO_SMALL')
    }
    lines.push(`  clvBets=${summary.clvSample} calibGames=${summary.calibSample} noBets=${summary.noBets} holdoutFolds=${summary.holdoutFolds ?? summary.folds} devFolds=${summary.developmentFolds ?? 0} warmupFolds=${summary.warmupFolds ?? 0} lineMoved=${summary.lineMoved}`)
    lines.push(`  avgCLV=${fmtPp(summary.avgClv)} beatClose=${fmtPct(summary.beatCloseShare)} hitRate=${fmtPct(summary.hitRate)}`)
    lines.push(`  Brier model=${fmtNum(summary.brierModel)} close=${fmtNum(summary.brierClose)} beatsClose=${summary.brierBeatsClose}`)
    lines.push(`  logLoss model=${fmtNum(summary.logLossModel)} close=${fmtNum(summary.logLossClose)} beatsClose=${summary.logLossBeatsClose}`)
    lines.push(`  publishEligible=${summary.publish.eligibleForPublic}`)
    if (summary.publish.reasons.length) {
      lines.push(`  blocked: ${summary.publish.reasons.join('; ')}`)
    }
  }
  if (result.nhlNotes?.length) {
    lines.push('')
    lines.push('NHL flags (model unchanged):')
    for (const note of result.nhlNotes) lines.push(`  - ${note}`)
  }
  if (verbose) {
    lines.push('')
    lines.push('per-game:')
    for (const row of result.rows) {
      lines.push(`  ${row.sport} ${row.market} ${row.gameId} lock=${row.lockAt} side=${row.betSide || 'none'} out=${row.outcome || 'n/a'} clv=${fmtPp(row.clvProb)}`)
    }
  }
  return lines.join('\n')
}

function fmtPp(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a'
  const n = Number(value) * 100
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}pp`
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a'
  return `${(Number(value) * 100).toFixed(1)}%`
}

function fmtNum(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a'
  return Number(value).toFixed(4)
}

export function featuresAtLock(game, dataset, lockAt) {
  return buildNflPregameFeatures({
    game,
    completedGames: dataset.games || [],
    injuries: dataset.injuries || [],
    lockAt,
  })
}
