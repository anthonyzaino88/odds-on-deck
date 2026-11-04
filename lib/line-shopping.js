/**
 * Cross-book line shopping for player props.
 *
 * Morning fetch already pays for every US book on the event-odds payload.
 * This module keeps that ladder (price + last_update), computes vig-free
 * consensus vs best price, and writes quotes onto PlayerPropCache when
 * SQL 010 is applied. Writers retry without quote columns on PGRST204 /
 * 42703 so a pre-migration database still stores the collapsed best row.
 *
 * Does not call The Odds API. Does not add regions. CLV math lives in
 * closing-line.js (posted/entry vs consensus close) and is unchanged.
 */

import { isMissingColumnError } from './grade-audit.js'
import { getBookCount } from './juice-traps.js'
import { toAmericanOdds, toDecimalOdds } from './odds-units.js'

export const LINE_SHOP_UNPAIRED_VIG = 0.955
export const LINE_SHOP_STALE_AFTER_MS = 6 * 60 * 60 * 1000
export const PLAYER_PROP_CACHE_QUOTE_FIELDS = Object.freeze(['quotes', 'quoteUpdatedAt'])
export const PROP_VALIDATION_ENTRY_BOOK_FIELDS = Object.freeze(['entryBook'])

/** Process-local: after a missing-column miss, later writes skip quote fields. */
let quoteColumnsMissing = false
let entryBookColumnMissing = false

export function resetLineShopQuoteColumnCache() {
  quoteColumnsMissing = false
}

export function resetEntryBookColumnCache() {
  entryBookColumnMissing = false
}

export function bookQuoteLastUpdate(bookmaker, market) {
  return market?.last_update || market?.lastUpdate
    || bookmaker?.last_update || bookmaker?.lastUpdate
    || null
}

export function parseQuoteInstant(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function quoteAgeMs(lastUpdate, now = Date.now()) {
  const updated = parseQuoteInstant(lastUpdate)
  if (updated == null) return null
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowMs)) return null
  return nowMs - updated
}

/**
 * Missing last_update is not fresh. Stale when older than 6h or when the
 * quote timestamp is at/after commence (in-game / live tick).
 */
export function isQuoteStale(quote, {
  now = Date.now(),
  commenceTime = null,
  maxAgeMs = LINE_SHOP_STALE_AFTER_MS,
} = {}) {
  const lastUpdate = quote?.lastUpdate ?? quote?.last_update
  const updated = parseQuoteInstant(lastUpdate)
  if (updated == null) return true
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  if (Number.isFinite(nowMs) && Number.isFinite(maxAgeMs) && (nowMs - updated) > maxAgeMs) {
    return true
  }
  const commenceMs = parseQuoteInstant(commenceTime)
  if (commenceMs != null && updated >= commenceMs) return true
  return false
}

export function usableDecimalPrice(price) {
  const decimal = toDecimalOdds(price)
  if (decimal == null || !(decimal > 1)) return null
  return decimal
}

export function vigFreeProbability(price, counterpartPrice) {
  const decimal = usableDecimalPrice(price)
  if (decimal == null) return null
  const implied = 1 / decimal
  const counterpart = usableDecimalPrice(counterpartPrice)
  if (counterpart == null) return implied * LINE_SHOP_UNPAIRED_VIG
  const otherImplied = 1 / counterpart
  const total = implied + otherImplied
  if (!(total > 0)) return null
  return implied / total
}

export function lineShoppingEdge(consensusProb, bestImplied) {
  const consensus = Number(consensusProb)
  const implied = Number(bestImplied)
  if (!(consensus > 0) || !Number.isFinite(implied)) return 0
  return Math.max(0, (consensus - implied) / consensus)
}

export function roundedAmerican(odds) {
  const american = toAmericanOdds(odds)
  if (american == null || !Number.isFinite(american)) return null
  return Math.round(american)
}

export function consensusOddsFromProbability(probability) {
  const prob = Number(probability)
  if (!Number.isFinite(prob) || !(prob > 0) || !(prob < 1)) return null
  return 1 / prob
}

export function parseStoredQuotes(value) {
  if (value == null) return null
  if (Array.isArray(value)) return value.length ? value : null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) && parsed.length ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function serializeQuote(priceEntry) {
  const decimal = usableDecimalPrice(priceEntry?.price ?? priceEntry?.decimal)
  if (decimal == null) return null
  const lastUpdate = priceEntry.lastUpdate ?? priceEntry.last_update ?? null
  return {
    book: priceEntry.book || null,
    decimal,
    american: roundedAmerican(decimal),
    lastUpdate: lastUpdate || null,
  }
}

