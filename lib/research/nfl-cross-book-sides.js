/**
 * Research evaluator for NFL moneyline and totals cross-book price gaps.
 *
 * Mirrors production prop-edge semantics (scripts/fetch-live-odds.js
 * buildLineShoppingEdges) without touching the public board.
 *
 *   consensus_fair  = mean of per-book two-way de-vigged side probabilities
 *   best_implied    = raw (with-vig) implied from the best decimal price
 *   price_gap       = (consensus_fair − best_implied) / consensus_fair
 *
 * This is a model-free price gap. A predictive-model gap is a separate
 * field and stays null unless a model probability is injected.
 *
 * Research only. eligibleForPublic stays false. No production writes.
 */

import { americanToImplied, removeMlVig, removeTotalVig } from '../implied.js'
import { impliedProbabilityFromOdds, toAmericanOdds, toDecimalOdds } from '../odds-units.js'

export const CROSS_BOOK_PUBLIC_ELIGIBLE = false
export const CROSS_BOOK_WRITES_PRODUCTION_DB = false
export const CROSS_BOOK_USES_ODDS_API = false
export const CROSS_BOOK_REGRADES_PICKS = false
export const CROSS_BOOK_MERGES = false

export const CROSS_BOOK_CONSTRAINTS = Object.freeze({
  eligibleForPublic: CROSS_BOOK_PUBLIC_ELIGIBLE,
  writesProductionDb: CROSS_BOOK_WRITES_PRODUCTION_DB,
  usesOddsApi: CROSS_BOOK_USES_ODDS_API,
  regradesPicks: CROSS_BOOK_REGRADES_PICKS,
  merges: CROSS_BOOK_MERGES,
})

export const PRICE_GAP_FORMULA = '(consensus_fair - best_implied) / consensus_fair'
export const PRICE_GAP_KIND = 'price_gap'
export const MODEL_GAP_KIND = 'model_gap'
export const DEFAULT_MIN_BOOKS = 2

export function mean(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v))
  if (!nums.length) return null
  return nums.reduce((sum, v) => sum + v, 0) / nums.length
}

export function rawImpliedFromOdds(odds) {
  const fromUnits = impliedProbabilityFromOdds(odds)
  if (fromUnits != null) return fromUnits
  const american = toAmericanOdds(odds)
  if (american == null) return null
  const implied = americanToImplied(american)
  return implied > 0 ? implied : null
}

export function priceGapRelative(consensusFair, bestImplied) {
  if (!Number.isFinite(consensusFair) || consensusFair <= 0) return null
  if (!Number.isFinite(bestImplied)) return null
  return (consensusFair - bestImplied) / consensusFair
}

export function priceGapPercentagePoints(consensusFair, bestImplied) {
  if (!Number.isFinite(consensusFair) || !Number.isFinite(bestImplied)) return null
  return consensusFair - bestImplied
}

/**
 * Model-free gap vs optional model-vs-market gap.
 * The two are never mixed: injecting modelP does not change priceGap.
 */
export function modelVersusConsensusGap(modelP, consensusFair) {
  if (!Number.isFinite(modelP) || !Number.isFinite(consensusFair)) return null
  return modelP - consensusFair
}

export function extractHistoricalEvents(payload) {
  if (!payload) return { timestamp: null, events: [] }
  if (Array.isArray(payload)) return { timestamp: null, events: payload }
  if (Array.isArray(payload.data)) {
    return { timestamp: payload.timestamp || null, events: payload.data }
  }
  if (Array.isArray(payload.events)) {
    return { timestamp: payload.timestamp || null, events: payload.events }
  }
  return { timestamp: payload.timestamp || null, events: [] }
}

function bookLabel(bookmaker) {
  return bookmaker?.title || bookmaker?.key || 'unknown'
}

