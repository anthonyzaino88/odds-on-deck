/**
 * Pure helpers for fetch-live-odds: map events to the right Game row
 * and stamp props/odds with the redirected game's date (or commence_time).
 * No I/O — scripts/ and operations/ call these from their write loops.
 */

import { parseSupabaseDate } from './date-utils.js'
import { etDayStartIso, shiftEtDate } from './game-reconcile.js'
import { isMissingQuotedAtColumnError, omitQuotedAtFields, quoteTimeIso } from './odds-quote-time.js'
import { isCancelledGameStatus } from './game-grade-eligibility.js'
import { parseStoredGameDate } from './score-updater.js'
import { isFinalStatus, isPreStartStatus } from './game-status.js'
import { resolveSportTeamCode } from './team-mapping.js'
import { getNFLWeekBounds } from './todays-games.js'

/**
 * How savePlayerProps should treat a mapped Game.
 * Final → look for a later scheduled sibling.
 * Cancelled / not_needed → skip (do not move those props onto another game).
 */
export function propSaveDecision(game) {
  if (isCancelledGameStatus(game?.status)) return 'skip'
  if (isFinalStatus(game?.status) || String(game?.status || '').toLowerCase() === 'final') return 'redirect'
  return 'keep'
}

/** Skip by Game.id so a shared oddsApiEventId on a retired row cannot hide a live row. */
export function gamesEligibleForPropSave(dbGames) {
  return (dbGames || []).filter((game) => {
    if (!game?.oddsApiEventId) return false
    return propSaveDecision(game) !== 'skip'
  })
}

