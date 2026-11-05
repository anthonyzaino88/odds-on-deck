const fs = require('fs')
const path = require('path')

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('cleanup leftover scripts and pointers', () => {
  test('operations/fetch-live-odds.js fork is gone', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'operations/fetch-live-odds.js'))).toBe(false)
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/fetch-live-odds.js'))).toBe(true)
  })

  test('nothing still points at fetch-live-odds under operations or find-real-value-props', () => {
    const files = [
      'package.json',
      'operations/README.md',
      'scripts/calculate-prop-edges.js',
      'scripts/fetch-fresh-games.js',
    ]
    for (const file of files) {
      const src = read(file)
      expect(src).not.toMatch(/operations\/fetch-live-odds/)
      expect(src).not.toMatch(/find-real-value-props/)
    }
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['report:final-score-mismatch']).toBe(
      'node scripts/report-final-score-mismatch.js',
    )
    expect(pkg.scripts['find-real-value-props']).toBeUndefined()
  })
})
