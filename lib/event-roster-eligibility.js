/**
 * Event-roster eligibility for NFL / NHL player props.
 *
 * Books still post lines on free agents and injured players. Before a
 * prop is generated or recorded as Published / shadow-published, the
 * player must appear on the ESPN active roster of one of the two teams
 * for that event, and must not have a blocked weekly designation
 * (FA, IR, Out, PUP, NFI, LTIR, Suspended) on `status` or `injuries[]`.
 *
 * Uses ESPN team or event roster data only. No Odds API calls.
 * Fail-safe: if the roster cannot be fetched, skip the prop.
 */

import { ESPN_TEAM_IDS } from './vendors/espn-nfl-roster.js'
import {
  normalizeGradePlayerName,
  uniqueFirstNameAliasMatch,
} from './player-name-match.js'
import { canonicalTeamCode, gameTeamCodes, parseGameIdTeams } from './player-stat-grade.js'

export const ESPN_ROSTER_GAP_MS = 200
export const ESPN_ROSTER_RETRY_MS = 400
export const ESPN_ROSTER_RETRY_MAX_MS = 400

export const ROSTER_SKIP_REASONS = Object.freeze({
  NOT_ON_EVENT_ROSTER: 'not_on_event_roster',
  ESPN_STATUS_FA: 'espn_status_fa',
  ESPN_STATUS_IR: 'espn_status_ir',
  ESPN_STATUS_OUT: 'espn_status_out',
  ESPN_STATUS_PUP: 'espn_status_pup',
  ESPN_STATUS_NFI: 'espn_status_nfi',
  ESPN_STATUS_LTIR: 'espn_status_ltir',
  ESPN_STATUS_SUSPENDED: 'espn_status_suspended',
  ROSTER_UNAVAILABLE: 'roster_unavailable',
})

export const PUBLISHED_ROSTER_GUARD_SPORTS = Object.freeze(['nfl'])
export const SHADOW_ROSTER_GUARD_SPORTS = Object.freeze(['nhl'])

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports'

const NFL_ABBR_ALIASES = Object.freeze({
  wsh: 'was',
  was: 'was',
  jac: 'jax',
  jax: 'jax',
  la: 'lar',
  lar: 'lar',
})

/** Prefer Game.homeId / awayId (NHL_12). Abbr map is fallback only. */
export const ESPN_NHL_TEAM_IDS = Object.freeze({
  ana: 25,
  ari: 24,
  bos: 1,
  buf: 2,
  car: 7,
  cbj: 29,
  cgy: 3,
  chi: 4,
  col: 17,
  dal: 9,
  det: 5,
  edm: 6,
  fla: 26,
  lak: 8,
  la: 8,
  min: 30,
  mtl: 10,
  nsh: 27,
  njd: 11,
  nj: 11,
  nyr: 13,
  nyi: 12,
  ott: 14,
  phi: 15,
  pit: 16,
  sea: 124292,
  sjs: 18,
  sj: 18,
  stl: 19,
  tbl: 20,
  tb: 20,
  tor: 21,
  uta: 24,
  van: 22,
  vgk: 37,
  veg: 37,
  lv: 37,
  wpg: 28,
  wsh: 23,
  was: 23,
})

