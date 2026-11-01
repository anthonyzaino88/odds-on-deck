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
 *
 * --nfl-all (opt-in): also target every pending NFL prop without a close
 * (Published bar does not apply) and merge h2h / spreads / totals onto
 * that same per-game request. Game-line closes land in ClosingOdds.
 */

import { impliedProbabilityFromOdds, toAmericanOdds, toDecimalOdds } from './odds-units.js'
import { normalizePlayerName } from './parlay-integrity.js'
import {
  isCloseCaptureEligiblePick,
  parseRecordInstant,
  PUBLISHED_SPORTS,
  SHADOW_PUBLISHED_SPORTS,
} from './published-picks.js'
import { isGameLineRecord } from './game-lines.js'
import { isLegacyNhlModelRecord } from './edge-nfl-nhl.js'
import { isMissingColumnError } from './grade-audit.js'
import { isPreStartStatus, statusMatches } from './game-status.js'

/** Stored rain-delay token from fetch-fresh-games (`STATUS_RAIN_DELAY`). */
const CLOSE_CAPTURE_DELAY = Object.freeze(new Set([
  'delayed',
  'rain_delay',
  'rain delay',
  'STATUS_RAIN_DELAY',
]))

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
  nhl: 'icehockey_nhl',
})

/** Odds API game-line markets merged onto each --nfl-all NFL event call. */
export const NFL_GAME_LINE_MARKETS = Object.freeze(['h2h', 'spreads', 'totals'])
export const NFL_ALL_SPORT = 'nfl'
/** Existing ClosingOdds.id carries the source tag. Not a new column. */
export const CLOSE_CAPTURE_ID_PREFIX = 'clvclose:'

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
  player_shots_on_goal: 'player_shots_on_goal',
  shots: 'player_shots_on_goal',
  sog: 'player_shots_on_goal',
  player_points: 'player_points',
  player_goals: 'player_goals',
  player_assists: 'player_assists',
  player_blocked_shots: 'player_blocked_shots',
  player_power_play_points: 'player_power_play_points',
  player_total_saves: 'player_total_saves',
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

export function isNflSport(sport) {
  return String(sport || '').toLowerCase().trim() === NFL_ALL_SPORT
}

export function isNflAllPendingProp(record) {
  if (!record || typeof record !== 'object') return false
  if (!isNflSport(record.sport)) return false
  if (isGameLineRecord(record)) return false
  if (String(record.status || '').toLowerCase().trim() !== 'pending') return false
  return !hasCloseAlready(record)
}

/** Published / shadow picks, plus every pending NFL prop when --nfl-all. */
export function isTargetedCloseCapturePick(record, { nflAll = false } = {}) {
  if (!record || typeof record !== 'object') return false
  if (hasCloseAlready(record)) return false
  if (isCloseCaptureEligiblePick(record)) return true
  return Boolean(nflAll) && isNflAllPendingProp(record)
}

/**
 * One event-odds market list per game. --nfl-all merges moneyline /
 * spread / total onto the NFL request so we never add a second HTTP call.
 */
export function marketsForCaptureJob(job, { nflAll = false, gameLinesCaptured = false } = {}) {
  const markets = new Set(marketsForPublishedPicks(job?.picks))
  if (nflAll && isNflSport(job?.game?.sport) && !gameLinesCaptured) {
    for (const market of NFL_GAME_LINE_MARKETS) markets.add(market)
  }
  return [...markets]
}

export function closeCaptureJobPriority(job) {
  const sport = String(job?.game?.sport || '').toLowerCase().trim()
  if (PUBLISHED_SPORTS.includes(sport)) return 0
  if (SHADOW_PUBLISHED_SPORTS.includes(sport)) return 1
  return 2
}

export function captureJobKickoffMs(job) {
  const start = parseRecordInstant(job?.game?.date || job?.game?.gameDate)
  return start ? start.getTime() : Number.POSITIVE_INFINITY
}

/**
 * Default: Published sports first so shadow NHL shares leftover budget.
 * --nfl-all: soonest kickoff first so --max-calls spends on games about
 * to start.
 */
export function sortCloseCaptureJobs(jobs, { nflAll = false } = {}) {
  return [...(jobs || [])].sort((a, b) => {
    if (nflAll) {
      const kickoff = captureJobKickoffMs(a) - captureJobKickoffMs(b)
      if (kickoff !== 0) return kickoff
    }
    const priority = closeCaptureJobPriority(a) - closeCaptureJobPriority(b)
    if (priority !== 0) return priority
    return captureJobKickoffMs(a) - captureJobKickoffMs(b)
  })
}

