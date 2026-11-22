/**
 * Private NFL / NHL moneyline + game-total shadow track.
 *
 * Records one pick per game / market / model version at lock (upcoming
 * games only), even when public gates and the 5% edge floor fail.
 * Tagged cohort:shadow-published with no auto-saved token so every
 * public query already drops the row. Nothing here flips
 * eligibleForPublic or PUBLISHED_GAME_LINE_SPORTS.
 *
 * Model versions stay on the row (propId + notes) so a later research
 * model (for example PR #110's nfl-selection-v1.1.0) can record beside
 * the live tag without colliding.
 */

import {
  GAME_LINE_SKIP_REASONS,
  GAME_LINE_SOURCE,
  SIDES_TOTALS_COHORT_TAG,
  gameLineMarketType,
  isGameLineRecord,
  isRecordedGameLineSport,
  isUpcomingGameLine,
} from './game-lines.js'
import {
  SHADOW_PUBLISHED_COHORT_TAG,
  isPrivateShadowPublished,
  withAppendedCohortTag,
  withPreservedCohortNotes,
} from './published-picks.js'
import {
  NFL_SELECTION_MODEL_VERSION,
  isLegacyNflHeuristicVersion,
  nflTotalOutcomeProbabilities,
  parseEdgePayload,
} from './nfl-selection-model.js'
import {
  NHL_MODEL_VERSION,
  isLegacyNhlHeuristicSnapshot,
} from './edge-nfl-nhl.js'
import {
  normalizeToAmericanOdds,
  removeMlVig,
  removeTotalVig,
} from './implied.js'
import { toAmericanOdds } from './odds-units.js'
import {
  applyPublishedCloseUpdate,
  closeCapturePayload,
  closingTotalOverUnderPrices,
  consensusClosingQuote,
  hasCloseAlready,
  isAttemptedClosingOddsBook,
  isCloseCaptureTaggedId,
  updateWithOptionalCloseOdds,
} from './closing-line.js'

export const GAME_LINE_SHADOW_SPORTS = Object.freeze(['nfl', 'nhl'])
export const GAME_LINE_MODEL_NOTES_PREFIX = 'model:'
export const GAME_LINE_MARKET_PROB_NOTES_PREFIX = 'marketProb:'
export const GAME_LINE_TOTALS_HEURISTIC_TAG = 'totals:heuristic'
export const NFL_REGULAR_SEASON_FINALS_FEATURE = 'regular-season-finals'
export const NFL_REGULAR_SEASON_FINALS_NOTES_TAG = 'features:regular-season-finals'
export const NFL_PRE_RS_FILTER_FEATURE = 'pre-regular-season-filter'
export const NFL_PRE_RS_FILTER_NOTES_TAG = 'features:pre-regular-season-filter'
export const NFL_TOTALS_HEURISTIC_VARIANCE = 169
export const NFL_TOTALS_HEURISTIC_HOME_BOOST = 1.5
export const NHL_TOTALS_HEURISTIC_SD = 2
export const NHL_TOTALS_HEURISTIC_HOME_BOOST = 0.2
export const GAME_LINE_SHADOW_CLOSING_ODDS_SELECT = [
  'id',
  'game_id',
  'sport',
  'book',
  'market',
  'price_home',
  'price_away',
  'total',
  'spread',
  'snapshot_at',
  'quoted_at',
].join(', ')

export function isGameLineShadowSport(sport) {
  return GAME_LINE_SHADOW_SPORTS.includes(String(sport || '').toLowerCase().trim())
}

export function isShadowGameLineRecord(record) {
  return isGameLineRecord(record) && isPrivateShadowPublished(record)
}

export function modelVersionNotesTag(modelVersion) {
  const version = String(modelVersion || '').trim()
  if (!version) return ''
  return `${GAME_LINE_MODEL_NOTES_PREFIX}${version}`
}

export function marketProbNotesTag(marketProb) {
  const value = Number(marketProb)
  if (!Number.isFinite(value)) return ''
  return `${GAME_LINE_MARKET_PROB_NOTES_PREFIX}${value.toFixed(4)}`
}

export function modelVersionFromNotes(notes) {
  const match = String(notes || '').match(/\bmodel:([^\s|]+)/i)
  return match ? match[1] : null
}