const BLOCKED_STATUS_REASONS = Object.freeze({
  fa: ROSTER_SKIP_REASONS.ESPN_STATUS_FA,
  freeagent: ROSTER_SKIP_REASONS.ESPN_STATUS_FA,
  'free agent': ROSTER_SKIP_REASONS.ESPN_STATUS_FA,
  ir: ROSTER_SKIP_REASONS.ESPN_STATUS_IR,
  injuredreserve: ROSTER_SKIP_REASONS.ESPN_STATUS_IR,
  'injured reserve': ROSTER_SKIP_REASONS.ESPN_STATUS_IR,
  out: ROSTER_SKIP_REASONS.ESPN_STATUS_OUT,
  o: ROSTER_SKIP_REASONS.ESPN_STATUS_OUT,
  pup: ROSTER_SKIP_REASONS.ESPN_STATUS_PUP,
  'physical unable to perform': ROSTER_SKIP_REASONS.ESPN_STATUS_PUP,
  'physically unable to perform': ROSTER_SKIP_REASONS.ESPN_STATUS_PUP,
  reservepup: ROSTER_SKIP_REASONS.ESPN_STATUS_PUP,
  'reserve pup': ROSTER_SKIP_REASONS.ESPN_STATUS_PUP,
  nfi: ROSTER_SKIP_REASONS.ESPN_STATUS_NFI,
  'non football injury': ROSTER_SKIP_REASONS.ESPN_STATUS_NFI,
  nonfootballinjury: ROSTER_SKIP_REASONS.ESPN_STATUS_NFI,
  reservenfi: ROSTER_SKIP_REASONS.ESPN_STATUS_NFI,
  'reserve nfi': ROSTER_SKIP_REASONS.ESPN_STATUS_NFI,
  ltir: ROSTER_SKIP_REASONS.ESPN_STATUS_LTIR,
  'long term injured reserve': ROSTER_SKIP_REASONS.ESPN_STATUS_LTIR,
  longterminjuredreserve: ROSTER_SKIP_REASONS.ESPN_STATUS_LTIR,
  'long term ir': ROSTER_SKIP_REASONS.ESPN_STATUS_LTIR,
  suspended: ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED,
  suspension: ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED,
  sus: ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED,
  reservesus: ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED,
  'reserve sus': ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED,
})

/** Weekly designations that stay eligible (not a DNP / reserve list). */
const ALLOWED_WEEKLY_STATUS = new Set([
  'questionable',
  'q',
  'doubtful',
  'd',
  'day to day',
  'daytoday',
  'dtd',
  'probable',
  'active',
  'act',
])

function normalizeSport(sport) {
  return String(sport || '').toLowerCase().trim()
}

function normalizeStatusToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactStatusToken(value) {
  return normalizeStatusToken(value).replace(/\s+/g, '')
}

export function espnRosterUrl(sport, teamId) {
  const key = normalizeSport(sport)
  const path = key === 'nhl' ? 'hockey/nhl' : 'football/nfl'
  return `${ESPN_SITE}/${path}/teams/${teamId}/roster`
}

export function espnEventSummaryUrl(sport, espnGameId) {
  const key = normalizeSport(sport)
  const path = key === 'nhl' ? 'hockey/nhl' : 'football/nfl'
  return `${ESPN_SITE}/${path}/summary?event=${espnGameId}`
}

export function resolveEspnTeamId(sport, team) {
  if (team == null || team === '') return null
  const key = normalizeSport(sport)
  const prefixed = String(team.id || team.espnId || team.espnTeamId || '')
  const match = prefixed.match(/^(NFL|NHL)_(\d+)$/i)
  if (match) {
    const prefixSport = match[1].toLowerCase() === 'nfl' ? 'nfl' : 'nhl'
    if (!key || prefixSport === key) return match[2]
  }
  if (/^\d+$/.test(prefixed)) return prefixed

  const abbrRaw = String(team.abbr || team.abbreviation || (typeof team === 'string' ? team : ''))
    .toLowerCase()
    .replace(/^(nfl|nhl)_/i, '')
    .trim()
  if (!abbrRaw) return null

  if (key === 'nhl') {
    return ESPN_NHL_TEAM_IDS[abbrRaw] != null ? String(ESPN_NHL_TEAM_IDS[abbrRaw]) : null
  }
  const nflAbbr = NFL_ABBR_ALIASES[abbrRaw] || abbrRaw
  if (ESPN_TEAM_IDS[nflAbbr] != null) return String(ESPN_TEAM_IDS[nflAbbr])
  return null
}

export function formatEventLabel(game) {
  const sport = game?.sport
  const teams = gameTeamCodes(game, sport)
  const away = teams.away || 'UNK'
  const home = teams.home || 'UNK'
  const id = game?.id || game?.gameId || game?.espnGameId || 'unknown-event'
  return `${away} @ ${home} (${id})`
}