export function storedInstantIso(value) {
  const parsed = value instanceof Date ? value : parseStoredGameDate(value)
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function eventCommenceMs(commenceTime, fallbackDate) {
  const fromEvent = storedInstantIso(commenceTime)
  if (fromEvent) return Date.parse(fromEvent)
  if (fallbackDate) {
    const fallback = Date.parse(`${fallbackDate}T12:00:00.000Z`)
    if (Number.isFinite(fallback)) return fallback
  }
  return NaN
}

/**
 * Only unmapped Game rows may receive a new oddsApiEventId.
 * Falling back to the closest already-mapped sibling steals that
 * event and lands odds/props on the wrong game (doubleheaders, makeups).
 */
export function isOpenForOddsEvent(game, eventId) {
  const mapped = game?.oddsApiEventId
  if (mapped == null || mapped === '') return true
  return eventId != null && eventId !== '' && String(mapped) === String(eventId)
}

/**
 * saveGameOdds team-name fallback: first same-teams row that is still
 * unmapped (or already this event). A mapped sibling must not be stolen.
 */
export function pickOpenTeamMatch(games, eventId) {
  return (games || []).find((game) => isOpenForOddsEvent(game, eventId)) || null
}

/**
 * Team-name fallback for saveGameOdds.
 * ±1 day is only for timezone / date-boundary misses (no same-day
 * team matches at all). If same-day matches exist but are all mapped
 * to other events, stay unmapped — do not attach to tomorrow's game.
 */
export function resolveTeamNameFallback(sameDayMatches, adjacentDayMatches, eventId) {
  const sameDay = Array.isArray(sameDayMatches) ? sameDayMatches : []
  if (sameDay.length > 0) return pickOpenTeamMatch(sameDay, eventId)
  return pickOpenTeamMatch(adjacentDayMatches, eventId)
}

/**
 * Game columns mapAndSaveEventIds must load. `status` is required:
 * pickUnmappedOddsGame only maps pre-start rows.
 */
export const MAP_EVENT_GAME_SELECT =
  'id, sport, date, status, homeId, awayId, oddsApiEventId, espnGameId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)'

/** An Odds API event may only map to a Game whose start is within this window. */
export const ODDS_EVENT_MATCH_WINDOW_MS = 6 * 60 * 60 * 1000
/** A mapped Game whose start differs from its event by more than this is re-mapped. */
export const ODDS_EVENT_REMAP_DRIFT_MS = 3 * 60 * 60 * 1000

function gameStartMs(game) {
  const ms = parseStoredGameDate(game?.date)?.getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * |Game.date - event commence_time| in ms, or null when either is unknown.
 */
export function eventStartDriftMs(game, eventTime) {
  const start = gameStartMs(game)
  const target = Number(eventTime)
  if (start == null || !Number.isFinite(target)) return null
  return Math.abs(start - target)
}

export function shouldRemapEvent(game, eventTime, driftMs = ODDS_EVENT_REMAP_DRIFT_MS) {
  const drift = eventStartDriftMs(game, eventTime)
  return drift != null && drift > driftMs
}

/**
 * Pick the open Game row closest to the event start, but only within
 * `windowMs`. Outside the window returns null (log + leave unmapped)
 * instead of falling forward onto the next day's game — that cascade
 * put TB@CLE 10/15 odds on 10/16 and 10/16 odds/props on 10/17.
 *
 * `isReclaimable(game)` lets the caller treat a row as open even though
 * it is mapped (e.g. its event id is no longer in the Odds API feed).
 * Only pre-start rows may receive a mapping — unmapped live / final /
 * postponed rows are left alone, same as a mapped reclaim.
 */
export function pickUnmappedOddsGame(teamMatches, eventTime, {
  windowMs = ODDS_EVENT_MATCH_WINDOW_MS,
  isReclaimable = null,
} = {}) {
  const open = (teamMatches || []).filter((game) => {
    if (!isPreStartStatus(game?.status)) return false
    if (!game?.oddsApiEventId) return true
    return typeof isReclaimable === 'function' && isReclaimable(game)
  })
  if (open.length === 0) return null
  const target = Number(eventTime)
  if (!Number.isFinite(target)) {
    // Unknown event time: only an unambiguous single unmapped row is safe.
    const unmapped = open.filter((game) => !game?.oddsApiEventId)
    return unmapped.length === 1 ? unmapped[0] : null
  }
  const inWindow = open
    .map((game) => ({ game, drift: eventStartDriftMs(game, target) }))
    .filter(({ drift }) => drift != null && drift <= windowMs)
    .sort((a, b) => a.drift - b.drift)
  return inWindow[0]?.game || null
}

export const UNMAPPED_ODDS_REASONS = Object.freeze({
  NOT_IN_SLATE: 'not_in_slate',
  TEAM_MAP_MISS: 'team_map_miss',
  TIME_MISMATCH: 'time_mismatch',
})

const TEAM_CODE_RE = /^[A-Z]{2,4}$/

function etKeyToUtcNoon(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`)
}

function boundsFromEtKeys(startKey, endKey) {
  const startIso = etDayStartIso(startKey)
  const nextStartIso = etDayStartIso(shiftEtDate(endKey, 1))
  if (!startIso || !nextStartIso) return { startIso: null, endIso: null, startKey, endKey }
  return {
    startIso,
    endIso: new Date(Date.parse(nextStartIso) - 1).toISOString(),
    startKey,
    endKey,
  }
}

/**
 * DB window used to load Game rows for Odds API event mapping.
 *
 * Do not build this with local setHours/setDate on a YYYY-MM-DD string.
 * On an ET host, Wednesday +4 local days ends Saturday and drops Sunday
 * afternoon, SNF, and Monday night games that are already in Game.
 *
 * NFL: current Thu–Mon week, padded one ET day each side (same pad as
 * the public slate). Next week's Odds API events stay unloaded so they
 * log as not_in_slate instead of matching leftover rows or triggering
 * extra props fetches.
 * MLB/NHL: keep ±3 / +4 days, but on the ET calendar of `date`.
 */
export function oddsEventSlateBounds({ sport, date, now = new Date() } = {}) {
  const sportKey = String(sport || '').toLowerCase()
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
    ? String(date)
    : new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now instanceof Date ? now : new Date(now))

  if (sportKey === 'nfl') {
    const week = getNFLWeekBounds(etKeyToUtcNoon(dateKey))
    return boundsFromEtKeys(shiftEtDate(week.thursdayKey, -1), shiftEtDate(week.mondayKey, 1))
  }
  return boundsFromEtKeys(shiftEtDate(dateKey, -3), shiftEtDate(dateKey, 4))
}

/** True when a feed name or abbr resolved to a real 2–4 letter team code. */
export function isResolvedSportTeamCode(sport, value) {
  const raw = String(value || '').trim()
  if (!raw) return false
  return TEAM_CODE_RE.test(resolveSportTeamCode(sport, raw))
}

export function oddsTeamsMatch(dbHome, dbAway, oddsHome, oddsAway, sport) {
  const home = resolveSportTeamCode(sport, dbHome)
  const away = resolveSportTeamCode(sport, dbAway)
  const oHome = resolveSportTeamCode(sport, oddsHome)
  const oAway = resolveSportTeamCode(sport, oddsAway)
  if (![home, away, oHome, oAway].every((code) => TEAM_CODE_RE.test(code))) return false
  return (home === oHome && away === oAway) || (home === oAway && away === oHome)
}

export function gamesMatchingOddsTeams(dbGames, oddsHome, oddsAway, sport) {
  return (dbGames || []).filter((game) => oddsTeamsMatch(
    (game.home?.abbr || game.home?.name || '').trim(),
    (game.away?.abbr || game.away?.name || '').trim(),
    oddsHome,
    oddsAway,
    sport,
  ))
}

/**
 * Why an Odds API event did not land on a Game row.
 * not_in_slate: no matching teams in the loaded Game rows (typically next week).
 * team_map_miss: Odds API name/abbr did not resolve to a known team code.
 * time_mismatch: the matchup exists but no open row is within ±6h of commence_time.
 */
export function classifyUnmappedOddsEvent({
  oddsHome,
  oddsAway,
  sport,
  eventTime,
  dbGames = [],
  windowMs = ODDS_EVENT_MATCH_WINDOW_MS,
} = {}) {
  if (!isResolvedSportTeamCode(sport, oddsHome) || !isResolvedSportTeamCode(sport, oddsAway)) {
    return { reason: UNMAPPED_ODDS_REASONS.TEAM_MAP_MISS }
  }
  const teamMatches = gamesMatchingOddsTeams(dbGames, oddsHome, oddsAway, sport)
  if (teamMatches.length === 0) {
    return { reason: UNMAPPED_ODDS_REASONS.NOT_IN_SLATE }
  }
  const target = Number(eventTime)
  const inWindow = teamMatches.some((game) => {
    const drift = eventStartDriftMs(game, target)
    return drift != null && drift <= windowMs
  })
  return { reason: UNMAPPED_ODDS_REASONS.TIME_MISMATCH, inWindow }
}

export function matchOddsApiEventToGame({
  event,
  sport,
  date,
  dbGames,
  isReclaimable = null,
} = {}) {
  const oddsHome = (event?.home_team || '').trim()
  const oddsAway = (event?.away_team || '').trim()
  const eventTime = eventCommenceMs(event?.commence_time, date)
  const teamMatches = gamesMatchingOddsTeams(dbGames, oddsHome, oddsAway, sport)
    .filter((game) => game?.oddsApiEventId !== event?.id)
  const game = pickUnmappedOddsGame(teamMatches, eventTime, { isReclaimable })
  if (game) return { game, reason: null, eventTime, teamMatches }
  const { reason } = classifyUnmappedOddsEvent({
    oddsHome,
    oddsAway,
    sport,
    eventTime,
    dbGames,
  })
  return { game: null, reason, eventTime, teamMatches }
}

export function formatUnmappedOddsEventLine(event, reason) {
  const away = event?.away_team || '?'
  const home = event?.home_team || '?'
  const when = event?.commence_time ? ` (${event.commence_time})` : ''
  return `${away} @ ${home}${when} reason=${reason}`
}

export function summarizeUnmappedOddsReasons(reasons) {
  const counts = {
    [UNMAPPED_ODDS_REASONS.NOT_IN_SLATE]: 0,
    [UNMAPPED_ODDS_REASONS.TEAM_MAP_MISS]: 0,
    [UNMAPPED_ODDS_REASONS.TIME_MISMATCH]: 0,
  }
  for (const reason of reasons || []) {
    if (Object.prototype.hasOwnProperty.call(counts, reason)) counts[reason] += 1
    else counts[reason] = (counts[reason] || 0) + 1
  }
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${key}=${n}`)
  const total = (reasons || []).length
  return {
    total,
    counts,
    summary: `Unmapped: ${total}${parts.length ? ` (${parts.join(', ')})` : ''}`,
  }
}

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function etDayKey(value) {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : parseSupabaseDate(value)
  if (!date || Number.isNaN(date.getTime())) return null
  return ET_DAY.format(date)
}

/** Default TTL for NFL props on a game whose ET date is not today. */
export const DEFAULT_NFL_ADJACENT_PROPS_TTL_MS = 48 * 60 * 60 * 1000

/** Floor for PlayerPropCache.expiresAt. Same 24h window as the props cache. */
export const PROP_CACHE_EXPIRES_MS = 24 * 60 * 60 * 1000

/**
 * Public price age. Retention (`expiresAt`) may run past kickoff so
 * morning cleanup does not delete a later game. Boards still hide a
 * price fetched more than 24h ago — the old expiresAt window.
 */
export const PUBLIC_PROP_FRESHNESS_MS = PROP_CACHE_EXPIRES_MS

export function publicPropFetchedSince(now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now)
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now()
  return new Date(nowMs - PUBLIC_PROP_FRESHNESS_MS).toISOString()
}