export function isNflSelectionV110(version) {
  return String(version || '').trim() === NFL_SELECTION_MODEL_VERSION
}

function notesHaveTag(notes, tag) {
  return Boolean(tag) && String(notes || '').includes(tag)
}

/**
 * New NFL v1.1.0 rows rebuild from regular-season finals only.
 * Untagged existing v1.1.0 shadow rows were scored on mixed
 * preseason+regular records and belong in a pre-fix group.
 */
export function nflV110ShadowFeatureGroup(row) {
  if (String(row?.sport || '').toLowerCase().trim() !== 'nfl') return null
  const version = modelVersionFromNotes(row?.notes)
    || row?.modelRun
    || row?.modelVersion
    || ''
  if (!isNflSelectionV110(version)) return null
  if (notesHaveTag(row?.notes, NFL_REGULAR_SEASON_FINALS_NOTES_TAG)) {
    return NFL_REGULAR_SEASON_FINALS_FEATURE
  }
  if (notesHaveTag(row?.notes, NFL_PRE_RS_FILTER_NOTES_TAG)) {
    return NFL_PRE_RS_FILTER_FEATURE
  }
  return NFL_PRE_RS_FILTER_FEATURE
}

export function shouldTagNflRegularSeasonFinals(line) {
  return line?.regularSeasonFinals === true
}

/** Dry-run plan: existing mixed-record v1.1.0 shadow rows that still need a pre-fix tag. */
export function planNflV110PreRsFilterRetag(rows = []) {
  const planned = []
  for (const row of rows || []) {
    if (nflV110ShadowFeatureGroup(row) !== NFL_PRE_RS_FILTER_FEATURE) continue
    if (notesHaveTag(row?.notes, NFL_PRE_RS_FILTER_NOTES_TAG)) continue
    planned.push({
      id: row.id,
      gameIdRef: row.gameIdRef || row.gameId || null,
      notes: row.notes || '',
      nextNotes: withAppendedCohortTag(row.notes, NFL_PRE_RS_FILTER_NOTES_TAG),
    })
  }
  return planned
}

export function sanitizeModelVersionForId(modelVersion) {
  const raw = String(modelVersion || 'unknown').trim() || 'unknown'
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

/**
 * One row per game + market + model version. Side is not in the id, so
 * a later re-run cannot mint Over and Under (or both teams) as two picks.
 */
export function gameLineShadowPropId(line) {
  const gameId = line?.gameId || line?.gameIdRef || 'unknown'
  const type = gameLineMarketType(line) || 'line'
  const version = sanitizeModelVersionForId(
    line?.modelVersion || line?.modelRun || 'unknown',
  )
  return `gl-shadow-${gameId}-${type}-${version}`
}

export const SHADOW_GAME_LINE_DUPLICATE_NOTE = 'Duplicate game-line shadow'

function sameShadowGameLineMarket(row, line = {}) {
  if (!row || typeof row !== 'object') return false
  if (String(row.source || '').toLowerCase().trim() !== GAME_LINE_SOURCE) return false
  const sport = String(line.sport || '').toLowerCase().trim()
  if (String(row.sport || '').toLowerCase().trim() !== sport) return false
  const market = gameLineMarketType(line)
  if (!market || gameLineMarketType(row) !== market) return false
  if (String(row.gameIdRef || row.gameId || '') !== String(line.gameId || line.gameIdRef || '')) {
    return false
  }
  if (!isPrivateShadowPublished(row) && sport !== 'nhl') return false
  const wanted = String(line.modelVersion || line.modelRun || '').trim()
  const existingVersion = modelVersionFromNotes(row.notes)
    || String(row.modelRun || row.modelVersion || '').trim()
  if (!existingVersion) return true
  if (!wanted) return false
  return existingVersion === wanted
}

function isPendingGameLineRow(row) {
  const status = String(row?.status || '').toLowerCase().trim()
  return !status || status === 'pending'
}

/**
 * Pending legacy `gl-…` NHL (and other private shadow) rows match a
 * new `gl-shadow-…` persist so a re-run updates instead of inserting
 * a second pick. Different model versions stay separate.
 */
export function isReusableShadowGameLineRow(row, line = {}) {
  return isPendingGameLineRow(row) && sameShadowGameLineMarket(row, line)
}

/**
 * Old gl- ids encoded the side. Keep one pending row per game / market /
 * model and void the rest so Over and Under (or both moneylines) cannot
 * both grade.
 */
export function chooseShadowGameLineSurvivor(rows, line = {}) {
  const pending = (Array.isArray(rows) ? rows : []).filter((row) => (
    isReusableShadowGameLineRow(row, line)
  ))
  if (pending.length === 0) return { survivor: null, extras: [] }
  const wanted = String(line.pick || line.prediction || '').trim().toLowerCase()
  const matching = wanted
    ? pending.filter((row) => String(row.prediction || row.pick || '').trim().toLowerCase() === wanted)
    : []
  const pool = matching.length > 0 ? matching : pending
  const survivor = [...pool].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))[0]
  return {
    survivor,
    extras: pending.filter((row) => row.id !== survivor.id),
  }
}

