/**
 * Sides & totals — public moneyline and game over/under pile.
 * Separate from the props Published / Pile B track. Never pad.
 *
 * Live list: MLB + NFL, upcoming / not-final, edge >= GAME_LINE_MIN_EDGE
 * (the generatePicksFromSupabase default). NHL stays off this section.
 *
 * Tracked rows land in PropValidation with source=game_line and
 * propType moneyline|total so Published ROI filters can exclude them.
 */

import { nflGameLineMeetsPublicGates } from './nfl-selection-model.js'

export const GAME_LINE_MIN_EDGE = 0.05
export const GAME_LINE_SPORTS = Object.freeze(['mlb', 'nfl'])
export const GAME_LINE_TYPES = Object.freeze(['moneyline', 'total'])
export const GAME_LINE_SOURCE = 'game_line'
export const SIDES_TOTALS_COHORT_TAG = 'cohort:sides_totals'
export const GAME_LINE_CAP = 8

const GAME_LINE_TYPE_ALIASES = Object.freeze({
  moneyline: 'moneyline',
  ml: 'moneyline',
  h2h: 'moneyline',
  total: 'total',
  totals: 'total',
})

const ENDED_OR_LIVE = new Set([
  'final',
  'completed',
  'postponed',
  'cancelled',
  'canceled',
  'suspended',
  'in_progress',
  'in-progress',
  'in progress',
  'live',
])

const UPCOMING_STATUSES = new Set([
  'scheduled',
  'pre-game',
  'pre_game',
  'pregame',
  'warmup',
])

function normalizeSport(sport) {
  return String(sport || '').toLowerCase().trim()
}

function normalizeType(record) {
  const raw = String(record?.type || record?.propType || '').toLowerCase().trim()
  return GAME_LINE_TYPE_ALIASES[raw] || null
}

/**
 * True for moneyline / game-total rows (and the tagged game_line source).
 * Used so Published / Pile B never absorbs this pile.
 */
export function isGameLineRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (String(record.source || '').toLowerCase().trim() === GAME_LINE_SOURCE) return true
  if (String(record.notes || '').includes(SIDES_TOTALS_COHORT_TAG)) return true
  return normalizeType(record) != null
}

export function isUpcomingGameLine(record, now = new Date()) {
  if (!record || typeof record !== 'object') return false
  const status = String(record.status || record.gameStatus || '').toLowerCase().trim()
  if (ENDED_OR_LIVE.has(status)) return false
  if (UPCOMING_STATUSES.has(status)) return true

  const gameTime = record.gameTime
  if (gameTime) {
    const at = gameTime instanceof Date ? gameTime : new Date(gameTime)
    if (!Number.isNaN(at.getTime()) && at.getTime() <= now.getTime()) return false
  }
  return true
}

/**
 * Live public-section gate. Positive edge uses the generatePicksFromSupabase
 * floor (GAME_LINE_MIN_EDGE). Does not use the props QS / odds-band bar.
 */
export function isPublicGameLine(record, now = new Date()) {
  if (!record || typeof record !== 'object') return false
  if (normalizeType(record) == null) return false
  if (!GAME_LINE_SPORTS.includes(normalizeSport(record.sport))) return false
  if (normalizeSport(record.sport) === 'nfl' && !isApprovedNflGameLine(record)) return false
  const edge = Number(record.modelVsMarketGap ?? record.edge)
  if (!Number.isFinite(edge) || edge < GAME_LINE_MIN_EDGE) return false
  return isUpcomingGameLine(record, now)
}

/**
 * Same gates as nflGameLineSnapshotIsPublic: current model allowlist
 * plus payload (or mapped-row) eligibility. MLB does not use this.
 */
export function isApprovedNflGameLine(record) {
  if (!record || typeof record !== 'object') return false
  if (normalizeSport(record.sport) !== 'nfl') return false
  return nflGameLineMeetsPublicGates(record)
}

/**
 * Pure helper: ML and game totals only, ranked by edge, capped.
 * Empty is honest — never pads.
 */
export function selectGameLines(records, now = new Date(), cap = GAME_LINE_CAP) {
  const ranked = (Array.isArray(records) ? records : [])
    .filter((record) => isPublicGameLine(record, now))
    .sort((a, b) => (Number(b.edge) || 0) - (Number(a.edge) || 0))
  const limit = Number.isFinite(cap) && cap > 0 ? cap : GAME_LINE_CAP
  return ranked.slice(0, limit)
}

/**
 * Plain-English why from the stored edge. Does not invent extra stats.
 */