/** True when fetchedAt is inside the public 24h window. Missing fetchedAt is not fresh. */
export function isPublicFreshPropPrice(row, now = new Date()) {
  const fetchedMs = Date.parse(row?.fetchedAt)
  if (!Number.isFinite(fetchedMs)) return false
  return fetchedMs >= Date.parse(publicPropFetchedSince(now))
}

export function omitUnfreshPublicPropRows(rows, now = new Date()) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isPublicFreshPropPrice(row, now))
}

/** SQL half of the public freshness gate. Callers still apply isStale / expiresAt / gameTime. */
export function applyPublicPropFreshness(query, now = new Date()) {
  return query.gte('fetchedAt', publicPropFetchedSince(now))
}

/** Keep a cache row until a few hours after kickoff so morning cleanup cannot drop it pre-game. */
export const PROP_CACHE_POST_KICKOFF_BUFFER_MS = 4 * 60 * 60 * 1000

/**
 * expiresAt = max(now+24h, now+propsCacheMaxAgeMs, gameTime+4h).
 * Today's props stay at least 24h. Adjacent NFL stays through the 48h
 * skip window. A later kickoff stays until 4h after gameTime so the
 * expired filter cannot delete the row before the game. Every sport
 * uses this; non-NFL TTL is the 24h floor, so only a later gameTime
 * extends them.
 */
