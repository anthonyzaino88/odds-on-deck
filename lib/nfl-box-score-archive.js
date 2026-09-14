/**
 * Independent NFL box-score archival (ESPN public endpoints).
 *
 * Discovers completed games from the source scoreboard / summary — not from
 * PropValidation. Missing statistics stay null. DNP is never inferred from
 * absent or zero stats. Identical observations are idempotent; source
 * corrections write a new version. A game is marked archived only after
 * raw + normalized output is written and verified.
 */

import path from 'path'
import {
  ArchiveWriteError,
  NFL_INDEX_FILENAME,
  appendJsonlRecords,
  readJsonFile,
  readJsonlFile,
  resolveNflBoxScoresDir,
  stableHash,
  writeJsonAtomic,
  writeJsonlAtomic,
} from './local-archive.js'

export const NFL_BOX_SCORE_SCHEMA_VERSION = 1
export const NFL_BOX_SCORE_SOURCE = 'espn-site-api-v2-summary'
export const ESPN_NFL_SITE_API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'

const PASSING_POS = { completionsAttempts: 0, yards: 1, td: 3, int: 4 }
const RUSHING_POS = { attempts: 0, yards: 1, td: 3 }
const RECEIVING_POS = { receptions: 0, yards: 1, td: 3, targets: 5 }
const DEFENSIVE_POS = { tackles: 0, sacks: 2 }
const INTERCEPTIONS_POS = { interceptions: 0 }
const RETURN_POS = { yards: 1, td: 4 }

const EMPTY_STAT_TOKENS = new Set(['', '-', '--', '—', 'n/a', 'na', 'null', 'undefined'])

export function configuredNflSeasonYear(now = new Date()) {
  const env = process.env.NFL_ARCHIVE_SEASON
  if (env && /^\d{4}$/.test(String(env))) return Number(env)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  // Jan–Feb are the prior season's playoffs.
  return m < 3 ? y - 1 : y
}

export function espnScoreboardUrl({ season, week, seasonType = 2, dates } = {}) {
  const params = new URLSearchParams()
  if (dates) params.set('dates', String(dates).replace(/-/g, ''))
  else if (season) params.set('dates', String(season))
  if (week != null && week !== '') {
    params.set('week', String(week))
    params.set('seasontype', String(seasonType))
  } else if (season && !dates) {
    params.set('seasontype', String(seasonType))
  }
  const qs = params.toString()
  return qs ? `${ESPN_NFL_SITE_API}/scoreboard?${qs}` : `${ESPN_NFL_SITE_API}/scoreboard`
}

export function espnSummaryUrl(eventId) {
  return `${ESPN_NFL_SITE_API}/summary?event=${encodeURIComponent(eventId)}`
}