export function blockedEspnStatusReason(status) {
  const tokens = []
  if (status == null) return null
  if (typeof status === 'string' || typeof status === 'number') {
    tokens.push(normalizeStatusToken(status), compactStatusToken(status))
  } else if (typeof status === 'object') {
    for (const value of [status.abbreviation, status.name, status.type, status.description]) {
      if (value == null || value === '') continue
      if (typeof value === 'object') {
        tokens.push(normalizeStatusToken(value.name), compactStatusToken(value.name))
        tokens.push(normalizeStatusToken(value.abbreviation), compactStatusToken(value.abbreviation))
      } else {
        tokens.push(normalizeStatusToken(value), compactStatusToken(value))
      }
    }
  }
  for (const token of tokens) {
    if (token && BLOCKED_STATUS_REASONS[token]) return BLOCKED_STATUS_REASONS[token]
  }
  return null
}

export function isBlockedEspnStatus(status) {
  return Boolean(blockedEspnStatusReason(status))
}

export function isAllowedWeeklyEspnStatus(status) {
  const tokens = []
  if (status == null) return false
  if (typeof status === 'string' || typeof status === 'number') {
    tokens.push(normalizeStatusToken(status), compactStatusToken(status))
  } else if (typeof status === 'object') {
    for (const value of [status.abbreviation, status.name, status.type]) {
      if (value == null || value === '') continue
      tokens.push(normalizeStatusToken(value), compactStatusToken(value))
    }
  }
  return tokens.some((token) => ALLOWED_WEEKLY_STATUS.has(token))
}

function athleteName(athlete) {
  return athlete?.displayName || athlete?.fullName || athlete?.name || athlete?.athlete?.displayName || ''
}

function injuryEntries(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node.injuries)) return node.injuries.filter(Boolean)
  if (node.injury) return [node.injury]
  return []
}

function pushStatusSource(sources, value) {
  if (value == null || value === '') return
  sources.push(value)
}

/**
 * ESPN's roster `status` is often still Active while the weekly
 * designation lives on every `injuries[]` entry (Out, IR, Suspension).
 */
export function collectAthleteStatusSources(athlete) {
  if (!athlete || typeof athlete !== 'object') return []
  const nodes = [athlete]
  if (athlete.athlete && athlete.athlete !== athlete) nodes.push(athlete.athlete)
  const sources = []
  for (const node of nodes) {
    pushStatusSource(sources, node.status)
    for (const injury of injuryEntries(node)) {
      pushStatusSource(sources, injury.status)
      pushStatusSource(sources, injury.type)
    }
  }
  return sources
}

export function athleteBlockingReason(athlete) {
  for (const source of collectAthleteStatusSources(athlete)) {
    const reason = blockedEspnStatusReason(source)
    if (reason) return { reason, status: source }
  }
  const sources = collectAthleteStatusSources(athlete)
  return { reason: null, status: sources[0] || null }
}

function athleteRecord(athlete, teamAbbr) {
  const name = athleteName(athlete)
  if (!name) return null
  const statuses = collectAthleteStatusSources(athlete)
  const blocked = athleteBlockingReason(athlete)
  return {
    name,
    team: teamAbbr || athlete.team?.abbreviation || athlete.team?.abbr || null,
    position: athlete.position?.abbreviation || athlete.position?.name || null,
    status: blocked.status || athlete.status || null,
    statuses,
    espnId: athlete.id || athlete.espnId || null,
  }
}

function mergeWrapperInjuries(node) {
  const inner = node.athlete
  const injuries = [...injuryEntries(inner), ...injuryEntries(node)]
  return {
    ...inner,
    status: inner.status || node.status,
    injuries,
  }
}

function collectAthletes(node) {
  if (!node) return []
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectAthletes(item))
  }
  if (Array.isArray(node.items)) return node.items
  if (Array.isArray(node.athletes)) return node.athletes.flatMap((item) => collectAthletes(item))
  if (Array.isArray(node.roster)) return node.roster
  if (node.athlete) return [mergeWrapperInjuries(node)]
  if (node.displayName || node.fullName || node.name) return [node]
  return []
}

export function parseEspnRosterAthletes(payload, teamAbbr) {
  const athletes = collectAthletes(payload?.athletes || payload?.items || payload)
  const players = []
  for (const athlete of athletes) {
    const record = athleteRecord(athlete, teamAbbr)
    if (record) players.push(record)
  }
  return players
}

