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
    expect(pkg.scripts.postinstall).toBe('prisma generate')
    expect(pkg.dependencies.prisma).toBe('5.22.0')
    expect(pkg.devDependencies.prisma).toBeUndefined()
    expect(pkg.scripts['ops:morning-edges']).toBe(
      'node scripts/ensure-prisma-client.js && node scripts/fetch-team-performance-data.js && node scripts/calculate-game-edges.js',
    )
  })

  test('morning scripts preflight the generated Prisma client', () => {
    expect(read('scripts/ensure-prisma-client.js')).toMatch(/ensurePrismaClient\(\{ warnOnly: true \}\)/)
    expect(read('scripts/fetch-team-performance-data.js')).toMatch(/ensurePrismaClient\(\{ warnOnly: true \}\)/)
    expect(read('scripts/calculate-game-edges.js')).toMatch(/ensurePrismaClient\(\{ warnOnly: true \}\)/)
    expect(read('operations/fetch-team-performance-data.js')).toMatch(/ensurePrismaClient\(\{ warnOnly: true \}\)/)
    expect(read('scripts/auto-validate-parlays.js')).toMatch(/ensurePrismaClient\(\)/)
    expect(read('scripts/auto-validate-parlays.js')).not.toMatch(/ensurePrismaClient\(\{ warnOnly/)
    expect(read('scripts/fetch-team-performance-data.js')).not.toMatch(/ensurePrismaClient\(\)[\s\S]{0,120}process\.exit\(1\)/)
    expect(read('scripts/calculate-game-edges.js')).not.toMatch(/ensurePrismaClient\(\)[\s\S]{0,120}process\.exit\(1\)/)
    const preflight = read('lib/prisma-preflight.js')
    expect(preflight).toMatch(/prisma\/build\/index\.js/)
    expect(preflight).toMatch(/require\.resolve/)
    expect(preflight).toMatch(/npx prisma generate/)
    const ops = read('operations/README.md')
    expect(ops).toMatch(/Never junction `node_modules`/)
    expect(ops).toMatch(/npm ci/)
    expect(ops).toMatch(/cmd \/c rmdir <link>/)
    expect(ops).not.toMatch(/rmdir <link> \/s/)
    expect(ops).toMatch(/prisma\/build\/index\.js/)
    expect(ops).toMatch(/npx prisma generate` is a secondary fallback/)
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
    expect(script).toMatch(/MODEL_VERSION/)
    expect(script).toMatch(/modelRun: edges\.modelRun \|\| MODEL_VERSION/)
    expect(script).not.toMatch(/modelRun: 'v0\.1\.0'/)
    expect(script).not.toMatch(/Leave lib\/edge\.js math untouched/)
  })

  test('parlay generate gates game-line legs on skipped / no-edge / bad team stats', () => {
    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).toMatch(/shouldSkipParlayGameLines/)
    expect(generator).toMatch(/Skipping parlay game-line legs/)
    expect(generator).toMatch(/statsCapturedAt/)
  })
})
