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
/**
 * Existing ClosingOdds.id carries the source tag. Not a new column.
 * Prisma: String @id; SQL: TEXT PRIMARY KEY. Deterministic clvclose:
 * ids therefore hit the existing primary key on overlap.
 */
export const CLOSE_CAPTURE_ID_PREFIX = 'clvclose:'
export const CLOSE_CAPTURE_ATTEMPTED_BOOK = 'attempted'
/** Postgres unique_violation. ClosingOdds.id is the TEXT primary key. */
export const POSTGRES_UNIQUE_VIOLATION = '23505'
export const CLOSING_ODDS_PKEY = 'ClosingOdds_pkey'

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
 *
 * Totals: Over = price_away, Under = price_home. That matches
 * fetch-live-odds, snapshot-closing-lines, lib/edge.js,
 * lib/edge-nfl-nhl.js, lib/picks.js, and lib/simple-parlay-generator.js.
 * lib/vendors/odds.js getBestLines is the outlier (Over = priceHome)
 * and is left unchanged.
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
        priceAway = over.price
        priceHome = under.price
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

export function attemptedGameLineCloseRow(gameId, market, capturedAt = new Date()) {
  const snapshotAt = (capturedAt instanceof Date ? capturedAt : new Date(capturedAt)).toISOString()
  return {
    id: closeCaptureRowId(gameId, CLOSE_CAPTURE_ATTEMPTED_BOOK, market),
    game_id: gameId,
    sport: NFL_ALL_SPORT,
    book: CLOSE_CAPTURE_ATTEMPTED_BOOK,
    market,
    price_home: null,
    price_away: null,
    total: null,
    spread: null,
    snapshot_at: snapshotAt,
  }
}

/** After one fetch, mark missing markets so the game is not refetched. */
export function fillMissingNflGameLineAttempts(rows, gameIds, capturedAt = new Date()) {
  const next = [...(rows || [])]
  for (const gameId of [...new Set((gameIds || []).filter(Boolean))]) {
    const present = new Set(
      next
        .filter((row) => String(row.game_id || row.gameId) === String(gameId))
        .map((row) => String(row.market || '').toLowerCase().trim()),
    )
    for (const market of NFL_GAME_LINE_MARKETS) {
      if (present.has(market)) continue
      next.push(attemptedGameLineCloseRow(gameId, market, capturedAt))
    }
  }
  return next
}

