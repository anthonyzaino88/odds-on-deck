/**
 * NHL player-stat grading helpers (pure).
 *
 * ESPN's NHL boxscore uses S for shots on goal and SOG for shootout goals.
 * Matching is player id, or exact normalized full name plus team.
 * Last-name-only and substring matches are rejected.
 */

const GENERATIONAL_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

const NHL_TEAM_ALIASES = {
  NJ: 'NJD',
  NJD: 'NJD',
  LA: 'LAK',
  LAK: 'LAK',
  SJ: 'SJS',
  SJS: 'SJS',
  TB: 'TBL',
  TBL: 'TBL',
  WAS: 'WSH',
  WSH: 'WSH',
  MON: 'MTL',
  MTL: 'MTL',
  CLS: 'CBJ',
  CBJ: 'CBJ',
  VEG: 'VGK',
  LV: 'VGK',
  VGK: 'VGK',
}

export const NHL_GRADE_SOURCES = Object.freeze({
  NHL_API: 'nhl-api',
  ESPN_FALLBACK: 'espn-fallback',
})

const ESPN_LABEL_BY_PROP = {
  goals: 'G',
  assists: 'A',
  points: 'POINTS',
  shots: 'S',
  shots_on_goal: 'S',
  sog: 'S',
  blocked_shots: 'BS',
  hits: 'HT',
  plus_minus: '+/-',
  saves: 'SV',
  goalie_saves: 'SV',
  powerplay_points: 'PPP',
  power_play_points: 'PPP',
}

