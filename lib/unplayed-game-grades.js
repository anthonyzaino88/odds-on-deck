/**
 * Read-only (default) report of grades that landed on games that were
 * never truly final — postponed, cancelled, suspended, or MLB 0-0.
 *
 * --apply is opt-in and writes repairs. Dry-run is the default.
 * --apply requires SUPABASE_SECRET_KEY (anon is a silent RLS no-op).
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
const FLAGGED_HOLD_REASONS = new Set([
  'postponed',
  'suspended',
  'mlb_unplayed_0_0',
  'final_without_scores',
])

export const UNPLAYED_IN_CHUNK = 200
export const UNPLAYED_PAGE_SIZE = 1000

function lower(value) {
  return String(value || '').toLowerCase().trim()
}

function takeFlag(argv, flag) {
  const i = argv.indexOf(flag)
  if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) return argv[i + 1]
  return null
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
    game: takeFlag(argv, '--game'),
    sport: takeFlag(argv, '--sport'),
    from: takeFlag(argv, '--from'),
    to: takeFlag(argv, '--to'),
  }
}

export function requireUnplayedGradeApplyKey(env = process.env) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || null
  if (!key) {
    throw new Error('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required for --apply. Anon writes are silent RLS no-ops.')
  }
  return key
}

export function chunkIds(ids, size = UNPLAYED_IN_CHUNK) {
  const list = Array.isArray(ids) ? ids : []
  const chunks = []
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size))
  return chunks
}

export async function paginateSupabaseSelect(makeQuery, { pageSize = UNPLAYED_PAGE_SIZE } = {}) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) return { rows, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return { rows, error: null }
}

export function gameMatchesScope(game, scope = {}) {
  if (!game) return false
  if (scope.game && String(game.id) !== String(scope.game)) return false
  if (scope.sport && String(game.sport || '').toLowerCase() !== String(scope.sport).toLowerCase()) {
    return false
  }
  if (scope.from && game.date && new Date(game.date) < new Date(`${scope.from}T00:00:00.000Z`)) {
    return false
  }
  if (scope.to && game.date && new Date(game.date) > new Date(`${scope.to}T23:59:59.999Z`)) {
    return false
  }
  return true
}

function isFlaggedClassification(classification) {
  if (!classification) return false
  if (classification.action === GRADE_ACTIONS.VOID) return true
  return FLAGGED_HOLD_REASONS.has(classification.reason)
}

/**
 * @param {{ games: object[], validations?: object[], parlays?: object[], scope?: object }} input
 */
export function planUnplayedGameGradeRepair({
  games,
  validations = [],
  parlays = [],
  scope = {},
} = {}) {
  const gameList = (Array.isArray(games) ? games : []).filter((game) => gameMatchesScope(game, scope))

  const flaggedGames = gameList
    .map((game) => {
      const classification = classifyGameForGrading(game)
      if (!isFlaggedClassification(classification)) return null
      return { game, classification }
    })
    .filter(Boolean)

  const flaggedIds = new Set(flaggedGames.map((row) => row.game.id))
  const flaggedById = new Map(flaggedGames.map((row) => [row.game.id, row]))

  const props = []
  for (const row of validations) {
    const gameId = row.gameIdRef
    if (!flaggedIds.has(gameId) || !isSettledPropGrade(row)) continue
    const flagged = flaggedById.get(gameId)
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
    let touchesFlaggedGame = false
    for (const leg of parlayLegs) {
      const gameId = leg.gameIdRef
      if (!flaggedIds.has(gameId)) continue
      touchesFlaggedGame = true
      if (!isSettledLegGrade(leg)) continue
      const flagged = flaggedById.get(gameId)
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
    // Settled parlays that touch a flagged game reset even if their
    // legs were already voided/pended (partial --apply abort).
    if (!touchesFlaggedGame) continue
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

function rowCount(result) {
  if (!result) return 0
  if (Number.isFinite(result.count)) return result.count
  if (Array.isArray(result.data)) return result.data.length
  return 0
}

/**
 * Apply the repair plan. Throws on write error or 0 rows affected
 * so a partial abort can be retried (planner is idempotent).
 */
export async function applyUnplayedGradeRepairs(plan, writers, { now = new Date() } = {}) {
  let wrote = 0
  for (const row of plan.props || []) {
    const result = await writers.writeProp(row.id, describePropRepairWrite(row, now))
    if (result?.error) {
      throw new Error(`PropValidation write failed for ${row.id}: ${result.error.message}`)
    }
    if (rowCount(result) < 1) {
      throw new Error(`PropValidation write affected 0 rows for ${row.id}`)
    }
    wrote += 1
  }
  for (const leg of plan.legs || []) {
    const result = await writers.writeLeg(leg.id, describeLegRepairWrite(leg))
    if (result?.error) {
      throw new Error(`ParlayLeg write failed for ${leg.id}: ${result.error.message}`)
    }
    if (rowCount(result) < 1) {
      throw new Error(`ParlayLeg write affected 0 rows for ${leg.id}`)
    }
    wrote += 1
  }
  for (const parlay of plan.parlays || []) {
    const result = await writers.writeParlay(parlay.id, describeParlayRepairWrite())
    if (result?.error) {
      throw new Error(`Parlay write failed for ${parlay.id}: ${result.error.message}`)
    }
    if (rowCount(result) < 1) {
      throw new Error(`Parlay write affected 0 rows for ${parlay.id}`)
    }
    wrote += 1
  }
  return { wrote }
}