export function gameLineClosesForCaptureJob(job, eventData, now = new Date()) {
  const rows = []
  if (!isNflSport(job?.game?.sport)) return rows
  const gameIds = [...new Set((job?.gameIds || [job?.gameId]).filter(Boolean))]
  for (const gameId of gameIds) {
    rows.push(...gameLineClosesFromEventOdds(eventData, {
      gameId,
      sport: NFL_ALL_SPORT,
      capturedAt: now,
    }))
  }
  return fillMissingNflGameLineAttempts(rows, gameIds, now)
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

/**
 * A ClosingOdds row is from this close-capture job only when its id
 * starts with clvclose:. snapshot_at is not used: snapshot-closing-lines
 * stamps insert time, so a T-30 snapshot would otherwise block the close.
 */
export function isCloseCaptureClosingOddsRow(row) {
  return isCloseCaptureTaggedId(row?.id)
}

export function nflGameLineMarketsAlreadyCaptured(game, existingRows = []) {
  if (!game?.id) return false
  const markets = new Set()
  for (const row of existingRows || []) {
    const rowGame = row.game_id ?? row.gameId
    if (String(rowGame) !== String(game.id)) continue
    if (!isCloseCaptureClosingOddsRow(row)) continue
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
  seenKeys = inProcessClosingOddsKeys,
} = {}) {
  const captured = new Set(seenKeys || [])
  for (const row of existing || []) {
    if (!isCloseCaptureClosingOddsRow(row)) continue
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

function constraintNameFromText(text) {
  const match = String(text || '').match(/constraint\s+"([^"]+)"/i)
  return match?.[1] || null
}

/**
 * Postgres / PostgREST sometimes expose the constraint as `constraint`,
 * `constraint_name`, or a quoted name inside `message` / `details`.
 */
export function exposedClosingOddsConstraint(error) {
  const direct = error?.constraint
    || error?.constraint_name
    || error?.constraintName
    || null
  if (direct) return String(direct)
  return constraintNameFromText(error?.message)
    || constraintNameFromText(error?.details)
    || null
}

/**
 * True only for Postgres unique_violation (23505). Prefer
 * ClosingOdds_pkey when the constraint is named; if it is not
 * exposed, fall back to the code alone. Other unique constraints
 * and message-only "duplicate" / "already exists" strings do not match.
 */
export function isDuplicateClosingOddsError(error) {
  if (String(error?.code || '') !== POSTGRES_UNIQUE_VIOLATION) return false
  const constraint = exposedClosingOddsConstraint(error)
  if (!constraint) return true
  return String(constraint).includes(CLOSING_ODDS_PKEY)
}

export function isAttemptedClosingOddsBook(book) {
  return String(book || '').toLowerCase().trim() === CLOSE_CAPTURE_ATTEMPTED_BOOK
}

/** Sentinel book=attempted rows are not research quotes. */
export function isResearchArchiveClosingOddsRow(row) {
  return !isAttemptedClosingOddsBook(row?.book)
}

export function filterClosingOddsForResearchArchive(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isResearchArchiveClosingOddsRow)
}

async function insertClosingOdds(supabase, rows) {
  try {
    return await supabase.from('ClosingOdds').insert(rows)
  } catch (error) {
    return { data: null, error }
  }
}

function markClosingOddsCaptured(seenKeys, row) {
  if (seenKeys) seenKeys.add(closingOddsRowKey(row))
}

function unmarkClosingOddsCaptured(seenKeys, row) {
  if (seenKeys) seenKeys.delete(closingOddsRowKey(row))
}

/**
 * A batch insert is atomic: one 23505 rolls back every row. Retry
 * one-by-one so only true duplicates are skipped / marked captured
 * and the rest still insert.
 */
export async function insertClosingOddsRowsHandlingDuplicates(supabase, rows, {
  seenKeys = inProcessClosingOddsKeys,
} = {}) {
  const batch = Array.isArray(rows) ? rows : []
  if (!batch.length) return { inserted: 0, skipped: 0, failed: 0, rows: [], error: null }

  const first = await insertClosingOdds(supabase, batch)
  if (!first?.error) {
    for (const row of batch) markClosingOddsCaptured(seenKeys, row)
    return { inserted: batch.length, skipped: 0, failed: 0, rows: batch, error: null }
  }
  if (!isDuplicateClosingOddsError(first.error)) {
    for (const row of batch) unmarkClosingOddsCaptured(seenKeys, row)
    return { inserted: 0, skipped: 0, failed: batch.length, rows: [], error: first.error }
  }

  const inserted = []
  let skippedDuplicates = 0
  let failed = 0
  let firstOtherError = null
  for (const row of batch) {
    const single = await insertClosingOdds(supabase, [row])
    if (!single?.error) {
      markClosingOddsCaptured(seenKeys, row)
      inserted.push(row)
      continue
    }
    if (isDuplicateClosingOddsError(single.error)) {
      markClosingOddsCaptured(seenKeys, row)
      skippedDuplicates += 1
      continue
    }
    unmarkClosingOddsCaptured(seenKeys, row)
    failed += 1
    if (!firstOtherError) firstOtherError = single.error
  }

  return {
    inserted: inserted.length,
    skipped: skippedDuplicates,
    failed,
    rows: inserted,
    error: firstOtherError,
  }
}

/**
 * Insert only rows this job has not already captured (clvclose: ids).
 * Deterministic TEXT primary keys plus an in-process key set guard
 * same-run duplicates. Overlapping applies hit ClosingOdds_pkey
 * (23505). A batch 23505 is retried row-by-row: duplicates are
 * already captured, other rows still insert.
 */
export async function writeGameLineCloses(supabase, rows, {
  gamesById,
  seenKeys = inProcessClosingOddsKeys,
} = {}) {
  const proposed = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    id: row.id || closeCaptureRowId(row.game_id || row.gameId, row.book, row.market),
  }))
  if (!proposed.length) return { inserted: 0, skipped: 0, failed: 0, rows: [], error: null }
  const gameIds = proposed.map((row) => row.game_id || row.gameId)
  const existing = await loadExistingClosingOdds(supabase, gameIds)
  if (existing.error) return { inserted: 0, skipped: 0, failed: 0, rows: [], error: existing.error }
  const fresh = filterNewClosingOddsRows(proposed, existing.rows, { gamesById, seenKeys })
  if (!fresh.length) {
    return { inserted: 0, skipped: proposed.length, failed: 0, rows: [], error: null }
  }
  const written = await insertClosingOddsRowsHandlingDuplicates(supabase, fresh, { seenKeys })
  const failed = written.failed || 0
  return {
    inserted: written.inserted,
    skipped: proposed.length - written.inserted - failed,
    failed,
    rows: written.rows,
    error: written.error || null,
  }
}