function collectTwoWayBooks(event, marketKey, sideNames, { point = null } = {}) {
  const books = []
  for (const bookmaker of event.bookmakers || []) {
    const market = (bookmaker.markets || []).find((m) => m.key === marketKey)
    if (!market) continue
    const sides = {}
    for (const outcome of market.outcomes || []) {
      const name = String(outcome.name || '')
      const outcomePoint = outcome.point == null ? null : Number(outcome.point)
      if (point != null && Number.isFinite(point) && outcomePoint !== point) continue
      for (const [side, labels] of Object.entries(sideNames)) {
        if (labels.some((label) => label && name.toLowerCase() === String(label).toLowerCase())) {
          sides[side] = outcome
        }
      }
    }
    const required = Object.keys(sideNames)
    if (!required.every((side) => sides[side]?.price != null)) continue
    books.push({
      book: bookLabel(bookmaker),
      bookKey: bookmaker.key || bookLabel(bookmaker),
      sides,
    })
  }
  return books
}

function evaluateSideFromBooks(books, side, {
  fairFromDevig,
  minBooks = DEFAULT_MIN_BOOKS,
  modelP = null,
} = {}) {
  const quotes = []
  const fairProbs = []
  for (const book of books) {
    const outcome = book.sides[side]
    const decimalOdds = toDecimalOdds(outcome.price)
    const americanOdds = toAmericanOdds(outcome.price)
    const impliedRaw = rawImpliedFromOdds(outcome.price)
    const fair = fairFromDevig(book)
    if (impliedRaw == null || decimalOdds == null) continue
    quotes.push({
      book: book.book,
      bookKey: book.bookKey,
      americanOdds,
      decimalOdds,
      impliedRaw,
      fairProbBook: Number.isFinite(fair) ? fair : null,
    })
    if (Number.isFinite(fair)) fairProbs.push(fair)
  }

  if (quotes.length < minBooks) {
    return {
      ok: false,
      reason: 'insufficient_books',
      side,
      numBooks: quotes.length,
      quotes,
      consensusFair: null,
      bestImplied: null,
      priceGap: null,
    }
  }

  const consensusFair = mean(fairProbs)
  const bestQuote = quotes.reduce((best, cur) => (
    cur.decimalOdds > best.decimalOdds ? cur : best
  ))
  const bestImplied = bestQuote.impliedRaw
  const gap = priceGapRelative(consensusFair, bestImplied)
  const gapPp = priceGapPercentagePoints(consensusFair, bestImplied)

  return {
    ok: true,
    reason: null,
    kind: PRICE_GAP_KIND,
    formula: PRICE_GAP_FORMULA,
    side,
    numBooks: quotes.length,
    quotes,
    consensusFair,
    bestBook: bestQuote.book,
    bestBookKey: bestQuote.bookKey,
    bestAmericanOdds: bestQuote.americanOdds,
    bestDecimalOdds: bestQuote.decimalOdds,
    bestImplied,
    priceGap: gap,
    priceGapPp: gapPp,
    priceGapFloored: gap == null ? null : Math.max(0, gap),
    modelP: Number.isFinite(modelP) ? modelP : null,
    modelGap: modelVersusConsensusGap(modelP, consensusFair),
    modelGapKind: Number.isFinite(modelP) ? MODEL_GAP_KIND : null,
  }
}

export function evaluateMoneyline(event, { minBooks = DEFAULT_MIN_BOOKS, modelPHome = null, modelPAway = null } = {}) {
  const home = event.home_team
  const away = event.away_team
  const books = collectTwoWayBooks(event, 'h2h', {
    home: [home],
    away: [away],
  })

  const withDevig = books.map((book) => {
    const homeOdds = toAmericanOdds(book.sides.home.price)
    const awayOdds = toAmericanOdds(book.sides.away.price)
    const vig = removeMlVig(homeOdds, awayOdds)
    return { ...book, vig }
  }).filter((book) => Number.isFinite(book.vig?.homeFairProb) && Number.isFinite(book.vig?.awayFairProb))

  return {
    market: 'h2h',
    homeTeam: home,
    awayTeam: away,
    numBooks: withDevig.length,
    home: evaluateSideFromBooks(withDevig, 'home', {
      fairFromDevig: (book) => book.vig.homeFairProb,
      minBooks,
      modelP: modelPHome,
    }),
    away: evaluateSideFromBooks(withDevig, 'away', {
      fairFromDevig: (book) => book.vig.awayFairProb,
      minBooks,
      modelP: modelPAway,
    }),
  }
}

