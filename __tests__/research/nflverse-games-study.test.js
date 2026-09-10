import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  NFLVERSE_STUDY_CONSTRAINTS,
  NFLVERSE_STUDY_PUBLIC_ELIGIBLE,
  NFLVERSE_STUDY_USES_ODDS_API,
  NFLVERSE_STUDY_WRITES_PRODUCTION_DB,
  isChronologicallyBefore,
  parseNflverseGames,
  parseStudyArgs,
  renderStudyMarkdown,
  runNflverseGamesStudy,
  seasonToDateRecords,
} from '../../lib/research/nflverse-games-study.js'

const FIXTURE_PATH = resolve('scripts/research/fixtures/nflverse-games-snippet.csv')
const FIXTURE_CSV = readFileSync(FIXTURE_PATH, 'utf8')

describe('nflverse offline study (research only)', () => {
  test('keeps the public board and paid/production paths off', () => {
    expect(NFLVERSE_STUDY_PUBLIC_ELIGIBLE).toBe(false)
    expect(NFLVERSE_STUDY_WRITES_PRODUCTION_DB).toBe(false)
    expect(NFLVERSE_STUDY_USES_ODDS_API).toBe(false)
    expect(NFLVERSE_STUDY_CONSTRAINTS).toEqual({
      eligibleForPublic: false,
      writesProductionDb: false,
      usesOddsApi: false,
      regradesPicks: false,
      merges: false,
    })
  })

  test('parses the embedded snippet without network I/O', () => {
    expect(global.fetch).not.toHaveBeenCalled()
    const games = parseNflverseGames(FIXTURE_CSV)
    expect(games).toHaveLength(16)
    expect(games[0]).toMatchObject({
      gameId: '2023_01_AAA_BBB',
      season: 2023,
      gameType: 'REG',
      completed: true,
      total: 34,
      homeMoneyline: 130,
      awayMoneyline: -150,
    })
    expect(games.find((game) => game.gameId === '2024_02_AAA_BBB').completed).toBe(false)
  })

  test('filters regular season and optional playoffs', () => {
    const resultReg = runNflverseGamesStudy({ csvText: FIXTURE_CSV })
    const resultPlus = runNflverseGamesStudy({ csvText: FIXTURE_CSV, includePlayoffs: true })
    expect(resultReg.source.filteredRows).toBe(15)
    expect(resultReg.source.completedRows).toBe(14)
    expect(resultPlus.source.filteredRows).toBe(16)
    expect(resultPlus.sampleSizes.find((row) => row.season === 2023).playoffs).toBe(1)
    expect(resultReg.sampleSizes.find((row) => row.season === 2023).playoffs).toBe(0)
  })

  test('reports sample sizes by season', () => {
    const result = runNflverseGamesStudy({ csvText: FIXTURE_CSV })
    expect(result.sampleSizes.map((row) => row.season)).toEqual([2023, 2024])
    const s2023 = result.sampleSizes.find((row) => row.season === 2023)
    const s2024 = result.sampleSizes.find((row) => row.season === 2024)
    expect(s2023.completed).toBe(12)
    expect(s2023.mlEvaluable).toBe(4)
    expect(s2024.scheduled).toBe(3)
    expect(s2024.completed).toBe(2)
    expect(s2024.mlEvaluable).toBe(0)
  })

  test('season-to-date records do not leak later or same-slate results', () => {
    const games = parseNflverseGames(FIXTURE_CSV).filter((game) => game.completed && game.gameType === 'REG')
    const week5 = games.find((game) => game.gameId === '2023_05_BBB_AAA')
    const prior = seasonToDateRecords(week5, games)

    expect(prior.home).toEqual({ wins: 4, losses: 0, ties: 0, gamesPlayed: 4 })
    expect(prior.away).toEqual({ wins: 2, losses: 2, ties: 0, gamesPlayed: 4 })

    const week1Aaa = games.find((game) => game.gameId === '2023_01_AAA_BBB')
    const week1Ccc = games.find((game) => game.gameId === '2023_01_CCC_DDD')
    expect(isChronologicallyBefore(week1Aaa, week1Ccc)).toBe(false)
    expect(isChronologicallyBefore(week1Ccc, week1Aaa)).toBe(false)
    expect(seasonToDateRecords(week1Aaa, games).home.gamesPlayed).toBe(0)
  })

  test('fits an empirical totals distribution labeled as not production-validated', () => {
    const result = runNflverseGamesStudy({
      csvText: FIXTURE_CSV,
      totalsOosMinTrain: 8,
    })
    const fit = result.totals.inSample
    expect(fit.n).toBe(14)
    expect(fit.mean).toBeCloseTo(38.857, 2)
    expect(fit.variance).toBeGreaterThan(0)
    expect(fit.productionValidatedForBetting).toBe(false)
    expect(fit.validationStatus).toBe('empirical_from_nflverse_not_production_validated')
    expect(result.totals.disclaimer).toMatch(/not production-validated/i)

    const oos2024 = result.totals.chronologicalOos.find((row) => row.holdoutSeason === 2024)
    expect(oos2024).toBeTruthy()
    expect(oos2024.nTrain).toBe(12)
    expect(oos2024.nHoldout).toBe(2)
    expect(oos2024.trainMean).toBeCloseTo(37.833, 2)
    const holdoutMean = (48 + 42) / 2
    expect(oos2024.holdoutMean).toBeCloseTo(holdoutMean, 5)
    expect(oos2024.trainFit.n).toBe(12)
  })

  test('evaluates the shrinkage moneyline baseline with honest scoring', () => {
    const result = runNflverseGamesStudy({ csvText: FIXTURE_CSV })
    const ml = result.moneyline
    expect(ml.nEvaluated).toBe(4)
    expect(ml.nDecisive).toBe(4)
    expect(ml.logLoss.model).toBeGreaterThan(0)
    expect(ml.logLoss.market).toBeGreaterThan(0)
    expect(ml.brier.model).toBeGreaterThan(0)
    expect(ml.brier.market).toBeGreaterThan(0)
    expect(Number.isFinite(ml.flatStake.modelPreferred.roi)).toBe(true)
    expect(ml.flatStake.modelPreferred.n).toBe(4)

    const week5 = ml.evaluations.find((row) => row.gameId === '2023_05_BBB_AAA')
    expect(week5.homePrior.wins).toBe(4)
    expect(week5.homePrior.gamesPlayed).toBe(4)
    expect(week5.yHome).toBe(0)
    expect(week5.modelPHome).toBeGreaterThan(0.5)

    const week1 = ml.evaluations.find((row) => row.gameId === '2023_01_AAA_BBB')
    expect(week1).toBeUndefined()
  })

  test('renders a research report that does not claim public eligibility', () => {
    const result = runNflverseGamesStudy({ csvText: FIXTURE_CSV, sourcePath: FIXTURE_PATH })
    const markdown = renderStudyMarkdown(result)
    expect(markdown).toMatch(/Not production-validated for betting/)
    expect(markdown).toMatch(/eligibleForPublic.*false/s)
    expect(markdown).toMatch(/Sample sizes by season/)
    expect(markdown).not.toMatch(/eligibleForPublic.*true/)
  })

  test('CLI args default to a local report path and optional local input', () => {
    const args = parseStudyArgs([
      '--input',
      FIXTURE_PATH,
      '--include-playoffs',
      '--min-season',
      '2023',
    ])
    expect(args.input).toBe(FIXTURE_PATH)
    expect(args.includePlayoffs).toBe(true)
    expect(args.minSeason).toBe(2023)
    expect(args.report).toBe('docs/research/nflverse-games-study.md')
  })

  test('does not call fetch when the study runs on the fixture', () => {
    global.fetch.mockClear()
    runNflverseGamesStudy({ csvText: FIXTURE_CSV })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
