import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBacktestArgs } from '../../lib/game-line-backtest.js'
import { BACKTEST_USAGE } from '../../scripts/backtest-game-lines.js'

describe('backtest-game-lines script contract', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/backtest-game-lines.js'), 'utf8')
  const lib = readFileSync(join(process.cwd(), 'lib/game-line-backtest.js'), 'utf8')

  test('is read-only and never calls The Odds API', () => {
    expect(src).toMatch(/Read-only/)
    expect(src).toMatch(/Zero Odds API credits/)
    expect(src).not.toMatch(/fetchOddsApiJson|ODDS_API_KEY|the-odds-api/)
    expect(lib).not.toMatch(/fetchOddsApiJson|ODDS_API_KEY|the-odds-api/)
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
  })

  test('documents --summary / --dry-run and SAMPLE_TOO_SMALL', () => {
    expect(BACKTEST_USAGE).toMatch(/--summary/)
    expect(src).toMatch(/SAMPLE_TOO_SMALL/)
    expect(parseBacktestArgs(['--dry-run']).dryRun).toBe(true)
    expect(parseBacktestArgs(['--summary']).summary).toBe(true)
    expect(parseBacktestArgs(['--sport', 'nfl', '--market', 'totals']).market).toBe('totals')
  })

  test('does not change quiet-window or publish gating', () => {
    expect(src).not.toMatch(/eligibleForPublic\s*=\s*true/)
    expect(src).not.toMatch(/OPS_QUIET_MINUTE/)
    expect(lib).not.toMatch(/PUBLISHED_GAME_LINE_SPORTS/)
  })
})