/** Add empty pick lists for in-window NFL games so game-line-only calls exist. */
export function includeNflWindowGamesForGameLines(byGame, windowGames, {
  nflAll = false,
  capturedGameIds = new Set(),
} = {}) {
  const next = byGame instanceof Map ? byGame : new Map(byGame || [])
  if (!nflAll) return next
  const already = capturedGameIds instanceof Set ? capturedGameIds : new Set(capturedGameIds || [])
  for (const game of windowGames || []) {
    if (!game?.id || !isNflSport(game.sport)) continue
    if (already.has(game.id)) continue
    if (!next.has(game.id)) next.set(game.id, [])
  }
  return next
}

export function fetchableCloseCaptureJobCount(jobs) {
  return (jobs || []).filter((job) => job?.eventId && oddsApiSportKey(job?.game?.sport)).length
}

/**
 * Planned HTTP calls for a run: one /v4/sports quota probe plus one
 * event-odds call per fetchable job (mapped event id required).
 * --max-calls caps the total, probe included.
 */
export function plannedCloseCaptureHttpCalls({
  jobCount = 0,
  jobs = null,
  maxCalls = null,
  includeQuota = true,
} = {}) {
  const mapped = Array.isArray(jobs)
    ? fetchableCloseCaptureJobCount(jobs)
    : Math.max(0, Number(jobCount) || 0)
  const quota = includeQuota && mapped > 0 ? 1 : 0
  let planned = quota + mapped
  if (maxCalls != null && Number.isFinite(Number(maxCalls))) {
    planned = Math.min(planned, Math.max(0, Number(maxCalls)))
  }
  return planned
}

export function creditCostForMarkets(marketCount, regions = CLOSE_CAPTURE_REGIONS) {
  return Math.max(0, Number(marketCount) || 0) * (Number(regions) || 1)
}

export function formatCallsUsed(calls) {
  return `CALLS_USED=${Number(calls) || 0}`
}

export function formatCreditsUsed(credits) {
  return `CREDITS_USED=${Number(credits) || 0}`
}

/**
 * Pick jobs that fit --max-calls / --max-credits. Caller must already
 * sort (soonest kickoff when --nfl-all). Unmapped jobs are excluded.
 */
export function selectCloseCaptureJobsWithinBudget(jobs, {
  nflAll = false,
  maxCalls = null,
  maxCredits = null,
  gameLinesCapturedByGameId = new Set(),
} = {}) {
  const captured = gameLinesCapturedByGameId instanceof Set
    ? gameLinesCapturedByGameId
    : new Set(gameLinesCapturedByGameId || [])
  const selected = []
  let eventCalls = 0
  let credits = 0
  if (maxCalls != null && maxCalls <= 0) {
    return { jobs: selected, plannedCalls: 0, plannedCredits: 0 }
  }
  for (const job of jobs || []) {
    if (!job?.eventId || !oddsApiSportKey(job?.game?.sport)) continue
    const jobGameIds = [...new Set([job.gameId, ...(job.gameIds || [])].filter(Boolean))]
    const gameLinesCaptured = jobGameIds.length > 0
      && jobGameIds.every((id) => captured.has(id))
    const markets = marketsForCaptureJob(job, { nflAll, gameLinesCaptured })
    if (!markets.length) continue
    const jobCredits = creditCostForMarkets(markets.length)
    const nextHttp = 1 + eventCalls + 1
    if (maxCalls != null && nextHttp > maxCalls) break
    if (maxCredits != null && credits + jobCredits > maxCredits) break
    selected.push({ ...job, markets, creditCost: jobCredits })
    eventCalls += 1
    credits += jobCredits
  }
  return {
    jobs: selected,
    plannedCalls: selected.length ? 1 + selected.length : 0,
    plannedCredits: credits,
  }
}

function outcomeName(outcome) {
  return String(outcome?.name || '').trim()
}

function findTeamOutcome(outcomes, teamName) {
  const wanted = String(teamName || '').trim().toLowerCase()
  if (!wanted) return null
  return (outcomes || []).find((outcome) => outcomeName(outcome).toLowerCase() === wanted) || null
}

/**
 * Flatten h2h / spreads / totals into ClosingOdds rows (snake_case columns).
 * One row per book + market. Home spread is the stored `spread`.
 * Totals match lib/vendors/odds.js getBestLines: price_home = Over,
 * price_away = Under.
 */