export function duplicateShadowGameLineVoidPatch(row, keptPropId, now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  return {
    result: 'void',
    status: 'manual_closed',
    actualValue: null,
    completedAt: instant.toISOString(),
    notes: withAppendedCohortTag(
      withPreservedCohortNotes(
        row?.notes,
        `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG} | ${SHADOW_GAME_LINE_DUPLICATE_NOTE} — kept ${keptPropId}`,
      ),
      SHADOW_PUBLISHED_COHORT_TAG,
    ),
  }
}

export function isReportableShadowGameLineRecord(row) {
  if (!isShadowGameLineRecord(row)) return false
  const result = String(row?.result || '').toLowerCase().trim()
  const status = String(row?.status || '').toLowerCase().trim()
  if (result === 'void' || result === 'voided') return false
  if (status === 'manual_closed') return false
  return true
}

export function gameLineShadowPersistNotes(existingNotes, line) {
  let notes = withPreservedCohortNotes(existingNotes, SIDES_TOTALS_COHORT_TAG)
  notes = withAppendedCohortTag(notes, SHADOW_PUBLISHED_COHORT_TAG)
  notes = withAppendedCohortTag(notes, modelVersionNotesTag(line?.modelVersion || line?.modelRun))
  notes = withAppendedCohortTag(notes, marketProbNotesTag(line?.marketFairProb))
  if (line?.totalsHeuristic) {
    notes = withAppendedCohortTag(notes, GAME_LINE_TOTALS_HEURISTIC_TAG)
  }
  if (shouldTagNflRegularSeasonFinals(line)) {
    notes = withAppendedCohortTag(notes, NFL_REGULAR_SEASON_FINALS_NOTES_TAG)
  }
  return notes
}

export function shadowGameLineSkip(reason, extra = {}) {
  return { reason, ...extra }
}

function skipFor(game, market, reason, modelVersion) {
  return shadowGameLineSkip(reason, {
    gameId: game?.id || game?.gameId || null,
    market,
    modelVersion: modelVersion || null,
  })
}

