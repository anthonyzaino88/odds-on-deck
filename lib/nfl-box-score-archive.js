/**
 * Independent NFL box-score archival (ESPN public endpoints).
 *
 * Discovers completed games from the source scoreboard / summary — not from
 * PropValidation. Missing statistics stay null. DNP is never inferred from
 * absent or zero stats. Identical observations are idempotent; source
 * corrections write a new version. A game is marked archived only after
 * raw + normalized output is written and verified.
 */

import fs from 'fs'
import path from 'path'
import {
  ArchiveWriteError,
  NFL_INDEX_FILENAME,
  appendJsonlRecords,
  assertJsonlAppendable,
  readJsonlFile,
  resolveNflBoxScoresDir,
  stableHash,
  statJsonFile,
  writeJsonAtomic,
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
  // Date-only --from/--to are inclusive UTC calendar days, not Eastern dates.
  // `new Date('YYYY-MM-DD')` is 00:00Z, which would drop afternoon UTC kickoffs
  // on the --to day. An 8:15 PM ET kickoff on the named Eastern date is the
  // next UTC day and is outside `--to` of that Eastern date.
  const fromDay = from ? utcDay(from) : null
  const toDay = to ? utcDay(to) : null
  return (events || []).filter((event) => {
    if (!event?.completed) return false
    if (!event.provider_event_id) return false
    if (fromDay != null || toDay != null) {
      if (!event.game_time) return false
      const gameDay = utcDay(event.game_time)
      if (!gameDay) return false
      if (fromDay != null && gameDay < fromDay) return false
      if (toDay != null && gameDay > toDay) return false
    }
    return true
  })
}

function boxscoreTeamIdsFrom(boxscore) {
  return (boxscore?.players || [])
    .map((block) => teamIdFrom(block.team || block))
    .filter(Boolean)
}

function teamBlockHasPlayerStats(teamBlock) {
  if (!teamBlock) return false
  return (teamBlock.statistics || []).some((category) => (category.athletes || []).length > 0)
}

export function mergeDiscoveredEventMetadata(summaryMeta, discovered) {
  const discovery = {
    season: discovered?.season != null && discovered.season !== '' ? String(discovered.season) : null,
    week: discovered?.week ?? null,
    season_type: discovered?.season_type ?? discovered?.seasonType ?? null,
  }
  const summary = {
    season: summaryMeta?.season != null && summaryMeta.season !== '' ? String(summaryMeta.season) : null,
    week: summaryMeta?.week ?? null,
    season_type: summaryMeta?.season_type ?? null,
  }
  const mismatches = []
  for (const field of ['season', 'week', 'season_type']) {
    if (discovery[field] != null && summary[field] != null && String(discovery[field]) !== String(summary[field])) {
      mismatches.push({ field, discovery: discovery[field], summary: summary[field] })
    }
  }
  return {
    season: discovery.season ?? summary.season,
    week: discovery.week ?? summary.week,
    season_type: discovery.season_type ?? summary.season_type,
    metadata_consistency: {
      ok: mismatches.length === 0,
      mismatches,
      discovery,
      summary,
    },
  }
}

