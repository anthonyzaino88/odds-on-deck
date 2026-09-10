/**
 * Budgeted Odds API historical CLV pilot for NFL h2h + totals.
 *
 * Research only. Writes local JSON/CSV/markdown. Does not write
 * production Supabase, regrade picks, merge, or flip eligibleForPublic.
 *
 * Credit rules (HARD):
 *   - us + h2h,totals = 20 credits per historical slate snapshot
 *   - hard cap 3000; plan ≤ 140 snapshots (default 36 = 18 weeks × 2)
 *   - abort before a call that would exceed the cap
 */

import { CROSS_BOOK_CONSTRAINTS, evaluateSnapshot, flattenQuotes, flattenSides } from './nfl-cross-book-sides.js'
import {
  DEFAULT_EXPECTED_SNAPSHOT_COST,
  DEFAULT_HISTORICAL_MARKETS,
  DEFAULT_HISTORICAL_REGIONS,
  HARD_CREDIT_CAP,
  PLANNED_SNAPSHOT_MARGIN_MAX,
  createCreditGuard,
  expectedHistoricalOddsCost,
  guardedFetch,
  redactOddsApiUrl,
  summarizeGuard,
} from './odds-api-credit-guard.js'
import { parseNflverseGames } from './nflverse-games-study.js'

export const CLV_PILOT_PUBLIC_ELIGIBLE = false
export const CLV_PILOT_WRITES_PRODUCTION_DB = false
export const CLV_PILOT_REGRADES_PICKS = false
export const CLV_PILOT_MERGES = false

export const CLV_PILOT_CONSTRAINTS = Object.freeze({
  eligibleForPublic: CLV_PILOT_PUBLIC_ELIGIBLE,
  writesProductionDb: CLV_PILOT_WRITES_PRODUCTION_DB,
  usesOddsApi: true,
  regradesPicks: CLV_PILOT_REGRADES_PICKS,
  merges: CLV_PILOT_MERGES,
  hardCreditCap: HARD_CREDIT_CAP,
})

export const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
export const CLV_SPORT = 'americanfootball_nfl'
export const CLV_SEASON = 2024
export const CLV_SEASON_TYPE = 'REG'
export const CLV_WEEK_COUNT = 18
export const DEFAULT_MAX_SNAPSHOTS = 36
export const S1_MIN_PRICE_GAP = 0.03
export const S1_MIN_BOOKS = 3

export const NFL_TEAM_NAME_TO_ABBR = Object.freeze({
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV',
  'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LA',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WAS',
  'Washington Football Team': 'WAS',
  'Washington Redskins': 'WAS',
})

const WEEK1_SUNDAY_UTC = Date.UTC(2024, 8, 8)

export function nfl2024WeekSundayUtc(week) {
  return new Date(WEEK1_SUNDAY_UTC + (week - 1) * 7 * 24 * 60 * 60 * 1000)
}

