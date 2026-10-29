/**
 * Closing-line capture + CLV for the Published track.
 *
 * CLV (closing-line value): we beat the close when the price we recorded
 * pays more than the last available price before first pitch.
 *   clvProb = implied(close) − implied(recorded)
 *   positive = market moved toward our side / we locked a better number
 *
 * Quota: one Odds API event-odds HTTP call per oddsApiEventId that
 * still has Published picks without a close, requesting only those
 * markets. Writes only where closeOdds IS NULL.
 */

import { impliedProbabilityFromOdds, toAmericanOdds, toDecimalOdds } from './odds-units.js'
import { normalizePlayerName } from './parlay-integrity.js'
import { parseRecordInstant } from './published-picks.js'
import { isMissingColumnError } from './grade-audit.js'
import { isPreStartStatus } from './game-status.js'

export const CLOSE_CAPTURE_WINDOW_MINUTES = 35
export const CLOSE_CAPTURE_MIN_LEAD_MINUTES = 1
export const CLOSE_CAPTURE_REGIONS = 1
export const CLOSE_CAPTURE_DEFAULT_MIN_REMAINING = 50
export const ODDS_API_SPORTS_URL = 'https://api.the-odds-api.com/v4/sports'
export const OPS_QUIET_MINUTE_START = 5
export const OPS_QUIET_MINUTE_END = 15
export const ET = 'America/New_York'

export const CLOSE_ODDS_FIELDS = Object.freeze([
  'closeOdds',
  'closeLine',
  'closeBook',
  'closeNumBooks',
  'closeCapturedAt',
])

export const SPORT_ODDS_API_KEY = Object.freeze({
  mlb: 'baseball_mlb',
  nfl: 'americanfootball_nfl',
})

const PROP_TYPE_TO_MARKET = Object.freeze({
  batter_hits: 'batter_hits',
  hits: 'batter_hits',
  b_hits: 'batter_hits',
  batter_total_bases: 'batter_total_bases',
  total_bases: 'batter_total_bases',
  b_total_bases: 'batter_total_bases',
  batter_home_runs: 'batter_home_runs',
  batter_runs_scored: 'batter_runs_scored',
  batter_rbis: 'batter_rbis',
  batter_singles: 'batter_singles',
  batter_doubles: 'batter_doubles',
  batter_stolen_bases: 'batter_stolen_bases',
  pitcher_strikeouts: 'pitcher_strikeouts',
  p_strikeouts: 'pitcher_strikeouts',
  strikeouts: 'pitcher_strikeouts',
  pitcher_outs: 'pitcher_outs',
  p_outs: 'pitcher_outs',
  outs: 'pitcher_outs',
  pitcher_walks: 'pitcher_walks',
  receptions: 'player_receptions',
  player_receptions: 'player_receptions',
  rec_yds: 'player_reception_yds',
  receiving_yards: 'player_reception_yds',
  player_reception_yds: 'player_reception_yds',
  pass_tds: 'player_pass_tds',
  passing_touchdowns: 'player_pass_tds',
  player_pass_tds: 'player_pass_tds',
  pass_yds: 'player_pass_yds',
  passing_yards: 'player_pass_yds',
  player_pass_yds: 'player_pass_yds',
  rush_yds: 'player_rush_yds',
  rushing_yards: 'player_rush_yds',
  player_rush_yds: 'player_rush_yds',
})

export function etClockParts(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  let hour = get('hour')
  if (hour === 24) hour = 0
  return { hour, minute: get('minute') }
}

export function isOpsWriteQuietPeriod(now = new Date()) {
  const { minute } = etClockParts(now)
  return Number.isFinite(minute)
    && minute >= OPS_QUIET_MINUTE_START
    && minute <= OPS_QUIET_MINUTE_END
}

export function oddsApiSportKey(sport) {
  return SPORT_ODDS_API_KEY[String(sport || '').toLowerCase().trim()] || null
}

export function publishedMarketKey(propType) {
  const key = String(propType || '').toLowerCase().trim()
  return PROP_TYPE_TO_MARKET[key] || (key.includes('_') ? key : null)
}

export function marketsForPublishedPicks(picks) {
  const markets = new Set()
  for (const pick of picks || []) {
    const market = publishedMarketKey(pick.propType || pick.type)
    if (market) markets.add(market)
  }
  return [...markets]
}

export function buildEventOddsUrl({
  sportKey,
  eventId,
  markets = [],
  apiKey,
  oddsFormat = 'american',
}) {
  const params = new URLSearchParams({
    regions: 'us',
    markets: markets.join(','),
    oddsFormat,
    dateFormat: 'iso',
  })
  if (apiKey) params.set('apiKey', apiKey)
  return `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?${params.toString()}`
}