export function parseEspnEventRosters(payload) {
  const players = []
  const rosters = Array.isArray(payload?.rosters) ? payload.rosters : []
  for (const group of rosters) {
    const teamAbbr = group?.team?.abbreviation || group?.team?.abbr || null
    const entries = collectAthletes(group)
    for (const athlete of entries) {
      const record = athleteRecord(athlete, teamAbbr)
      if (record) players.push(record)
    }
  }
  if (players.length) return players

  const boxTeams = Array.isArray(payload?.boxscore?.players) ? payload.boxscore.players : []
  for (const teamBlock of boxTeams) {
    const teamAbbr = teamBlock?.team?.abbreviation || teamBlock?.team?.abbr || null
    const stats = Array.isArray(teamBlock?.statistics) ? teamBlock.statistics : []
    for (const stat of stats) {
      for (const athlete of collectAthletes(stat)) {
        const record = athleteRecord(athlete, teamAbbr)
        if (record) players.push(record)
      }
    }
  }
  return players
}

export function findRosterPlayer(players, playerName) {
  const list = Array.isArray(players) ? players.filter((p) => p?.name) : []
  if (!list.length || !playerName) return null
  const target = normalizeGradePlayerName(playerName)
  if (!target) return null
  const exact = list.filter((p) => normalizeGradePlayerName(p.name) === target)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const aliasName = uniqueFirstNameAliasMatch(list.map((p) => p.name), target)
  if (!aliasName) return null
  return list.find((p) => p.name === aliasName) || null
}

export function evaluateEventRosterEligibility({ playerName, players, rosterAvailable = true } = {}) {
  if (!rosterAvailable || !Array.isArray(players)) {
    return { ok: false, reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE }
  }
  const match = findRosterPlayer(players, playerName)
  if (!match) {
    return { ok: false, reason: ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER }
  }
  const statuses = Array.isArray(match.statuses) && match.statuses.length
    ? match.statuses
    : [match.status]
  for (const status of statuses) {
    const blocked = blockedEspnStatusReason(status)
    if (blocked) return { ok: false, reason: blocked, player: match }
  }
  return { ok: true, player: match }
}

export function logEventRosterSkip({ playerName, event, reason } = {}, log = console.log) {
  const player = playerName || '(unknown player)'
  const eventLabel = event || '(unknown event)'
  const skipReason = reason || ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE
  log(`Skipping roster-ineligible prop: ${player} | event=${eventLabel} | reason=${skipReason}`)
}

export function summarizeRosterGuard({ kept = [], skipped = [], guardedCount = null } = {}) {
  const byReason = {}
  for (const skip of skipped) {
    const reason = skip?.reason || ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE
    byReason[reason] = (byReason[reason] || 0) + 1
  }
  const unavailableCount = byReason[ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE] || 0
  const guarded = Number.isFinite(guardedCount) ? guardedCount : skipped.length
  const keptCount = Number.isFinite(guardedCount)
    ? Math.max(0, guarded - skipped.length)
    : kept.length
  const rosterOutage = guarded > 0 && keptCount === 0 && unavailableCount === guarded
  return {
    unavailableCount,
    rosterOutage,
    guardedCount: guarded,
    keptCount,
    skippedCount: skipped.length,
    byReason,
  }
}

export function formatRosterGuardStatusLine(stats) {
  const status = stats?.rosterOutage ? 'outage' : 'ok'
  const unavailable = stats?.unavailableCount || 0
  let line = `ROSTER_GUARD_STATUS=${status} unavailable=${unavailable}`
  const sports = stats?.sports && typeof stats.sports === 'object'
    ? Object.entries(stats.sports)
    : (stats?.sport ? [[stats.sport, stats]] : [])
  for (const [sport, sportStats] of sports) {
    if (!sport) continue
    line += ` ${sport}=${sportStats?.rosterOutage ? 'outage' : 'ok'}`
  }
  return line
}

