import {
  assertNoLookAhead,
  etFoldKey,
  formatBacktestReport,
  noVigPair,
  pickLockTime,
  selectCloseQuote,
  summarizeBacktest,
  walkForwardBacktest,
} from '../../lib/game-line-backtest.js'
import {
  PUBLISH_MIN_SAMPLE,
  sampleSizeStatus,
} from '../../lib/game-line-model-rules.js'
import {
  gamesAvailableBeforeLock,
  gamesAvailableForTraining,
  injuryFeatures,
  rebuildTeamSeasonStats,
  teamRecentForm,
} from '../../lib/nfl-pregame-features.js'
import {
  NFL_SELECTION_MODEL_VERSION,
  blendModelProbTowardMarket,
  calculateNFLSelection,
} from '../../lib/nfl-selection-model.js'
import { runBacktestGameLines } from '../../scripts/backtest-game-lines.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BACKTEST_NFL_FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), '__tests__/fixtures/game-line-backtest-nfl.json'), 'utf8'),
)

const LOCK = '2025-11-16T17:00:00.000Z'
const KICKOFF = '2025-11-16T18:00:00.000Z'

function finalGame(overrides = {}) {
  return {
    id: 'g-week1',
    sport: 'nfl',
    season: '2025',
    week: 1,
    date: '2025-11-09T18:00:00.000Z',
    status: 'final',
    home: { id: 'NFL_KC', abbr: 'KC' },
    away: { id: 'NFL_DEN', abbr: 'DEN' },
    homeScore: 27,
    awayScore: 17,
    lastUpdate: '2025-11-09T21:30:00.000Z',
    resultAvailableAt: '2025-11-09T21:30:00.000Z',
    ...overrides,
  }
}

function upcoming(overrides = {}) {
  return {
    id: 'g-week2',
    sport: 'nfl',
    season: '2025',
    week: 2,
    date: KICKOFF,
    status: 'final',
    home: { id: 'NFL_KC', abbr: 'KC' },
    away: { id: 'NFL_LV', abbr: 'LV' },
    homeScore: 24,
    awayScore: 20,
    lastUpdate: '2025-11-16T21:00:00.000Z',
    resultAvailableAt: '2025-11-16T21:00:00.000Z',
    ...overrides,
  }
}

function priorFinals(teamAbbr, opponentAbbr, count = 4) {
  const rows = []
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.parse('2025-10-20T17:00:00.000Z') + i * 7 * 24 * 60 * 60 * 1000)
    const done = new Date(start.getTime() + 3 * 60 * 60 * 1000)
    rows.push(finalGame({
      id: `g-hist-${teamAbbr}-${i}`,
      week: i + 1,
      date: start.toISOString(),
      home: { id: `NFL_${teamAbbr}`, abbr: teamAbbr },
      away: { id: `NFL_${opponentAbbr}${i}`, abbr: `${opponentAbbr}${i}` },
      homeScore: 24 + i,
      awayScore: 17,
      lastUpdate: done.toISOString(),
      resultAvailableAt: done.toISOString(),
    }))
  }
  return rows
}

function quote(overrides = {}) {
  return {
    id: 'odd-h2h-lock',
    gameId: 'g-week2',
    book: 'DraftKings',
    market: 'h2h',
    priceHome: -150,
    priceAway: 130,
    ts: LOCK,
    quotedAt: LOCK,
    ...overrides,
  }
}