export function buildSportsQuotaProbeUrl(apiKey) {
  const params = new URLSearchParams()
  if (apiKey) params.set('apiKey', apiKey)
  return `${ODDS_API_SPORTS_URL}?${params.toString()}`
}

export async function probeOddsApiQuota({
  apiKey,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(buildSportsQuotaProbeUrl(apiKey), {
    headers: { 'User-Agent': 'OddsOnDeck/1.0' },
  })
  return parseOddsApiQuota(response.headers)
}

export function parseOddsApiQuota(headers) {
  if (!headers) return { remaining: null, used: null }
  const get = (name) => {
    if (typeof headers.get === 'function') return headers.get(name)
    return headers[name] || headers[name.toLowerCase()] || null
  }
  const remaining = Number(get('x-requests-remaining'))
  const used = Number(get('x-requests-used'))
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    used: Number.isFinite(used) ? used : null,
  }
}

export function estimateCloseCaptureCalls(gameCount, marketCounts) {
  return estimateCloseCaptureCost({ gameCount, marketCounts })
}

/**
 * The Odds API bills credits as markets × regions per event-odds HTTP call.
 * We request region=us only. Credits = sum(markets_per_game × 1).
 */
export function estimateCloseCaptureCost({ gameCount = 0, marketCounts = [], regions = CLOSE_CAPTURE_REGIONS } = {}) {
  const httpCalls = Number(gameCount) || (Array.isArray(marketCounts) ? marketCounts.length : 0)
  const credits = (Array.isArray(marketCounts) && marketCounts.length
    ? marketCounts.reduce((sum, n) => sum + (Number(n) || 0), 0)
    : httpCalls) * (Number(regions) || 1)
  return {
    httpCalls,
    credits,
    regions: Number(regions) || 1,
    note: '1 HTTP call per game. Credits = markets × regions (us=1), not the morning 10-market slate.',
  }
}

/**
 * Flatten event-odds bookmakers into comparable quotes.
 */
export function flattenEventOddsQuotes(eventData) {
  const quotes = []
  for (const bookmaker of eventData?.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      for (const outcome of market.outcomes || []) {
        const pick = String(outcome.name || '').toLowerCase().trim()
        if (!['over', 'under'].includes(pick)) continue
        quotes.push({
          playerName: outcome.description || outcome.name,
          market: market.key,
          pick,
          threshold: outcome.point,
          odds: outcome.price,
          book: bookmaker.title || bookmaker.key,
        })
      }
    }
  }
  return quotes
}

function namesMatch(a, b) {
  const left = normalizePlayerName(a)
  const right = normalizePlayerName(b)
  return Boolean(left) && left === right
}

/**
 * Best same-side price (highest decimal) among quotes that match
 * player + market + pick. Prefer the recorded threshold.
 */
export function matchClosingQuote(pick, quotes) {
  const market = publishedMarketKey(pick.propType || pick.type)
  const side = String(pick.prediction || pick.pick || '').toLowerCase().trim()
  const line = Number(pick.threshold)
  const candidates = (quotes || []).filter((quote) => (
    namesMatch(quote.playerName, pick.playerName)
    && quote.market === market
    && quote.pick === side
  ))
  if (candidates.length === 0) return null

  const sameLine = Number.isFinite(line)
    ? candidates.filter((quote) => Number(quote.threshold) === line)
    : candidates
  const pool = sameLine.length ? sameLine : candidates
  const books = new Set(pool.map((quote) => quote.book).filter(Boolean))
  const best = pool.reduce((winner, quote) => {
    const dec = toDecimalOdds(quote.odds)
    const bestDec = toDecimalOdds(winner.odds)
    if (dec == null) return winner
    if (bestDec == null || dec > bestDec) return quote
    return winner
  })
  return {
    ...best,
    sameLine: sameLine.length > 0,
    numBooks: books.size || null,
  }
}

export function clvFromOdds(recordedOdds, closeOdds) {
  const recordedImplied = impliedProbabilityFromOdds(recordedOdds)
  const closeImplied = impliedProbabilityFromOdds(closeOdds)
  const recordedDecimal = toDecimalOdds(recordedOdds)
  const closeDecimal = toDecimalOdds(closeOdds)
  if (recordedImplied == null || closeImplied == null) {
    return {
      clvProb: null,
      beatClose: null,
      recordedImplied,
      closeImplied,
      recordedDecimal,
      closeDecimal,
    }
  }
  return {
    clvProb: closeImplied - recordedImplied,
    beatClose: recordedDecimal != null && closeDecimal != null
      ? recordedDecimal > closeDecimal
      : closeImplied > recordedImplied,
    recordedImplied,
    closeImplied,
    recordedDecimal,
    closeDecimal,
  }
}

export function closeLineMoved(row) {
  if (row?.closeLine == null || row?.threshold == null) return false
  return Number(row.closeLine) !== Number(row.threshold)
}

