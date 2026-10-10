/**
 * MLB box-score appearance + stat extraction (pure).
 *
 * StatsAPI includes every rostered player. Bench / DNP rows have
 * stats.batting = {} and stats.pitching = {} — empty objects, which are
 * truthy in JS. Coercing missing fields with `|| 0` grades those as a
 * real 0. Sportsbooks void the prop when the batter had no PA or the
 * pitcher faced nobody.
 */

import { planPlayerAppearanceGrade } from './player-stat-grade.js'

export const MLB_STAT_MAP = Object.freeze({
  hits: 'hits',
  batter_hits: 'hits',
  runs: 'runs',
  batter_runs_scored: 'runs',
  rbis: 'rbi',
  batter_rbis: 'rbi',
  home_runs: 'homeRuns',
  batter_home_runs: 'homeRuns',
  strikeouts: 'strikeouts',
  batter_strikeouts: 'strikeouts',
  walks: 'walks',
  batter_walks: 'walks',
  stolen_bases: 'stolenBases',
  batter_stolen_bases: 'stolenBases',
  total_bases: 'totalBases',
  batter_total_bases: 'totalBases',
  singles: 'singles',
  batter_singles: 'singles',
  doubles: 'doubles',
  batter_doubles: 'doubles',
  triples: 'triples',
  pitcher_strikeouts: 'strikeouts',
  pitcher_hits_allowed: 'hitsAllowed',
  hits_allowed: 'hitsAllowed',
  pitcher_earned_runs: 'earnedRuns',
  earned_runs: 'earnedRuns',
  pitcher_walks: 'walksAllowed',
  pitcher_outs: 'outs',
  innings_pitched: 'inningsPitched',
  pitches_thrown: 'pitchesThrown',
})

const PITCHER_PROP_ALIASES = new Set([
  'pitcher_strikeouts',
  'pitcher_hits_allowed',
  'hits_allowed',
  'pitcher_earned_runs',
  'earned_runs',
  'pitcher_walks',
  'pitcher_outs',
  'innings_pitched',
  'pitches_thrown',
])

export function normalizeMlbPlayerName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function isMlbPitcherProp(propType) {
  const raw = String(propType || '').toLowerCase().trim()
  if (raw.startsWith('pitcher_')) return true
  return PITCHER_PROP_ALIASES.has(raw)
}

export function isStatLinePresent(line) {
  return Boolean(line && typeof line === 'object' && !Array.isArray(line) && Object.keys(line).length > 0)
}

export function numericStat(line, key) {
  if (!line || line[key] == null || line[key] === '') return null
  const n = typeof line[key] === 'number' ? line[key] : Number(line[key])
  return Number.isFinite(n) ? n : null
}

export function plateAppearancesFromBatting(batting) {
  if (!isStatLinePresent(batting)) return 0
  const pa = numericStat(batting, 'plateAppearances')
  if (pa != null) return pa
  const atBats = numericStat(batting, 'atBats') ?? 0
  const walks = numericStat(batting, 'baseOnBalls') ?? 0
  const hbp = numericStat(batting, 'hitByPitch') ?? 0
  const sacFlies = numericStat(batting, 'sacFlies') ?? 0
  const sacBunts = numericStat(batting, 'sacBunts') ?? 0
  return atBats + walks + hbp + sacFlies + sacBunts
}

export function battersFacedFromPitching(pitching) {
  if (!isStatLinePresent(pitching)) return 0
  const bf = numericStat(pitching, 'battersFaced')
  if (bf != null) return bf
  const outs = numericStat(pitching, 'outs')
  if (outs != null && outs > 0) return outs
  const ip = pitching.inningsPitched
  if (ip != null && parseFloat(ip) > 0) return 1
  return 0
}

/**
 * Sportsbook PA rule: a batter "appeared" only with a plate appearance.
 * Pinch runners / defensive subs with a run or stolen base but 0 PA still
 * void runs/SB props. That is intentional and matches book rules as we
 * understand them (the runner never officially batted).
 */
export function mlbBatterAppeared(batting) {
  return plateAppearancesFromBatting(batting) > 0
}

export function mlbPitcherAppeared(pitching) {
  return battersFacedFromPitching(pitching) > 0
}

export function extractMlbBattingStats(batting) {
  if (!isStatLinePresent(batting)) return null
  const hits = numericStat(batting, 'hits') ?? 0
  const doubles = numericStat(batting, 'doubles') ?? 0
  const triples = numericStat(batting, 'triples') ?? 0
  const homeRuns = numericStat(batting, 'homeRuns') ?? 0
  const singles = hits - doubles - triples - homeRuns
  const officialTb = numericStat(batting, 'totalBases')
  return {
    hits,
    singles: Math.max(0, singles),
    runs: numericStat(batting, 'runs') ?? 0,
    rbi: numericStat(batting, 'rbi') ?? 0,
    homeRuns,
    strikeouts: numericStat(batting, 'strikeOuts') ?? 0,
    walks: numericStat(batting, 'baseOnBalls') ?? 0,
    stolenBases: numericStat(batting, 'stolenBases') ?? 0,
    totalBases: officialTb != null ? officialTb : hits + doubles + (2 * triples) + (3 * homeRuns),
    doubles,
    triples,
    atBats: numericStat(batting, 'atBats') ?? 0,
    plateAppearances: plateAppearancesFromBatting(batting),
  }
}