export function isoUtc(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function build2024RegSnapshotPlan({
  maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
  weeks = null,
} = {}) {
  const weekList = weeks && weeks.length
    ? weeks
    : Array.from({ length: CLV_WEEK_COUNT }, (_, i) => i + 1)
  const planned = []
  for (const week of weekList) {
    if (!Number.isInteger(week) || week < 1 || week > CLV_WEEK_COUNT) continue
    const sunday = nfl2024WeekSundayUtc(week)
    const early = new Date(sunday.getTime() - 5 * 24 * 60 * 60 * 1000)
    early.setUTCHours(18, 0, 0, 0)
    const late = new Date(sunday.getTime())
    late.setUTCHours(16, 55, 0, 0)
    planned.push({
      snapshotId: `2024_W${String(week).padStart(2, '0')}_early`,
      week,
      season: CLV_SEASON,
      seasonType: CLV_SEASON_TYPE,
      phase: 'early',
      date: isoUtc(early),
    })
    planned.push({
      snapshotId: `2024_W${String(week).padStart(2, '0')}_late`,
      week,
      season: CLV_SEASON,
      seasonType: CLV_SEASON_TYPE,
      phase: 'late',
      date: isoUtc(late),
    })
  }

  const capped = planned.slice(0, Math.min(maxSnapshots, PLANNED_SNAPSHOT_MARGIN_MAX))
  const expectedCostEach = expectedHistoricalOddsCost({
    regions: DEFAULT_HISTORICAL_REGIONS,
    markets: DEFAULT_HISTORICAL_MARKETS,
  })
  return {
    sport: CLV_SPORT,
    regions: DEFAULT_HISTORICAL_REGIONS,
    markets: DEFAULT_HISTORICAL_MARKETS,
    season: CLV_SEASON,
    seasonType: CLV_SEASON_TYPE,
    maxSnapshots: Math.min(maxSnapshots, PLANNED_SNAPSHOT_MARGIN_MAX),
    snapshotCount: capped.length,
    expectedCostEach,
    expectedCostTotal: capped.length * expectedCostEach,
    hardCap: HARD_CREDIT_CAP,
    snapshots: capped,
    notes: [
      'Early = Tuesday 18:00 UTC of that NFL week (after MNF, before TNF).',
      'Late = Sunday 16:55 UTC (12:55 PM ET), near the main Sunday kickoff window.',
      'Thursday / Saturday games often drop off the Sunday slate snapshot; those have early quotes only.',
      'Weekly slate endpoint (not per-event) so one 20-credit call covers the week.',
    ],
  }
}

export function historicalOddsUrl({ apiKey, date, regions = DEFAULT_HISTORICAL_REGIONS, markets = DEFAULT_HISTORICAL_MARKETS }) {
  const params = new URLSearchParams({
    apiKey: apiKey || '',
    regions,
    markets,
    oddsFormat: 'american',
    dateFormat: 'iso',
    date,
  })
  return `${ODDS_API_BASE}/historical/sports/${CLV_SPORT}/odds?${params.toString()}`
}

export function sportsCatalogUrl(apiKey) {
  const params = new URLSearchParams({ apiKey: apiKey || '' })
  return `${ODDS_API_BASE}/sports?${params.toString()}`
}

export function teamAbbr(name) {
  if (!name) return null
  if (NFL_TEAM_NAME_TO_ABBR[name]) return NFL_TEAM_NAME_TO_ABBR[name]
  const upper = String(name).trim().toUpperCase()
  if (Object.values(NFL_TEAM_NAME_TO_ABBR).includes(upper)) return upper
  return null
}

export function joinNflverseResult(eventEval, games) {
  const home = teamAbbr(eventEval.homeTeam)
  const away = teamAbbr(eventEval.awayTeam)
  const day = eventEval.commenceTime ? eventEval.commenceTime.slice(0, 10) : null
  const match = (games || []).find((game) => {
    if (game.homeTeam !== home || game.awayTeam !== away) return false
    if (day && game.gameday && game.gameday !== day) {
      const commence = Date.parse(eventEval.commenceTime)
      const gameday = Date.parse(`${game.gameday}T00:00:00Z`)
      if (!Number.isFinite(commence) || !Number.isFinite(gameday)) return false
      return Math.abs(commence - gameday) <= 2 * 24 * 60 * 60 * 1000
    }
    return true
  })
  if (!match || !match.completed) return null
  return {
    gameId: match.gameId,
    gameday: match.gameday,
    week: match.week,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    total: match.total,
    homeWon: match.homeScore > match.awayScore,
    awayWon: match.awayScore > match.homeScore,
    tie: match.homeScore === match.awayScore,
  }
}

export function gradeSide(sideRow, result) {
  if (!result) return { outcome: null, profit: null }
  if (sideRow.market === 'h2h') {
    if (result.tie) return { outcome: 'push', profit: 0 }
    const won = sideRow.side === 'home' ? result.homeWon : result.awayWon
    if (won) return { outcome: 'win', profit: sideRow.bestDecimalOdds - 1 }
    return { outcome: 'loss', profit: -1 }
  }
  if (sideRow.market === 'totals' && Number.isFinite(sideRow.line) && Number.isFinite(result.total)) {
    if (result.total === sideRow.line) return { outcome: 'push', profit: 0 }
    const overHit = result.total > sideRow.line
    const won = sideRow.side === 'over' ? overHit : !overHit
    if (won) return { outcome: 'win', profit: sideRow.bestDecimalOdds - 1 }
    return { outcome: 'loss', profit: -1 }
  }
  return { outcome: null, profit: null }
}

export function pairEarlyLate(sideRows) {
  const byKey = new Map()
  for (const row of sideRows) {
    if (!row.eventId || !row.market || !row.side) continue
    const linePart = row.market === 'totals' && row.line != null ? String(row.line) : ''
    const key = `${row.eventId}|${row.market}|${row.side}|${linePart}`
    const entry = byKey.get(key) || { key, early: null, late: null }
    if (row.phase === 'early') entry.early = row
    if (row.phase === 'late') entry.late = row
    byKey.set(key, entry)
  }
  return [...byKey.values()]
}

export function clvFromPair(early, late) {
  if (!early?.ok || !late?.ok) return null
  if (!Number.isFinite(late.consensusFair) || !Number.isFinite(early.bestImplied)) return null
  const clvRelative = (late.consensusFair - early.bestImplied) / late.consensusFair
  const clvPp = late.consensusFair - early.bestImplied
  return { clvRelative, clvPp }
}

export function selectedByS1(early) {
  return Boolean(
    early?.ok
    && Number.isFinite(early.priceGap)
    && early.priceGap >= S1_MIN_PRICE_GAP
    && (early.numBooks || 0) >= S1_MIN_BOOKS,
  )
}

function finiteMean(values) {
  const nums = values.filter((v) => Number.isFinite(v))
  if (!nums.length) return null
  return nums.reduce((sum, v) => sum + v, 0) / nums.length
}

function summarizeBets(rows) {
  const graded = rows.filter((row) => row.outcome != null)
  const n = graded.length
  const wins = graded.filter((row) => row.outcome === 'win').length
  const losses = graded.filter((row) => row.outcome === 'loss').length
  const pushes = graded.filter((row) => row.outcome === 'push').length
  const profit = graded.reduce((sum, row) => sum + (Number.isFinite(row.profit) ? row.profit : 0), 0)
  return {
    n,
    wins,
    losses,
    pushes,
    profit,
    roi: n ? profit / n : null,
    meanClv: finiteMean(graded.map((row) => row.clvRelative)),
    meanClvPp: finiteMean(graded.map((row) => row.clvPp)),
  }
}

export function computeClvReport({
  evaluations = [],
  nflverseGames = [],
  credit = null,
  plan = null,
  mode = 'fixture',
} = {}) {
  const quoteRows = evaluations.flatMap((evaluation, i) => flattenQuotes(evaluation, {
    snapshotId: evaluation.snapshotId || `snap_${i}`,
  }))
  const sideRows = evaluations.flatMap((evaluation, i) => flattenSides(evaluation, {
    snapshotId: evaluation.snapshotId || `snap_${i}`,
  }))

  const pairs = pairEarlyLate(sideRows).map((pair) => {
    const clv = clvFromPair(pair.early, pair.late)
    const result = joinNflverseResult(pair.early || pair.late, nflverseGames)
    const selected = selectedByS1(pair.early)
    const graded = selected && pair.early && pair.late
      ? gradeSide(pair.early, result)
      : { outcome: null, profit: null }
    const persistence = pair.early?.ok && pair.late?.ok
      ? {
        earlyPositive: pair.early.priceGap > 0,
        latePositive: pair.late.priceGap > 0,
        gapDelta: Number.isFinite(pair.late.priceGap) && Number.isFinite(pair.early.priceGap)
          ? pair.late.priceGap - pair.early.priceGap
          : null,
      }
      : null
    return {
      key: pair.key,
      eventId: pair.early?.eventId || pair.late?.eventId,
      homeTeam: pair.early?.homeTeam || pair.late?.homeTeam,
      awayTeam: pair.early?.awayTeam || pair.late?.awayTeam,
      market: pair.early?.market || pair.late?.market,
      side: pair.early?.side || pair.late?.side,
      line: pair.early?.line ?? pair.late?.line ?? null,
      early: pair.early,
      late: pair.late,
      clvRelative: clv?.clvRelative ?? null,
      clvPp: clv?.clvPp ?? null,
      selectedS1: selected && Boolean(pair.late),
      result,
      outcome: graded.outcome,
      profit: graded.profit,
      persistence,
    }
  })

  const paired = pairs.filter((row) => row.early?.ok && row.late?.ok)
  const selected = pairs.filter((row) => row.selectedS1)
  const earlyOnly = pairs.filter((row) => row.early?.ok && !row.late?.ok)
  const persistedPositive = paired.filter((row) => row.persistence?.earlyPositive)
  const stillPositive = persistedPositive.filter((row) => row.persistence?.latePositive)

  return {
    generatedAt: new Date().toISOString(),
    mode,
    constraints: {
      ...CLV_PILOT_CONSTRAINTS,
      eligibleForPublic: false,
    },
    preRegisteredRule: {
      id: 'S1',
      description: '1 unit on the early best-book side when price_gap >= 3% and numBooks >= 3, graded vs nflverse result, using early best decimal odds.',
      minPriceGap: S1_MIN_PRICE_GAP,
      minBooks: S1_MIN_BOOKS,
      stake: 1,
      profit: 'win = decimalOdds - 1; loss = -1; push = 0',
    },
    plan: plan
      ? {
        snapshotCount: plan.snapshotCount,
        expectedCostTotal: plan.expectedCostTotal,
        hardCap: plan.hardCap,
        season: plan.season,
        seasonType: plan.seasonType,
      }
      : null,
    credit: credit ? summarizeGuard(credit) : null,
    sample: {
      snapshots: evaluations.length,
      quoteRows: quoteRows.length,
      sideRows: sideRows.length,
      pairedSides: paired.length,
      earlyOnlySides: earlyOnly.length,
      selectedS1: selected.length,
      selectedS1Graded: selected.filter((row) => row.outcome != null).length,
      nflverseJoined: pairs.filter((row) => row.result).length,
    },
    clvAllPaired: {
      n: paired.length,
      meanClv: finiteMean(paired.map((row) => row.clvRelative)),
      meanClvPp: finiteMean(paired.map((row) => row.clvPp)),
    },
    gapPersistence: {
      nEarlyPositive: persistedPositive.length,
      nStillPositiveAtClose: stillPositive.length,
      fraction: persistedPositive.length ? stillPositive.length / persistedPositive.length : null,
      meanGapDelta: finiteMean(paired.map((row) => row.persistence?.gapDelta)),
    },
    ruleS1: summarizeBets(selected),
    pairs,
    quoteRows,
    sideRows,
  }
}

export function toCsv(rows) {
  if (!rows.length) return ''
  const columns = Object.keys(rows[0])
  const escape = (value) => {
    if (value == null) return ''
    if (typeof value === 'object') return JSON.stringify(value).replaceAll('"', '""')
    const text = String(value)
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
    return text
  }
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(',')),
  ].join('\n')
}

