/**
 * Alternate-line shop for Published NFL player props.
 *
 * Informational only. CLV stays entry (posted line/price) vs consensus
 * close at the same line. Does not change morning fetch, close capture,
 * or snapshot routines.
 *
 * Official Odds API keys (docs, 2026): player_*_alternate on the
 * event-odds endpoint. Credits = markets × regions (regions=us → 1).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMissingColumnError } from './grade-audit.js'
import { toAmericanOdds, toDecimalOdds } from './odds-units.js'
import { etDayKey, parseEnvNonNegInt } from './odds-api-budget.js'
import { isQuoteStale, parseStoredQuotes, quoteAgeMs } from './line-shopping.js'
import { normalizePlayerName } from './parlay-integrity.js'
import {
  alternateMarketKey,
  creditCostForMarkets,
  isNflSport,
  mainMarketKey,
  publishedMarketKey,
} from './closing-line.js'
import {
  isPublishedCohort,
  isPublishedEligibleProp,
  isPublishedTrackSource,
  isShadowPublishedCohort,
  sourceMarketFromPick,
} from './published-picks.js'
import {
  isSnapshotEligiblePick,
  quotesAreFresh,
} from './odds-snapshot.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const NFL_ALT_STATUS_OK = 'ok'
export const NFL_ALT_STATUS_PARTIAL = 'partial'
export const NFL_ALT_STATUS_FAILED = 'failed'

export const DEFAULT_NFL_ALT_DAILY_CREDITS = 48
export const DEFAULT_NFL_ALT_FRESH_MINUTES = 90
export const DEFAULT_NFL_ALT_HORIZON_HOURS = 36
export const DEFAULT_NFL_ALT_MAX_LINES = 12
export const NFL_ALT_REGIONS = Object.freeze(['us'])
export const DEFAULT_NFL_ALT_REL_PATH = path.join('.local', 'odds-nfl-alt.json')
export const PLAYER_PROP_CACHE_ALT_FIELDS = Object.freeze(['altQuotes', 'altQuoteUpdatedAt'])

/**
 * Official NFL / NCAAF / CFL alternate player-prop keys from
 * https://the-odds-api.com/sports-odds-data/betting-markets.html
 * Only request a key on this list (INVALID_MARKET otherwise).
 */
export const NFL_ALT_MARKETS = Object.freeze([
  'player_assists_alternate',
  'player_field_goals_alternate',
  'player_kicking_points_alternate',
  'player_pass_attempts_alternate',
  'player_pass_completions_alternate',
  'player_pass_interceptions_alternate',
  'player_pass_longest_completion_alternate',
  'player_pass_rush_yds_alternate',
  'player_pass_rush_reception_tds_alternate',
  'player_pass_rush_reception_yds_alternate',
  'player_pass_tds_alternate',
  'player_pass_yds_alternate',
  'player_pats_alternate',
  'player_receptions_alternate',
  'player_reception_longest_alternate',
  'player_reception_tds_alternate',
  'player_reception_yds_alternate',
  'player_rush_attempts_alternate',
  'player_rush_longest_alternate',
  'player_rush_tds_alternate',
  'player_rush_yds_alternate',
  'player_rush_reception_tds_alternate',
  'player_rush_reception_yds_alternate',
  'player_sacks_alternate',
  'player_solo_tackles_alternate',
  'player_tackles_assists_alternate',
])

/**
 * Credit math (event-odds, regions=us → 1× markets).
 * Morning + close + snapshots already estimate ~6–10.5k / month.
 * This job's hard cap keeps the worst month well under the 16.5k plan.
 */
export const NFL_ALT_CREDIT_ESTIMATE = Object.freeze({
  typicalSundayEvents: 8,
  typicalSundayMarkets: 2,
  typicalSundayCredits: 16,
  typicalMonthSundays: 4,
  typicalMonthCredits: 64,
  dailyCap: DEFAULT_NFL_ALT_DAILY_CREDITS,
  nflDaysPerMonth: 8,
  worstNflDaysMonthCredits: 384,
  worstEveryDayMonthCredits: 1488,
})

const NFL_ALT_MARKET_SET = new Set(NFL_ALT_MARKETS)

/** Process-local: after a missing-column miss, later writes skip alt fields. */
let altColumnsMissing = false