describe('NFL fold keys', () => {
  test('a Game with a week number and an ArchivedGame without one share the ET Monday', () => {
    const tagged = upcoming({ week: 11, season: '2025' })
    const archived = upcoming({ week: undefined, season: undefined, id: 'g-archived' })
    delete archived.week
    delete archived.season
    expect(etFoldKey(tagged)).toBe(etFoldKey(archived))
    expect(etFoldKey(tagged)).toMatch(/^nfl-\d{4}-\d{2}-\d{2}$/)
  })

  test('TNF, Sunday, and MNF of one week share a fold and MNF is not grouped with next Thursday', () => {
    const tnf = upcoming({
      id: 'g-tnf',
      date: '2025-11-14T01:15:00.000Z',
      week: 11,
    })
    const sunday = upcoming({
      id: 'g-sun',
      date: '2025-11-16T18:00:00.000Z',
      week: 11,
    })
    const mnf = upcoming({
      id: 'g-mnf',
      date: '2025-11-18T01:15:00.000Z',
      week: 11,
    })
    const nextThu = upcoming({
      id: 'g-next-tnf',
      date: '2025-11-21T01:15:00.000Z',
      week: 12,
    })
    expect(etFoldKey(tnf)).toBe(etFoldKey(sunday))
    expect(etFoldKey(sunday)).toBe(etFoldKey(mnf))
    expect(etFoldKey(mnf)).toBe('nfl-2025-11-17')
    expect(etFoldKey(nextThu)).toBe('nfl-2025-11-24')
    expect(etFoldKey(mnf)).not.toBe(etFoldKey(nextThu))

    const postponedTue = upcoming({
      id: 'g-mnf-tue',
      date: '2025-11-19T01:15:00.000Z',
      week: 11,
    })
    expect(etFoldKey(postponedTue)).toBe(etFoldKey(mnf))
    expect(etFoldKey(postponedTue)).toBe('nfl-2025-11-17')
    expect(etFoldKey(postponedTue)).not.toBe(etFoldKey(nextThu))
  })
})

describe('lock time rejects look-ahead quotes', () => {
  test('a quote timestamped after lock is not the lock quote', () => {
    const game = upcoming()
    const afterKickoff = quote({
      id: 'odd-late',
      ts: '2025-11-16T18:05:00.000Z',
      quotedAt: '2025-11-16T18:04:00.000Z',
    })
    const lock = pickLockTime(game, [afterKickoff], { market: 'moneyline' })
    expect(lock.quote).toBeNull()
    expect(lock.reason).toBe('no_lock_quote')
  })

  test('the 60-minute lock capture is kept and a later close is not', () => {
    const game = upcoming()
    const lockQuote = quote()
    const closeQuote = quote({
      id: 'clvclose:g-week2:h2h',
      ts: '2025-11-16T17:50:00.000Z',
      quotedAt: '2025-11-16T17:48:00.000Z',
      priceHome: -170,
      priceAway: 145,
    })
    const lock = pickLockTime(game, [lockQuote, closeQuote], { market: 'moneyline' })
    expect(lock.quote.id).toBe('odd-h2h-lock')
    expect(lock.lockAt).toBe(LOCK)

    const close = selectCloseQuote([closeQuote], { game, market: 'moneyline' })
    expect(close.quote.id).toBe('clvclose:g-week2:h2h')
  })

  test('a zone-less Game.date never selects the clvclose quote as lock', () => {
    const game = upcoming({ date: '2025-11-16T18:00:00' })
    const lockQuote = quote()
    const closeQuote = quote({
      id: 'clvclose:g-week2:h2h',
      ts: '2025-11-16T17:50:00.000Z',
      quotedAt: '2025-11-16T17:48:00.000Z',
      priceHome: -170,
      priceAway: 145,
    })
    const lock = pickLockTime(game, [lockQuote, closeQuote], { market: 'moneyline' })
    expect(lock.quote).toBeTruthy()
    expect(lock.quote.id).not.toMatch(/^clvclose:/)
    expect(lock.quote.id).toBe('odd-h2h-lock')
    expect(lock.lockAt).toBe(LOCK)
  })
})