function closingOddsNumericTotal(row) {
  const raw = row?.total
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function closingOddsSnapshotMs(row) {
  const raw = row?.snapshot_at ?? row?.snapshotAt
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isNaN(ms) ? null : ms
}

function parseKickoffMs(kickoff) {
  if (!kickoff) return null
  const instant = kickoff instanceof Date ? kickoff : new Date(kickoff)
  const ms = instant.getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Totals: Over = price_away, Under = price_home. Same convention as
 * capture writes, fetch-live-odds, snapshot-closing-lines, and edge.
 */
export function closingTotalOverUnderPrices(row) {
  const over = row?.price_away ?? row?.priceAway
  const under = row?.price_home ?? row?.priceHome
  return {
    over: over == null ? null : Number(over),
    under: under == null ? null : Number(under),
  }
}

export function compareClosingOddsRowsDeterministic(a, b) {
  const aSnap = closingOddsSnapshotMs(a)
  const bSnap = closingOddsSnapshotMs(b)
  const aRank = aSnap == null ? Number.NEGATIVE_INFINITY : aSnap
  const bRank = bSnap == null ? Number.NEGATIVE_INFINITY : bSnap
  if (aRank !== bRank) return bRank - aRank
  const bookCmp = String(a?.book || '').localeCompare(String(b?.book || ''))
  if (bookCmp) return bookCmp
  const marketCmp = String(a?.market || '').localeCompare(String(b?.market || ''))
  if (marketCmp) return marketCmp
  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

function isTotalsMarket(row) {
  return String(row?.market || '').toLowerCase().trim() === 'totals'
}

function usableClosingTotalRows(rows) {
  return (rows || []).filter((row) => (
    isTotalsMarket(row)
    && !isAttemptedClosingOddsBook(row?.book)
    && closingOddsNumericTotal(row) != null
  ))
}

/**
 * Prefer a clvclose: totals row (never book=attempted). If none, take
 * the latest snapshot_at strictly before kickoff. Ties break by book,
 * market, then id so the pick is deterministic.
 */
export function selectClosingTotalRow(rows, { kickoff = null } = {}) {
  const usable = usableClosingTotalRows(rows)
  if (!usable.length) return null

  const tagged = usable.filter((row) => isCloseCaptureTaggedId(row?.id))
  if (tagged.length) {
    return [...tagged].sort(compareClosingOddsRowsDeterministic)[0]
  }

  const kickoffMs = parseKickoffMs(kickoff)
  const snapshots = Number.isFinite(kickoffMs)
    ? usable.filter((row) => {
      const snap = closingOddsSnapshotMs(row)
      return snap != null && snap < kickoffMs
    })
    : usable
  if (!snapshots.length) return null
  return [...snapshots].sort(compareClosingOddsRowsDeterministic)[0]
}

export function closingTotalsByGame(rows, gamesById = new Map()) {
  const grouped = new Map()
  for (const row of rows || []) {
    const gameId = row?.game_id ?? row?.gameId
    if (!gameId) continue
    if (!grouped.has(gameId)) grouped.set(gameId, [])
    grouped.get(gameId).push(row)
  }

  const lookup = (gameId) => {
    if (gamesById instanceof Map) return gamesById.get(gameId)
    return gamesById?.[gameId] || null
  }

  const map = new Map()
  for (const [gameId, gameRows] of grouped) {
    const game = lookup(gameId)
    const selected = selectClosingTotalRow(gameRows, {
      kickoff: game?.date || game?.gameDate || null,
    })
    if (!selected) continue
    const prices = closingTotalOverUnderPrices(selected)
    map.set(gameId, {
      line: closingOddsNumericTotal(selected),
      book: selected.book,
      id: selected.id || null,
      snapshotAt: selected.snapshot_at ?? selected.snapshotAt ?? null,
      overPrice: Number.isFinite(prices.over) ? prices.over : null,
      underPrice: Number.isFinite(prices.under) ? prices.under : null,
    })
  }
  return map
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