export function slimPair(pair) {
  return {
    eventId: pair.eventId,
    homeTeam: pair.homeTeam,
    awayTeam: pair.awayTeam,
    market: pair.market,
    side: pair.side,
    line: pair.line,
    earlyGap: pair.early?.priceGap ?? null,
    lateGap: pair.late?.priceGap ?? null,
    earlyBestBook: pair.early?.bestBook ?? null,
    earlyBestAmerican: pair.early?.bestAmericanOdds ?? null,
    clvRelative: pair.clvRelative,
    selectedS1: pair.selectedS1,
    outcome: pair.outcome,
    profit: pair.profit,
    nflverseGameId: pair.result?.gameId ?? null,
  }
}

export function renderClvMarkdown(report) {
  const credit = report.credit
  const s1 = report.ruleS1
  const fmt = (value, digits = 4) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a')
  const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a')

  return `# NFL historical CLV pilot (research only)

**Not a public-board switch. \`eligibleForPublic\` stays false.**

This artifact is a budgeted Odds API historical pull plus a model-free cross-book price-gap evaluator. It does **not** write production Supabase, regrade picks, merge, or enable live NFL moneyline / totals.

| Constraint | Value |
| --- | --- |
| \`eligibleForPublic\` | \`false\` |
| Production DB writes | \`false\` |
| Regrade picks | \`false\` |
| Merge | \`false\` |
| Hard credit cap | \`${HARD_CREDIT_CAP}\` |
| Mode | \`${report.mode}\` |

Generated at: \`${report.generatedAt}\`

## Credit spend

| Field | Value |
| --- | --- |
| Spent | \`${credit?.spent ?? 'n/a'}\` |
| Remaining (API) | \`${credit?.remaining ?? 'n/a'}\` |
| Hard cap | \`${credit?.hardCap ?? HARD_CREDIT_CAP}\` |
| Calls | \`${credit?.calls ?? 0}\` |
| Aborted | \`${credit?.aborted ?? false}\` |
| Abort reason | ${credit?.abortReason ? `\`${credit.abortReason}\`` : 'none'} |
| Planned snapshots | \`${report.plan?.snapshotCount ?? 'n/a'}\` |
| Planned cost | \`${report.plan?.expectedCostTotal ?? 'n/a'}\` |

If mode is \`dry-run\` or \`fixture\`, spent is 0 and no Odds API historical credits were used.

## Pre-registered rule S1

${report.preRegisteredRule.description}

- Minimum relative price gap: **${S1_MIN_PRICE_GAP}**
- Minimum books: **${S1_MIN_BOOKS}**
- Stake: **1 unit**
- Profit: ${report.preRegisteredRule.profit}

Do not retune the threshold after seeing results. This is not a predictive model.

## Sample

| Count | n |
| --- | --- |
| Snapshots evaluated | ${report.sample.snapshots} |
| Quote rows | ${report.sample.quoteRows} |
| Side rows | ${report.sample.sideRows} |
| Paired early/late sides | ${report.sample.pairedSides} |
| Early-only sides (no Sunday close) | ${report.sample.earlyOnlySides} |
| S1 selections | ${report.sample.selectedS1} |
| S1 graded vs nflverse | ${report.sample.selectedS1Graded} |
| Rows joined to nflverse | ${report.sample.nflverseJoined} |

## CLV (early best price vs closing fair)

CLV relative = \`(late_consensus_fair − early_best_implied) / late_consensus_fair\`. Same shape as the prop price-gap formula, with the close standing in for consensus.

| Set | n | Mean CLV (relative) | Mean CLV (pp) |
| --- | --- | --- | --- |
| All paired sides | ${report.clvAllPaired.n} | ${fmt(report.clvAllPaired.meanClv)} | ${fmt(report.clvAllPaired.meanClvPp)} |
| Rule S1 | ${s1.n} | ${fmt(s1.meanClv)} | ${fmt(s1.meanClvPp)} |

## Rule S1 ROI

| Metric | Value |
| --- | --- |
| n | ${s1.n} |
| Wins | ${s1.wins} |
| Losses | ${s1.losses} |
| Pushes | ${s1.pushes} |
| Profit (units) | ${fmt(s1.profit, 3)} |
| ROI | ${pct(s1.roi)} |

## Cross-book gap persistence

Among paired sides whose **early** price gap was positive, the fraction that were still positive at the late snapshot.

| Metric | Value |
| --- | --- |
| Early +gap sides | ${report.gapPersistence.nEarlyPositive} |
| Still +gap at close | ${report.gapPersistence.nStillPositiveAtClose} |
| Persistence fraction | ${fmt(report.gapPersistence.fraction)} |
| Mean gap change (late − early) | ${fmt(report.gapPersistence.meanGapDelta)} |

## What this is not

- Not a public NFL board enable.
- Not a claim that price gaps are +EV.
- Not the nfl-selection-v1.0.1 model (that path stays dark and separate).
- Not MLB / NHL / props production behavior.

Ask before enabling live ML/totals. Stay dark unless an independent candidate honestly beats the close on a pre-registered rule with a real sample.

## How this run was produced

\`\`\`bash
# 0 credits
node scripts/research/nfl-historical-clv-pilot.js --dry-run
node scripts/research/nfl-historical-clv-pilot.js --fixture

# Live (hard cap 3000)
ODDS_API_KEY=your_key node scripts/research/nfl-historical-clv-pilot.js --live --nflverse /path/to/games.csv
\`\`\`

Early = Tuesday 18:00 UTC; late = Sunday 16:55 UTC. Region \`us\`, markets \`h2h,totals\`, 20 credits per slate snapshot. See \`docs/research/nfl-cross-book-sides.md\` for the price-gap formula.
`
}

