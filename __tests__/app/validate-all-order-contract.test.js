import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('validate:all grades props before parlays', () => {
  test('npm script runs player-prop validation then auto-validate parlays', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts.validate).toBe('node scripts/validate-pending-props.js')
    expect(pkg.scripts['validate:parlays']).toBe('node scripts/auto-validate-parlays.js')
    expect(pkg.scripts['validate:all']).toBe(
      'node scripts/run-validation-check.js && node scripts/auto-validate-parlays.js'
    )
    expect(pkg.scripts['regrade:featured']).toBe(
      'node scripts/auto-validate-parlays.js --regrade'
    )

    const check = read('scripts/run-validation-check.js')
    expect(check).toMatch(/validate-pending-props\.js/)

    const all = pkg.scripts['validate:all']
    expect(all.indexOf('run-validation-check.js')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('run-validation-check.js')).toBeLessThan(all.indexOf('auto-validate-parlays.js'))
  })

  test('auto-validate never assumes 0 on pending PropValidation', () => {
    const src = read('scripts/auto-validate-parlays.js')
    expect(src).not.toMatch(/assumed 0/)
    expect(src).not.toMatch(/canAssumeFinished/)
    expect(src).not.toMatch(/actualValue = 0\n\s+outcome = gradeOverUnder\(0/)
    expect(src).toMatch(/gradeFeaturedParlayFromValidations/)
    expect(src).toMatch(/gradePropLegFromValidation/)
    expect(src).toMatch(/--regrade/)
    expect(src).toMatch(/Pending prop validation \(no numeric actual\)/)
  })

  test('ops docs state props-then-parlays and the local regrade command', () => {
    const featured = read('docs/featured-parlay-track.md')
    const ops = read('operations/README.md')
    expect(featured).toMatch(/player props first/)
    expect(featured).toMatch(/npm run regrade:featured/)
    expect(featured).toMatch(/Do not treat .+pending.+ as actual 0/)
    expect(ops).toMatch(/Props first/)
    expect(ops).toMatch(/npm run regrade:featured/)
  })
})