export function parseNullableNumber(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const trimmed = String(value).trim()
  if (!trimmed || EMPTY_STAT_TOKENS.has(trimmed.toLowerCase())) return null
  const n = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function parseCompletionAttempt(raw) {
  if (raw == null) return { completions: null, attempts: null }
  const trimmed = String(raw).trim()
  if (!trimmed || EMPTY_STAT_TOKENS.has(trimmed.toLowerCase())) {
    return { completions: null, attempts: null }
  }
  if (!trimmed.includes('/')) {
    return { completions: parseNullableNumber(trimmed), attempts: null }
  }
  const [c, a] = trimmed.split('/')
  return { completions: parseNullableNumber(c), attempts: parseNullableNumber(a) }
}

function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function indexOfKey(keys, candidates) {
  if (!Array.isArray(keys) || keys.length === 0) return -1
  const wanted = candidates.map(normalizeKey)
  return keys.findIndex((key) => wanted.includes(normalizeKey(key)))
}

function statAt(stats, keys, candidates, positionalIndex) {
  const fromKey = indexOfKey(keys, candidates)
  if (fromKey >= 0) return stats[fromKey]
  if (positionalIndex == null) return undefined
  return stats[positionalIndex]
}

function setIfCategoryPresent(target, field, value) {
  target[field] = value == null ? null : value
}

export function isEspnNflEventCompleted(payload) {
  if (!payload || typeof payload !== 'object') return false
  const competition =
    payload.competitions?.[0] ||
    payload.header?.competitions?.[0] ||
    payload
  const status = competition.status || payload.status || payload.header?.status
  const type = status?.type || {}

  const name = String(type.name || type.description || '').toUpperCase()
  if (
    name.includes('CANCEL') ||
    name.includes('POSTPONE') ||
    name.includes('DELAY') ||
    name.includes('FORFEIT') ||
    name.includes('SUSPEND')
  ) {
    return false
  }

  if (type.completed === true) return true
  if (type.completed === false) return false

  if (type.state === 'post' && (name === 'STATUS_FINAL' || name === 'STATUS_FINAL_OVERTIME')) {
    return true
  }
  return false
}

function teamIdFrom(node) {
  if (!node) return null
  const id = node.id || node.team?.id || node.team?.team?.id
  return id == null ? null : String(id)
}

function teamAbbrFrom(node) {
  if (!node) return null
  return (
    node.abbreviation ||
    node.abbr ||
    node.team?.abbreviation ||
    node.team?.abbr ||
    node.team?.team?.abbreviation ||
    null
  )
}

function teamNameFrom(node) {
  if (!node) return null
  return (
    node.displayName ||
    node.name ||
    node.team?.displayName ||
    node.team?.name ||
    node.team?.team?.displayName ||
    null
  )
}

function competitorsFrom(payload) {
  return (
    payload?.competitions?.[0]?.competitors ||
    payload?.header?.competitions?.[0]?.competitors ||
    payload?.boxscore?.teams ||
    []
  )
}

function applyPassing(statsObj, stats, keys) {
  const rawPair = statAt(stats, keys, ['c/att', 'completions/passingattempts', 'compatt'], PASSING_POS.completionsAttempts)
  const pair = parseCompletionAttempt(rawPair)
  setIfCategoryPresent(statsObj, 'passingCompletions', pair.completions)
  setIfCategoryPresent(statsObj, 'passingAttempts', pair.attempts)
  setIfCategoryPresent(
    statsObj,
    'passingYards',
    parseNullableNumber(statAt(stats, keys, ['yds', 'yards', 'passingyards'], PASSING_POS.yards))
  )
  setIfCategoryPresent(
    statsObj,
    'passingTouchdowns',
    parseNullableNumber(statAt(stats, keys, ['td', 'touchdowns', 'passingtouchdowns'], PASSING_POS.td))
  )
  setIfCategoryPresent(
    statsObj,
    'interceptions',
    parseNullableNumber(statAt(stats, keys, ['int', 'interceptions'], PASSING_POS.int))
  )
}

function applyRushing(statsObj, stats, keys) {
  setIfCategoryPresent(
    statsObj,
    'rushingAttempts',
    parseNullableNumber(statAt(stats, keys, ['car', 'att', 'attempts', 'rushingattempts'], RUSHING_POS.attempts))
  )
  setIfCategoryPresent(
    statsObj,
    'rushingYards',
    parseNullableNumber(statAt(stats, keys, ['yds', 'yards', 'rushingyards'], RUSHING_POS.yards))
  )
  setIfCategoryPresent(
    statsObj,
    'rushingTouchdowns',
    parseNullableNumber(statAt(stats, keys, ['td', 'touchdowns', 'rushingtouchdowns'], RUSHING_POS.td))
  )
}

function applyReceiving(statsObj, stats, keys) {
  setIfCategoryPresent(
    statsObj,
    'receptions',
    parseNullableNumber(statAt(stats, keys, ['rec', 'receptions'], RECEIVING_POS.receptions))
  )
  setIfCategoryPresent(
    statsObj,
    'receivingYards',
    parseNullableNumber(statAt(stats, keys, ['yds', 'yards', 'receivingyards'], RECEIVING_POS.yards))
  )
  setIfCategoryPresent(
    statsObj,
    'receivingTouchdowns',
    parseNullableNumber(statAt(stats, keys, ['td', 'touchdowns', 'receivingtouchdowns'], RECEIVING_POS.td))
  )
  setIfCategoryPresent(
    statsObj,
    'targets',
    parseNullableNumber(statAt(stats, keys, ['tgts', 'targets'], RECEIVING_POS.targets))
  )
}

function applyDefensive(statsObj, stats, keys) {
  setIfCategoryPresent(
    statsObj,
    'tackles',
    parseNullableNumber(statAt(stats, keys, ['tot', 'total', 'tackles'], DEFENSIVE_POS.tackles))
  )
  setIfCategoryPresent(
    statsObj,
    'sacks',
    parseNullableNumber(statAt(stats, keys, ['sacks'], DEFENSIVE_POS.sacks))
  )
}

function applyDefensiveInterceptions(statsObj, stats, keys) {
  setIfCategoryPresent(
    statsObj,
    'defensiveInterceptions',
    parseNullableNumber(statAt(stats, keys, ['int', 'interceptions'], INTERCEPTIONS_POS.interceptions))
  )
}

function applyReturns(statsObj, stats, keys, prefix) {
  setIfCategoryPresent(
    statsObj,
    `${prefix}Yards`,
    parseNullableNumber(statAt(stats, keys, ['yds', 'yards'], RETURN_POS.yards))
  )
  setIfCategoryPresent(
    statsObj,
    `${prefix}Touchdowns`,
    parseNullableNumber(statAt(stats, keys, ['td', 'touchdowns'], RETURN_POS.td))
  )
}

function parseBoxscorePlayers(boxscore) {
  const players = []
  const unresolvedPlayerIds = []
  const unresolvedTeamIds = []

  for (const teamBlock of boxscore?.players || []) {
    const teamId = teamIdFrom(teamBlock.team || teamBlock)
    const teamAbbr = teamAbbrFrom(teamBlock.team || teamBlock)
    const teamName = teamNameFrom(teamBlock.team || teamBlock)
    if (!teamId) unresolvedTeamIds.push(teamAbbr || teamName || 'unknown-team')

    for (const category of teamBlock.statistics || []) {
      const statType = category.name
      const keys = category.keys || category.labels || []
      for (const athlete of category.athletes || []) {
        const person = athlete.athlete || athlete
        const playerId = person?.id != null ? String(person.id) : null
        const playerName = person?.displayName || person?.fullName || person?.name || null
        if (!playerName) continue
        if (!playerId) unresolvedPlayerIds.push(playerName)

        let row = players.find(
          (p) =>
            (playerId && p.provider_player_id === playerId) ||
            (!playerId && p.player_name === playerName && p.provider_team_id === teamId)
        )
        if (!row) {
          row = {
            provider_player_id: playerId,
            player_name: playerName,
            provider_team_id: teamId,
            team_abbr: teamAbbr,
            team: teamName,
            stats: {},
          }
          players.push(row)
        }

        const stats = athlete.stats || []
        if (statType === 'passing') applyPassing(row.stats, stats, keys)
        else if (statType === 'rushing') applyRushing(row.stats, stats, keys)
        else if (statType === 'receiving') applyReceiving(row.stats, stats, keys)
        else if (statType === 'defensive') applyDefensive(row.stats, stats, keys)
        else if (statType === 'interceptions') applyDefensiveInterceptions(row.stats, stats, keys)
        else if (statType === 'kickReturns') applyReturns(row.stats, stats, keys, 'kickReturn')
        else if (statType === 'puntReturns') applyReturns(row.stats, stats, keys, 'puntReturn')
      }
    }
  }

  return { players, unresolvedPlayerIds, unresolvedTeamIds }
}

/**
 * Name-keyed map used by the existing grading adapter. Category keys that
 * were present but null become 0, matching historical fetchNFLGameStats.
 * Keys the player never appeared in stay absent (getPlayerGameStat → null).
 */
export function toGradingAdapterPlayerMap(parsed) {
  const playerStats = {}
  for (const player of parsed?.players || []) {
    const name = player.player_name
    if (!name) continue
    if (!playerStats[name]) playerStats[name] = {}
    for (const [field, value] of Object.entries(player.stats || {})) {
      playerStats[name][field] = value == null ? 0 : value
    }
  }
  return playerStats
}

export function parseEspnNflScoreboardEvents(scoreboard) {
  const events = []
  const seasonDefault = scoreboard?.season?.year
  const weekDefault = scoreboard?.week?.number
  const seasonTypeDefault = scoreboard?.season?.type

  for (const event of scoreboard?.events || []) {
    const competition = event.competitions?.[0] || {}
    const home = (competition.competitors || []).find((c) => c.homeAway === 'home')
    const away = (competition.competitors || []).find((c) => c.homeAway === 'away')
    const completed = isEspnNflEventCompleted(event)
    events.push({
      provider_event_id: event.id != null ? String(event.id) : null,
      name: event.name || event.shortName || null,
      game_time: event.date || competition.date || null,
      season: String(event.season?.year || seasonDefault || ''),
      week: event.week?.number ?? weekDefault ?? null,
      season_type: event.season?.type ?? seasonTypeDefault ?? null,
      completed,
      status_name: competition.status?.type?.name || event.status?.type?.name || null,
      status_state: competition.status?.type?.state || event.status?.type?.state || null,
      home_team_id: teamIdFrom(home),
      away_team_id: teamIdFrom(away),
      home_abbr: teamAbbrFrom(home),
      away_abbr: teamAbbrFrom(away),
    })
  }
  return events
}

export function filterCompletedNflEvents(events, { from, to } = {}) {
  const fromMs = from ? new Date(from).getTime() : null
  const toMs = to ? new Date(to).getTime() : null
  return (events || []).filter((event) => {
    if (!event?.completed) return false
    if (!event.provider_event_id) return false
    if (fromMs != null || toMs != null) {
      if (!event.game_time) return false
      const t = new Date(event.game_time).getTime()
      if (Number.isNaN(t)) return false
      if (fromMs != null && t < fromMs) return false
      if (toMs != null && t > toMs) return false
    }
    return true
  })
}

export function parseEspnNflSummary(data, { fetchedAt } = {}) {
  if (!data || typeof data !== 'object') return null

  const header = data.header || {}
  const competition = header.competitions?.[0] || data.competitions?.[0] || {}
  const completed = isEspnNflEventCompleted(data)
  const boxscore = data.boxscore
  const hasBoxscorePlayers = Array.isArray(boxscore?.players) && boxscore.players.length > 0
  const { players, unresolvedPlayerIds, unresolvedTeamIds } = hasBoxscorePlayers
    ? parseBoxscorePlayers(boxscore)
    : { players: [], unresolvedPlayerIds: [], unresolvedTeamIds: [] }

  const competitors = competitorsFrom(data)
  const home = competitors.find((c) => c.homeAway === 'home' || c.homeAway === 'Home') || competitors[0]
  const away = competitors.find((c) => c.homeAway === 'away' || c.homeAway === 'Away') || competitors[1]

  const providerEventId = header.id != null ? String(header.id) : data.id != null ? String(data.id) : null
  const fetched = fetchedAt || new Date().toISOString()

  const teams = [
    {
      side: 'away',
      provider_team_id: teamIdFrom(away),
      abbr: teamAbbrFrom(away),
      name: teamNameFrom(away),
      score: parseNullableNumber(away?.score),
    },
    {
      side: 'home',
      provider_team_id: teamIdFrom(home),
      abbr: teamAbbrFrom(home),
      name: teamNameFrom(home),
      score: parseNullableNumber(home?.score),
    },
  ]

  const unresolvedTeamIdsFromTeams = teams
    .filter((t) => !t.provider_team_id)
    .map((t) => t.abbr || t.side)

  const observation = {
    schema_version: NFL_BOX_SCORE_SCHEMA_VERSION,
    sport: 'nfl',
    source: NFL_BOX_SCORE_SOURCE,
    provider: 'espn',
    provider_event_id: providerEventId,
    season: header.season?.year != null ? String(header.season.year) : null,
    week: header.week?.number ?? data.week?.number ?? null,
    season_type: header.season?.type ?? null,
    game_time: competition.date || header.competitions?.[0]?.date || null,
    completed,
    teams,
    players,
  }

  const observationHash = stableHash(observation)
  const completeEnough =
    Boolean(completed) &&
    Boolean(providerEventId) &&
    hasBoxscorePlayers &&
    players.length > 0 &&
    teams.every((t) => t.provider_team_id)

  return {
    ...observation,
    fetched_at: fetched,
    observation_hash: observationHash,
    completeness: {
      ok: completeEnough,
      completed_from_source: completed,
      has_boxscore_players: hasBoxscorePlayers,
      player_count: players.length,
      unresolved_player_ids: [...new Set(unresolvedPlayerIds)],
      unresolved_team_ids: [...new Set([...unresolvedTeamIds, ...unresolvedTeamIdsFromTeams])],
    },
  }
}

export function observationFingerprint(record) {
  if (!record) return null
  if (record.observation_hash) return record.observation_hash
  return stableHash({
    schema_version: record.schema_version,
    sport: record.sport,
    source: record.source,
    provider: record.provider,
    provider_event_id: record.provider_event_id,
    season: record.season,
    week: record.week,
    season_type: record.season_type,
    game_time: record.game_time,
    completed: record.completed,
    teams: record.teams,
    players: record.players,
  })
}

export function nflEventPaths(archiveRoot, eventId, version) {
  const safeId = String(eventId)
  const v = `v${version}`
  return {
    raw: path.join(archiveRoot, 'raw', safeId, `${v}.json`),
    normalized: path.join(archiveRoot, 'normalized', safeId, `${v}.json`),
    versions: path.join(archiveRoot, 'games', `${safeId}.jsonl`),
    index: path.join(archiveRoot, NFL_INDEX_FILENAME),
  }
}

export function loadNflArchiveIndex(archiveRoot) {
  const indexPath = path.join(archiveRoot, NFL_INDEX_FILENAME)
  const parsed = readJsonlFile(indexPath)
  return {
    path: indexPath,
    records: parsed.records,
    corrupt: parsed.corrupt,
    missing: parsed.missing,
  }
}

export function latestCompleteVersion(indexRecords, eventId) {
  const id = String(eventId)
  const matches = (indexRecords || []).filter(
    (row) => String(row.provider_event_id) === id && row.complete === true
  )
  if (matches.length === 0) return null
  return matches.reduce((best, row) => (Number(row.version) > Number(best.version) ? row : best))
}

export function maxVersionForEvent(indexRecords, eventId) {
  const id = String(eventId)
  let max = 0
  for (const row of indexRecords || []) {
    if (String(row.provider_event_id) !== id) continue
    const v = Number(row.version) || 0
    if (v > max) max = v
  }
  return max
}

export function detectPartialNflArchive(archiveRoot, eventId) {
  const index = loadNflArchiveIndex(archiveRoot)
  const id = String(eventId)
  const rows = index.records.filter((row) => String(row.provider_event_id) === id)
  const issues = []

  if (index.corrupt.length > 0) {
    issues.push({ kind: 'corrupt_index', count: index.corrupt.length })
  }

  for (const row of rows) {
    const paths = nflEventPaths(archiveRoot, id, row.version)
    if (row.complete) {
      const raw = readJsonFile(paths.raw)
      const normalized = readJsonFile(paths.normalized)
      if (!raw) issues.push({ kind: 'missing_raw', version: row.version, path: paths.raw })
      if (!normalized) {
        issues.push({ kind: 'missing_normalized', version: row.version, path: paths.normalized })
      } else if (normalized.observation_hash && row.observation_hash && normalized.observation_hash !== row.observation_hash) {
        issues.push({ kind: 'hash_mismatch', version: row.version })
      } else if (normalized.completeness && normalized.completeness.ok === false) {
        issues.push({ kind: 'incomplete_normalized', version: row.version })
      }
    }
  }

  const claimed = latestCompleteVersion(index.records, id)
  return {
    eventId: id,
    hasComplete: Boolean(claimed),
    latest: claimed,
    issues,
    partial: issues.length > 0 || (rows.some((r) => r.complete) && !claimed),
  }
}

function indexRecordFrom(normalized, paths, version) {
  return {
    schema_version: NFL_BOX_SCORE_SCHEMA_VERSION,
    sport: 'nfl',
    provider: 'espn',
    provider_event_id: normalized.provider_event_id,
    season: normalized.season,
    week: normalized.week,
    season_type: normalized.season_type,
    game_time: normalized.game_time,
    fetched_at: normalized.fetched_at,
    source: normalized.source,
    version,
    observation_hash: normalized.observation_hash,
    complete: Boolean(normalized.completeness?.ok),
    player_count: normalized.completeness?.player_count ?? normalized.players?.length ?? 0,
    unresolved_player_ids: normalized.completeness?.unresolved_player_ids || [],
    unresolved_team_ids: normalized.completeness?.unresolved_team_ids || [],
    raw_path: paths.raw,
    normalized_path: paths.normalized,
  }
}

/**
 * Write raw + versioned normalized records. Idempotent when the latest
 * complete version has the same observation hash. Corrections append a new
 * version. Existing files for other games are not touched.
 *
 * A game is marked complete in the index only after raw and normalized
 * files are written and verified.
 */
export function writeNflBoxScoreArchive({
  archiveRoot,
  raw,
  normalized,
  now = new Date(),
} = {}) {
  if (!archiveRoot) throw new ArchiveWriteError('archiveRoot is required')
  if (!normalized?.provider_event_id) {
    throw new ArchiveWriteError('normalized record missing provider_event_id')
  }

  const eventId = String(normalized.provider_event_id)
  const index = loadNflArchiveIndex(archiveRoot)
  const latest = latestCompleteVersion(index.records, eventId)
  const hash = observationFingerprint(normalized)

  if (!normalized.completeness?.ok) {
    return {
      wrote: false,
      reason: 'incomplete_observation',
      eventId,
      complete: false,
      completeness: normalized.completeness,
    }
  }

  let version
  if (latest && latest.observation_hash === hash) {
    const check = detectPartialNflArchive(archiveRoot, eventId)
    const latestBroken = check.issues.some((issue) => Number(issue.version) === Number(latest.version))
    if (!latestBroken) {
      return {
        wrote: false,
        reason: 'identical',
        eventId,
        version: latest.version,
        complete: true,
        indexRecord: latest,
      }
    }
    version = latest.version
  } else {
    version = maxVersionForEvent(index.records, eventId) + 1
  }
  const paths = nflEventPaths(archiveRoot, eventId, version)
  const record = {
    ...normalized,
    fetched_at: normalized.fetched_at || now.toISOString(),
    version,
    observation_hash: hash,
  }

  writeJsonAtomic(paths.raw, raw)
  if (readJsonFile(paths.raw) == null) {
    throw new ArchiveWriteError(`failed to verify raw archive for ${eventId}`, { path: paths.raw })
  }

  writeJsonAtomic(paths.normalized, record)
  const verifiedNormalized = readJsonFile(paths.normalized)
  if (!verifiedNormalized || verifiedNormalized.observation_hash !== hash) {
    throw new ArchiveWriteError(`failed to verify normalized archive for ${eventId}`, {
      path: paths.normalized,
    })
  }

  const versionsParsed = readJsonlFile(paths.versions)
  const nextVersions = [
    ...versionsParsed.records.filter((row) => Number(row.version) !== version),
    record,
  ]
  writeJsonlAtomic(paths.versions, nextVersions)

  const indexRecord = indexRecordFrom(record, paths, version)
  appendJsonlRecords(paths.index, [indexRecord])

  const reloaded = loadNflArchiveIndex(archiveRoot)
  const marked = latestCompleteVersion(reloaded.records, eventId)
  if (!marked || marked.version !== version || marked.observation_hash !== hash) {
    throw new ArchiveWriteError(`failed to verify index mark for ${eventId} v${version}`)
  }

  return {
    wrote: true,
    reason: latest && latest.observation_hash === hash ? 'recovered' : latest ? 'correction' : 'new',
    eventId,
    version,
    complete: true,
    indexRecord: marked,
    paths,
  }
}

export async function fetchEspnJson(url, { fetchImpl = globalThis.fetch, headers } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ArchiveWriteError('fetchImpl is not available')
  }
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'OddsOnDeck/1.0', ...(headers || {}) },
  })
  if (!response.ok) {
    const text = typeof response.text === 'function' ? await response.text() : ''
    const err = new Error(`ESPN request failed ${response.status} for ${url}`)
    err.status = response.status
    err.body = text
    throw err
  }
  return response.json()
}