export function parsePilotArgs(argv = []) {
  const args = {
    help: false,
    dryRun: false,
    live: false,
    fixture: null,
    out: 'scripts/research/out/nfl-historical-clv-pilot',
    report: 'docs/research/nfl-historical-clv-pilot-run.md',
    nflverse: null,
    maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
    maxCredits: HARD_CREDIT_CAP,
    weeks: null,
    resume: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    const next = () => argv[++i]
    if (token === '--help' || token === '-h') args.help = true
    else if (token === '--dry-run') args.dryRun = true
    else if (token === '--live') args.live = true
    else if (token === '--no-resume') args.resume = false
    else if (token === '--fixture') {
      const peek = argv[i + 1]
      if (peek && !String(peek).startsWith('--')) args.fixture = next()
      else args.fixture = true
    }
    else if (token === '--out') args.out = next()
    else if (token === '--report') args.report = next()
    else if (token === '--nflverse') args.nflverse = next()
    else if (token === '--max-snapshots') args.maxSnapshots = Number(next())
    else if (token === '--max-credits') args.maxCredits = Number(next())
    else if (token === '--weeks') {
      const raw = String(next() || '')
      args.weeks = raw.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n))
    }
  }

  if (!args.live && !args.fixture) args.dryRun = true
  if (!Number.isFinite(args.maxSnapshots) || args.maxSnapshots < 1) args.maxSnapshots = DEFAULT_MAX_SNAPSHOTS
  args.maxSnapshots = Math.min(args.maxSnapshots, PLANNED_SNAPSHOT_MARGIN_MAX)
  if (!Number.isFinite(args.maxCredits) || args.maxCredits < 0) args.maxCredits = HARD_CREDIT_CAP
  args.maxCredits = Math.min(args.maxCredits, HARD_CREDIT_CAP)
  return args
}