export function parseEspnNflSummary(data, { fetchedAt, discovered } = {}) {
  if (!data || typeof data !== 'object') return null

  const header = data.header || {}
  const competition = header.competitions?.[0] || data.competitions?.[0] || {}
  const completed = isEspnNflEventCompleted(data)
  const boxscore = data.boxscore
  const boxscoreBlocks = Array.isArray(boxscore?.players) ? boxscore.players : []
  const hasBoxscorePlayers = boxscoreBlocks.length > 0
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

  const expectedTeamIds = teams.map((t) => t.provider_team_id).filter(Boolean)
  const boxscoreTeamIds = boxscoreTeamIdsFrom(boxscore)
  const boxscoreTeamsMatchCompetitors =
    expectedTeamIds.length >= 2 &&
    expectedTeamIds.every((id) => boxscoreTeamIds.includes(id)) &&
    boxscoreTeamIds.every((id) => expectedTeamIds.includes(id))
  const bothTeamsHavePlayerStats =
    expectedTeamIds.length >= 2 &&
    expectedTeamIds.every((id) => {
      const block = boxscoreBlocks.find((b) => teamIdFrom(b.team || b) === id)
      if (!teamBlockHasPlayerStats(block)) return false
      return players.some((p) => String(p.provider_team_id) === String(id))
    })

  const mergedMeta = mergeDiscoveredEventMetadata(
    {
      season: header.season?.year != null ? String(header.season.year) : null,
      week: header.week?.number ?? data.week?.number ?? null,
      season_type: header.season?.type ?? null,
    },
    discovered
  )

  const observation = {
    schema_version: NFL_BOX_SCORE_SCHEMA_VERSION,
    sport: 'nfl',
    source: NFL_BOX_SCORE_SOURCE,
    provider: 'espn',
    provider_event_id: providerEventId,
    season: mergedMeta.season,
    week: mergedMeta.week,
    season_type: mergedMeta.season_type,
    game_time: competition.date || header.competitions?.[0]?.date || null,
    completed,
    teams,
    players,
  }

  const observationHash = observationContentHash(observation)
  const completeEnough =
    Boolean(completed) &&
    Boolean(providerEventId) &&
    expectedTeamIds.length >= 2 &&
    teams.every((t) => t.provider_team_id) &&
    boxscoreTeamsMatchCompetitors &&
    bothTeamsHavePlayerStats

  return {
    ...observation,
    fetched_at: fetched,
    observation_hash: observationHash,
    metadata_consistency: mergedMeta.metadata_consistency,
    completeness: {
      ok: completeEnough,
      completed_from_source: completed,
      has_boxscore_players: hasBoxscorePlayers,
      both_teams_have_player_stats: bothTeamsHavePlayerStats,
      boxscore_teams_match_competitors: boxscoreTeamsMatchCompetitors,
      expected_team_ids: expectedTeamIds,
      boxscore_team_ids: boxscoreTeamIds,
      player_count: players.length,
      unresolved_player_ids: [...new Set(unresolvedPlayerIds)],
      unresolved_team_ids: [...new Set([...unresolvedTeamIds, ...unresolvedTeamIdsFromTeams])],
    },
  }
}