export function propCacheExpiresAt({
  now = new Date(),
  gameTime,
  sport,
  todayMaxAgeMs = PROP_CACHE_EXPIRES_MS,
  adjacentMaxAgeMs = DEFAULT_NFL_ADJACENT_PROPS_TTL_MS,
  postKickoffBufferMs = PROP_CACHE_POST_KICKOFF_BUFFER_MS,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now)
  const nowMs = nowDate.getTime()
  const floor = Number.isFinite(nowMs) ? nowMs : Date.now()
  const dayMs = Number(todayMaxAgeMs)
  const dayEnd = floor + (Number.isFinite(dayMs) ? dayMs : PROP_CACHE_EXPIRES_MS)
  const ttl = propsCacheMaxAgeMs({
    sport,
    gameInstant: gameTime,
    now: new Date(floor),
    todayMaxAgeMs: Number.isFinite(dayMs) ? dayMs : PROP_CACHE_EXPIRES_MS,
    adjacentMaxAgeMs,
  })
  const ttlEnd = floor + (Number.isFinite(Number(ttl)) ? Number(ttl) : 0)
  const gameMs = gameTime instanceof Date ? gameTime.getTime() : Date.parse(gameTime)
  const afterKickoff = Number.isFinite(gameMs) ? gameMs + Number(postKickoffBufferMs || 0) : floor
  return new Date(Math.max(dayEnd, ttlEnd, afterKickoff)).toISOString()
}

export function nflAdjacentPropsTtlMs(env = process.env) {
  const hours = Number(env.ODDS_NFL_ADJACENT_PROPS_TTL_HOURS)
  if (Number.isFinite(hours) && hours >= 0) return hours * 60 * 60 * 1000
  return DEFAULT_NFL_ADJACENT_PROPS_TTL_MS
}

/**
 * Cache max-age for a player-props fetch.
 * Non-NFL and today's NFL keep `todayMaxAgeMs` (midnight-ET clamp).
 * NFL games on another ET day (the ±1-day / week window) use the
 * adjacent TTL so a fresh cache is not burned again at the next run.
 */