export function logRosterGuardSummary(stats, {
  log = console.log,
  error = console.error,
  label = '',
} = {}) {
  const tag = label ? ` (${label})` : ''
  const reasonBits = Object.entries(stats?.byReason || {})
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ')
  log(
    `📌 Roster guard${tag}: unavailable=${stats?.unavailableCount || 0}`
    + ` skipped=${stats?.skippedCount || 0}`
    + ` kept=${stats?.keptCount || 0}`
    + (reasonBits ? ` (${reasonBits})` : ''),
  )
  if (stats?.rosterOutage) {
    error('🚨 Roster guard outage: every prop skipped because ESPN roster was unavailable')
  }
}

export function withRosterGuardMeta(saved, stats) {
  const rows = Array.isArray(saved) ? saved : []
  rows.unavailableCount = stats?.unavailableCount || 0
  rows.rosterOutage = Boolean(stats?.rosterOutage)
  rows.rosterGuard = stats || summarizeRosterGuard({})
  return rows
}

export function mergeRosterGuardMeta(...parts) {
  const statsList = parts.map((part) => part?.rosterGuard || summarizeRosterGuard({}))
  const byReason = {}
  const sports = {}
  let guardedCount = 0
  let keptCount = 0
  let skippedCount = 0
  let unavailableCount = 0
  for (const stats of statsList) {
    guardedCount += stats.guardedCount || 0
    keptCount += stats.keptCount || 0
    skippedCount += stats.skippedCount || 0
    unavailableCount += stats.unavailableCount || 0
    for (const [reason, count] of Object.entries(stats.byReason || {})) {
      byReason[reason] = (byReason[reason] || 0) + count
    }
    if (stats.sport) sports[stats.sport] = stats
    if (stats.sports && typeof stats.sports === 'object') {
      Object.assign(sports, stats.sports)
    }
  }
  const merged = {
    unavailableCount,
    // Either sport's full outage is an outage. Do not let a kept NHL
    // prop hide a complete NFL roster miss (or the reverse).
    rosterOutage: statsList.some((stats) => Boolean(stats.rosterOutage)),
    guardedCount,
    keptCount,
    skippedCount,
    byReason,
    sports,
  }
  const combined = parts.flatMap((part) => (Array.isArray(part) ? part : []))
  return withRosterGuardMeta(combined, merged)
}