export function gameLineClosesFromEventOdds(eventData, {
  gameId,
  sport = NFL_ALL_SPORT,
  capturedAt = new Date(),
} = {}) {
  const homeTeam = eventData?.home_team || eventData?.homeTeam
  const awayTeam = eventData?.away_team || eventData?.awayTeam
  const snapshotAt = (capturedAt instanceof Date ? capturedAt : new Date(capturedAt)).toISOString()
  const rows = []
  if (!gameId) return rows

  for (const bookmaker of eventData?.bookmakers || []) {
    const book = bookmaker.title || bookmaker.key
    if (!book) continue
    for (const market of bookmaker.markets || []) {
      const key = String(market.key || '').toLowerCase().trim()
      if (!NFL_GAME_LINE_MARKETS.includes(key)) continue
      const outcomes = market.outcomes || []
      let priceHome = null
      let priceAway = null
      let spread = null
      let total = null

      if (key === 'h2h') {
        const home = findTeamOutcome(outcomes, homeTeam)
        const away = findTeamOutcome(outcomes, awayTeam)
        if (!home || !away) continue
        priceHome = home.price
        priceAway = away.price
      } else if (key === 'spreads') {
        const home = findTeamOutcome(outcomes, homeTeam)
        const away = findTeamOutcome(outcomes, awayTeam)
        if (!home || !away) continue
        priceHome = home.price
        priceAway = away.price
        if (home.point != null && Number.isFinite(Number(home.point))) {
          spread = Number(home.point)
        } else if (away.point != null && Number.isFinite(Number(away.point))) {
          spread = -Number(away.point)
        }
      } else if (key === 'totals') {
        const over = (outcomes || []).find((outcome) => outcomeName(outcome).toLowerCase() === 'over')
        const under = (outcomes || []).find((outcome) => outcomeName(outcome).toLowerCase() === 'under')
        if (!over || !under) continue
        priceHome = over.price
        priceAway = under.price
        const point = over.point != null ? over.point : under.point
        if (point != null && Number.isFinite(Number(point))) total = Number(point)
      }

      if (priceHome == null && priceAway == null) continue
      rows.push({
        id: closeCaptureRowId(gameId, book, key),
        game_id: gameId,
        sport: String(sport || NFL_ALL_SPORT).toLowerCase().trim(),
        book: String(book),
        market: key,
        price_home: priceHome != null ? Number(priceHome) : null,
        price_away: priceAway != null ? Number(priceAway) : null,
        total,
        spread,
        snapshot_at: snapshotAt,
      })
    }
  }
  return rows
}

export function gameLineClosesForCaptureJob(job, eventData, now = new Date()) {
  const rows = []
  if (!isNflSport(job?.game?.sport)) return rows
  for (const gameId of job?.gameIds || [job?.gameId]) {
    if (!gameId) continue
    rows.push(...gameLineClosesFromEventOdds(eventData, {
      gameId,
      sport: NFL_ALL_SPORT,
      capturedAt: now,
    }))
  }
  return rows
}

export function closingOddsRowKey(row) {
  const gameId = row?.game_id ?? row?.gameId ?? ''
  const book = row?.book ?? ''
  const market = row?.market ?? ''
  return `${String(gameId).toLowerCase()}|${String(book).toLowerCase()}|${String(market).toLowerCase()}`
}

export function closeCaptureRowId(gameId, book, market) {
  return `${CLOSE_CAPTURE_ID_PREFIX}${closingOddsRowKey({
    game_id: gameId,
    book,
    market,
  })}`
}

export function isCloseCaptureTaggedId(id) {
  return String(id || '').toLowerCase().startsWith(CLOSE_CAPTURE_ID_PREFIX)
}

/** snapshot_at is inside that game's T−35..T−1 close window. */
export function isCloseCaptureSnapshotAt(snapshotAt, game) {
  if (!game || snapshotAt == null) return false
  return gameIsInCloseWindow(game, snapshotAt)
}

/**
 * A ClosingOdds row is from this close-capture job only when its id is
 * tagged or its snapshot_at landed in the game's T−35..T−1 window.
 * Morning snapshot-closing-lines rows (same book title, up to 2h out)
 * do not count, so they cannot block the true close.
 */
export function isCloseCaptureClosingOddsRow(row, game) {
  if (!row || typeof row !== 'object') return false
  if (isCloseCaptureTaggedId(row.id)) return true
  const snapshotAt = row.snapshot_at ?? row.snapshotAt
  return isCloseCaptureSnapshotAt(snapshotAt, game)
}

export function nflGameLineMarketsAlreadyCaptured(game, existingRows = []) {
  if (!game?.id) return false
  const markets = new Set()
  for (const row of existingRows || []) {
    const rowGame = row.game_id ?? row.gameId
    if (String(rowGame) !== String(game.id)) continue
    if (!isCloseCaptureClosingOddsRow(row, game)) continue
    const market = String(row.market || '').toLowerCase().trim()
    if (market) markets.add(market)
  }
  return NFL_GAME_LINE_MARKETS.every((market) => markets.has(market))
}