export async function probeQuota(guard, { apiKey, fetchImpl = globalThis.fetch } = {}) {
  const url = sportsCatalogUrl(apiKey)
  const response = await guardedFetch(guard, url, {
    expectedCost: 0,
    fetchImpl,
    snapshotId: 'quota_probe_sports',
  })
  return {
    ok: response.ok,
    status: response.status,
    url: redactOddsApiUrl(url),
    remaining: guard.remaining,
    spent: guard.spent,
  }
}

export async function fetchHistoricalSnapshot(guard, snapshot, {
  apiKey,
  fetchImpl = globalThis.fetch,
  regions = DEFAULT_HISTORICAL_REGIONS,
  markets = DEFAULT_HISTORICAL_MARKETS,
} = {}) {
  const expectedCost = expectedHistoricalOddsCost({ regions, markets }) || DEFAULT_EXPECTED_SNAPSHOT_COST
  const url = historicalOddsUrl({ apiKey, date: snapshot.date, regions, markets })
  const response = await guardedFetch(guard, url, {
    expectedCost,
    fetchImpl,
    snapshotId: snapshot.snapshotId,
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { parseError: true, textPreview: String(text).slice(0, 500) }
  }
  return {
    ok: response.ok,
    status: response.status,
    snapshot,
    url: redactOddsApiUrl(url),
    body,
    credit: summarizeGuard(guard),
  }
}

export function evaluateFetchedSnapshot(fetched) {
  const evaluation = evaluateSnapshot(fetched.body, {
    snapshotTs: fetched.body?.timestamp || fetched.snapshot.date,
    phase: fetched.snapshot.phase,
  })
  evaluation.snapshotId = fetched.snapshot.snapshotId
  evaluation.week = fetched.snapshot.week
  evaluation.requestDate = fetched.snapshot.date
  evaluation.httpStatus = fetched.status
  return evaluation
}

export function loadNflverseGames(csvText) {
  if (!csvText) return []
  return parseNflverseGames(csvText).filter((game) => (
    game.season === CLV_SEASON && game.gameType === CLV_SEASON_TYPE
  ))
}

export function createPilotGuard(args = {}) {
  return createCreditGuard({
    hardCap: Math.min(args.maxCredits ?? HARD_CREDIT_CAP, HARD_CREDIT_CAP),
  })
}
