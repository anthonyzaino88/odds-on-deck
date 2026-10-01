/**
 * Read-only (default) report of grades that landed on games that were
 * never truly final — postponed, cancelled, suspended, or MLB 0-0.
 *
 * --apply is opt-in and writes repairs. Dry-run is the default.
 */

import {
  classifyGameForGrading,
  GRADE_ACTIONS,
  voidParlayLegPatch,
  voidPropValidationPatch,
} from './game-grade-eligibility.js'

const SETTLED_PROP_RESULTS = new Set(['correct', 'incorrect', 'push', 'pushed', 'won', 'lost'])
const SETTLED_LEG_OUTCOMES = new Set(['won', 'lost', 'push'])
const SETTLED_PARLAY_STATUSES = new Set(['won', 'lost', 'push'])

function lower(value) {
  return String(value || '').toLowerCase().trim()
}

export function isAlreadyVoided(record) {
  if (!record) return false
  if (lower(record.result) === 'void' || lower(record.outcome) === 'void') return true
  return lower(record.status) === 'manual_closed' && lower(record.result) === 'void'
}

export function isSettledPropGrade(row) {
  if (!row || isAlreadyVoided(row)) return false
  if (SETTLED_PROP_RESULTS.has(lower(row.result))) return true
  return lower(row.status) === 'completed' && row.result != null
}

export function isSettledLegGrade(leg) {
  if (!leg || isAlreadyVoided(leg)) return false
  return SETTLED_LEG_OUTCOMES.has(lower(leg.outcome))
}

export function parseUnplayedGradeArgs(argv = []) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

/**
 * @param {{ games: object[], validations?: object[], parlays?: object[] }} input
 */
export function planUnplayedGameGradeRepair({ games, validations = [], parlays = [] } = {}) {
  const gameList = Array.isArray(games) ? games : []

  const flaggedGames = gameList
    .map((game) => {
      const classification = classifyGameForGrading(game)
      if (classification.action === GRADE_ACTIONS.GRADE) return null
      if (classification.reason === 'missing_game') return null
      if (classification.reason === 'not_started' || classification.reason === 'scheduled') return null
      if (['in_progress', 'live', 'halftime', 'pre_game', 'warmup', 'not_started'].includes(classification.reason)) {
        return null
      }
      // Hold/void for postponed, cancelled, suspended, delayed, MLB 0-0, missing scores.
      if (
        classification.action === GRADE_ACTIONS.VOID
        || ['postponed', 'suspended', 'delayed', 'mlb_unplayed_0_0', 'final_without_scores'].includes(classification.reason)
      ) {
        return { game, classification }
      }
      return null
    })
    .filter(Boolean)

  const flaggedIds = new Set(flaggedGames.map((row) => row.game.id))

  const props = []
  for (const row of validations) {
    const gameId = row.gameIdRef
    if (!flaggedIds.has(gameId) || !isSettledPropGrade(row)) continue
    const flagged = flaggedGames.find((item) => item.game.id === gameId)
    props.push({
      id: row.id,
      propId: row.propId,
      playerName: row.playerName,
      propType: row.propType,
      result: row.result,
      status: row.status,
      actualValue: row.actualValue,
      gameIdRef: gameId,
      gameStatus: flagged.game.status,
      sport: flagged.game.sport || row.sport,
      action: flagged.classification.action,
      reason: flagged.classification.reason,
    })
  }

  const legs = []
  const parlayRepairs = []
  for (const parlay of parlays) {
    const parlayLegs = Array.isArray(parlay.legs) ? parlay.legs : []
    const repairedLegs = []
    for (const leg of parlayLegs) {
      const gameId = leg.gameIdRef
      if (!flaggedIds.has(gameId) || !isSettledLegGrade(leg)) continue
      const flagged = flaggedGames.find((item) => item.game.id === gameId)
      const item = {
        id: leg.id,
        parlayId: parlay.id,
        playerName: leg.playerName,
        selection: leg.selection,
        betType: leg.betType,
        propType: leg.propType,
        outcome: leg.outcome,
        gameIdRef: gameId,
        gameStatus: flagged.game.status,
        action: flagged.classification.action,
        reason: flagged.classification.reason,
      }
      legs.push(item)
      repairedLegs.push(item)
    }
    if (repairedLegs.length === 0) continue
    if (!SETTLED_PARLAY_STATUSES.has(lower(parlay.status || parlay.outcome))) continue
    parlayRepairs.push({
      id: parlay.id,
      status: parlay.status,
      outcome: parlay.outcome,
      sport: parlay.sport,
      repairedLegCount: repairedLegs.length,
    })
  }

  return {
    games: flaggedGames.map(({ game, classification }) => ({
      id: game.id,
      sport: game.sport,
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      date: game.date,
      action: classification.action,
      reason: classification.reason,
    })),
    props,
    legs,
    parlays: parlayRepairs,
  }
}

export function describePropRepairWrite(item, now = new Date()) {
  if (item.action === GRADE_ACTIONS.VOID) {
    return voidPropValidationPatch(now, {
      status: item.gameStatus,
      sport: item.sport,
    }, 'repair unplayed-game grade')
  }
  return {
    status: 'pending',
    result: null,
    actualValue: null,
    completedAt: null,
    notes: `Requeued — game ${item.gameStatus || item.reason} is not a true final`,
  }
}

export function describeLegRepairWrite(item) {
  if (item.action === GRADE_ACTIONS.VOID) {
    return voidParlayLegPatch({ status: item.gameStatus }, 'repair unplayed-game grade')
  }
  return {
    outcome: 'pending',
    actualResult: null,
  }
}

export function describeParlayRepairWrite() {
  return {
    status: 'pending',
    outcome: 'pending',
    actualResult: null,
  }
}
