import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('morning ops team-stats refresh', () => {
  test('ops README runs fetch-team-performance-data before calculate-game-edges', () => {
    const ops = read('operations/README.md')
    const fetchAt = ops.indexOf('node scripts/fetch-team-performance-data.js')
    const edgesAt = ops.indexOf('node scripts/calculate-game-edges.js')
    expect(fetchAt).toBeGreaterThan(-1)
    expect(edgesAt).toBeGreaterThan(-1)
    expect(fetchAt).toBeLessThan(edgesAt)
    expect(ops).toMatch(/REQUIRED: refresh team performance BEFORE calculate-game-edges/)
    expect(ops).toMatch(/REQUIRED: calculate game edges before record-game-lines/)
  })

  test('npm script chain is fetch then calculate-game-edges', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['fetch:team-performance']).toBe('node scripts/fetch-team-performance-data.js')
    expect(pkg.scripts['calculate:game-edges']).toBe('node scripts/calculate-game-edges.js')
    expect(pkg.scripts['ops:morning-edges']).toBe(
      'node scripts/fetch-team-performance-data.js && node scripts/calculate-game-edges.js',
    )
  })

  test('fetch script uses the secret-key helper and does not auto-run on import', () => {
    const script = read('scripts/fetch-team-performance-data.js')
    expect(script).toMatch(/createScriptSupabaseClient|runFetchTeamPerformanceData/)
    expect(script).toMatch(/invokedDirectly/)
    expect(script).not.toMatch(/\bsupabaseUrl\b|\bsupabaseSecretKey\b/)
  })

  test('calculate-game-edges skips MLB when team stats are ineligible', () => {
    const script = read('scripts/calculate-game-edges.js')
    expect(script).toMatch(/evaluateMatchupTeamStatsForEdge/)
    expect(script).toMatch(/Skipping MLB edge/)
    expect(script).toMatch(/from '\.\.\/lib\/edge\.js'/)
  })

  test('parlay generate gates game-line legs on skipped / no-edge / bad team stats', () => {
    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).toMatch(/shouldSkipParlayGameLines/)
    expect(generator).toMatch(/Skipping parlay game-line legs/)
    expect(generator).toMatch(/statsCapturedAt/)
  })
})
