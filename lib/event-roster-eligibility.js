/**
 * Event-roster eligibility for NFL / NHL player props.
 *
 * Books still post lines on free agents and injured players. Before a
 * prop is generated or recorded as Published / shadow-published, the
 * player must appear on the ESPN active roster of one of the two teams
 * for that event, and must not have status FA, IR, or Out.
 *
 * Uses ESPN team or event roster data only. No Odds API calls.
 * Fail-safe: if the roster cannot be fetched, skip the prop.
 */

import { ESPN_TEAM_IDS } from './vendors/espn-nfl-roster.js'
import {
  normalizeGradePlayerName,
  uniqueFirstNameAliasMatch,
} from './player-name-match.js'
import { gameTeamCodes, parseGameIdTeams } from './player-stat-grade.js'

export const ESPN_ROSTER_GAP_MS = 200

export const ROSTER_SKIP_REASONS = Object.freeze({
  NOT_ON_EVENT_ROSTER: 'not_on_event_roster',
  ESPN_STATUS_FA: 'espn_status_fa',
  ESPN_STATUS_IR: 'espn_status_ir',
  ESPN_STATUS_OUT: 'espn_status_out',
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
})

function normalizeSport(sport) {
  return String(sport || '').toLowerCase().trim()
}

function normalizeStatusToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
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

function athleteName(athlete) {
  return athlete?.displayName || athlete?.fullName || athlete?.name || athlete?.athlete?.displayName || ''
}

function athleteStatus(athlete) {
  if (!athlete || typeof athlete !== 'object') return null
  if (athlete.status) return athlete.status
  const injury = Array.isArray(athlete.injuries) ? athlete.injuries[0] : athlete.injury
  if (injury?.status) return injury.status
  if (typeof injury?.type === 'string') return injury.type
  if (injury?.type?.name) return injury.type.name
  return null
}

function athleteRecord(athlete, teamAbbr) {
  const name = athleteName(athlete)
  if (!name) return null
  return {
    name,
    team: teamAbbr || athlete.team?.abbreviation || athlete.team?.abbr || null,
    position: athlete.position?.abbreviation || athlete.position?.name || null,
    status: athleteStatus(athlete),
    espnId: athlete.id || athlete.espnId || null,
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
  if (node.athlete) return [node.athlete]
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
  const blocked = blockedEspnStatusReason(match.status)
  if (blocked) return { ok: false, reason: blocked, player: match }
  return { ok: true, player: match }
}

export function logEventRosterSkip({ playerName, event, reason } = {}, log = console.log) {
  const player = playerName || '(unknown player)'
  const eventLabel = event || '(unknown event)'
  const skipReason = reason || ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE
  log(`Skipping roster-ineligible prop: ${player} | event=${eventLabel} | reason=${skipReason}`)
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pacedGap(state, { sleepImpl, gapMs }) {
  if (!state.lastFetchAt) {
    state.lastFetchAt = Date.now()
    return
  }
  const wait = Math.max(0, (gapMs ?? ESPN_ROSTER_GAP_MS) - (Date.now() - state.lastFetchAt))
  if (wait > 0) await (sleepImpl || defaultSleep)(wait)
  state.lastFetchAt = Date.now()
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
    payload = await readEspnJson(espnRosterUrl(sport, teamId), deps)
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
    payload = await readEspnJson(espnEventSummaryUrl(sport, espnGameId), deps)
  } catch {
    payload = null
  }
  const players = parseEspnEventRosters(payload)
  const result = players.length > 0
    ? { ok: true, players }
    : { ok: false, players: [] }
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
    pace: options.pace || { lastFetchAt: 0 },
    headers: options.headers,
  }

  if (game?.espnGameId && options.preferEvent !== false) {
    const eventRoster = await fetchEventRosterPlayers(sport, game.espnGameId, deps)
    if (eventRoster.ok) return eventRoster
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
  const log = options.log || console.log
  const cache = options.cache || new Map()
  const pace = options.pace || { lastFetchAt: 0 }
  const gamesById = options.gamesById instanceof Map ? options.gamesById : new Map(Object.entries(options.gamesById || {}))

  for (const prop of rows) {
    const sport = normalizeSport(prop?.sport)
    if (!sports.has(sport)) {
      kept.push(prop)
      continue
    }

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
      gapMs: options.gapMs,
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

  return { kept, skipped }
}