function latestOddsByMarket(oddsRows) {
  const latestOdds = {}
  for (const odd of Array.isArray(oddsRows) ? oddsRows : []) {
    const marketKey = odd.market
    if (!latestOdds[marketKey] || new Date(odd.ts) > new Date(latestOdds[marketKey].ts)) {
      latestOdds[marketKey] = odd
    }
  }
  return latestOdds
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function americanPrice(value) {
  const american = toAmericanOdds(normalizeToAmericanOdds(value))
  return Number.isFinite(american) ? american : null
}

function snapshotModelVersion(edge, sport) {
  const payload = parseEdgePayload(edge)
  return edge?.modelRun
    || edge?.modelVersion
    || payload?.modelVersion
    || payload?.modelRun
    || (String(sport).toLowerCase() === 'nfl' ? NFL_SELECTION_MODEL_VERSION : NHL_MODEL_VERSION)
}

function pickFavoredSide(sides) {
  const usable = (Array.isArray(sides) ? sides : []).filter((side) => (
    side
    && Number.isFinite(Number(side.modelProb))
    && Number.isFinite(Number(side.marketProb))
    && Number.isFinite(Number(side.odds))
  ))
  if (usable.length === 0) return null
  let best = null
  for (const side of usable) {
    const gap = Number(side.modelProb) - Number(side.marketProb)
    const candidate = { ...side, gap }
    if (!best || candidate.gap > best.gap) best = candidate
  }
  if (!best || !(best.gap > 0)) return null
  return best
}

function moneylineShadowPick({
  game, sport, modelVersion, homeAbbr, awayAbbr, homeProb, awayProb, quote, extra = {},
}) {
  const homeOdds = americanPrice(quote?.priceHome)
  const awayOdds = americanPrice(quote?.priceAway)
  if (homeOdds == null || awayOdds == null) {
    return { pick: null, skip: GAME_LINE_SKIP_REASONS.NO_ODDS }
  }
  if (!Number.isFinite(homeProb) || !Number.isFinite(awayProb)) {
    return { pick: null, skip: GAME_LINE_SKIP_REASONS.NO_MODEL_PROBABILITY }
  }
  const fair = removeMlVig(homeOdds, awayOdds)
  const favored = pickFavoredSide([
    {
      pick: homeAbbr,
      team: homeAbbr,
      opponent: awayAbbr,
      modelProb: homeProb,
      marketProb: fair?.homeFairProb,
      odds: homeOdds,
    },
    {
      pick: awayAbbr,
      team: awayAbbr,
      opponent: homeAbbr,
      modelProb: awayProb,
      marketProb: fair?.awayFairProb,
      odds: awayOdds,
    },
  ])
  if (!favored) {
    return { pick: null, skip: GAME_LINE_SKIP_REASONS.NO_POSITIVE_EDGE }
  }
  return {
    skip: null,
    pick: {
      gameId: game.id,
      type: 'moneyline',
      pick: favored.pick,
      team: favored.team,
      opponent: favored.opponent,
      homeTeam: homeAbbr,
      awayTeam: awayAbbr,
      threshold: 0,
      edge: favored.gap,
      modelVsMarketGap: favored.gap,
      odds: favored.odds,
      probability: favored.modelProb,
      modelPWin: favored.modelProb,
      marketFairProb: favored.marketProb,
      confidence: 'medium',
      sport,
      status: game.status,
      gameTime: game.date || game.gameTime,
      modelRun: modelVersion,
      modelVersion,
      eligibleForPublic: false,
      shadow: true,
      source: GAME_LINE_SOURCE,
      bookmaker: quote?.book || null,
      ...extra,
    },
  }
}

function totalShadowPick({
  game, sport, modelVersion, homeAbbr, awayAbbr, pOver, pUnder, pPush = 0, quote, extra = {},
}) {
  const line = finiteNumber(quote?.total, quote?.line)
  const overOdds = americanPrice(quote?.priceOver ?? quote?.priceAway)
  const underOdds = americanPrice(quote?.priceUnder ?? quote?.priceHome)
  if (line == null || overOdds == null || underOdds == null) {
    return { pick: null, skip: GAME_LINE_SKIP_REASONS.NO_ODDS }
  }
  if (!Number.isFinite(pOver) || !Number.isFinite(pUnder)) {
    return { pick: null, skip: GAME_LINE_SKIP_REASONS.NO_MODEL_PROBABILITY }
  }
  const fair = removeTotalVig(overOdds, underOdds, line)
  const decisivePush = Number(pPush) || 0
  const overConditional = decisivePush < 1 ? pOver / (1 - decisivePush) : null
  const underConditional = decisivePush < 1 ? pUnder / (1 - decisivePush) : null
  const favored = pickFavoredSide([
    {
      pick: 'over',
      modelProb: overConditional,
      marketProb: fair?.overFairProb,
      odds: overOdds,
    },
    {
      pick: 'under',
      modelProb: underConditional,
      marketProb: fair?.underFairProb,
      odds: underOdds,
    },
  ])
  if (!favored) {
    return { pick: null, skip: GAME_LINE_SKIP_REASONS.NO_POSITIVE_EDGE }
  }
  return {
    skip: null,
    pick: {
      gameId: game.id,
      type: 'total',
      pick: favored.pick,
      team: `${awayAbbr} @ ${homeAbbr}`,
      opponent: null,
      homeTeam: homeAbbr,
      awayTeam: awayAbbr,
      threshold: line,
      edge: favored.gap,
      modelVsMarketGap: favored.gap,
      odds: favored.odds,
      probability: favored.modelProb,
      modelPWin: favored.modelProb,
      marketFairProb: favored.marketProb,
      confidence: 'medium',
      sport,
      status: game.status,
      gameTime: game.date || game.gameTime,
      modelRun: modelVersion,
      modelVersion,
      eligibleForPublic: false,
      shadow: true,
      source: GAME_LINE_SOURCE,
      bookmaker: quote?.book || null,
      ...extra,
    },
  }
}

function nflHeuristicTotalMean(payload) {
  const home = payload?.inputSnapshot?.home
  const away = payload?.inputSnapshot?.away
  const homeFor = finiteNumber(home?.seasonPointsFor, home?.avgPointsLast10)
  const homeAgainst = finiteNumber(home?.seasonPointsAgainst, home?.avgPointsAllowedLast10)
  const awayFor = finiteNumber(away?.seasonPointsFor, away?.avgPointsLast10)
  const awayAgainst = finiteNumber(away?.seasonPointsAgainst, away?.avgPointsAllowedLast10)
  if (![homeFor, homeAgainst, awayFor, awayAgainst].every((value) => Number.isFinite(value))) {
    return null
  }
  return ((homeFor + awayAgainst) / 2) + ((awayFor + homeAgainst) / 2) + NFL_TOTALS_HEURISTIC_HOME_BOOST
}

function nhlPredictedTotal(payload) {
  const homeGf = finiteNumber(payload?.home?.gfPerGame)
  const homeGa = finiteNumber(payload?.home?.gaPerGame)
  const awayGf = finiteNumber(payload?.away?.gfPerGame)
  const awayGa = finiteNumber(payload?.away?.gaPerGame)
  if (![homeGf, homeGa, awayGf, awayGa].every((value) => Number.isFinite(value))) return null
  return ((homeGf + awayGa) / 2) + ((awayGf + homeGa) / 2) + NHL_TOTALS_HEURISTIC_HOME_BOOST
}

function logisticTwoWay(mean, line, sd) {
  if (!Number.isFinite(mean) || !Number.isFinite(line) || !(sd > 0)) return null
  const pOver = 1 / (1 + Math.exp(-((mean - line) / sd) * 1.7))
  return { pOver, pUnder: 1 - pOver, pPush: 0 }
}

function buildNflShadowPicks(game, edge, latestOdds, modelVersion) {
  const picks = []
  const skips = []
  const payload = parseEdgePayload(edge)
  const homeAbbr = game.home?.abbr || 'HOME'
  const awayAbbr = game.away?.abbr || 'AWAY'
  const mark = (market, reason) => skips.push(skipFor(game, market, reason, modelVersion))

  if (isLegacyNflHeuristicVersion(modelVersion) || isLegacyNflHeuristicVersion(edge?.modelRun)) {
    mark('moneyline', GAME_LINE_SKIP_REASONS.LEGACY_MODEL)
    mark('total', GAME_LINE_SKIP_REASONS.LEGACY_MODEL)
    return { picks, skips }
  }
  if (!payload) {
    mark('moneyline', GAME_LINE_SKIP_REASONS.NO_MODEL_PROBABILITY)
    mark('total', GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE)
    return { picks, skips }
  }

  const ml = payload.moneyline
  const homeProb = finiteNumber(ml?.home?.model?.pWin, ml?.model?.pHomeWin)
  const awayProb = finiteNumber(ml?.away?.model?.pWin, ml?.model?.pAwayWin)
  const mlQuote = {
    ...(ml?.quote || {}),
    ...(latestOdds.h2h || {}),
    priceHome: ml?.home?.quote?.americanOdds ?? ml?.quote?.priceHome ?? latestOdds.h2h?.priceHome,
    priceAway: ml?.away?.quote?.americanOdds ?? ml?.quote?.priceAway ?? latestOdds.h2h?.priceAway,
    book: ml?.quote?.book || latestOdds.h2h?.book || null,
  }
  if (!Number.isFinite(homeProb) || !Number.isFinite(awayProb)) {
    mark('moneyline', ml?.eligibility?.reason || ml?.reason || GAME_LINE_SKIP_REASONS.NO_MODEL_PROBABILITY)
  } else {
    const built = moneylineShadowPick({
      game,
      sport: 'nfl',
      modelVersion,
      homeAbbr,
      awayAbbr,
      homeProb,
      awayProb,
      quote: mlQuote,
      extra: {
        regularSeasonFinals: payload?.inputSnapshot?.regularSeasonFinals === true,
      },
    })
    if (built.pick) picks.push(built.pick)
    else mark('moneyline', built.skip)
  }

  const totals = payload.totals
  const totalsQuote = {
    ...(totals?.quote || {}),
    ...(latestOdds.totals || {}),
    total: finiteNumber(totals?.quote?.line, totals?.quote?.total, latestOdds.totals?.total),
    priceOver: totals?.over?.quote?.americanOdds ?? totals?.quote?.priceOver ?? latestOdds.totals?.priceAway,
    priceUnder: totals?.under?.quote?.americanOdds ?? totals?.quote?.priceUnder ?? latestOdds.totals?.priceHome,
    priceAway: totals?.over?.quote?.americanOdds ?? latestOdds.totals?.priceAway,
    priceHome: totals?.under?.quote?.americanOdds ?? latestOdds.totals?.priceHome,
    book: totals?.quote?.book || latestOdds.totals?.book || null,
  }
  const storedOver = finiteNumber(totals?.over?.model?.pWin)
  const storedUnder = finiteNumber(totals?.under?.model?.pWin)
  let pOver = storedOver
  let pUnder = storedUnder
  let pPush = finiteNumber(totals?.over?.model?.pPush, totals?.model?.pPush) || 0
  let totalsHeuristic = !(Number.isFinite(storedOver) && Number.isFinite(storedUnder))

  if (totalsHeuristic) {
    const mean = nflHeuristicTotalMean(payload)
    const line = finiteNumber(totalsQuote.total)
    if (line == null) {
      mark('total', GAME_LINE_SKIP_REASONS.NO_ODDS)
      return { picks, skips }
    }
    if (mean == null) {
      mark('total', GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE)
      return { picks, skips }
    }
    const dist = nflTotalOutcomeProbabilities({
      mean,
      variance: NFL_TOTALS_HEURISTIC_VARIANCE,
      line,
    })
    if (!dist.ok) {
      mark('total', dist.reason || GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE)
      return { picks, skips }
    }
    pOver = dist.pOver
    pUnder = dist.pUnder
    pPush = dist.pPush
  }

  const builtTotal = totalShadowPick({
    game,
    sport: 'nfl',
    modelVersion,
    homeAbbr,
    awayAbbr,
    pOver,
    pUnder,
    pPush,
    quote: totalsQuote,
    extra: {
      totalsHeuristic,
      regularSeasonFinals: payload?.inputSnapshot?.regularSeasonFinals === true,
    },
  })
  if (builtTotal.pick) picks.push(builtTotal.pick)
  else mark('total', builtTotal.skip)
  return { picks, skips }
}

function buildNhlShadowPicks(game, edge, latestOdds, modelVersion) {
  const picks = []
  const skips = []
  const payload = parseEdgePayload(edge) || {}
  const homeAbbr = game.home?.abbr || 'HOME'
  const awayAbbr = game.away?.abbr || 'AWAY'
  const mark = (market, reason) => skips.push(skipFor(game, market, reason, modelVersion))

  if (isLegacyNhlHeuristicSnapshot(edge, 'nhl')) {
    mark('moneyline', GAME_LINE_SKIP_REASONS.LEGACY_MODEL)
    mark('total', GAME_LINE_SKIP_REASONS.LEGACY_MODEL)
    return { picks, skips }
  }

  const homeProb = finiteNumber(payload.rawModelProb)
  const awayProb = Number.isFinite(homeProb) ? 1 - homeProb : null
  const builtMl = moneylineShadowPick({
    game,
    sport: 'nhl',
    modelVersion,
    homeAbbr,
    awayAbbr,
    homeProb,
    awayProb,
    quote: latestOdds.h2h || {},
  })
  if (builtMl.pick) picks.push(builtMl.pick)
  else mark('moneyline', builtMl.skip)

  const predicted = nhlPredictedTotal(payload)
  const line = finiteNumber(latestOdds.totals?.total, latestOdds.totals?.line)
  if (line == null) {
    mark('total', GAME_LINE_SKIP_REASONS.NO_ODDS)
    return { picks, skips }
  }
  if (predicted == null) {
    mark('total', GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE)
    return { picks, skips }
  }
  const dist = logisticTwoWay(predicted, line, NHL_TOTALS_HEURISTIC_SD)
  if (!dist) {
    mark('total', GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE)
    return { picks, skips }
  }
  const builtTotal = totalShadowPick({
    game,
    sport: 'nhl',
    modelVersion,
    homeAbbr,
    awayAbbr,
    pOver: dist.pOver,
    pUnder: dist.pUnder,
    pPush: dist.pPush,
    quote: latestOdds.totals || {},
    extra: { totalsHeuristic: true },
  })
  if (builtTotal.pick) picks.push(builtTotal.pick)
  else mark('total', builtTotal.skip)
  return { picks, skips }
}

/**
 * Private lock-time builder. Ignores eligibleForPublic and the 5% floor.
 * Still refuses live/final games, legacy models, and markets with no
 * model probability or no two-way quote.
 */
export function inspectGameLineShadowSnapshot({
  game,
  edge,
  oddsRows = [],
  now = new Date(),
} = {}) {
  if (!game) {
    return { picks: [], skips: [shadowGameLineSkip(GAME_LINE_SKIP_REASONS.NO_ACTIVE_GAMES)] }
  }
  const sport = String(game.sport || '').toLowerCase()
  const modelVersion = snapshotModelVersion(edge, sport)
  if (!isGameLineShadowSport(sport) || !isRecordedGameLineSport(sport)) {
    return {
      picks: [],
      skips: [skipFor(game, 'line', GAME_LINE_SKIP_REASONS.UNPUBLISHED, modelVersion)],
    }
  }
  const upcomingRecord = {
    ...game,
    sport,
    gameTime: game.date || game.gameTime,
    status: game.status,
  }
  if (!isUpcomingGameLine(upcomingRecord, now)) {
    return {
      picks: [],
      skips: [skipFor(game, 'line', GAME_LINE_SKIP_REASONS.LOCK_TIME, modelVersion)],
    }
  }
  if (!edge) {
    return {
      picks: [],
      skips: [skipFor(game, 'line', GAME_LINE_SKIP_REASONS.NO_EDGE_SNAPSHOT, modelVersion)],
    }
  }
  if (!Array.isArray(oddsRows) || oddsRows.length === 0) {
    return {
      picks: [],
      skips: [
        skipFor(game, 'moneyline', GAME_LINE_SKIP_REASONS.NO_ODDS, modelVersion),
        skipFor(game, 'total', GAME_LINE_SKIP_REASONS.NO_ODDS, modelVersion),
      ],
    }
  }

  const latestOdds = latestOddsByMarket(oddsRows)
  if (sport === 'nfl') return buildNflShadowPicks(game, edge, latestOdds, modelVersion)
  return buildNhlShadowPicks(game, edge, latestOdds, modelVersion)
}

export function buildGameLineShadowPicksFromSnapshots(args) {
  return inspectGameLineShadowSnapshot(args).picks
}

function closingOddsGameId(row) {
  return row?.game_id ?? row?.gameId ?? null
}

function closingOddsMarket(row) {
  return String(row?.market || '').toLowerCase().trim()
}

function teamAbbr(value) {
  return String(value || '').toUpperCase().trim()
}

function moneylineClosePrice(row, pick, game) {
  const prediction = teamAbbr(pick?.prediction || pick?.pick)
  const home = teamAbbr(game?.home?.abbr || pick?.homeTeam)
  const away = teamAbbr(game?.away?.abbr || pick?.awayTeam)
  if (!prediction) return null
  if (prediction === home) return finiteNumber(row?.price_home, row?.priceHome)
  if (prediction === away) return finiteNumber(row?.price_away, row?.priceAway)
  return null
}

function totalClosePrice(row, pick) {
  const side = String(pick?.prediction || pick?.pick || '').toLowerCase().trim()
  const prices = closingTotalOverUnderPrices(row)
  if (side === 'over') return Number.isFinite(prices.over) ? prices.over : null
  if (side === 'under') return Number.isFinite(prices.under) ? prices.under : null
  return null
}

function usableCloseRows(rows, pick, game) {
  const gameId = String(pick?.gameIdRef || pick?.gameId || '')
  const type = gameLineMarketType(pick)
  const market = type === 'total' ? 'totals' : 'h2h'
  const line = type === 'total' ? Number(pick?.threshold) : null
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (String(closingOddsGameId(row) || '') !== gameId) return false
    if (!isCloseCaptureTaggedId(row?.id)) return false
    if (isAttemptedClosingOddsBook(row?.book)) return false
    if (closingOddsMarket(row) !== market) return false
    if (type === 'total') {
      const closeLine = finiteNumber(row?.total)
      if (closeLine == null || closeLine !== line) return false
    }
    const odds = type === 'total' ? totalClosePrice(row, pick) : moneylineClosePrice(row, pick, game)
    return Number.isFinite(odds)
  })
}