describe('no look-ahead in form, injuries, or team stats', () => {
  test('a later final is not in this game\'s form', () => {
    const week1 = finalGame()
    const week2 = upcoming()
    const week1Lock = '2025-11-09T17:00:00.000Z'
    const form = teamRecentForm([week1, week2], 'KC', week1Lock)
    expect(form.games).toBe(0)
    expect(gamesAvailableBeforeLock([week1, week2], week1Lock)).toEqual([])
  })

  test('week 1\'s result is available for week 2\'s lock and week 2\'s own final is not', () => {
    const week1 = finalGame()
    const week2 = upcoming()
    const form = teamRecentForm([week1, week2], 'KC', LOCK)
    expect(form.games).toBe(1)
    expect(form.wins).toBe(1)
    expect(form.ids).toEqual(['g-week1'])
    expect(form.ids).not.toContain('g-week2')
  })

  test('an injury fetched after lock is ignored', () => {
    const features = injuryFeatures([
      {
        id: 'inj-late',
        sport: 'nfl',
        teamAbbr: 'KC',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        status: 'Out',
        fetchedAt: '2025-11-16T17:30:00.000Z',
        asOfDate: '2025-11-16',
      },
    ], 'KC', { lockAt: LOCK, startingQB: 'Patrick Mahomes' })
    expect(features.qbOut).toBe(false)
    expect(features.injuryCount).toBe(0)
  })

  test('an injury fetched before lock is used', () => {
    const features = injuryFeatures([
      {
        id: 'inj-early',
        sport: 'nfl',
        teamAbbr: 'KC',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        status: 'Out',
        fetchedAt: '2025-11-16T12:00:00.000Z',
        asOfDate: '2025-11-15',
      },
    ], 'KC', { lockAt: LOCK, startingQB: 'Patrick Mahomes' })
    expect(features.qbOut).toBe(true)
    expect(features.strongEvidence).toBe(true)
  })

  test('a later Active report replaces an older Out for the same player', () => {
    const features = injuryFeatures([
      {
        id: 'inj-old-out',
        sport: 'nfl',
        teamAbbr: 'KC',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        status: 'Out',
        fetchedAt: '2025-10-01T12:00:00.000Z',
        asOfDate: '2025-10-01',
      },
      {
        id: 'inj-new-active',
        sport: 'nfl',
        teamAbbr: 'KC',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        status: 'Active',
        fetchedAt: '2025-11-16T12:00:00.000Z',
        asOfDate: '2025-11-15',
      },
    ], 'KC', { lockAt: LOCK, startingQB: 'Patrick Mahomes' })
    expect(features.qbOut).toBe(false)
    expect(features.strongEvidence).toBe(false)
    expect(features.injuryCount).toBe(1)
  })

  test('a result inside the 24h embargo is not a training label', () => {
    const fresh = finalGame({
      id: 'g-last-night',
      date: '2025-11-16T01:00:00.000Z',
      lastUpdate: '2025-11-16T16:00:00.000Z',
      resultAvailableAt: '2025-11-16T16:00:00.000Z',
    })
    expect(gamesAvailableBeforeLock([fresh], LOCK).map((game) => game.id)).toEqual(['g-last-night'])
    expect(gamesAvailableForTraining([fresh], LOCK)).toEqual([])
    expect(teamRecentForm([fresh], 'KC', LOCK).ids).toEqual([])
  })

  test('a tie still counts as a game played', () => {
    const tie = finalGame({
      id: 'g-tie',
      homeScore: 20,
      awayScore: 20,
    })
    const stats = rebuildTeamSeasonStats([tie], 'KC', { lockAt: LOCK, season: '2025' })
    expect(stats.ties).toBe(1)
    expect(stats.gamesPlayed).toBe(1)
    expect(stats.pointsForPerGame).toBe(20)
    expect(stats.last10Record).toBe('0-0-1')
  })

  test('assertNoLookAhead rejects stats written after lock', () => {
    expect(assertNoLookAhead({
      observedAt: '2025-11-16T17:01:00.000Z',
      lockAt: LOCK,
      label: 'team_stats',
    }).ok).toBe(false)
    expect(assertNoLookAhead({
      observedAt: '2025-11-16T16:59:00.000Z',
      dataThrough: '2025-11-16T16:00:00.000Z',
      lockAt: LOCK,
      label: 'team_stats',
    }).ok).toBe(true)
  })

  test('a prior whose dataThrough is after lock is excluded from features', () => {
    const leaky = finalGame({
      id: 'g-leaky',
      frozenStart: '2025-11-09T18:00:00.000Z',
      date: '2025-11-16T18:30:00.000Z',
      lastUpdate: '2025-11-09T21:00:00.000Z',
      resultAvailableAt: '2025-11-09T21:00:00.000Z',
      homeScore: 40,
      awayScore: 3,
    })
    const week2 = upcoming()
    const result = walkForwardBacktest({
      games: [...priorFinals('KC', 'SEA'), ...priorFinals('LV', 'NYJ'), leaky, week2],
      odds: [quote()],
      closingOdds: [quote({
        id: 'clvclose:g-week2:h2h',
        ts: '2025-11-16T17:50:00.000Z',
        quotedAt: '2025-11-16T17:48:00.000Z',
      })],
    }, { sport: 'nfl', market: 'moneyline' })
    expect(result.lookAheadRejected.some((row) => row.priorId === 'g-leaky')).toBe(true)
    expect(result.inventory.lookAheadRejected).toBeGreaterThan(0)
    const available = gamesAvailableBeforeLock([leaky, week2], LOCK)
      .filter((game) => game.id !== 'g-week2')
    expect(available.map((game) => game.id)).toContain('g-leaky')
    const safe = available.filter((game) => assertNoLookAhead({
      observedAt: game.resultAvailableAt || game.lastUpdate || game.archivedAt,
      dataThrough: game.date,
      lockAt: LOCK,
      label: 'prior_final',
    }).ok)
    expect(safe.map((game) => game.id)).not.toContain('g-leaky')
    expect(teamRecentForm(safe, 'KC', LOCK).ids).not.toContain('g-leaky')
  })
})