export function capturedNflGameLineGameIds(games, existingRows = []) {
  const ids = new Set()
  for (const game of games || []) {
    if (nflGameLineMarketsAlreadyCaptured(game, existingRows)) ids.add(game.id)
  }
  return ids
}

const inProcessClosingOddsKeys = new Set()

export function resetClosingOddsWriteGuard() {
  inProcessClosingOddsKeys.clear()
}

export function filterNewClosingOddsRows(proposed, existing = [], {
  gamesById,
  seenKeys = inProcessClosingOddsKeys,
} = {}) {
  const captured = new Set(seenKeys || [])
  for (const row of existing || []) {
    const gameId = row.game_id ?? row.gameId
    const game = gamesById?.get(gameId)
    if (!isCloseCaptureClosingOddsRow(row, game)) continue
    captured.add(closingOddsRowKey(row))
  }
  const fresh = []
  for (const row of proposed || []) {
    const key = closingOddsRowKey(row)
    if (!key || captured.has(key)) continue
    captured.add(key)
    if (seenKeys) seenKeys.add(key)
    fresh.push(row)
  }
  return fresh
}

export async function loadExistingClosingOdds(supabase, gameIds) {
  const ids = [...new Set((gameIds || []).filter(Boolean))]
  if (!ids.length) return { rows: [], error: null }
  const { data, error } = await supabase
    .from('ClosingOdds')
    .select('id, game_id, book, market, snapshot_at')
    .in('game_id', ids)
  if (error) return { rows: [], error }
  return { rows: data || [], error: null }
}

export function isDuplicateClosingOddsError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '23505'
    || message.includes('duplicate')
    || message.includes('unique')
    || message.includes('already exists')
}

/**
 * Insert only rows this job has not already captured. Early snapshot
 * rows on the same game/book/market do not count. Deterministic ids
 * plus an in-process key set guard same-run duplicates. Overlapping
 * apply processes can still race — do not overlap capture runs.
 */
export async function writeGameLineCloses(supabase, rows, {
  gamesById,
  seenKeys = inProcessClosingOddsKeys,
} = {}) {
  const proposed = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    id: row.id || closeCaptureRowId(row.game_id || row.gameId, row.book, row.market),
  }))
  if (!proposed.length) return { inserted: 0, skipped: 0, rows: [], error: null }
  const gameIds = proposed.map((row) => row.game_id || row.gameId)
  const existing = await loadExistingClosingOdds(supabase, gameIds)
  if (existing.error) return { inserted: 0, skipped: 0, rows: [], error: existing.error }
  const fresh = filterNewClosingOddsRows(proposed, existing.rows, { gamesById, seenKeys })
  if (!fresh.length) {
    return { inserted: 0, skipped: proposed.length, rows: [], error: null }
  }
  const { error } = await supabase.from('ClosingOdds').insert(fresh)
  if (error) {
    if (isDuplicateClosingOddsError(error)) {
      for (const row of fresh) seenKeys.add(closingOddsRowKey(row))
      return { inserted: 0, skipped: proposed.length, rows: [], error: null }
    }
    return { inserted: 0, skipped: 0, rows: [], error }
  }
  for (const row of fresh) seenKeys.add(closingOddsRowKey(row))
  return {
    inserted: fresh.length,
    skipped: proposed.length - fresh.length,
    rows: fresh,
    error: null,
  }
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
  const rows = (Array.isArray(records) ? records : [])
    .filter((row) => !isLegacyNhlModelRecord(row))
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
  const american = toAmericanOdds(quote?.odds)
  if (american == null || !Number.isFinite(american)) return null
  return {
    closeOdds: Math.round(american),
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
 * Pre-start, plus the stored `delayed` rain-delay token. Mid-game
 * delays after first pitch fall out of T−35..T−1 on the clock.
 */
export function isCloseCaptureStatus(status) {
  return isPreStartStatus(status) || statusMatches(CLOSE_CAPTURE_DELAY, status)
}

/**
 * Capture candidates are pre-start (or a pre-pitch rain delay). Live /
 * final / postponed / cancelled rows can still have a date inside
 * T−35..T−1.
 */
export function isCloseCaptureCandidate(game, now = new Date()) {
  return isCloseCaptureStatus(game?.status) && gameIsInCloseWindow(game, now)
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
  return table.update(body).eq('id', pickId).is('closeOdds', null).select('id')
}

export function closeUpdateRowCount(write) {
  if (!write || write.error) return null
  if (Array.isArray(write.data)) return write.data.length
  if (Number.isFinite(Number(write.count))) return Number(write.count)
  return null
}

export function hasCloseAlready(row) {
  return row?.closeOdds != null || Boolean(row?.closeCapturedAt)
}