/**
 * Same-line consensus close from already-stored clvclose: ClosingOdds
 * rows. No Odds API. Moved totals are left unmatched so a later capture
 * can retry.
 */
export function matchShadowGameLineClosingOdds(pick, rows, game) {
  const type = gameLineMarketType(pick)
  if (!type) return null
  const usable = usableCloseRows(rows, pick, game)
  if (usable.length === 0) return null
  const quotes = usable.map((row) => ({
    odds: type === 'total' ? totalClosePrice(row, pick) : moneylineClosePrice(row, pick, game),
    book: row.book,
    threshold: type === 'total' ? finiteNumber(row.total) : 0,
    market: closingOddsMarket(row),
  }))
  const consensus = consensusClosingQuote(quotes)
  if (!consensus) return null
  const books = new Set(quotes.map((quote) => quote.book).filter(Boolean))
  return {
    ...consensus,
    threshold: type === 'total' ? Number(pick.threshold) : 0,
    numBooks: books.size || null,
    sameLine: true,
  }
}

export function shadowGameLineClosePatch(pick, rows, game, now = new Date()) {
  const quote = matchShadowGameLineClosingOdds(pick, rows, game)
  if (!quote) return null
  return closeCapturePayload(quote, now)
}

function indexGames(games) {
  const map = new Map()
  for (const game of games || []) {
    if (game?.id) map.set(String(game.id), game)
  }
  return map
}

