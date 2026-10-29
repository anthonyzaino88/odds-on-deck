import {
  FETCH_TEAM_PERFORMANCE_USAGE,
  formatFetchTeamPerformanceModeBanner,
  parseFetchTeamPerformanceArgs,
  runFetchTeamPerformanceCli,
} from '../../scripts/fetch-team-performance-data.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

describe('parseFetchTeamPerformanceArgs', () => {
  test('treats --help and -h as help; everything else is unknown', () => {
    expect(parseFetchTeamPerformanceArgs([])).toEqual({ help: false, unknown: [] })
    expect(parseFetchTeamPerformanceArgs(['--help'])).toMatchObject({ help: true, unknown: [] })
    expect(parseFetchTeamPerformanceArgs(['-h'])).toMatchObject({ help: true, unknown: [] })
    expect(parseFetchTeamPerformanceArgs(['--oops'])).toEqual({ help: false, unknown: ['--oops'] })
    expect(parseFetchTeamPerformanceArgs(['foo'])).toEqual({ help: false, unknown: ['foo'] })
  })
})

describe('runFetchTeamPerformanceCli', () => {
  test('--help and -h print usage and never fetch or create a client', async () => {
    for (const flag of ['--help', '-h']) {
      const runFetch = jest.fn()
      const createClient = jest.fn()
      const preflightPrisma = jest.fn()
      const log = memoryLog()
      const result = await runFetchTeamPerformanceCli({
        argv: [flag],
        runFetch,
        createClient,
        preflightPrisma,
        log,
      })
      expect(result.exitCode).toBe(0)
      expect(log.lines.join('\n')).toContain(FETCH_TEAM_PERFORMANCE_USAGE)
      expect(log.lines.join('\n')).toMatch(/No DB writes/)
      expect(runFetch).not.toHaveBeenCalled()
      expect(createClient).not.toHaveBeenCalled()
      expect(preflightPrisma).not.toHaveBeenCalled()
    }
  })

  test('unknown flags and positionals exit 2 without fetching or creating a client', async () => {
    for (const argv of [['--oops'], ['3'], ['--apply', 'extra']]) {
      const runFetch = jest.fn()
      const createClient = jest.fn()
      const preflightPrisma = jest.fn()
      const log = memoryLog()
      const result = await runFetchTeamPerformanceCli({
        argv,
        runFetch,
        createClient,
        preflightPrisma,
        log,
      })
      expect(result.exitCode).toBe(2)
      expect(result.unknown).toEqual(argv)
      expect(log.lines.join('\n')).toMatch(/Unknown argument/)
      expect(runFetch).not.toHaveBeenCalled()
      expect(createClient).not.toHaveBeenCalled()
      expect(preflightPrisma).not.toHaveBeenCalled()
    }
  })

  test('write path prints MODE: APPLY first and then calls the fetch runner', async () => {
    const runFetch = jest.fn(async ({ createClient }) => {
      createClient()
      return { exitCode: 0, results: [] }
    })
    const createClient = jest.fn(() => ({ tag: 'client' }))
    const preflightPrisma = jest.fn()
    const log = memoryLog()
    const result = await runFetchTeamPerformanceCli({
      argv: [],
      runFetch,
      createClient,
      preflightPrisma,
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(formatFetchTeamPerformanceModeBanner()).toBe('MODE: APPLY')
    expect(log.lines[0]).toBe('MODE: APPLY')
    expect(preflightPrisma).toHaveBeenCalledTimes(1)
    expect(runFetch).toHaveBeenCalledTimes(1)
    expect(runFetch.mock.calls[0][0].createClient).toBe(createClient)
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})