export function withSharedRosterGuard(options = {}) {
  return {
    ...options,
    rosterCache: options.rosterCache || new Map(),
    rosterPace: options.rosterPace || { lastFetchAt: null },
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nowMs(deps = {}) {
  if (typeof deps.nowImpl === 'function') return deps.nowImpl()
  return Date.now()
}

async function pacedGap(state, deps = {}) {
  const clock = nowMs(deps)
  if (state.lastFetchAt == null) {
    state.lastFetchAt = clock
    return
  }
  const wait = Math.max(0, (deps.gapMs ?? ESPN_ROSTER_GAP_MS) - (clock - state.lastFetchAt))
  if (wait > 0) await (deps.sleepImpl || defaultSleep)(wait)
  state.lastFetchAt = nowMs(deps)
}

async function readEspnJson(url, { fetchImpl, headers } = {}) {
  const fetchFn = fetchImpl || fetch
  const response = await fetchFn(url, {
    headers: headers || { 'User-Agent': 'OddsOnDeck/1.0' },
  })
  if (!response || !response.ok) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

function rosterRetryWaitMs(options = {}) {
  const requested = Number(options.retryMs ?? ESPN_ROSTER_RETRY_MS)
  const cap = Number(options.retryMaxMs ?? ESPN_ROSTER_RETRY_MAX_MS)
  if (!Number.isFinite(requested) || requested < 0) return Math.max(0, cap)
  return Math.max(0, Math.min(requested, cap))
}

async function readEspnJsonWithRetry(url, deps) {
  try {
    const first = await readEspnJson(url, deps)
    if (first) return first
  } catch {
    // retry once
  }
  const wait = rosterRetryWaitMs(deps)
  if (wait > 0) await (deps.sleepImpl || defaultSleep)(wait)
  try {
    return await readEspnJson(url, deps)
  } catch {
    return null
  }
}

function canonRosterTeam(sport, abbr) {
  const key = normalizeSport(sport)
  if (key === 'nhl' || key === 'mlb') return canonicalTeamCode(key, abbr)
  const raw = String(abbr || '').toUpperCase().trim()
  if (!raw) return ''
  const aliased = NFL_ABBR_ALIASES[raw.toLowerCase()]
  return String(aliased || raw).toUpperCase()
}

export function eventRosterHasBothTeams(players, game, sport = game?.sport) {
  const teams = eventTeams(game, sport)
  const home = canonRosterTeam(sport, teams.home.abbr)
  const away = canonRosterTeam(sport, teams.away.abbr)
  if (!home || !away) return false
  const seen = new Set(
    (Array.isArray(players) ? players : [])
      .map((player) => canonRosterTeam(sport, player?.team))
      .filter(Boolean),
  )
  return seen.has(home) && seen.has(away)
}

export function eventTeams(game, sport = game?.sport) {
  const codes = gameTeamCodes(game, sport)
  const home = {
    abbr: codes.home || game?.home?.abbr || null,
    id: game?.homeId || game?.home?.id || null,
  }
  const away = {
    abbr: codes.away || game?.away?.abbr || null,
    id: game?.awayId || game?.away?.id || null,
  }
  return { home, away }
}

async function fetchTeamRosterPlayers(sport, team, deps) {
  const teamId = resolveEspnTeamId(sport, team)
  if (!teamId) return { ok: false, players: [] }
  const cache = deps.cache
  const cacheKey = `team:${normalizeSport(sport)}:${teamId}`
  if (cache?.has(cacheKey)) return cache.get(cacheKey)

  await pacedGap(deps.pace, deps)
  let payload = null
  try {
    payload = await readEspnJsonWithRetry(espnRosterUrl(sport, teamId), deps)
  } catch {
    payload = null
  }
  const players = parseEspnRosterAthletes(payload, team.abbr || team.abbreviation || null)
  const result = players.length > 0
    ? { ok: true, players }
    : { ok: false, players: [] }
  cache?.set(cacheKey, result)
  return result
}

async function fetchEventRosterPlayers(sport, espnGameId, deps) {
  const cache = deps.cache
  const cacheKey = `event:${normalizeSport(sport)}:${espnGameId}`
  if (cache?.has(cacheKey)) return cache.get(cacheKey)

  await pacedGap(deps.pace, deps)
  let payload = null
  try {
    payload = await readEspnJsonWithRetry(espnEventSummaryUrl(sport, espnGameId), deps)
  } catch {
    payload = null
  }
  const players = parseEspnEventRosters(payload)
  const result = { ok: players.length > 0, players }
  cache?.set(cacheKey, result)
  return result
}

/**
 * Load ESPN players for both teams in an event. Prefers an event roster
 * when espnGameId is present and populated; otherwise both team rosters.
 * Incomplete or failed fetches are unavailable (fail-safe).
 */
export async function loadEventRosterPlayers(game, options = {}) {
  const sport = normalizeSport(options.sport || game?.sport)
  if (sport !== 'nfl' && sport !== 'nhl') {
    return { ok: false, players: [], reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE }
  }
  const deps = {
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    gapMs: options.gapMs ?? ESPN_ROSTER_GAP_MS,
    cache: options.cache || new Map(),
    pace: options.pace || { lastFetchAt: null },
    headers: options.headers,
    nowImpl: options.nowImpl,
    retryMs: options.retryMs,
    retryMaxMs: options.retryMaxMs,
  }

  if (game?.espnGameId && options.preferEvent !== false) {
    const eventRoster = await fetchEventRosterPlayers(sport, game.espnGameId, deps)
    if (eventRoster.ok && eventRosterHasBothTeams(eventRoster.players, game, sport)) {
      return eventRoster
    }
  }

  const teams = eventTeams(game, sport)
  const homeId = resolveEspnTeamId(sport, teams.home)
  const awayId = resolveEspnTeamId(sport, teams.away)
  if (!homeId || !awayId) {
    return { ok: false, players: [], reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE }
  }

  const home = await fetchTeamRosterPlayers(sport, teams.home, deps)
  const away = await fetchTeamRosterPlayers(sport, teams.away, deps)
  if (!home.ok || !away.ok) {
    return { ok: false, players: [], reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE }
  }
  return { ok: true, players: [...home.players, ...away.players] }
}

export async function checkPlayerEventRosterEligibility({
  playerName,
  game,
  sport,
  ...options
} = {}) {
  const roster = await loadEventRosterPlayers(game, { sport: sport || game?.sport, ...options })
  return {
    ...evaluateEventRosterEligibility({
      playerName,
      players: roster.players,
      rosterAvailable: roster.ok,
    }),
    event: formatEventLabel(game),
  }
}

function propGameId(prop) {
  return prop?.gameId || prop?.gameIdRef || null
}

function gameFromPropFields(prop, parsed) {
  if (!parsed && !prop) return null
  return {
    id: propGameId(prop),
    sport: prop?.sport,
    espnGameId: prop?.espnGameId || null,
    home: prop?.home || { abbr: parsed?.home || prop?.homeAbbr || null },
    away: prop?.away || { abbr: parsed?.away || prop?.awayAbbr || null },
    homeId: prop?.homeId || null,
    awayId: prop?.awayId || null,
  }
}

const GAME_ROSTER_SELECT = 'id, sport, espnGameId, homeId, awayId, home:Team!Game_homeId_fkey(abbr, name), away:Team!Game_awayId_fkey(abbr, name)'

async function resolveGameForProp(prop, options) {
  const id = propGameId(prop)
  if (options.gamesById) {
    const hit = options.gamesById instanceof Map
      ? options.gamesById.get(id)
      : options.gamesById[id]
    if (hit) return hit
  }
  if (typeof options.loadGame === 'function') {
    const loaded = await options.loadGame(id, prop)
    if (loaded) return loaded
  }
  if (options.supabase && id) {
    try {
      const query = options.supabase.from('Game').select(GAME_ROSTER_SELECT).eq('id', id)
      const result = typeof query.maybeSingle === 'function'
        ? await query.maybeSingle()
        : await query
      if (result?.data) return result.data
    } catch {
      // fall through to gameId parse
    }
  }
  const parsed = parseGameIdTeams(id)
  if (parsed || prop?.home || prop?.away) return gameFromPropFields(prop, parsed)
  return null
}

/**
 * Keep props whose player is on an event roster with an allowed status.
 * Sports not in `options.sports` pass through unchanged (MLB, etc.).
 */
export async function guardPropsByEventRoster(props, options = {}) {
  const rows = Array.isArray(props) ? props : []
  const sports = new Set((options.sports || ['nfl', 'nhl']).map(normalizeSport))
  const kept = []
  const skipped = []
  let guardedCount = 0
  const log = options.log || console.log
  const cache = options.cache || options.rosterCache || new Map()
  const pace = options.pace || options.rosterPace || { lastFetchAt: null }
  const gamesById = options.gamesById instanceof Map ? options.gamesById : new Map(Object.entries(options.gamesById || {}))

  for (const prop of rows) {
    const sport = normalizeSport(prop?.sport)
    if (!sports.has(sport)) {
      kept.push(prop)
      continue
    }
    guardedCount += 1

    const game = await resolveGameForProp(prop, { ...options, gamesById })
    const event = formatEventLabel(game || { id: propGameId(prop), sport })
    const playerName = prop?.playerName
    if (!game) {
      const skip = { playerName, event, reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE, sport }
      skipped.push(skip)
      logEventRosterSkip(skip, log)
      continue
    }
    if (game?.id) gamesById.set(game.id, game)

    const roster = await loadEventRosterPlayers(game, {
      sport,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      nowImpl: options.nowImpl,
      gapMs: options.gapMs,
      retryMs: options.retryMs,
      retryMaxMs: options.retryMaxMs,
      cache,
      pace,
      preferEvent: options.preferEvent,
    })
    const decision = evaluateEventRosterEligibility({
      playerName,
      players: roster.players,
      rosterAvailable: roster.ok,
    })
    if (!decision.ok) {
      const skip = { playerName, event, reason: decision.reason, sport }
      skipped.push(skip)
      logEventRosterSkip(skip, log)
      continue
    }
    kept.push(prop)
  }

  const stats = summarizeRosterGuard({ kept, skipped, guardedCount })
  return { kept, skipped, ...stats }
}
