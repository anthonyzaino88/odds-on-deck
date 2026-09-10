import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('Featured parlays contract', () => {
  test('Featured fetch asks the generator for featured quality', () => {
    const page = read('app/parlays/page.js')
    expect(page).toMatch(/featured=1/)
    expect(page).toMatch(/type=single_game&featured=1/)
    expect(page).not.toMatch(/\/api\/parlays\/generate\?sport=\$\{s\}&legs=3&maxParlays=1`/)
  })

  test('GET generate forwards featured to the generator', () => {
    const route = read('app/api/parlays/generate/route.js')
    expect(route).toMatch(/searchParams\.get\('featured'\)/)
    expect(route).toMatch(/featured,/)
  })

  test('generator never assigns playerId from propId', () => {
    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).not.toMatch(/playerId:\s*prop\.propId/)
    expect(generator).not.toMatch(/playerId:\s*prop\.propId\s*\|\|/)
    expect(generator).toMatch(/playerCorrelationKey/)
    expect(generator).toMatch(/assembleParlays/)
  })
})