export function resetNflAltColumnCache() {
  altColumnsMissing = false
}

export function isMissingAltQuoteColumnError(error) {
  if (!isMissingColumnError(error)) return false
  const message = String(error.message || '')
  if (!message) return true
  return PLAYER_PROP_CACHE_ALT_FIELDS.some((name) => (
    message.includes(`'${name}'`)
    || message.includes(`"${name}"`)
    || message.includes(`column ${name}`)
    || new RegExp(name, 'i').test(message)
  ))
}

export function withoutAltQuoteFields(payload) {
  const next = { ...(payload || {}) }
  for (const key of PLAYER_PROP_CACHE_ALT_FIELDS) delete next[key]
  return next
}

export function isNflAltEligiblePick(record) {
  if (!isNflSport(record?.sport)) return false
  if (isShadowPublishedCohort(record)) return false
  if (!isSnapshotEligiblePick(record)) return false
  return Boolean(nflAlternateMarketForPick(record))
}

/**
 * Public /api/props gate. Cache rows have no Published notes column
 * (and shadow is NHL-only), so sport + isPublishedEligibleProp is the
 * real bar. The pick-side shadow check stays on isNflAltEligiblePick.
 */
export function isNflAltEligibleCacheProp(record) {
  if (!record || !isNflSport(record.sport)) return false
  if (!isPublishedEligibleProp(record)) return false
  return true
}

export function nflAlternateMarketForPick(pick) {
  const mapped = publishedMarketKey(pick?.propType || pick?.type)
  const source = sourceMarketFromPick(pick)
  const main = mainMarketKey(mapped || source || pick?.propType || pick?.type)
  if (!main) return null
  const alt = alternateMarketKey(main) || `${main}_alternate`
  return NFL_ALT_MARKET_SET.has(alt) ? alt : null
}

export function altMarketsForPicks(picks) {
  const markets = new Set()
  for (const pick of picks || []) {
    const alt = nflAlternateMarketForPick(pick)
    if (alt) markets.add(alt)
  }
  return [...markets]
}

export function readNflAltConfig(env = process.env) {
  return {
    dailyCredits: parseEnvNonNegInt(env.ODDS_NFL_ALT_DAILY_CREDITS, DEFAULT_NFL_ALT_DAILY_CREDITS),
    freshMinutes: parseEnvNonNegInt(env.ODDS_NFL_ALT_FRESH_MINUTES, DEFAULT_NFL_ALT_FRESH_MINUTES),
    horizonHours: parseEnvNonNegInt(env.ODDS_NFL_ALT_HORIZON_HOURS, DEFAULT_NFL_ALT_HORIZON_HOURS),
    maxLines: parseEnvNonNegInt(env.ODDS_NFL_ALT_MAX_LINES, DEFAULT_NFL_ALT_MAX_LINES),
    persistPath: env.ODDS_NFL_ALT_PATH
      ? String(env.ODDS_NFL_ALT_PATH)
      : DEFAULT_NFL_ALT_REL_PATH,
  }
}

export function isNflAltDisabled(env = process.env) {
  const raw = String(env.ODDS_NFL_ALT ?? '').trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return true
  return readNflAltConfig(env).dailyCredits === 0
}

export function resolveNflAltPath(persistPath) {
  const rel = persistPath || DEFAULT_NFL_ALT_REL_PATH
  if (path.isAbsolute(rel)) return rel
  return path.resolve(REPO_ROOT, rel)
}

function emptyDayState() {
  return { version: 1, days: {}, updatedAt: null }
}

export function loadNflAltDayState({
  persistPath,
  filesystem = fs,
  persist = true,
} = {}) {
  if (!persist) return emptyDayState()
  const filePath = resolveNflAltPath(persistPath)
  try {
    if (filesystem.existsSync && !filesystem.existsSync(filePath)) return emptyDayState()
    const parsed = JSON.parse(filesystem.readFileSync(filePath, 'utf8'))
    const days = {}
    for (const [day, row] of Object.entries(parsed?.days || {})) {
      days[day] = { credits: Math.max(0, Number(row?.credits) || 0) }
    }
    return { version: 1, days, updatedAt: parsed?.updatedAt || null }
  } catch {
    return emptyDayState()
  }
}