export function sleep(ms, { sleepImpl } = {}) {
  const wait = sleepImpl || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  return wait(ms)
}

export function utcDay(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

export function summarizeNflCoverage({ expectedEvents, indexRecords, failedFetches = [], dateRange } = {}) {
  const completeById = new Map()
  for (const row of indexRecords || []) {
    if (!row.complete || !row.provider_event_id) continue
    const prev = completeById.get(row.provider_event_id)
    if (!prev || Number(row.version) > Number(prev.version)) {
      completeById.set(row.provider_event_id, row)
    }
  }

  const expectedIds = [...new Set((expectedEvents || []).map((e) => String(e.provider_event_id)).filter(Boolean))]
  const missing = []
  const complete = []
  const unresolved = []
  const days = new Set()

  for (const event of expectedEvents || []) {
    const id = String(event.provider_event_id)
    const day = utcDay(event.game_time)
    if (day) days.add(day)
    const archived = completeById.get(id)
    if (archived) {
      complete.push({ event, archived })
      const unresolvedPlayers = archived.unresolved_player_ids || []
      const unresolvedTeams = archived.unresolved_team_ids || []
      if (unresolvedPlayers.length || unresolvedTeams.length) {
        unresolved.push({
          provider_event_id: id,
          unresolved_player_ids: unresolvedPlayers,
          unresolved_team_ids: unresolvedTeams,
        })
      }
    } else {
      missing.push(event)
    }
  }

  const archivedDays = [...new Set((indexRecords || []).map((row) => utcDay(row.game_time)).filter(Boolean))]
  archivedDays.sort()
  const expectedDays = [...days].sort()

  return {
    season: dateRange?.season ?? null,
    from: dateRange?.from ?? (expectedDays[0] || null),
    to: dateRange?.to ?? (expectedDays[expectedDays.length - 1] || null),
    expected_games: expectedIds.length,
    complete_archives: complete.length,
    missing_games: missing.map((e) => ({
      provider_event_id: e.provider_event_id,
      game_time: e.game_time,
      name: e.name,
      week: e.week,
    })),
    failed_fetches: failedFetches,
    unresolved_identities: unresolved,
    expected_date_coverage: expectedDays,
    archived_date_coverage: archivedDays,
  }
}

export function emptyNflArchiveRoot(repoRoot) {
  return resolveNflBoxScoresDir(repoRoot)
}