describe('walk-forward does not feed the close into the model', () => {
  test('the committed NFL fixture never uses the close as a lock quote and scores a bet', () => {
    const kickoff = BACKTEST_NFL_FIXTURE.games.find((game) => game.id === 'g-week2')
    const lock = pickLockTime(kickoff, BACKTEST_NFL_FIXTURE.odds, { market: 'moneyline' })
    expect(lock.quote.id).toBe('odd-h2h-lock')
    expect(lock.quote.id).not.toMatch(/^clvclose:/)
    const result = walkForwardBacktest(BACKTEST_NFL_FIXTURE, {
      sport: 'nfl',
      market: 'moneyline',
      model: NFL_SELECTION_MODEL_VERSION,
    })
    expect(result.lookAheadRejected).toEqual([])
    expect(result.inventory.games).toBe(9)
    const row = result.rows.find((item) => item.gameId === 'g-week2' && item.market === 'moneyline')
    expect(row).toBeTruthy()
    expect(row.pClose).not.toBeNull()
    expect(row.outcome).toMatch(/^(win|loss|push)$/)
    expect(row.lockAt).toBe(LOCK)
  })

  test('scoring uses the close while the model only sees the lock quote', () => {
    const week2 = upcoming()
    const lockQuote = quote()
    const closeQuote = quote({
      id: 'clvclose:g-week2:h2h',
      ts: '2025-11-16T17:50:00.000Z',
      quotedAt: '2025-11-16T17:48:00.000Z',
      priceHome: -200,
      priceAway: 170,
    })
    const result = walkForwardBacktest({
      games: [...priorFinals('KC', 'SEA'), ...priorFinals('LV', 'NYJ'), week2],
      odds: [lockQuote],
      closingOdds: [closeQuote],
      injuries: [],
    }, { sport: 'nfl', market: 'moneyline', model: NFL_SELECTION_MODEL_VERSION })

    const row = result.rows.find((item) => item.gameId === 'g-week2' && item.market === 'moneyline')
    expect(row).toBeTruthy()
    expect(row.lockAt).toBe(LOCK)
    expect(row.pClose).not.toBeNull()
    expect(row.clvProb).not.toBeNull()
    expect(result.lookAheadRejected).toEqual([])
    expect(formatBacktestReport(result)).toMatch(/SAMPLE_EMPTY|SAMPLE_TOO_SMALL|sample /)
  })

  test('a future final cannot leak into an earlier fold', () => {
    const week1 = finalGame({
      id: 'g-week1-live',
      date: KICKOFF,
      lastUpdate: '2025-11-16T21:00:00.000Z',
      resultAvailableAt: '2025-11-16T21:00:00.000Z',
      homeScore: 40,
      awayScore: 3,
    })
    const earlier = finalGame({
      id: 'g-earlier',
      date: '2025-11-09T18:00:00.000Z',
      lastUpdate: '2025-11-09T21:00:00.000Z',
      resultAvailableAt: '2025-11-09T21:00:00.000Z',
    })
    const earlierLock = quote({
      gameId: 'g-earlier',
      ts: '2025-11-09T17:00:00.000Z',
      quotedAt: '2025-11-09T17:00:00.000Z',
    })
    const earlierClose = quote({
      id: 'clvclose:g-earlier:h2h',
      gameId: 'g-earlier',
      ts: '2025-11-09T17:50:00.000Z',
      quotedAt: '2025-11-09T17:48:00.000Z',
    })
    const result = walkForwardBacktest({
      games: [earlier, week1],
      odds: [earlierLock],
      closingOdds: [earlierClose],
    }, { sport: 'nfl', market: 'moneyline' })

    const available = gamesAvailableBeforeLock([earlier, week1], '2025-11-09T17:00:00.000Z')
    expect(available.map((game) => game.id)).not.toContain('g-week1-live')
    expect(result.lookAheadRejected).toEqual([])
  })
})

