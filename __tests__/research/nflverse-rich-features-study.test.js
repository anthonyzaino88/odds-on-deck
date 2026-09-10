import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseNflverseGames } from '../../lib/research/nflverse-games-study.js'
import {
  PREREGISTERED_STAKE,
  RICH_STUDY_CONSTRAINTS,
  RICH_STUDY_PUBLIC_ELIGIBLE,
  beatsClosingMarket,
  buildMlFeatures,
  pairedTotalsComparable,
  parseRichStudyArgs,
  projectGameTotal,
  renderRichStudyMarkdown,
  runNflverseRichFeaturesStudy,
  seasonToDateScoring,
  shrinkPpg,
} from '../../lib/research/nflverse-rich-features-study.js'

const FIXTURE_PATH = resolve('scripts/research/fixtures/nflverse-games-rich-snippet.csv')
const FIXTURE_CSV = readFileSync(FIXTURE_PATH, 'utf8')

describe('nflverse rich-features study (research only, pass 2)', () => {
  test('keeps the public board and paid/production paths off', () => {
    expect(RICH_STUDY_PUBLIC_ELIGIBLE).toBe(false)
    expect(RICH_STUDY_CONSTRAINTS.eligibleForPublic).toBe(false)
    expect(RICH_STUDY_CONSTRAINTS.writesProductionDb).toBe(false)
    expect(RICH_STUDY_CONSTRAINTS.usesOddsApi).toBe(false)
    expect(PREREGISTERED_STAKE.moneyline).toBe('bet_positive_ev_at_close')
    expect(PREREGISTERED_STAKE.totals).toBe('bet_positive_ev_at_close')
  })

  test('parses rest, division, roof, and weather from the rich fixture', () => {
    const games = parseNflverseGames(FIXTURE_CSV)
    const outdoor = games.find((game) => game.gameId === '2022_01_AAA_BBB')
    const dome = games.find((game) => game.gameId === '2022_01_CCC_DDD')
    expect(outdoor).toMatchObject({
      homeRest: 7,
      awayRest: 7,
      divGame: 1,
      roof: 'outdoors',
      temp: 70,
      wind: 8,
    })
    expect(dome.roof).toBe('dome')
    expect(dome.temp).toBeNull()
    expect(dome.wind).toBeNull()
  })

  test('season-to-date scoring does not leak later or same-slate results', () => {
    const games = parseNflverseGames(FIXTURE_CSV).filter((game) => game.completed && game.gameType === 'REG')
    const week5 = games.find((game) => game.gameId === '2023_05_BBB_AAA')
    const prior = seasonToDateScoring(week5, games)

    expect(prior.home).toMatchObject({
      wins: 4,
      losses: 0,
      gamesPlayed: 4,
      pointsFor: 106,
      pointsAgainst: 47,
      pointDiff: 59,
    })
    expect(prior.home.pdpg).toBeCloseTo(14.75, 5)
    expect(prior.away).toMatchObject({
      wins: 2,
      losses: 2,
      gamesPlayed: 4,
      pointsFor: 72,
      pointsAgainst: 69,
    })

    const week1 = games.find((game) => game.gameId === '2023_01_AAA_BBB')
    expect(seasonToDateScoring(week1, games).home.gamesPlayed).toBe(0)
  })

  test('PPG projection uses shrunk season-to-date offense/defense only', () => {
    const games = parseNflverseGames(FIXTURE_CSV).filter((game) => game.completed)
    const week5 = games.find((game) => game.gameId === '2023_05_BBB_AAA')
    const prior = seasonToDateScoring(week5, games)
    const leaguePpg = 19.75
    const proj = projectGameTotal(prior.home, prior.away, leaguePpg)
    expect(proj).toBeCloseTo(38.125, 3)
    expect(shrinkPpg(106, 4, leaguePpg)).toBeCloseTo(23.125, 3)
  })

  test('weather features are zero on dome games and present outdoors', () => {
    const games = parseNflverseGames(FIXTURE_CSV)
    const completed = games.filter((game) => game.completed)
    const outdoor = games.find((game) => game.gameId === '2023_05_BBB_AAA')
    const dome = games.find((game) => game.gameId === '2023_05_DDD_CCC')
    const outdoorFeat = buildMlFeatures(outdoor, seasonToDateScoring(outdoor, completed))
    const domeFeat = buildMlFeatures(dome, seasonToDateScoring(dome, completed))
    expect(outdoorFeat.weather_present).toBe(1)
    expect(outdoorFeat.wind_10).toBeCloseTo(0.8, 5)
    expect(domeFeat.weather_present).toBe(0)
    expect(domeFeat.wind_10).toBe(0)
    expect(domeFeat.is_indoor).toBe(1)
    expect(outdoorFeat.div_game).toBe(1)
    expect(outdoorFeat.rest_diff).toBe(0)
  })

  test('expanding fits for 2024 do not use 2024 games and stay off the public board', () => {
    global.fetch.mockClear()
    const result = runNflverseRichFeaturesStudy({
      csvText: FIXTURE_CSV,
      minFitGames: 4,
      sourcePath: FIXTURE_PATH,
    })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.constraints.eligibleForPublic).toBe(false)

    const context = result.moneyline.candidates.find((row) => row.candidateId === 'winpct_pd_context')
    const y2024 = context.bySeason.find((row) => row.season === 2024)
    expect(y2024.nEvaluated).toBe(2)
    expect(y2024.fitKind).toBe('expanding_prior_seasons')
    expect(y2024.coefficients).toBeTruthy()

    const train2024 = result.fitLog.find((row) => row.season === 2024 && row.candidateId === 'winpct_pd_context')
    expect(train2024.nTrain).toBe(8)

    const blend = result.moneyline.candidates.find((row) => row.candidateId === 'market_blend')
    expect(blend.usesClosingMarket).toBe(true)
    expect(blend.beatsClosingMarket.beats).toBe(false)
    expect(blend.beatsClosingMarket.reason).toBe('uses_closing_market_as_input')
  })

  test('totals use prior-season sigma and do not claim a beat without the pre-registered rule', () => {
    const result = runNflverseRichFeaturesStudy({
      csvText: FIXTURE_CSV,
      minFitGames: 4,
    })
    const totals2023 = result.totals.bySeason.find((row) => row.season === 2023)
    expect(totals2023.nEvaluated).toBeGreaterThan(0)
    expect(Number.isFinite(totals2023.mae)).toBe(true)
    expect(result.totals.overall.beatsClosingMarket.beats).toBe(
      result.totals.overall.beatsClosingMarket.betterScores
      && result.totals.overall.beatsClosingMarket.profitable,
    )
    expect(result.totals.disclaimer).toMatch(/not production-validated/i)
  })

  test('totals vs-market scores use only rows that have a closing O/U', () => {
    const mixed = [
      { y: 1, pOverDecisive: 0.6, marketPOver: 0.52, primaryProfit: 0.91 },
      { y: 0, pOverDecisive: 0.4, marketPOver: 0.48, primaryProfit: -1 },
      { y: 1, pOverDecisive: 0.9, marketPOver: null, primaryProfit: null },
    ]
    const paired = pairedTotalsComparable(mixed)
    expect(paired.n).toBe(2)
    expect(paired.primary.n).toBe(2)
    expect(paired.model.logLoss).toBeCloseTo(
      (-Math.log(0.6) + -Math.log(0.6)) / 2,
      5,
    )
    expect(paired.market.logLoss).toBeCloseTo(
      (-Math.log(0.52) + -Math.log(0.52)) / 2,
      5,
    )
  })

  test('beatsClosingMarket requires better scores and positive primary ROI', () => {
    expect(beatsClosingMarket({
      logLoss: 0.60,
      brier: 0.20,
      primaryRoi: 0.02,
      marketLogLoss: 0.61,
      marketBrier: 0.21,
    }).beats).toBe(true)
    expect(beatsClosingMarket({
      logLoss: 0.60,
      brier: 0.20,
      primaryRoi: -0.01,
      marketLogLoss: 0.61,
      marketBrier: 0.21,
    }).beats).toBe(false)
    expect(beatsClosingMarket({
      logLoss: 0.60,
      brier: 0.20,
      primaryRoi: 0.02,
      marketLogLoss: 0.61,
      marketBrier: 0.21,
      usesClosingMarket: true,
    })).toMatchObject({ beats: false, reason: 'uses_closing_market_as_input' })
  })

  test('report documents methods and does not flip public eligibility', () => {
    const result = runNflverseRichFeaturesStudy({ csvText: FIXTURE_CSV, minFitGames: 4 })
    const markdown = renderRichStudyMarkdown(result)
    expect(markdown).toMatch(/rich-features study/)
    expect(markdown).toMatch(/Pre-registered stake rule/)
    expect(markdown).toMatch(/winpct_pd_context/)
    expect(markdown).toMatch(/eligibleForPublic.*false/s)
    expect(markdown).not.toMatch(/eligibleForPublic.*true/)
    expect(markdown).toMatch(/Uses the closing moneyline/)
  })

  test('CLI args default to the pass-2 report path', () => {
    const args = parseRichStudyArgs(['--input', FIXTURE_PATH, '--min-fit-games', '8'])
    expect(args.input).toBe(FIXTURE_PATH)
    expect(args.minFitGames).toBe(8)
    expect(args.report).toBe('docs/research/nflverse-rich-features-study.md')
  })
})