export function observationContentHash(record) {
  if (!record) return null
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

export function observationFingerprint(record) {
  return observationContentHash(record)
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

export function latestIndexRow(indexRecords, eventId) {
  const id = String(eventId)
  const matches = (indexRecords || []).filter((row) => String(row.provider_event_id) === id)
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

export function verifyNflArchiveVersion(archiveRoot, row) {
  const issues = []
  if (!row) {
    return { status: 'missing', healthy: false, issues: [{ kind: 'missing_index_row' }], current: null }
  }
  const eventId = String(row.provider_event_id)
  const paths = nflEventPaths(archiveRoot, eventId, row.version)

  const rawStat = statJsonFile(paths.raw)
  if (rawStat.missing) {
    issues.push({ kind: 'missing_raw', version: row.version, path: paths.raw })
  } else if (rawStat.corrupt) {
    issues.push({ kind: 'corrupt_raw', version: row.version, path: paths.raw })
  } else {
    const rawId = rawStat.value?.header?.id ?? rawStat.value?.id
    if (rawId != null && String(rawId) !== eventId) {
      issues.push({
        kind: 'raw_event_id_mismatch',
        version: row.version,
        expected: eventId,
        actual: String(rawId),
      })
    }
  }

  const normStat = statJsonFile(paths.normalized)
  if (normStat.missing) {
    issues.push({ kind: 'missing_normalized', version: row.version, path: paths.normalized })
  } else if (normStat.corrupt) {
    issues.push({ kind: 'corrupt_normalized', version: row.version, path: paths.normalized })
  } else {
    const normalized = normStat.value
    if (normalized.provider_event_id != null && String(normalized.provider_event_id) !== eventId) {
      issues.push({
        kind: 'normalized_event_id_mismatch',
        version: row.version,
        expected: eventId,
        actual: String(normalized.provider_event_id),
      })
    }
    if (normalized.schema_version != null && normalized.schema_version !== NFL_BOX_SCORE_SCHEMA_VERSION) {
      issues.push({
        kind: 'schema_mismatch',
        version: row.version,
        expected: NFL_BOX_SCORE_SCHEMA_VERSION,
        actual: normalized.schema_version,
      })
    }
    const recomputed = observationContentHash(normalized)
    if (normalized.observation_hash && normalized.observation_hash !== recomputed) {
      issues.push({
        kind: 'normalized_hash_stale',
        version: row.version,
        stored: normalized.observation_hash,
        recomputed,
      })
    }
    if (row.observation_hash && row.observation_hash !== recomputed) {
      issues.push({
        kind: 'index_hash_mismatch',
        version: row.version,
        stored: row.observation_hash,
        recomputed,
      })
    }
    if (normalized.completeness && normalized.completeness.ok === false) {
      issues.push({ kind: 'incomplete_normalized', version: row.version })
    }
    if (normalized.completeness?.both_teams_have_player_stats === false) {
      issues.push({ kind: 'one_team_box_score', version: row.version })
    }
  }

  const missingFiles = issues.some((i) => i.kind === 'missing_raw' || i.kind === 'missing_normalized')
  const incomplete = issues.some(
    (i) => i.kind === 'incomplete_normalized' || i.kind === 'one_team_box_score'
  )
  const corrupt = issues.some(
    (i) =>
      i.kind === 'corrupt_raw' ||
      i.kind === 'corrupt_normalized' ||
      i.kind === 'normalized_hash_stale' ||
      i.kind === 'index_hash_mismatch' ||
      i.kind === 'raw_event_id_mismatch' ||
      i.kind === 'normalized_event_id_mismatch' ||
      i.kind === 'schema_mismatch'
  )

  let status = 'healthy'
  if (issues.length > 0) {
    if (missingFiles && !corrupt && !incomplete) status = 'missing_files'
    else if (incomplete && !corrupt && !missingFiles) status = 'incomplete'
    else if (corrupt) status = 'corrupt'
    else status = missingFiles ? 'missing_files' : 'corrupt'
  } else if (row.complete !== true) {
    status = 'incomplete'
    issues.push({ kind: 'index_not_complete', version: row.version })
  }

  return {
    status,
    healthy: status === 'healthy',
    issues,
    current: row,
    paths,
    eventId,
    version: row.version,
  }
}

export function detectPartialNflArchive(archiveRoot, eventId) {
  const index = loadNflArchiveIndex(archiveRoot)
  const id = String(eventId)
  const rows = index.records.filter((row) => String(row.provider_event_id) === id)
  const issues = []

  if (index.corrupt.length > 0) {
    issues.push({ kind: 'corrupt_index', count: index.corrupt.length })
  }

  const current = latestIndexRow(rows, id)
  if (current) {
    const verified = verifyNflArchiveVersion(archiveRoot, current)
    issues.push(...verified.issues)
    return {
      eventId: id,
      hasComplete: verified.healthy,
      latest: current,
      issues,
      partial: !verified.healthy,
      status: verified.status,
    }
  }

  return {
    eventId: id,
    hasComplete: false,
    latest: null,
    issues,
    partial: issues.length > 0 || rows.length > 0,
    status: rows.length ? 'incomplete' : 'missing',
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
 * *healthy* version has the same observation hash. Corrections and repairs
 * append a new version. Existing files for other games and prior versions
 * are not rewritten or deleted. Original capture timestamps stay on vN.
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
  const current = latestIndexRow(index.records, eventId)
  const hash = observationContentHash(normalized)

  if (!normalized.completeness?.ok) {
    return {
      wrote: false,
      reason: 'incomplete_observation',
      eventId,
      complete: false,
      completeness: normalized.completeness,
    }
  }

  if (current) {
    const verified = verifyNflArchiveVersion(archiveRoot, current)
    if (verified.healthy && current.observation_hash === hash) {
      return {
        wrote: false,
        reason: 'identical',
        eventId,
        version: current.version,
        complete: true,
        indexRecord: current,
      }
    }
  }

  const version = maxVersionForEvent(index.records, eventId) + 1
  const paths = nflEventPaths(archiveRoot, eventId, version)
  const record = {
    ...normalized,
    fetched_at: normalized.fetched_at || now.toISOString(),
    version,
    observation_hash: hash,
  }

  writeJsonAtomic(paths.raw, raw)
  const rawStat = statJsonFile(paths.raw)
  if (rawStat.missing || rawStat.corrupt) {
    throw new ArchiveWriteError(`failed to verify raw archive for ${eventId}`, { path: paths.raw })
  }

  writeJsonAtomic(paths.normalized, record)
  const verifiedNormalized = statJsonFile(paths.normalized)
  if (
    verifiedNormalized.missing ||
    verifiedNormalized.corrupt ||
    observationContentHash(verifiedNormalized.value) !== hash
  ) {
    throw new ArchiveWriteError(`failed to verify normalized archive for ${eventId}`, {
      path: paths.normalized,
    })
  }

  const versionsPath = paths.versions
  if (fs.existsSync(versionsPath)) {
    assertJsonlAppendable(fs.readFileSync(versionsPath, 'utf8'), versionsPath)
  }
  const versionsParsed = readJsonlFile(versionsPath)
  const already = versionsParsed.records.find((row) => Number(row.version) === version)
  if (!already) {
    appendJsonlRecords(versionsPath, [record])
  } else if (observationContentHash(already) !== hash) {
    throw new ArchiveWriteError(
      `versions file already has a different record for ${eventId} v${version}; leaving it in place`,
      { path: versionsPath, version }
    )
  }

  const indexRecord = indexRecordFrom(record, paths, version)
  appendJsonlRecords(paths.index, [indexRecord])

  const reloaded = loadNflArchiveIndex(archiveRoot)
  const marked = latestIndexRow(reloaded.records, eventId)
  const markedOk = verifyNflArchiveVersion(archiveRoot, marked)
  if (!markedOk.healthy || Number(marked.version) !== version || marked.observation_hash !== hash) {
    throw new ArchiveWriteError(`failed to verify index mark for ${eventId} v${version}`)
  }

  let reason = 'new'
  if (current && current.observation_hash === hash) reason = 'recovered'
  else if (current) reason = 'correction'

  return {
    wrote: true,
    reason,
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

export function summarizeNflCoverage({
  expectedEvents,
  indexRecords,
  archiveRoot,
  failedFetches = [],
  dateRange,
} = {}) {
  const expectedIds = [...new Set((expectedEvents || []).map((e) => String(e.provider_event_id)).filter(Boolean))]
  const missing = []
  const healthy = []
  const corrupt = []
  const incomplete = []
  const missingFiles = []
  const unresolved = []
  const days = new Set()

  for (const event of expectedEvents || []) {
    const id = String(event.provider_event_id)
    const day = utcDay(event.game_time)
    if (day) days.add(day)

    const current = latestIndexRow(indexRecords, id)
    if (!current) {
      missing.push(event)
      continue
    }

    const verified = archiveRoot
      ? verifyNflArchiveVersion(archiveRoot, current)
      : { status: 'missing_files', healthy: false, issues: [{ kind: 'audit_requires_files' }], current }

    const entry = { event, archived: current, verification: verified }
    if (verified.healthy) {
      healthy.push(entry)
      const unresolvedPlayers = current.unresolved_player_ids || []
      const unresolvedTeams = current.unresolved_team_ids || []
      if (unresolvedPlayers.length || unresolvedTeams.length) {
        unresolved.push({
          provider_event_id: id,
          unresolved_player_ids: unresolvedPlayers,
          unresolved_team_ids: unresolvedTeams,
        })
      }
    } else if (verified.status === 'incomplete') {
      incomplete.push(entry)
    } else if (verified.status === 'missing_files') {
      missingFiles.push(entry)
    } else {
      corrupt.push(entry)
    }
  }

  const integrityFailures = [...corrupt, ...incomplete, ...missingFiles].map((entry) => ({
    provider_event_id: entry.event.provider_event_id,
    version: entry.archived?.version ?? null,
    status: entry.verification.status,
    issues: entry.verification.issues,
  }))

  const archivedDays = [...new Set((indexRecords || []).map((row) => utcDay(row.game_time)).filter(Boolean))]
  archivedDays.sort()
  const expectedDays = [...days].sort()

  return {
    season: dateRange?.season ?? null,
    from: dateRange?.from ?? (expectedDays[0] || null),
    to: dateRange?.to ?? (expectedDays[expectedDays.length - 1] || null),
    expected_games: expectedIds.length,
    complete_archives: healthy.length,
    healthy_archives: healthy.length,
    missing_games: missing.map((e) => ({
      provider_event_id: e.provider_event_id,
      game_time: e.game_time,
      name: e.name,
      week: e.week,
    })),
    corrupt_archives: corrupt.map((entry) => ({
      provider_event_id: entry.event.provider_event_id,
      version: entry.archived?.version ?? null,
      issues: entry.verification.issues,
    })),
    incomplete_archives: incomplete.map((entry) => ({
      provider_event_id: entry.event.provider_event_id,
      version: entry.archived?.version ?? null,
      issues: entry.verification.issues,
    })),
    missing_files_archives: missingFiles.map((entry) => ({
      provider_event_id: entry.event.provider_event_id,
      version: entry.archived?.version ?? null,
      issues: entry.verification.issues,
    })),
    integrity_failures: integrityFailures,
    failed_fetches: failedFetches,
    unresolved_identities: unresolved,
    expected_date_coverage: expectedDays,
    archived_date_coverage: archivedDays,
  }
}

export function nflCoverageHasFailure(coverage) {
  if (!coverage) return true
  return Boolean(
    (coverage.missing_games || []).length ||
      (coverage.corrupt_archives || []).length ||
      (coverage.incomplete_archives || []).length ||
      (coverage.missing_files_archives || []).length ||
      (coverage.integrity_failures || []).length ||
      (coverage.failed_fetches || []).length
  )
}

export function emptyNflArchiveRoot(repoRoot) {
  return resolveNflBoxScoresDir(repoRoot)
}
