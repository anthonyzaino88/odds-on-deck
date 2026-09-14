import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('NFL archive operator wiring', () => {
  test('npm scripts expose audit + archive-only backfill', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['archive:nfl']).toBe('node scripts/archive-nfl-box-scores.js')
    expect(pkg.scripts['archive:nfl:audit']).toBe('node scripts/archive-nfl-box-scores.js --audit')
  })

  test('Jest collects *.test.js so archive fixtures are not empty suites', () => {
    const jestConfig = read('jest.config.js')
    expect(jestConfig).toMatch('**/__tests__/**/*.test.(js|jsx)')
    expect(jestConfig).not.toMatch("**/__tests__/**/*.(js|jsx)'")
  })

  test('CLI is archive-only and documents ESPN (not Odds API)', () => {
    const src = read('scripts/archive-nfl-box-scores.js')
    expect(src).toMatch(/No Odds API/)
    expect(src).toMatch(/never deletes/i)
    expect(src).toMatch(/--audit/)
    expect(src).not.toMatch(/clear-stale-props/)
    expect(src).not.toMatch(/ODDS_API_KEY/)
  })

  test('docs describe coverage report fields and postgame / correction refresh', () => {
    const archiveReadme = read('research/archive/README.md')
    expect(archiveReadme).toMatch(/expected games/i)
    expect(archiveReadme).toMatch(/healthy archives/i)
    expect(archiveReadme).toMatch(/missing games/i)
    expect(archiveReadme).toMatch(/failed fetches/i)
    expect(archiveReadme).toMatch(/unresolved identities/i)
    expect(archiveReadme).toMatch(/date coverage/i)
    expect(archiveReadme).toMatch(/archive-nfl-box-scores/)
    expect(archiveReadme).toMatch(/quote_ts/)
    expect(archiveReadme).toMatch(/NHL/)
    expect(archiveReadme).toMatch(/inclusive UTC calendar days/)
    expect(archiveReadme).toMatch(/8:15 PM ET/)
    expect(archiveReadme).toMatch(/next UTC day/)
    expect(archiveReadme).toMatch(/weeks 1–18/)
    expect(archiveReadme).toMatch(/recomputed/)
    expect(archiveReadme).toMatch(/both/)
    expect(archiveReadme).toMatch(/JSONL append recovery/)
    expect(archiveReadme).toMatch(/one-time backfill is not the recurring archival/)
    expect(archiveReadme).toMatch(/odds_format/)
    expect(archiveReadme).toMatch(/unknown/)

    const cli = read('scripts/archive-nfl-box-scores.js')
    expect(cli).toMatch(/8:15 PM ET/)
    expect(cli).toMatch(/next\* UTC day|next UTC day/)
    expect(cli).toMatch(/nflArchiveJobExitCode/)

    const ops = read('operations/README.md')
    expect(ops).toMatch(/archive-nfl-box-scores/)
    expect(ops).toMatch(/archive:nfl/)
    expect(ops).toMatch(/8:15 PM ET/)
  })
})
