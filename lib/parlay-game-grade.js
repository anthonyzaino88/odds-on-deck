/**
 * Non-Featured moneyline / total settle from a Game row.
 * Cancelled games void; postponed / unplayed 0-0 do not grade.
 */

import {
  canGradeFromGame,
  describeVoidNotes,
  shouldVoidFromGame,
} from './game-grade-eligibility.js'

const TEAM_VARIATIONS = {
  'JAX': 'JAC', 'JAC': 'JAX',
  'WSH': 'WAS', 'WAS': 'WSH',
  'LV': 'OAK', 'OAK': 'LV',
  'LA': 'LAR', 'LAR': 'LA',
  'TB': 'TBL', 'TBL': 'TB',
  'AZ': 'ARI', 'ARI': 'AZ',
}

export function teamMatches(selection, abbr) {
  if (!selection || !abbr) return false
  const a = String(selection).toUpperCase()
  const b = String(abbr).toUpperCase()
  if (a === b) return true
  if (TEAM_VARIATIONS[a] === b || TEAM_VARIATIONS[b] === a) return true
  return false
}

export function gradeOverUnder(actual, line, side) {
  const actualNum = Number(actual)
  const lineNum = Number(line)
  if (!Number.isFinite(actualNum) || !Number.isFinite(lineNum)) return null
  if (actualNum === lineNum) return 'push'
  const isOver = String(side || '').toLowerCase() === 'over'
  if (isOver) return actualNum > lineNum ? 'won' : 'lost'
  return actualNum < lineNum ? 'won' : 'lost'
}

export function gradeMoneylineFromGame(leg, game) {
  const teamAbbrev = String(leg?.selection || '').toUpperCase()
  if (shouldVoidFromGame(game)) {
    return {
      outcome: 'void',
      actualValue: null,
      notes: describeVoidNotes(game, 'moneyline'),
    }
  }
  if (!canGradeFromGame(game)) return { outcome: null, actualValue: null, notes: null }

  const homeScore = Number(game.homeScore)
  const awayScore = Number(game.awayScore)
  const homeAbbr = game.home?.abbr
  const awayAbbr = game.away?.abbr
  const matchup = `${awayAbbr || '?'} ${awayScore} @ ${homeAbbr || '?'} ${homeScore}`

  let won = null
  let outcome = null
  if (teamMatches(teamAbbrev, homeAbbr) || teamAbbrev === 'HOME') {
    won = homeScore === awayScore ? null : homeScore > awayScore
    if (homeScore === awayScore) outcome = 'push'
  } else if (teamMatches(teamAbbrev, awayAbbr) || teamAbbrev === 'AWAY') {
    won = homeScore === awayScore ? null : awayScore > homeScore
    if (homeScore === awayScore) outcome = 'push'
  } else {
    return {
      outcome: null,
      actualValue: null,
      notes: null,
      skipReason: `Team ${teamAbbrev} not in game ${leg?.gameIdRef}`,
    }
  }

  if (outcome === 'push') {
    return { outcome: 'push', actualValue: 0, notes: `${teamAbbrev} tied ${matchup}` }
  }
  if (won === true || won === false) {
    return {
      outcome: won ? 'won' : 'lost',
      actualValue: won ? 1 : 0,
      notes: `${teamAbbrev} ${matchup}`,
    }
  }
  return { outcome: null, actualValue: null, notes: null }
}

export function gradeTotalFromGame(leg, game, { line, side } = {}) {
  if (shouldVoidFromGame(game)) {
    return {
      outcome: 'void',
      actualValue: null,
      totalScore: null,
      notes: describeVoidNotes(game, 'total'),
    }
  }
  if (!canGradeFromGame(game)) {
    return { outcome: null, actualValue: null, totalScore: null, notes: null }
  }
  const totalScore = Number(game.awayScore) + Number(game.homeScore)
  const outcome = gradeOverUnder(totalScore, line, side)
  const matchup = `${game.away?.abbr || '?'} ${game.awayScore ?? '?'} @ ${game.home?.abbr || '?'} ${game.homeScore ?? '?'}`
  return {
    outcome,
    actualValue: totalScore,
    totalScore,
    notes: `Total: ${totalScore} vs ${String(side || '').toUpperCase()} ${line} (Game; ${matchup})`,
  }
}