export function extractMlbPitchingStats(pitching) {
  if (!isStatLinePresent(pitching)) return null
  return {
    inningsPitched: pitching.inningsPitched != null && pitching.inningsPitched !== ''
      ? parseFloat(pitching.inningsPitched)
      : 0,
    strikeouts: numericStat(pitching, 'strikeOuts') ?? 0,
    hitsAllowed: numericStat(pitching, 'hits') ?? 0,
    earnedRuns: numericStat(pitching, 'earnedRuns') ?? 0,
    walksAllowed: numericStat(pitching, 'baseOnBalls') ?? 0,
    outs: numericStat(pitching, 'outs') ?? 0,
    pitchesThrown: numericStat(pitching, 'numberOfPitches') ?? numericStat(pitching, 'pitchesThrown') ?? 0,
    battersFaced: battersFacedFromPitching(pitching),
  }
}

export function parseMlbBoxscorePlayers(data) {
  const players = {}
  for (const side of ['home', 'away']) {
    const teamPlayers = data?.teams?.[side]?.players
    if (!teamPlayers || typeof teamPlayers !== 'object') continue
    for (const playerData of Object.values(teamPlayers)) {
      const fullName = playerData?.person?.fullName
      if (!fullName) continue
      const stats = playerData.stats || {}
      const batting = extractMlbBattingStats(stats.batting)
      const pitching = extractMlbPitchingStats(stats.pitching)
      players[fullName] = {
        name: fullName,
        batting,
        pitching,
        plateAppearances: batting ? batting.plateAppearances : 0,
        battersFaced: pitching ? pitching.battersFaced : 0,
        gameStatus: playerData.gameStatus || null,
      }
    }
  }
  return players
}

export function toLegacyMlbPlayerStatsMap(players) {
  const map = {}
  for (const [name, player] of Object.entries(players || {})) {
    if (!player?.batting && !player?.pitching) continue
    map[name] = {
      ...(player.batting || {}),
      ...(player.pitching || {}),
    }
  }
  return map
}

export function matchMlbBoxscorePlayer(players, playerName) {
  if (!players || !playerName) return null
  if (players[playerName]) return players[playerName]
  const normalized = normalizeMlbPlayerName(playerName)
  const key = Object.keys(players).find((name) => normalizeMlbPlayerName(name) === normalized)
  return key ? players[key] : null
}

export function emptyMlbStatResult(overrides = {}) {
  return {
    value: null,
    matchStatus: 'unmatched',
    statFound: false,
    gameFinal: true,
    didNotPlay: false,
    reason: null,
    plateAppearances: null,
    battersFaced: null,
    player: null,
    ...overrides,
  }
}

/**
 * Structured MLB lookup. A numeric 0 is only a gradeable actual when the
 * batter had a plate appearance or the pitcher faced a batter.
 * In-box + 0 PA / 0 BF → didNotPlay (void). Not on the roster → not_in_box
 * (needs_review). Pinch-runner runs/SB with 0 PA follow the PA rule.
 */
export function lookupMlbPlayerStat(players, playerName, propType) {
  const player = matchMlbBoxscorePlayer(players, playerName)
  if (!player) {
    // Not on this box-score roster. Do not void — a wrong mlbGameId
    // would silently void every prop on the game. Live grader + repair
    // treat this as needs_review, same as NHL/NFL unmatched.
    return emptyMlbStatResult({
      didNotPlay: false,
      reason: 'not_in_box',
      matchStatus: 'unmatched',
    })
  }

  const pitcherProp = isMlbPitcherProp(propType)
  const appeared = pitcherProp
    ? mlbPitcherAppeared(player.pitching)
    : mlbBatterAppeared(player.batting)

  if (!appeared) {
    return emptyMlbStatResult({
      matchStatus: 'matched',
      didNotPlay: true,
      reason: pitcherProp ? 'no_batters_faced' : 'no_plate_appearances',
      plateAppearances: player.plateAppearances,
      battersFaced: player.battersFaced,
      player: player.name,
    })
  }

  const statField = MLB_STAT_MAP[String(propType || '').toLowerCase().trim()]
  if (!statField) {
    return emptyMlbStatResult({
      matchStatus: 'matched',
      reason: 'unknown_stat',
      plateAppearances: player.plateAppearances,
      battersFaced: player.battersFaced,
      player: player.name,
    })
  }

  const line = pitcherProp ? player.pitching : player.batting
  const value = line?.[statField]
  if (value === undefined || value === null) {
    return emptyMlbStatResult({
      matchStatus: 'matched',
      reason: 'stat_missing',
      plateAppearances: player.plateAppearances,
      battersFaced: player.battersFaced,
      player: player.name,
    })
  }

  return {
    value,
    matchStatus: 'matched',
    statFound: true,
    gameFinal: true,
    didNotPlay: false,
    reason: 'appeared',
    plateAppearances: player.plateAppearances,
    battersFaced: player.battersFaced,
    player: player.name,
  }
}

export function planMlbPlayerStatGrade(players, playerName, propType) {
  return planPlayerAppearanceGrade(lookupMlbPlayerStat(players, playerName, propType))
}
