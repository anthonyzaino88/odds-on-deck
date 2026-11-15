/**
 * Publish bars and lock-time rules for NFL / NHL / MLB game lines.
 * Numbers here are the working contract. Changing a threshold is a new
 * candidate — it does not flip eligibleForPublic.
 *
 * See docs/game-line-model-rules.md.
 */

export const GAME_LINE_SPORTS_IN_SCOPE = Object.freeze(['nfl', 'nhl', 'mlb'])
export const GAME_LINE_MARKETS_IN_SCOPE = Object.freeze(['moneyline', 'spreads', 'totals'])

/** Pick-lock is this many minutes before the frozen scheduled start. */
export const PICK_LOCK_LEAD_MINUTES = 60
export const PICK_LOCK_LEAD_MS = PICK_LOCK_LEAD_MINUTES * 60 * 1000

/** Close window copied from production close capture. */
export const CLOSE_WINDOW_MINUTES = 35
export const CLOSE_MIN_LEAD_MINUTES = 1

/** Quote older than this relative to capture is stale. */
export const LOCK_QUOTE_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Training result must be this old relative to the test lock. */
export const WALK_FORWARD_EMBARGO_HOURS = 24
export const WALK_FORWARD_EMBARGO_MS = WALK_FORWARD_EMBARGO_HOURS * 60 * 60 * 1000

/**
 * ~200 decided games per sport and market.
 * NFL regular season is 272 games; 200 is most of one season after
 * warmup weeks. NHL and MLB play more often, so 200 is a few weeks.
 * Below this the CI on CLV is too wide to trust.
 */
export const PUBLISH_MIN_SAMPLE = 200

/** Holdout must cover this many separate NFL weeks or NHL/MLB ET dates. */
export const PUBLISH_MIN_HOLDOUT_FOLDS = 4

/** Development folds required before a holdout can be formed. */
export const PUBLISH_MIN_DEV_FOLDS = 4

/**
 * Mean closing-line value, vig still inside both prices.
 * +1.0 percentage point is a real gap after juice; smaller averages are
 * noise relative to a 200-game sample.
 */
export const PUBLISH_MIN_AVG_CLV = 0.01

/**
 * Share of same-line bets whose posted price beat the close.
 * 52% is better than a coin flip with room for a cold week.
 */
export const PUBLISH_MIN_BEAT_CLOSE_SHARE = 0.52

export const LOG_LOSS_CLIP = 0.001
export const PROB_SUM_TOLERANCE = 1e-6

export const ALLOWED_PREGAME_INPUTS = Object.freeze([
  'matchup_history',
  'recent_form',
  'rest_travel',
  'injuries',
  'starters_qb',
  'home_away',
])

export const FORBIDDEN_LOOKAHEAD = Object.freeze([
  'result_available_after_lock',
  'quote_after_lock',
  'injury_fetched_after_lock',
  'stats_data_through_after_lock',
  'close_used_as_model_input',
])

/**
 * Chronological fold split for one sport/market/version.
 * Fold 1 is warmup (not in the publish sample). The next
 * PUBLISH_MIN_DEV_FOLDS are development. Everything after that is holdout.
 */
export function splitWalkForwardFolds(foldIds = []) {
  const folds = [...new Set((Array.isArray(foldIds) ? foldIds : []).filter(Boolean))]
    .sort(compareFoldIds)
  const warmup = folds.slice(0, 1)
  const rest = folds.slice(1)
  const development = rest.slice(0, PUBLISH_MIN_DEV_FOLDS)
  const holdout = rest.slice(PUBLISH_MIN_DEV_FOLDS)
  return { warmup, development, holdout, all: folds }
}

function compareFoldIds(a, b) {
  const left = foldSortParts(a)
  const right = foldSortParts(b)
  const n = Math.max(left.length, right.length)
  for (let i = 0; i < n; i += 1) {
    const av = left[i]
    const bv = right[i]
    if (av == null && bv == null) continue
    if (av == null) return -1
    if (bv == null) return 1
    if (typeof av === 'number' && typeof bv === 'number' && av !== bv) return av - bv
    const cmp = String(av).localeCompare(String(bv), 'en')
    if (cmp) return cmp
  }
  return 0
}

function foldSortParts(id) {
  const text = String(id || '')
  const nflWeek = text.match(/^nfl-(\d+)-w(\d+)$/i)
  if (nflWeek) {
    const season = Number(nflWeek[1])
    const week = Number(nflWeek[2])
    return [0, nflWeekProxyMs(season, week)]
  }
  const iso = text.match(/(\d{4}-\d{2}-\d{2})$/)
  if (iso) {
    const ms = Date.parse(`${iso[1]}T17:00:00.000Z`)
    if (Number.isFinite(ms)) return [0, ms]
  }
  return [1, text]
}

/** Week 1 ≈ Sep 1 of the season label. Only used to order leftover `nfl-YYYY-wN` ids. */
function nflWeekProxyMs(season, week) {
  return Date.UTC(season, 8, 1 + (Math.max(1, week) - 1) * 7)
}

export function sampleSizeStatus(n, minSample = PUBLISH_MIN_SAMPLE) {
  const sample = Number(n) || 0
  if (sample <= 0) {
    return {
      ok: false,
      code: 'SAMPLE_EMPTY',
      label: 'no scored games',
      sample,
      minSample,
    }
  }
  if (sample < minSample) {
    return {
      ok: false,
      code: 'SAMPLE_TOO_SMALL',
      label: `sample ${sample} < ${minSample} (too small to publish)`,
      sample,
      minSample,
    }
  }
  return {
    ok: true,
    code: 'SAMPLE_OK',
    label: `sample ${sample} meets the ${minSample}-game bar`,
    sample,
    minSample,
  }
}

export function publishBarsStatus({
  sample = 0,
  holdoutFolds = 0,
  devFolds = 0,
  avgClv = null,
  beatCloseShare = null,
  brierBeatsClose = false,
  logLossBeatsClose = false,
} = {}) {
  const size = sampleSizeStatus(sample)
  const reasons = []
  if (!size.ok) reasons.push(size.label)
  if ((Number(devFolds) || 0) < PUBLISH_MIN_DEV_FOLDS) {
    reasons.push(`development folds ${Number(devFolds) || 0} < ${PUBLISH_MIN_DEV_FOLDS}`)
  }
  if ((Number(holdoutFolds) || 0) < PUBLISH_MIN_HOLDOUT_FOLDS) {
    reasons.push(`holdout folds ${Number(holdoutFolds) || 0} < ${PUBLISH_MIN_HOLDOUT_FOLDS}`)
  }
  if (!Number.isFinite(Number(avgClv)) || Number(avgClv) < PUBLISH_MIN_AVG_CLV) {
    reasons.push('average CLV below +1.0pp')
  }
  if (!Number.isFinite(Number(beatCloseShare)) || Number(beatCloseShare) < PUBLISH_MIN_BEAT_CLOSE_SHARE) {
    reasons.push('beat-close share below 52%')
  }
  if (!brierBeatsClose) reasons.push('Brier does not beat the no-vig close')
  if (!logLossBeatsClose) reasons.push('log-loss does not beat the no-vig close')

  return {
    eligibleForPublic: reasons.length === 0,
    reasons,
    sample: size,
  }
}