function quoteUpdatedAtFromPrices(prices) {
  const stamps = (prices || [])
    .map((entry) => parseQuoteInstant(entry?.lastUpdate ?? entry?.last_update))
    .filter((ms) => ms != null)
  if (!stamps.length) return null
  return new Date(Math.max(...stamps)).toISOString()
}

/**
 * Build a real edge using cross-bookmaker line shopping.
 *
 * For each unique prop (player/market/threshold/pick):
 *   1. Collect decimal odds from every bookmaker (skip unparseable prices)
 *   2. Remove vig by pairing Over/Under from the same book
 *   3. Consensus = average vig-free probability (unpaired uses ×0.955)
 *   4. Best = highest decimal odds
 *   5. Edge = how much better the best price is vs consensus
 *
 * Returns a Map keyed by "gameId|playerName|market|threshold|pick".
 */
export function buildLineShoppingEdges(gameProps) {
  const propMap = new Map()

  for (const { gameId, props } of gameProps || []) {
    for (const bookmaker of props?.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        for (const outcome of market.outcomes || []) {
          const playerName = outcome.description || outcome.name
          const line = outcome.point ?? (market.description ? parseFloat(market.description) : null)
          const decimal = usableDecimalPrice(outcome.price)
          const pick = String(outcome.name || '').toLowerCase()
          if (!playerName || line == null || Number.isNaN(Number(line)) || decimal == null) continue
          if (!['over', 'under'].includes(pick)) continue

          const baseKey = `${gameId}|${playerName}|${market.key}|${line}`
          const fullKey = `${baseKey}|${pick}`
          if (!propMap.has(fullKey)) {
            propMap.set(fullKey, {
              baseKey,
              pick,
              prices: [],
              playerName,
              market: market.key,
              threshold: line,
            })
          }
          propMap.get(fullKey).prices.push({
            price: decimal,
            book: bookmaker.title || bookmaker.key,
            lastUpdate: bookQuoteLastUpdate(bookmaker, market),
          })
        }
      }
    }
  }

  const edgeMap = new Map()

  for (const [key, entry] of propMap) {
    if (!entry.prices.length) continue
    const oppositeKey = `${entry.baseKey}|${entry.pick === 'over' ? 'under' : 'over'}`
    const opposite = propMap.get(oppositeKey)

    const vigFreeProbabilities = []
    for (const { price, book } of entry.prices) {
      const counterpart = opposite?.prices.find((row) => row.book === book)
      const vigFree = vigFreeProbability(price, counterpart?.price)
      if (vigFree == null) continue
      vigFreeProbabilities.push(vigFree)
    }
    if (vigFreeProbabilities.length === 0) continue

    const consensusProb = vigFreeProbabilities.reduce((sum, n) => sum + n, 0) / vigFreeProbabilities.length
    const bestEntry = entry.prices.reduce((best, cur) => (cur.price > best.price ? cur : best))
    const bestImplied = 1 / bestEntry.price
    const quotes = entry.prices.map(serializeQuote).filter(Boolean)
    const consensusDecimal = consensusOddsFromProbability(consensusProb)

    edgeMap.set(key, {
      bestPrice: bestEntry.price,
      bestBook: bestEntry.book,
      consensusProb,
      vigFreeProb: consensusProb,
      consensusDecimal,
      consensusAmerican: roundedAmerican(consensusDecimal),
      bestAmerican: roundedAmerican(bestEntry.price),
      edge: lineShoppingEdge(consensusProb, bestImplied),
      numBooks: entry.prices.length,
      quotes,
      quoteUpdatedAt: quoteUpdatedAtFromPrices(entry.prices),
    })
  }

  return edgeMap
}

export function playerPropCacheQuoteFields(lineShop) {
  const quotes = parseStoredQuotes(lineShop?.quotes)
  if (!quotes) return null
  return {
    quotes,
    quoteUpdatedAt: lineShop.quoteUpdatedAt || quoteUpdatedAtFromPrices(quotes) || null,
  }
}

export function withLineShopQuoteFields(row, lineShop) {
  if (!row || typeof row !== 'object') return row
  if (quoteColumnsMissing) return withoutLineShopQuoteFields(row)
  const fields = playerPropCacheQuoteFields(lineShop)
  if (!fields) return withoutLineShopQuoteFields(row)
  return { ...row, ...fields }
}

export function withoutLineShopQuoteFields(payload) {
  const next = { ...(payload || {}) }
  for (const key of PLAYER_PROP_CACHE_QUOTE_FIELDS) delete next[key]
  return next
}