export function normalizeNhlPlayerName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[''`´.]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((part) => part && !GENERATIONAL_SUFFIXES.has(part))
    .join(' ')
}

export function canonicalNhlTeam(abbr) {
  const raw = String(abbr || '').toUpperCase().trim()
  if (!raw) return ''
  return NHL_TEAM_ALIASES[raw] || raw
}

export function nhlTeamsMatch(a, b) {
  const left = canonicalNhlTeam(a)
  const right = canonicalNhlTeam(b)
  return Boolean(left && right && left === right)
}

/**
 * @param {Array<{ id?: string|number|null, name?: string, team?: string }>} candidates
 * @param {{ playerId?: string|number|null, name?: string, team?: string }} query
 * @returns {{ status: 'matched'|'unmatched'|'ambiguous', player: object|null }}
 */
export function matchNhlBoxscorePlayer(candidates, query = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
  const playerId = query.playerId

  if (playerId != null && String(playerId).trim() !== '') {
    const id = String(playerId)
    const idMatches = list.filter((row) => row.id != null && String(row.id) === id)
    if (idMatches.length === 1) return { status: 'matched', player: idMatches[0] }
    if (idMatches.length > 1) return { status: 'ambiguous', player: null }
  }

  const targetName = normalizeNhlPlayerName(query.name)
  if (!targetName) return { status: 'unmatched', player: null }

  const nameMatches = list.filter((row) => normalizeNhlPlayerName(row.name) === targetName)
  if (nameMatches.length === 0) return { status: 'unmatched', player: null }

  const wantTeam = canonicalNhlTeam(query.team)
  const filtered = wantTeam
    ? nameMatches.filter((row) => nhlTeamsMatch(row.team, wantTeam))
    : nameMatches

  if (filtered.length === 1) return { status: 'matched', player: filtered[0] }
  if (filtered.length > 1) return { status: 'ambiguous', player: null }
  return { status: 'unmatched', player: null }
}

export function normalizeNhlPropType(propType) {
  return String(propType || '')
    .toLowerCase()
    .trim()
    .replace(/^player_/, '')
    .replace(/^goalie_/, '')
}

export function espnLabelForNhlProp(propType) {
  const raw = String(propType || '').toLowerCase().trim()
  const normalized = normalizeNhlPropType(propType)
  return ESPN_LABEL_BY_PROP[raw] || ESPN_LABEL_BY_PROP[normalized] || null
}

export function findEspnStatByLabel(stats, labels, targetLabel) {
  if (!Array.isArray(labels) || !Array.isArray(stats) || !targetLabel) return null
  const target = String(targetLabel).toUpperCase()
  const index = labels.findIndex((label) => String(label).toUpperCase() === target)
  if (index === -1 || index >= stats.length) return null
  const value = parseFloat(stats[index])
  return Number.isNaN(value) ? null : value
}

function inferPppFromTotals(goals, assists, pptoiRaw) {
  if (goals === 0 && assists === 0) {
    return { value: 0, statFound: true }
  }
  if (pptoiRaw === '0:00' || pptoiRaw === '0' || pptoiRaw === 0) {
    return { value: 0, statFound: true }
  }
  const totalPoints = (goals || 0) + (assists || 0)
  if (totalPoints > 0) return { value: null, statFound: false }
  return { value: 0, statFound: true }
}

export function extractEspnStatValue(athlete, propType, labels) {
  const stats = athlete?.stats || []
  const targetLabel = espnLabelForNhlProp(propType)
  if (!targetLabel) return { value: null, statFound: false }

  if (targetLabel === 'POINTS') {
    const goals = findEspnStatByLabel(stats, labels, 'G')
    const assists = findEspnStatByLabel(stats, labels, 'A')
    if (goals !== null && assists !== null) {
      return { value: goals + assists, statFound: true }
    }
    return { value: null, statFound: false }
  }

  if (targetLabel === 'PPP') {
    const goals = findEspnStatByLabel(stats, labels, 'G')
    const assists = findEspnStatByLabel(stats, labels, 'A')
    const pptoiIndex = labels?.findIndex((label) => String(label).toUpperCase() === 'PPTOI')
    const pptoiRaw = pptoiIndex >= 0 ? stats[pptoiIndex] : null
    return inferPppFromTotals(goals, assists, pptoiRaw)
  }

  const value = findEspnStatByLabel(stats, labels, targetLabel)
  if (value === null) return { value: null, statFound: false }
  return { value, statFound: true }
}

function nhlShotsOnGoal(player) {
  if (player?.sog != null) return player.sog
  if (player?.shots != null) return player.shots
  return undefined
}

export function nhlApiStatValue(player, propType) {
  const normalized = normalizeNhlPropType(propType)
  const isPpp = normalized.includes('power_play_point') || normalized.includes('powerplay_point')

  if (isPpp) {
    if (player?.goals === 0 && player?.assists === 0) {
      return { value: 0, statFound: true }
    }
    if (player?.powerPlayGoals > 0) {
      return { value: player.powerPlayGoals, statFound: true }
    }
    if (player?.powerPlayGoals === 0 && player?.points === 0) {
      return { value: 0, statFound: true }
    }
    return { value: null, statFound: false }
  }

  const mapping = {
    goals: player?.goals,
    assists: player?.assists,
    points: player?.points,
    shots: nhlShotsOnGoal(player),
    shots_on_goal: nhlShotsOnGoal(player),
    sog: nhlShotsOnGoal(player),
    blocked_shots: player?.blockedShots,
    hits: player?.hits,
    plus_minus: player?.plusMinus,
    power_play_goals: player?.powerPlayGoals,
    powerplay_goals: player?.powerPlayGoals,
    saves: player?.saves,
  }

  if (!(normalized in mapping) && !(propType in mapping)) {
    return { value: null, statFound: false }
  }

  const value = mapping[normalized] ?? mapping[propType]
  if (value === undefined || value === null) return { value: null, statFound: false }
  return { value, statFound: true }
}

export function emptyNhlStatResult(overrides = {}) {
  return {
    value: null,
    source: null,
    matchStatus: 'unmatched',
    statFound: false,
    gameFinal: false,
    team: null,
    player: null,
    ...overrides,
  }
}

export function isGradeableNhlStatResult(result) {
  if (!result) return false
  if (!result.gameFinal) return false
  if (result.matchStatus !== 'matched') return false
  if (!result.statFound) return false
  if (result.value === null || result.value === undefined) return false
  return true
}

export function nhlGradeSourceFromResult(result) {
  if (result?.source === NHL_GRADE_SOURCES.NHL_API) return NHL_GRADE_SOURCES.NHL_API
  if (result?.source === NHL_GRADE_SOURCES.ESPN_FALLBACK) return NHL_GRADE_SOURCES.ESPN_FALLBACK
  return 'validate_pending_props'
}