export async function loadShadowGameLineClosingOdds(supabase, gameIds) {
  const ids = [...new Set((gameIds || []).filter(Boolean))]
  if (!ids.length) return { rows: [], error: null }
  const { data, error } = await supabase
    .from('ClosingOdds')
    .select(GAME_LINE_SHADOW_CLOSING_ODDS_SELECT)
    .in('game_id', ids)
  if (error) return { rows: [], error }
  return { rows: data || [], error: null }
}

/**
 * Write PropValidation closeOdds from stored clvclose: rows. Idempotent:
 * rows that already have a close are left alone unless overwrite is set.
 */
export async function attachShadowGameLineCloses({
  supabase,
  picks,
  closingOddsRows,
  games = [],
  now = new Date(),
  apply = true,
  overwrite = false,
  log = console,
} = {}) {
  const gamesById = indexGames(games)
  const attached = []
  for (const pick of picks || []) {
    if (!isShadowGameLineRecord(pick) && pick?.shadow !== true) {
      if (String(pick?.source || '') !== GAME_LINE_SOURCE) continue
      if (!isPrivateShadowPublished(pick)) continue
    }
    if (!overwrite && hasCloseAlready(pick)) continue
    const game = gamesById.get(String(pick.gameIdRef || pick.gameId)) || null
    const patch = shadowGameLineClosePatch(pick, closingOddsRows, game, now)
    if (!patch) {
      log?.log?.(`  skip close ${pick.id || pick.propId}: no same-line clvclose`)
      continue
    }
    if (!apply) {
      log?.log?.(`  dry-run close ${pick.id || pick.propId} ${pick.propType} → ${patch.closeOdds}`)
      attached.push({ id: pick.id, ...patch, dryRun: true })
      continue
    }
    const write = await updateWithOptionalCloseOdds(
      (body) => applyPublishedCloseUpdate(
        supabase.from('PropValidation'),
        pick.id,
        body,
        { overwrite },
      ),
      patch,
    )
    if (write?.error) {
      log?.error?.(`  ❌ close ${pick.id}: ${write.error.message}`)
      continue
    }
    const written = Array.isArray(write.data) ? write.data.length : (write.data ? 1 : 0)
    if (written === 0) {
      log?.log?.(`  skipped ${pick.id} already captured`)
      continue
    }
    attached.push({ id: pick.id, ...patch })
    log?.log?.(`  ✅ close ${pick.id} ${pick.propType} ${pick.odds} → ${patch.closeOdds}`)
  }
  return attached
}