/**
 * True only for PGRST204 / 42703 on these optional columns.
 * Empty message still degrades (codes already matched). A missing-column
 * error for a different name does not.
 */
function missingOptionalColumnError(error, columnNames) {
  if (!isMissingColumnError(error)) return false
  const message = String(error.message || '')
  if (!message) return true
  return columnNames.some((name) => (
    message.includes(`'${name}'`)
    || message.includes(`"${name}"`)
    || message.includes(`column ${name}`)
  ))
}

export function isMissingLineShopQuoteColumnError(error) {
  return missingOptionalColumnError(error, PLAYER_PROP_CACHE_QUOTE_FIELDS)
}

export async function upsertPlayerPropCacheWithOptionalQuotes(doUpsert, batch) {
  const rows = Array.isArray(batch) ? batch : []
  const first = quoteColumnsMissing ? rows.map(withoutLineShopQuoteFields) : rows
  const result = await doUpsert(first)
  if (!result?.error) return result
  if (quoteColumnsMissing) return result
  if (!isMissingLineShopQuoteColumnError(result.error)) return result
  quoteColumnsMissing = true
  return doUpsert(rows.map(withoutLineShopQuoteFields))
}

export async function writePlayerPropCacheRows(client, rows, mode = 'upsert') {
  const doWrite = async (payload) => {
    const table = client.from('PlayerPropCache')
    if (mode === 'insert') return table.insert(payload)
    return table.upsert(payload, { onConflict: 'propId', ignoreDuplicates: false })
  }
  return upsertPlayerPropCacheWithOptionalQuotes(doWrite, rows)
}

export function attachEntryBook(row, source = row) {
  if (!row || typeof row !== 'object') return row
  const book = source?.entryBook || source?.bookmaker || source?.bestBook
  if (book == null || String(book).trim() === '') return row
  return { ...row, entryBook: String(book).slice(0, 64) }
}

export function withoutEntryBookFields(payload) {
  const next = { ...(payload || {}) }
  for (const key of PROP_VALIDATION_ENTRY_BOOK_FIELDS) delete next[key]
  return next
}

export function isMissingEntryBookColumnError(error) {
  return missingOptionalColumnError(error, PROP_VALIDATION_ENTRY_BOOK_FIELDS)
}

export async function writeWithOptionalEntryBook(doWrite, payload) {
  const firstPayload = entryBookColumnMissing ? withoutEntryBookFields(payload) : payload
  const first = await doWrite(firstPayload)
  if (!first?.error) return first
  if (entryBookColumnMissing) return first
  if (!isMissingEntryBookColumnError(first.error)) return first
  entryBookColumnMissing = true
  return doWrite(withoutEntryBookFields(payload))
}

export function publicNumBooks(prop) {
  const quotes = parseStoredQuotes(prop?.quotes)
  if (quotes) return quotes.length
  return getBookCount(prop)
}

export function toPublicShopQuotes(quotes, { now = Date.now(), commenceTime = null } = {}) {
  const parsed = parseStoredQuotes(quotes)
  if (!parsed) return null
  return parsed.map((quote) => {
    const lastUpdate = quote.lastUpdate ?? quote.last_update ?? null
    return {
      book: quote.book || null,
      decimal: usableDecimalPrice(quote.decimal ?? quote.price) ?? quote.decimal ?? null,
      american: quote.american ?? roundedAmerican(quote.decimal ?? quote.price),
      lastUpdate,
      ageMs: quoteAgeMs(lastUpdate, now),
      stale: isQuoteStale(quote, { now, commenceTime }),
    }
  })
}

/**
 * Public shop fields for a cache row. `quotes` is null when the ladder
 * was never stored (pre-010 or degraded write) so the UI can hide it.
 * Never invents a book count.
 */
export function toPublicPropShop(prop, { now = Date.now() } = {}) {
  if (!prop || typeof prop !== 'object') return null
  const commenceTime = prop.gameTime || prop.commenceTime || null
  const quotes = toPublicShopQuotes(prop.quotes, { now, commenceTime })
  const consensusOdds = consensusOddsFromProbability(prop.probability)
  const quoteUpdatedAt = prop.quoteUpdatedAt
    || (quotes ? quoteUpdatedAtFromPrices(quotes) : null)
    || null
  const edge = Number(prop.edge)
  return {
    bestBook: prop.bookmaker || prop.bestBook || null,
    bestOdds: prop.odds ?? prop.bestOdds ?? null,
    consensusOdds,
    consensusAmerican: roundedAmerican(consensusOdds),
    edge: Number.isFinite(edge) ? edge : 0,
    numBooks: publicNumBooks(prop),
    quotes,
    quoteUpdatedAt,
  }
}