export function gameLineEdgeWhy(line) {
  const gap = Number(line?.modelVsMarketGap ?? line?.edge)
  if (!Number.isFinite(gap) || gap <= 0) return null
  if (line?.edgeIsDisplayCap) {
    return `Model-versus-market gap exceeds the displayed ${(Math.abs(Number(line.edge) * 100)).toFixed(1)}% cap`
  }
  return `Model sees ${(gap * 100).toFixed(1)}% more than the price implies`
}

/**
 * generateQuickInsight sometimes falls back to "X% edge vs market".
 * That is not matchup context — we already show the edge sentence.
 */
export function isMatchupInsight(text) {
  const value = String(text || '').trim()
  if (!value) return false
  if (/edge vs market$/i.test(value)) return false
  return true
}

/**
 * Attach the edge why (always, when edge is real) plus an optional
 * matchup line from generateQuickInsight when that function has real fields.
 */
export function decorateGameLine(line, game, insightFn) {
  if (!line || typeof line !== 'object') return line
  const why = gameLineEdgeWhy(line)
  let matchupInsight = null
  if (typeof insightFn === 'function' && game) {
    try {
      const insight = insightFn(line, game)
      if (isMatchupInsight(insight)) matchupInsight = insight
    } catch {
      matchupInsight = null
    }
  }
  return { ...line, why, matchupInsight }
}

export function decorateGameLines(lines, gamesMap = {}, insightFn) {
  return (Array.isArray(lines) ? lines : []).map((line) =>
    decorateGameLine(line, gamesMap[line.gameId], insightFn),
  )
}

/**
 * Split a game-line list into moneyline vs totals. Props never appear.
 */
export function partitionGameLines(records) {
  const moneylines = []
  const totals = []
  for (const record of Array.isArray(records) ? records : []) {
    const type = normalizeType(record)
    if (type === 'moneyline') moneylines.push(record)
    else if (type === 'total') totals.push(record)
  }
  return { moneylines, totals }
}

export function gameLinePropId(line) {
  const gameId = line?.gameId || line?.gameIdRef || 'unknown'
  const type = normalizeType(line) || 'line'
  const pick = String(line?.pick || line?.prediction || 'side').replace(/\s+/g, '-')
  const threshold = line?.threshold == null || line?.threshold === '' ? 'ml' : String(line.threshold)
  return `gl-${gameId}-${type}-${pick}-${threshold}`
}

export function gameLineLabel(line) {
  const type = normalizeType(line)
  if (type === 'total') {
    const away = line.awayTeam || ''
    const home = line.homeTeam || ''
    if (away && home) return `${away} @ ${home}`
    return line.team || line.playerName || 'Total'
  }
  return line.pick || line.team || line.playerName || 'ML'
}

export function gameLineDetail(line) {
  const type = normalizeType(line)
  if (type === 'moneyline') return `${line.pick || line.team || ''} ML`.trim()
  if (type === 'total') {
    const side = String(line.pick || line.prediction || '').toUpperCase()
    const lineNum = line.threshold == null ? '' : String(line.threshold)
    return `${side} ${lineNum}`.trim()
  }
  return line.reasoning || ''
}

/**
 * Grade a stored or live game line from final scores. No odds API.
 * @returns {{ result: 'correct'|'incorrect'|'push', actualValue: number }|null}
 */
export function gradeGameLineFromScores(record, game) {
  if (!record || !game) return null
  const homeScore = Number(game.homeScore)
  const awayScore = Number(game.awayScore)
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null

  const type = normalizeType(record)
  if (type === 'total') {
    const actual = homeScore + awayScore
    const line = Number(record.threshold)
    const side = String(record.prediction || record.pick || '').toLowerCase()
    if (!Number.isFinite(line)) return null
    if (actual === line) return { result: 'push', actualValue: actual }
    if (side === 'over') return { result: actual > line ? 'correct' : 'incorrect', actualValue: actual }
    if (side === 'under') return { result: actual < line ? 'correct' : 'incorrect', actualValue: actual }
    return null
  }

  if (type === 'moneyline') {
    if (homeScore === awayScore) return { result: 'push', actualValue: homeScore }
    const pick = String(record.prediction || record.pick || '').toUpperCase()
    const homeAbbr = String(game.home?.abbr || record.homeTeam || '').toUpperCase()
    const awayAbbr = String(game.away?.abbr || record.awayTeam || '').toUpperCase()
    if (!pick) return null
    const homeWon = homeScore > awayScore
    if (pick === homeAbbr) return { result: homeWon ? 'correct' : 'incorrect', actualValue: homeScore }
    if (pick === awayAbbr) return { result: homeWon ? 'incorrect' : 'correct', actualValue: awayScore }
    return null
  }

  return null
}

export function isFinalGameStatus(status) {
  const s = String(status || '').toLowerCase().trim()
  return s === 'final' || s === 'completed' || s === 'f' || s === 'closed' || s === 'status_final'
}