export function propsCacheMaxAgeMs({
  sport,
  gameInstant,
  now = new Date(),
  todayMaxAgeMs,
  adjacentMaxAgeMs = DEFAULT_NFL_ADJACENT_PROPS_TTL_MS,
} = {}) {
  const todayTtl = Number(todayMaxAgeMs)
  const fallback = Number.isFinite(todayTtl) ? todayTtl : 0
  if (String(sport || '').toLowerCase() !== 'nfl') return fallback
  const gameKey = etDayKey(gameInstant)
  const todayKey = etDayKey(now)
  if (!gameKey || gameKey === todayKey) return fallback
  const adjacent = Number(adjacentMaxAgeMs)
  return Number.isFinite(adjacent) ? adjacent : fallback
}

/**
 * Milliseconds since midnight America/New_York for `now`. Used so a
 * props cache from yesterday morning never counts as fresh today.
 */
export function msSinceEtMidnight(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0)
  const hour = get('hour') % 24
  return ((hour * 60 + get('minute')) * 60 + get('second')) * 1000 + date.getMilliseconds()
}

/**
 * When the mapped row is already final, props belong on the next
 * scheduled sibling. Prefer that sibling's date, then the event
 * commence_time — never the final game's date or the script run time.
 */
export function resolvePropLanding({
  mappedGame = null,
  redirectGame = null,
  commenceTime = null,
  now = new Date(),
} = {}) {
  const target = redirectGame || mappedGame
  const redirected = Boolean(redirectGame?.id && redirectGame.id !== mappedGame?.id)
  const gameTime =
    storedInstantIso(redirectGame?.date)
    || storedInstantIso(commenceTime)
    || storedInstantIso(mappedGame?.date)
    || (now instanceof Date ? now.toISOString() : new Date(now).toISOString())
  return {
    gameId: target?.id || mappedGame?.id || null,
    gameTime,
    redirected,
  }
}

export function oddsInsertPayload({
  id,
  gameId,
  book,
  market,
  priceAway,
  priceHome,
  spread,
  total,
  ts,
  commenceTime,
  includeCommenceTime = false,
  quoteTime = undefined,
  includeQuotedAt = false,
} = {}) {
  const row = {
    id,
    gameId,
    book,
    market,
    priceAway,
    priceHome,
    spread,
    total,
    ts,
  }
  if (includeCommenceTime) {
    const commence = storedInstantIso(commenceTime)
    if (commence) row.commence_time = commence
  }
  if (includeQuotedAt) {
    row.quotedAt = quoteTimeIso(quoteTime)
  }
  return row
}

const MISSING_COLUMN = /column|does not exist|schema cache|could not find/i

export function oddsInsertFailedForMissingCommenceTime(error) {
  if (!error) return false
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  const code = String(error.code || '')
  if (!MISSING_COLUMN.test(message) && code !== 'PGRST204' && code !== '42703') return false
  return /commence_time/i.test(message) || code === 'PGRST204' || code === '42703'
}

function oddsWriteErrorText(error) {
  return `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
}

/**
 * Insert one Odds row, then drop only the column the error names.
 * A probe can say both commence_time and quotedAt exist, and the insert
 * can still fail after the schema changes. PostgREST reports one missing
 * column at a time, and a quotedAt PGRST204 must not be treated as a
 * commence_time miss. Each retry strips one named column.
 */
export async function insertOddsRowResolvingSchema(supabase, row) {
  let payload = { ...row }
  let result = await supabase.from('Odds').insert(payload)
  for (let attempt = 0; attempt < 4 && result?.error; attempt += 1) {
    const error = result.error
    const text = oddsWriteErrorText(error)
    if (isMissingQuotedAtColumnError(error) && Object.prototype.hasOwnProperty.call(payload, 'quotedAt')) {
      payload = omitQuotedAtFields(payload)
    } else if (
      oddsInsertFailedForMissingCommenceTime(error)
      && /commence_time/i.test(text)
      && Object.prototype.hasOwnProperty.call(payload, 'commence_time')
    ) {
      const { commence_time: _omit, ...rest } = payload
      payload = rest
    } else {
      break
    }
    result = await supabase.from('Odds').insert(payload)
  }
  return { ...(result || {}), payload }
}