export function saveNflAltDayState(state, {
  persistPath,
  filesystem = fs,
  persist = true,
} = {}) {
  if (!persist) return state
  const filePath = resolveNflAltPath(persistPath)
  filesystem.mkdirSync?.(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  filesystem.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  filesystem.renameSync(tmp, filePath)
  return state
}

export function todayNflAltCredits(state, now = new Date()) {
  const day = etDayKey(now)
  return Math.max(0, Number(state?.days?.[day]?.credits) || 0)
}

export function remainingNflAltCredits(
  state,
  now = new Date(),
  dailyCredits = DEFAULT_NFL_ALT_DAILY_CREDITS,
) {
  const cap = Math.max(0, Number(dailyCredits) || 0)
  return Math.max(0, cap - todayNflAltCredits(state, now))
}

export function recordNflAltSpend(state, credits, now = new Date(), opts = {}) {
  const day = etDayKey(now)
  const spent = Math.max(0, Number(credits) || 0)
  const next = {
    version: 1,
    days: { ...(state?.days || {}) },
    updatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
  const row = next.days[day] || { credits: 0 }
  next.days[day] = { credits: (Number(row.credits) || 0) + spent }
  return saveNflAltDayState(next, opts)
}

export function selectNflAltJobs(jobs, { maxCredits = DEFAULT_NFL_ALT_DAILY_CREDITS } = {}) {
  const cap = Math.max(0, Number(maxCredits) || 0)
  const sorted = [...(jobs || [])].sort((a, b) => {
    const aMs = Date.parse(a?.game?.date || a?.game?.gameDate || '') || Number.POSITIVE_INFINITY
    const bMs = Date.parse(b?.game?.date || b?.game?.gameDate || '') || Number.POSITIVE_INFINITY
    return aMs - bMs
  })
  const kept = []
  const skippedCap = []
  let credits = 0
  for (const job of sorted) {
    const markets = job.markets?.length ? job.markets : altMarketsForPicks(job.picks)
    const cost = creditCostForMarkets(markets.length, NFL_ALT_REGIONS.length)
    if (!markets.length || credits + cost > cap) {
      skippedCap.push(job)
      continue
    }
    kept.push({ ...job, markets, creditCost: cost })
    credits += cost
  }
  return { jobs: kept, skippedCap, plannedCredits: credits }
}

export function classifyNflAltJobs(jobs, {
  now = new Date(),
  freshMinutes = DEFAULT_NFL_ALT_FRESH_MINUTES,
  latestAltQuotes = new Map(),
} = {}) {
  const fetchable = []
  const skippedFresh = []
  const skippedNoMarket = []
  for (const job of jobs || []) {
    const markets = job.markets?.length ? job.markets : altMarketsForPicks(job.picks)
    if (!markets.length || !job.eventId) {
      skippedNoMarket.push(job)
      continue
    }
    const stamp = (job.gameIds || [job.gameId]).map((id) => latestAltQuotes.get(id)).find(Boolean)
    if (quotesAreFresh(stamp, now, freshMinutes)) {
      skippedFresh.push(job)
      continue
    }
    fetchable.push({ ...job, markets })
  }
  return { fetchable, skippedFresh, skippedNoMarket }
}

export function latestAltStampByGameId(rows) {
  const map = new Map()
  for (const row of rows || []) {
    const gameId = row.gameId
    const stamp = row.altQuoteUpdatedAt
    if (!gameId || !stamp) continue
    const prev = map.get(gameId)
    if (!prev || Date.parse(stamp) > Date.parse(prev)) map.set(gameId, stamp)
  }
  return map
}

export function cacheRowMatchesPick(row, pick) {
  if (!row || !pick) return false
  if (normalizePlayerName(row.playerName) !== normalizePlayerName(pick.playerName)) return false
  const rowSide = String(row.pick || '').toLowerCase().trim()
  const pickSide = String(pick.prediction || pick.pick || '').toLowerCase().trim()
  if (!rowSide || rowSide !== pickSide) return false
  const rowMarket = mainMarketKey(publishedMarketKey(row.type) || row.type)
  const pickMarket = mainMarketKey(publishedMarketKey(pick.propType || pick.type) || pick.propType || pick.type)
  return Boolean(rowMarket && pickMarket && rowMarket === pickMarket)
}

export function bestAltLinesForPick(pick, quotes, { maxLines = DEFAULT_NFL_ALT_MAX_LINES } = {}) {
  const side = String(pick?.prediction || pick?.pick || '').toLowerCase().trim()
  const player = normalizePlayerName(pick?.playerName)
  const altMarket = nflAlternateMarketForPick(pick)
  if (!player || !side || !altMarket) return []
  const byLine = new Map()
  for (const quote of quotes || []) {
    if (normalizePlayerName(quote.playerName) !== player) continue
    if (String(quote.pick || '').toLowerCase().trim() !== side) continue
    const market = String(quote.market || '')
    if (market !== altMarket && mainMarketKey(market) !== mainMarketKey(altMarket)) continue
    const line = Number(quote.threshold)
    const dec = toDecimalOdds(quote.odds)
    if (!Number.isFinite(line) || dec == null) continue
    const prev = byLine.get(line)
    if (!prev || dec > toDecimalOdds(prev.odds)) byLine.set(line, quote)
  }
  const cap = Math.max(0, Number(maxLines) || 0)
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, cap)
    .map(([line, quote]) => ({
      line,
      side,
      price: toAmericanOdds(quote.odds),
      book: quote.book || null,
      lastUpdate: quote.last_update || quote.lastUpdate || null,
    }))
}

export function altQuoteUpdatedAtFromLines(lines) {
  let latest = null
  for (const row of lines || []) {
    const stamp = row.lastUpdate || row.last_update
    if (!stamp) continue
    const ms = Date.parse(stamp)
    if (!Number.isFinite(ms)) continue
    if (latest == null || ms > Date.parse(latest)) latest = new Date(ms).toISOString()
  }
  return latest
}

export function applyAltLinesToCacheRows(cacheRows, pick, quotes, {
  maxLines = DEFAULT_NFL_ALT_MAX_LINES,
  now = new Date(),
} = {}) {
  const lines = bestAltLinesForPick(pick, quotes, { maxLines })
  if (!lines.length) return []
  const updatedAt = altQuoteStamp(now)
  return (cacheRows || [])
    .filter((row) => cacheRowMatchesPick(row, pick))
    .map((row) => altQuoteUpdateRow(row, lines, updatedAt))
}

export function cacheRowByPropId(cacheRows, pick) {
  const propId = pick?.propId
  if (propId == null || String(propId).trim() === '') return null
  return (cacheRows || []).find((row) => row?.propId === propId) || null
}

/**
 * A name/side/market miss can still be written: same propId updates that
 * row, otherwise a thin insert keyed by propId. No propId and no row
 * means there is nowhere to put the ladder.
 */
export function pickCanPersistAltQuotes(cacheRows, pick) {
  if ((cacheRows || []).some((row) => cacheRowMatchesPick(row, pick))) return true
  if (cacheRowByPropId(cacheRows, pick)) return true
  return Boolean(pick?.propId)
}

export function eventCanPersistAltQuotes(job, gameCache) {
  return (job?.picks || []).some((pick) => pickCanPersistAltQuotes(gameCache, pick))
}

function altQuoteStamp(now) {
  const instant = now instanceof Date ? now : new Date(now || Date.now())
  return instant.toISOString()
}

function altQuoteUpdateRow(row, lines, updatedAt) {
  return {
    id: row.id,
    propId: row.propId,
    gameId: row.gameId,
    altQuotes: lines,
    altQuoteUpdatedAt: updatedAt,
  }
}

/**
 * Holds altQuotes for a Published propId that has no PlayerPropCache row.
 * 012 stores the ladder on PlayerPropCache; PropValidation has no alt column.
 * edge/quality stay 0 and odds stay 1 so this row is not a public play and
 * does not rewrite an entry price. expiresAt/gameTime follow kickoff so
 * morning cleanup keeps it until the game.
 */
export function thinAltCacheInsert(pick, lines, { now = new Date(), game } = {}) {
  const instant = altQuoteStamp(now)
  const gameTime = game?.date || pick?.gameTime || instant
  return {
    insert: true,
    id: crypto.randomBytes(12).toString('base64url'),
    propId: String(pick.propId),
    gameId: pick.gameIdRef || pick.gameId || null,
    playerName: pick.playerName || null,
    type: pick.propType || pick.type || null,
    pick: String(pick.prediction || pick.pick || '').toLowerCase(),
    threshold: Number(pick.threshold),
    odds: 1,
    probability: 0,
    edge: 0,
    confidence: 'alt-only',
    qualityScore: 0,
    sport: 'nfl',
    gameTime,
    fetchedAt: instant,
    expiresAt: gameTime,
    isStale: false,
    altQuotes: lines,
    altQuoteUpdatedAt: instant,
  }
}

export function planAltQuotesForPick(cacheRows, pick, quotes, {
  maxLines = DEFAULT_NFL_ALT_MAX_LINES,
  now = new Date(),
  game = null,
} = {}) {
  const lines = bestAltLinesForPick(pick, quotes, { maxLines })
  if (!lines.length) return { empty: true, matchedRows: 0, rows: [] }
  const updatedAt = altQuoteStamp(now)
  const matched = (cacheRows || []).filter((row) => cacheRowMatchesPick(row, pick))
  if (matched.length) {
    return {
      empty: false,
      matchedRows: matched.length,
      rows: matched.map((row) => altQuoteUpdateRow(row, lines, updatedAt)),
    }
  }
  const byPropId = cacheRowByPropId(cacheRows, pick)
  if (byPropId) {
    return {
      empty: false,
      matchedRows: 0,
      rows: [altQuoteUpdateRow(byPropId, lines, updatedAt)],
    }
  }
  if (!pick?.propId) return { empty: false, matchedRows: 0, rows: [] }
  return {
    empty: false,
    matchedRows: 0,
    rows: [thinAltCacheInsert(pick, lines, { now, game })],
  }
}

export function altPickLabel(pick) {
  return `${pick?.playerName || 'unknown'} ${pick?.propType || pick?.type || ''}`.trim()
}

export function planAltQuotesForEvent(job, gameCache, quotes, opts = {}) {
  const rows = []
  const unmatchedPicks = []
  const emptyAltPicks = []
  let matchedRows = 0
  for (const pick of job?.picks || []) {
    const planned = planAltQuotesForPick(gameCache, pick, quotes, { ...opts, game: job?.game })
    matchedRows += planned.matchedRows
    if (planned.empty) {
      const label = altPickLabel(pick)
      emptyAltPicks.push(label)
      unmatchedPicks.push(label)
      continue
    }
    if (!planned.rows.length) {
      unmatchedPicks.push(altPickLabel(pick))
      continue
    }
    rows.push(...planned.rows)
  }
  return {
    quotesCount: Array.isArray(quotes) ? quotes.length : 0,
    cacheRowsForGame: Array.isArray(gameCache) ? gameCache.length : 0,
    matchedRows,
    persistedRows: rows.length,
    emptyAltPicks,
    unmatchedPicks,
    rows,
  }
}

export function formatNflAltEventLine(job, planned) {
  const eventId = job?.eventId || (job?.gameIds || []).join(',') || 'event'
  return `  ${eventId} quotesCount=${planned?.quotesCount ?? 0} cacheRowsForGame=${planned?.cacheRowsForGame ?? 0} matchedRows=${planned?.matchedRows ?? 0} persistedRows=${planned?.persistedRows ?? 0} emptyAltPicks=${JSON.stringify(planned?.emptyAltPicks || [])}`
}

/**
 * ok only when a paid run persisted every eligible pick it fetched.
 * credits spent with nothing saved, or any unmatched pick, is partial.
 */
export function nflAltPersistStatus({
  creditsUsed = 0,
  persistedRows = 0,
  unmatchedPicks = [],
  baseStatus = NFL_ALT_STATUS_OK,
} = {}) {
  if (baseStatus === NFL_ALT_STATUS_FAILED) return baseStatus
  const spent = Number(creditsUsed) || 0
  const saved = Number(persistedRows) || 0
  const unmatched = Array.isArray(unmatchedPicks) ? unmatchedPicks.length : 0
  if (spent > 0 && (saved === 0 || unmatched > 0)) return NFL_ALT_STATUS_PARTIAL
  return baseStatus
}

export function heldNflAltPath(persistPath) {
  return path.join(
    path.dirname(resolveNflAltPath(persistPath)),
    'odds-nfl-alt-held.jsonl',
  )
}

export function saveHeldNflAltRows(rows, {
  persistPath,
  filesystem = fs,
  persist = true,
  now = new Date(),
} = {}) {
  if (!persist || !rows?.length) return null
  const filePath = heldNflAltPath(persistPath)
  filesystem.mkdirSync?.(path.dirname(filePath), { recursive: true })
  const line = `${JSON.stringify({
    heldAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    rows,
  })}\n`
  if (typeof filesystem.appendFileSync === 'function') {
    filesystem.appendFileSync(filePath, line)
  } else {
    const prev = filesystem.existsSync?.(filePath)
      ? String(filesystem.readFileSync(filePath, 'utf8'))
      : ''
    filesystem.writeFileSync(filePath, `${prev}${line}`)
  }
  return filePath
}

export function toPublicAltLines(prop, { now = Date.now() } = {}) {
  if (!isNflAltEligibleCacheProp(prop)) return null
  const parsed = parseStoredQuotes(prop.altQuotes)
  if (!parsed) return null
  const commenceTime = prop.gameTime || prop.commenceTime || null
  const side = String(prop.pick || prop.prediction || '').toLowerCase().trim()
  const lines = parsed
    .filter((row) => !side || String(row.side || '').toLowerCase() === side)
    .map((row) => {
      const lastUpdate = row.lastUpdate ?? row.last_update ?? null
      return {
        line: Number(row.line),
        side: String(row.side || side || '').toLowerCase() || null,
        price: row.price ?? row.american ?? null,
        book: row.book || null,
        ageMs: quoteAgeMs(lastUpdate, now),
        stale: isQuoteStale({ lastUpdate }, { now, commenceTime }),
      }
    })
    .filter((row) => Number.isFinite(row.line) && row.price != null)
  return lines.length ? lines : null
}

export function attachPublicAltLines(publicRow, rawProp, { now = Date.now() } = {}) {
  if (!publicRow) return publicRow
  return {
    ...publicRow,
    altLines: toPublicAltLines(rawProp, { now }),
  }
}

export async function updateCacheAltQuotes(doUpdate, payload) {
  if (altColumnsMissing) return { skipped: true, columnMissing: true }
  const result = await doUpdate(payload)
  if (!result?.error) return result
  if (isMissingAltQuoteColumnError(result.error)) {
    altColumnsMissing = true
    return { ...result, columnMissing: true }
  }
  return result
}

function altQuotePatch(row) {
  return {
    altQuotes: row?.altQuotes,
    altQuoteUpdatedAt: row?.altQuoteUpdatedAt,
  }
}

/**
 * Update alt columns on an existing row. A thin insert is only used when
 * no cache row was found. A propId conflict updates alt columns only so a
 * real cache row's odds / edge are left alone.
 */
export async function writeAltQuoteRow(client, row) {
  const patch = altQuotePatch(row)
  if (!row?.insert) {
    const key = row?.id || row?.propId
    const column = row?.id ? 'id' : 'propId'
    return updateCacheAltQuotes(
      () => client.from('PlayerPropCache').update(patch).eq(column, key),
      row,
    )
  }
  const { insert, ...payload } = row
  const inserted = await updateCacheAltQuotes(
    () => client.from('PlayerPropCache').insert(payload),
    payload,
  )
  if (String(inserted?.error?.code || '') === '23505') {
    return updateCacheAltQuotes(
      () => client.from('PlayerPropCache').update(patch).eq('propId', row.propId),
      row,
    )
  }
  return inserted
}

export function formatNflAltStatus(status = NFL_ALT_STATUS_OK) {
  return `NFL_ALT_STATUS=${status || NFL_ALT_STATUS_OK}`
}

export function formatNflAltEvents(events) {
  return `NFL_ALT_EVENTS=${Number(events) || 0}`
}

export function formatNflAltCredits(credits) {
  return `CREDITS=${Number(credits) || 0}`
}

export {
  isPublishedCohort,
  isPublishedEligibleProp,
  isPublishedTrackSource,
  isShadowPublishedCohort,
}