export function summarizePublishedClv(records) {
  const rows = Array.isArray(records) ? records : []
  let withClose = 0
  let sameLine = 0
  let lineMoved = 0
  let beatClose = 0
  let clvSum = 0
  let lineMovedBeatClose = 0
  let lineMovedClvSum = 0

  for (const row of rows) {
    if (row?.closeOdds == null) continue
    const clv = clvFromOdds(row.odds, row.closeOdds)
    if (clv.clvProb == null) continue
    withClose += 1
    if (closeLineMoved(row)) {
      lineMoved += 1
      lineMovedClvSum += clv.clvProb
      if (clv.beatClose) lineMovedBeatClose += 1
      continue
    }
    sameLine += 1
    clvSum += clv.clvProb
    if (clv.beatClose) beatClose += 1
  }

  return {
    sample: rows.length,
    withClose,
    withoutClose: rows.length - withClose,
    sameLine,
    lineMoved,
    beatClose,
    pctBeatClose: sameLine > 0 ? beatClose / sameLine : null,
    avgClvProb: sameLine > 0 ? clvSum / sameLine : null,
    lineMovedBeatClose,
    lineMovedAvgClvProb: lineMoved > 0 ? lineMovedClvSum / lineMoved : null,
    lineMovedPctBeatClose: lineMoved > 0 ? lineMovedBeatClose / lineMoved : null,
  }
}

export function closeCapturePayload(quote, now = new Date()) {
  const american = toAmericanOdds(quote.odds)
  return {
    closeOdds: american != null ? Math.round(american) : null,
    closeLine: quote.threshold != null ? Number(quote.threshold) : null,
    closeBook: quote.book ? String(quote.book).slice(0, 64) : null,
    closeNumBooks: Number.isFinite(Number(quote.numBooks)) ? Number(quote.numBooks) : null,
    closeCapturedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
}

export function withoutCloseOddsFields(payload) {
  const next = { ...(payload || {}) }
  for (const key of CLOSE_ODDS_FIELDS) delete next[key]
  return next
}

let closeColumnsMissing = false

export function resetCloseColumnCache() {
  closeColumnsMissing = false
}

export async function updateWithOptionalCloseOdds(doUpdate, payload) {
  const firstPayload = closeColumnsMissing ? withoutCloseOddsFields(payload) : payload
  const first = await doUpdate(firstPayload)
  if (!first?.error) return first
  if (closeColumnsMissing) return first
  if (!isMissingColumnError(first.error)) return first
  closeColumnsMissing = true
  return doUpdate(withoutCloseOddsFields(payload))
}

export function gameIsInCloseWindow(
  game,
  now = new Date(),
  windowMinutes = CLOSE_CAPTURE_WINDOW_MINUTES,
  minLeadMinutes = CLOSE_CAPTURE_MIN_LEAD_MINUTES,
) {
  const start = parseRecordInstant(game?.date || game?.gameDate)
  const instant = now instanceof Date ? now : new Date(now)
  if (!start || Number.isNaN(instant.getTime())) return false
  const ms = start.getTime() - instant.getTime()
  const leadMs = Number(minLeadMinutes) * 60 * 1000
  return ms > leadMs && ms <= windowMinutes * 60 * 1000
}

/**
 * Capture candidates are pre-start only. Live / final / postponed /
 * cancelled rows can still have a date inside T−35..T−1.
 */
export function isCloseCaptureCandidate(game, now = new Date()) {
  return isPreStartStatus(game?.status) && gameIsInCloseWindow(game, now)
}

/**
 * One Odds API event-odds call per oddsApiEventId. Duplicate Game rows
 * that share an event id merge their picks onto the first job.
 */
export function groupCaptureJobsByOddsApiEventId(byGame, gamesById) {
  const jobs = []
  const indexByEvent = new Map()
  for (const [gameId, picks] of byGame || []) {
    const game = gamesById?.get(gameId)
    const eventId = game?.oddsApiEventId || null
    if (eventId && indexByEvent.has(eventId)) {
      const job = jobs[indexByEvent.get(eventId)]
      job.gameIds.push(gameId)
      job.picks.push(...(picks || []))
      continue
    }
    if (eventId) indexByEvent.set(eventId, jobs.length)
    jobs.push({
      gameId,
      gameIds: [gameId],
      game,
      eventId,
      picks: [...(picks || [])],
    })
  }
  return jobs
}

/** Never overwrite a stored close. Re-runs stay idempotent. */
export function applyPublishedCloseUpdate(table, pickId, body) {
  return table.update(body).eq('id', pickId).is('closeOdds', null)
}

export function hasCloseAlready(row) {
  return row?.closeOdds != null && Boolean(row?.closeCapturedAt)
}