export function totalsLinesPresent(event) {
  const counts = new Map()
  for (const bookmaker of event.bookmakers || []) {
    const market = (bookmaker.markets || []).find((m) => m.key === 'totals')
    if (!market) continue
    const points = new Set()
    for (const outcome of market.outcomes || []) {
      if (outcome.point == null) continue
      points.add(Number(outcome.point))
    }
    for (const point of points) {
      counts.set(point, (counts.get(point) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([point, bookCount]) => ({ point, bookCount }))
    .sort((a, b) => b.bookCount - a.bookCount || a.point - b.point)
}

export function modalTotalsLine(event) {
  const lines = totalsLinesPresent(event)
  return lines[0]?.point ?? null
}

export function evaluateTotalsAtLine(event, line, { minBooks = DEFAULT_MIN_BOOKS, modelPOver = null, modelPUnder = null } = {}) {
  const books = collectTwoWayBooks(event, 'totals', {
    over: ['Over', 'over'],
    under: ['Under', 'under'],
  }, { point: line })

  const withDevig = books.map((book) => {
    const overOdds = toAmericanOdds(book.sides.over.price)
    const underOdds = toAmericanOdds(book.sides.under.price)
    const vig = removeTotalVig(overOdds, underOdds, line)
    return { ...book, vig }
  }).filter((book) => Number.isFinite(book.vig?.overFairProb) && Number.isFinite(book.vig?.underFairProb))

  return {
    market: 'totals',
    line,
    isModalLine: line === modalTotalsLine(event),
    numBooks: withDevig.length,
    over: evaluateSideFromBooks(withDevig, 'over', {
      fairFromDevig: (book) => book.vig.overFairProb,
      minBooks,
      modelP: modelPOver,
    }),
    under: evaluateSideFromBooks(withDevig, 'under', {
      fairFromDevig: (book) => book.vig.underFairProb,
      minBooks,
      modelP: modelPUnder,
    }),
  }
}

export function evaluateTotals(event, options = {}) {
  const line = options.line ?? modalTotalsLine(event)
  if (line == null) {
    return {
      market: 'totals',
      line: null,
      isModalLine: false,
      numBooks: 0,
      over: { ok: false, reason: 'missing_totals_line', side: 'over' },
      under: { ok: false, reason: 'missing_totals_line', side: 'under' },
    }
  }
  return evaluateTotalsAtLine(event, line, options)
}

export function evaluateEvent(event, {
  snapshotTs = null,
  phase = null,
  minBooks = DEFAULT_MIN_BOOKS,
  modelProbs = null,
} = {}) {
  const moneyline = evaluateMoneyline(event, {
    minBooks,
    modelPHome: modelProbs?.home ?? null,
    modelPAway: modelProbs?.away ?? null,
  })
  const totals = evaluateTotals(event, {
    minBooks,
    modelPOver: modelProbs?.over ?? null,
    modelPUnder: modelProbs?.under ?? null,
  })

  return {
    eventId: event.id || null,
    sportKey: event.sport_key || 'americanfootball_nfl',
    commenceTime: event.commence_time || null,
    homeTeam: event.home_team || null,
    awayTeam: event.away_team || null,
    snapshotTs,
    phase,
    eligibleForPublic: false,
    priceGapKind: PRICE_GAP_KIND,
    modelGapKind: modelProbs ? MODEL_GAP_KIND : null,
    moneyline,
    totals,
  }
}

export function evaluateSnapshot(payload, {
  snapshotTs = null,
  phase = null,
  minBooks = DEFAULT_MIN_BOOKS,
} = {}) {
  const extracted = extractHistoricalEvents(payload)
  const ts = snapshotTs || extracted.timestamp
  const events = extracted.events.map((event) => evaluateEvent(event, {
    snapshotTs: ts,
    phase,
    minBooks,
  }))
  return {
    snapshotTs: ts,
    phase,
    eventCount: events.length,
    eligibleForPublic: false,
    constraints: CROSS_BOOK_CONSTRAINTS,
    formula: PRICE_GAP_FORMULA,
    events,
  }
}

export function flattenQuotes(evaluation, { snapshotId = null } = {}) {
  const rows = []
  const pushSide = (eventEval, market, sideEval, line = null) => {
    if (!sideEval?.quotes) return
    for (const quote of sideEval.quotes) {
      rows.push({
        snapshotId,
        snapshotTs: eventEval.snapshotTs,
        phase: eventEval.phase,
        eventId: eventEval.eventId,
        commenceTime: eventEval.commenceTime,
        homeTeam: eventEval.homeTeam,
        awayTeam: eventEval.awayTeam,
        market,
        side: sideEval.side,
        line,
        book: quote.book,
        americanOdds: quote.americanOdds,
        decimalOdds: quote.decimalOdds,
        impliedRaw: quote.impliedRaw,
        fairProbBook: quote.fairProbBook,
        consensusFair: sideEval.consensusFair,
        bestBook: sideEval.bestBook,
        bestImplied: sideEval.bestImplied,
        priceGap: sideEval.priceGap,
        numBooks: sideEval.numBooks,
      })
    }
  }

  for (const eventEval of evaluation.events || []) {
    pushSide(eventEval, 'h2h', eventEval.moneyline?.home)
    pushSide(eventEval, 'h2h', eventEval.moneyline?.away)
    pushSide(eventEval, 'totals', eventEval.totals?.over, eventEval.totals?.line)
    pushSide(eventEval, 'totals', eventEval.totals?.under, eventEval.totals?.line)
  }
  return rows
}

export function flattenSides(evaluation, { snapshotId = null } = {}) {
  const rows = []
  const push = (eventEval, market, sideEval, line = null) => {
    if (!sideEval) return
    rows.push({
      snapshotId,
      snapshotTs: eventEval.snapshotTs,
      phase: eventEval.phase,
      eventId: eventEval.eventId,
      commenceTime: eventEval.commenceTime,
      homeTeam: eventEval.homeTeam,
      awayTeam: eventEval.awayTeam,
      market,
      side: sideEval.side,
      line,
      ok: Boolean(sideEval.ok),
      reason: sideEval.reason,
      numBooks: sideEval.numBooks ?? 0,
      consensusFair: sideEval.consensusFair ?? null,
      bestBook: sideEval.bestBook ?? null,
      bestAmericanOdds: sideEval.bestAmericanOdds ?? null,
      bestDecimalOdds: sideEval.bestDecimalOdds ?? null,
      bestImplied: sideEval.bestImplied ?? null,
      priceGap: sideEval.priceGap ?? null,
      priceGapPp: sideEval.priceGapPp ?? null,
      priceGapFloored: sideEval.priceGapFloored ?? null,
      modelP: sideEval.modelP ?? null,
      modelGap: sideEval.modelGap ?? null,
      eligibleForPublic: false,
    })
  }

  for (const eventEval of evaluation.events || []) {
    push(eventEval, 'h2h', eventEval.moneyline?.home)
    push(eventEval, 'h2h', eventEval.moneyline?.away)
    push(eventEval, 'totals', eventEval.totals?.over, eventEval.totals?.line)
    push(eventEval, 'totals', eventEval.totals?.under, eventEval.totals?.line)
  }
  return rows
}