describe('publish bars', () => {
  test('sample under 200 is too small', () => {
    const status = sampleSizeStatus(12)
    expect(status.ok).toBe(false)
    expect(status.code).toBe('SAMPLE_TOO_SMALL')
    expect(status.minSample).toBe(PUBLISH_MIN_SAMPLE)

    const summary = summarizeBacktest([], { sport: 'nfl', market: 'moneyline' })
    expect(summary.sample.code).toBe('SAMPLE_EMPTY')
    expect(summary.publish.eligibleForPublic).toBe(false)
    const printed = formatBacktestReport({
      inventory: { games: 0, odds: 0, closingOdds: 0, scored: 0, skipped: 0 },
      summaries: [summary],
      rows: [],
      nhlNotes: [],
    })
    expect(printed).toMatch(/avgCLV=n\/a/)
    expect(printed).toMatch(/SAMPLE_EMPTY/)
    expect(printed).not.toMatch(/SAMPLE_TOO_SMALL/)
  })
})

describe('NFL v1.1.0 market shrink', () => {
  const NOW = new Date('2025-12-15T18:00:00.000Z')
  const team = (abbr, record, extras = {}) => ({
    abbr,
    last10Record: record,
    season: '2025',
    statsKind: 'season',
    statsCapturedAt: '2025-12-12T00:00:00.000Z',
    dataThrough: '2025-12-12T00:00:00.000Z',
    avgPointsLast10: extras.pf ?? 24,
    avgPointsAllowedLast10: extras.pa ?? 20,
    ...extras,
  })

  test('12-4 vs 4-12 cannot emit a 25pp gap versus an even market', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: team('KC', '12-4', { pf: 28, pa: 17 }),
      away: team('DEN', '4-12', { pf: 17, pa: 28 }),
    }, [{
      id: 'odd-h2h-1',
      gameId: 'g-nfl-1',
      book: 'DraftKings',
      market: 'h2h',
      priceHome: -110,
      priceAway: -110,
      ts: '2025-12-15T17:00:00.000Z',
    }], { now: NOW })

    const gap = Math.abs(selection.moneyline.model.pHomeWin - 0.5)
    expect(gap).toBeLessThanOrEqual(0.08 + 1e-9)
    expect(selection.eligibility.eligibleForPublic).toBe(false)
    expect(selection.modelVersion).toBe(NFL_SELECTION_MODEL_VERSION)
  })

  test('totals run from season scoring averages and stay research-only', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: team('KC', '12-4'),
      away: team('DEN', '4-12'),
    }, [{
      id: 'odd-tot-1',
      gameId: 'g-nfl-1',
      book: 'DraftKings',
      market: 'totals',
      total: 44.5,
      priceHome: -110,
      priceAway: -110,
      ts: '2025-12-15T17:00:00.000Z',
    }], { now: NOW })

    expect(selection.totals.model).not.toBeNull()
    expect(selection.totals.over.model.pWin + selection.totals.under.model.pWin)
      .toBeCloseTo(1, 8)
    expect(Math.abs(selection.totals.over.evaluation.modelVsMarketGap)).toBeLessThanOrEqual(0.12)
    expect(selection.totals.eligibility.eligibleForPublic).toBe(false)
  })

  test('spreads are scored in payload and never public', () => {
    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: team('KC', '12-4'),
      away: team('DEN', '4-12'),
    }, [{
      id: 'odd-sp-1',
      gameId: 'g-nfl-1',
      book: 'DraftKings',
      market: 'spreads',
      spread: -3.5,
      priceHome: -110,
      priceAway: -110,
      ts: '2025-12-15T17:00:00.000Z',
    }], { now: NOW })

    expect(selection.spreads.home).not.toBeNull()
    expect(selection.spreads.eligibility.eligibleForPublic).toBe(false)
    expect(selection.spreads.home.market).toBe('spreads')
  })

  test('blend helper clamps leftover gap to 8pp without QB-out evidence', () => {
    const shrunk = blendModelProbTowardMarket(0.80, 0.50, { strongEvidence: false })
    expect(Math.abs(shrunk.p - 0.50)).toBeLessThanOrEqual(0.08 + 1e-9)
    const withQb = blendModelProbTowardMarket(0.80, 0.50, { strongEvidence: true })
    expect(Math.abs(withQb.p - 0.50)).toBeLessThanOrEqual(0.12 + 1e-9)
    expect(Math.abs(withQb.p - 0.50)).toBeGreaterThan(0.08)
  })

  test('the 20/80 floor does not reopen a capped gap versus a big underdog market', () => {
    const shrunk = blendModelProbTowardMarket(0.40, 0.10, { strongEvidence: false })
    expect(Math.abs(shrunk.p - 0.10)).toBeLessThanOrEqual(0.08 + 1e-9)
    expect(shrunk.p).toBeLessThan(0.20)
  })

  test('a moved spread line is excluded from CLV', () => {
    const game = upcoming()
    const close = selectCloseQuote([{
      id: 'clvclose:g-week2:spreads',
      gameId: 'g-week2',
      book: 'DraftKings',
      market: 'spreads',
      spread: -7,
      priceHome: -110,
      priceAway: -110,
      ts: '2025-11-16T17:50:00.000Z',
      quotedAt: '2025-11-16T17:48:00.000Z',
    }], { game, market: 'spreads', lockLine: -3.5 })
    expect(close.lineMoved).toBe(true)
    expect(close.reason).toBe('line_moved')
  })
})

describe('backtest CLI', () => {
  test('--summary with an injected empty dataset reports SAMPLE_TOO_SMALL and does not fetch odds', async () => {
    const logs = []
    const result = await runBacktestGameLines({
      argv: ['--summary'],
      dataset: { games: [], odds: [], closingOdds: [], injuries: [] },
      log: { log: (...args) => logs.push(args.join(' ')), error() {} },
    })
    expect(result.exitCode).toBe(0)
    expect(logs.join('\n')).toMatch(/SAMPLE_TOO_SMALL/)
    expect(logs.join('\n')).toMatch(/0 Odds API credits/)
  })

  test('noVig pair always normalizes including underround', () => {
    const pair = noVigPair(-110, -110)
    expect(pair.side + pair.other).toBeCloseTo(1, 8)
  })
})
