/**
 * Shared "was this game actually played to a gradeable finish?"
 *
 * Parlay auto-grade, player-prop validation, and the game_line grader
 * all used slightly different "is this final?" checks. Postponed /
 * cancelled / suspended scoreless rows (and MLB 0-0 placeholders)
 * must never settle as a win, loss, or push.
 *
 * Cancelled → void (not a loss). Postponed / suspended / live → hold
 * (leave pending; the game may still be played or resumed).
 */

export const GRADE_ACTIONS = Object.freeze({
  GRADE: 'grade',
  HOLD: 'hold',
  VOID: 'void',
})

export const VOID_RESULT = 'void'
export const VOID_STATUS = 'manual_closed'
export const VOID_LEG_OUTCOME = 'void'

const FINAL_STATUSES = new Set([
  'final',
  'completed',
  'f',
  'closed',
  'status_final',
])

const CANCELLED_STATUSES = new Set([
  'cancelled',
  'canceled',
])

const UNPLAYED_HOLD_STATUSES = new Set([
  'postponed',
  'suspended',
  'delayed',
])

const LIVE_OR_UPCOMING_STATUSES = new Set([
  'scheduled',
  'pre-game',
  'pre_game',
  'pregame',
  'warmup',
  'in_progress',
  'in-progress',
  'in progress',
  'live',
  'halftime',
])

const VOID_OUTCOMES = new Set(['void', 'cancelled', 'canceled'])
const SETTLED_OUTCOMES = new Set(['won', 'lost', 'push'])

export function normalizeGameStatus(status) {
  const raw = String(status || '').toLowerCase().trim()
  if (!raw) return ''
  const stripped = raw.replace(/^status_/, '')
  if (stripped === 'canceled') return 'cancelled'
  if (stripped === 'in-progress' || stripped === 'in progress') return 'in_progress'
  if (stripped === 'pre-game' || stripped === 'pregame') return 'pre_game'
  return stripped
}

export function isTrulyFinalGameStatus(status) {
  const s = normalizeGameStatus(status)
  return FINAL_STATUSES.has(s) || s === 'final'
}

export function isCancelledGameStatus(status) {
  return CANCELLED_STATUSES.has(normalizeGameStatus(status))
}

export function isUnplayedHoldStatus(status) {
  return UNPLAYED_HOLD_STATUSES.has(normalizeGameStatus(status))
}

export function isLiveOrUpcomingStatus(status) {
  return LIVE_OR_UPCOMING_STATUSES.has(normalizeGameStatus(status))
}

export function hasNumericScores(game) {
  if (!game) return false
  return Number.isFinite(Number(game.homeScore)) && Number.isFinite(Number(game.awayScore))
}

export function isScoreless(game) {
  if (!hasNumericScores(game)) return true
  return Number(game.homeScore) === 0 && Number(game.awayScore) === 0
}

export function hasPositiveScore(game) {
  if (!hasNumericScores(game)) return false
  return Number(game.homeScore) > 0 || Number(game.awayScore) > 0
}

/**
 * MLB cannot end 0-0. A stored "final" 0-0 is an if-necessary
 * placeholder or a rained-out row that was marked final by mistake.
 * NHL / NFL 0-0 finals are theoretically possible and stay gradeable
 * when status is truly final.
 */
export function isImpossibleMlbFinal(game) {
  const sport = String(game?.sport || '').toLowerCase().trim()
  return sport === 'mlb' && isScoreless(game)
}

export function etDateKey(value, now = new Date()) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export function gameDateIsPast(game, now = new Date()) {
  const gameDay = etDateKey(game?.date)
  const today = etDateKey(now)
  return Boolean(gameDay && today && gameDay < today)
}

/**
 * @returns {{ action: 'grade'|'hold'|'void', reason: string }}
 */
export function classifyGameForGrading(game) {
  if (!game) return { action: GRADE_ACTIONS.HOLD, reason: 'missing_game' }

  const status = normalizeGameStatus(game.status)

  if (isCancelledGameStatus(status)) {
    return { action: GRADE_ACTIONS.VOID, reason: 'cancelled' }
  }
  if (isUnplayedHoldStatus(status)) {
    return { action: GRADE_ACTIONS.HOLD, reason: status || 'postponed' }
  }
  if (isLiveOrUpcomingStatus(status)) {
    return { action: GRADE_ACTIONS.HOLD, reason: status || 'not_started' }
  }
  if (isTrulyFinalGameStatus(status)) {
    if (!hasNumericScores(game)) {
      return { action: GRADE_ACTIONS.HOLD, reason: 'final_without_scores' }
    }
    if (isImpossibleMlbFinal(game)) {
      return { action: GRADE_ACTIONS.HOLD, reason: 'mlb_unplayed_0_0' }
    }
    return { action: GRADE_ACTIONS.GRADE, reason: 'final' }
  }

  return { action: GRADE_ACTIONS.HOLD, reason: 'not_final' }
}

