/**
 * @jest-environment node
 */
import fs from 'fs'
import path from 'path'

// Regression: switching Parlay Type to SGP showed an empty "Select Game"
// list until the sport changed. The game filter effect must re-run when
// the parlay type changes, since the cache is usually already warm.
describe('ParlayBuilder SGP game list', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../components/ParlayBuilder.js'), 'utf8')

  test('cached-games filter effect depends on type, sport, and cache', () => {
    const m = src.match(/filterCachedGames\(\)\s*\}\s*,\s*\[([^\]]*)\]\)/)
    expect(m).not.toBeNull()
    const deps = m[1].split(',').map(d => d.trim())
    expect(deps).toEqual(expect.arrayContaining(['type', 'sport', 'allGamesCache']))
  })
})