export function canGradeFromGame(game) {
  return classifyGameForGrading(game).action === GRADE_ACTIONS.GRADE
}

export function shouldVoidFromGame(game) {
  return classifyGameForGrading(game).action === GRADE_ACTIONS.VOID
}

/**
 * Player-stat lookup plan. Date-before-yesterday is not a substitute
 * for a real final — that shortcut is what graded rained-out box
 * scores as actual=0. Only look up stats when the game is a real
 * final, or when a stuck non-terminal status still has a positive
 * score (evidence the game was played).
 */
export function planStatLookupFromGame(game, { now = new Date() } = {}) {
  const classification = classifyGameForGrading(game)
  if (classification.action === GRADE_ACTIONS.GRADE) {
    return { action: 'lookup', reason: classification.reason }
  }
  if (classification.action === GRADE_ACTIONS.VOID) {
    return { action: 'void', reason: classification.reason }
  }
  if (
    classification.reason === 'not_final'
    && gameDateIsPast(game, now)
    && hasPositiveScore(game)
  ) {
    return { action: 'lookup', reason: 'past_with_scores' }
  }
  return { action: 'hold', reason: classification.reason }
}

function espnTypeBlob(type = {}) {
  return [
    type.name,
    type.description,
    type.detail,
    type.shortDetail,
    type.state,
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * ESPN uses state=post for postponed and cancelled as well as finals.
 * Only STATUS_FINAL / completed=true is a real finish.
 */
export function classifyEspnCompetition(competition) {
  const type = competition?.status?.type || {}
  const blob = espnTypeBlob(type)
  if (/\bcancel/.test(blob)) {
    return { action: GRADE_ACTIONS.VOID, reason: 'cancelled' }
  }
  if (/\bpostponed\b/.test(blob) || /\bsuspend/.test(blob) || /\bdelayed\b/.test(blob)) {
    return { action: GRADE_ACTIONS.HOLD, reason: 'espn_not_played' }
  }
  const name = String(type.name || '').toUpperCase()
  if (type.completed === true || name === 'STATUS_FINAL') {
    return { action: GRADE_ACTIONS.GRADE, reason: 'espn_final' }
  }
  return { action: GRADE_ACTIONS.HOLD, reason: 'espn_not_final' }
}

export function isEspnCompetitionGradeable(competition) {
  return classifyEspnCompetition(competition).action === GRADE_ACTIONS.GRADE
}

export function isVoidOutcome(outcome) {
  return VOID_OUTCOMES.has(String(outcome || '').toLowerCase().trim())
}

/**
 * Sportsbook-style parlay settle: void/cancelled legs drop out and
 * the ticket is re-graded on the remaining legs. A genuine push still
 * makes the whole card a push (existing behavior). All-void → push
 * (refund), which matches 0-unit treatment of void elsewhere.
 */
export function aggregateParlayOutcomes(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : []
  const actionable = list.filter((outcome) => !isVoidOutcome(outcome))
  if (actionable.some((outcome) => outcome === 'lost')) return 'lost'
  const unresolved = actionable.filter((outcome) => !SETTLED_OUTCOMES.has(outcome)).length
  if (unresolved) return 'pending'
  if (actionable.length === 0) return 'push'
  if (actionable.some((outcome) => outcome === 'push')) return 'push'
  if (actionable.every((outcome) => outcome === 'won')) return 'won'
  return 'pending'
}

export function describeVoidNotes(game, extra = '') {
  const away = game?.away?.abbr || game?.awayTeam || '?'
  const home = game?.home?.abbr || game?.homeTeam || '?'
  const status = normalizeGameStatus(game?.status) || 'cancelled'
  const suffix = extra ? ` ${extra}` : ''
  return `Game ${status} (${away} @ ${home}) — voided, not a loss.${suffix}`
}

export function voidPropValidationPatch(now = new Date(), game, extraNotes = '') {
  const instant = (now instanceof Date ? now : new Date(now)).toISOString()
  return {
    result: VOID_RESULT,
    status: VOID_STATUS,
    actualValue: null,
    completedAt: instant,
    notes: describeVoidNotes(game, extraNotes),
  }
}

export function voidParlayLegPatch(game, extraNotes = '') {
  return {
    outcome: VOID_LEG_OUTCOME,
    actualResult: describeVoidNotes(game, extraNotes),
  }
}
