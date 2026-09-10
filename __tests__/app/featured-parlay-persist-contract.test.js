import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('Featured parlay persist contract — Phase B', () => {
  test('generate persists Featured only and leaves explorer unsaved', () => {
    const route = read('app/api/parlays/generate/route.js')
    expect(route).toMatch(/persistFeaturedClearedParlays/)
    expect(route).toMatch(/persistFeaturedIfNeeded/)
    expect(route).toMatch(/Explorer generate never writes/)
    expect(route).not.toMatch(/Parlay saving temporarily disabled/)
    expect(route).not.toMatch(/saveParlaysToSupabase/)
  })

  test('save rejects non-Featured from the tracked cohort', () => {
    const save = read('app/api/parlays/save/route.js')
    expect(save).toMatch(/persistFeaturedClearedParlay/)
    expect(save).toMatch(/Only Featured-cleared parlays enter the tracked cohort/)
    expect(save).toMatch(/result\.rejected/)
    expect(save).not.toMatch(/User saved parlay with/)
  })

  test('history and validate stay on the Featured cohort tag', () => {
    const history = read('app/api/parlays/history/route.js')
    const validate = read('app/api/parlays/validate/route.js')
    expect(history).toMatch(/FEATURED_COHORT_TAG/)
    expect(history).toMatch(/filterFeaturedCohortRows/)
    expect(history).toMatch(/summarizeFeaturedParlays/)
    expect(history).toMatch(/cohort: 'featured'/)
    expect(validate).toMatch(/FEATURED_COHORT_TAG/)
    expect(validate).toMatch(/gradeFeaturedParlayFromValidations/)
    expect(validate).toMatch(/filterFeaturedCohortRows/)
  })

  test('persist layer does not write extra PropValidation rows', () => {
    const persist = read('lib/featured-parlay-persist.js')
    expect(persist).not.toMatch(/recordPropPrediction/)
    expect(persist).toMatch(/Does not insert extra PropValidation/)
    expect(persist).toMatch(/featuredPersistWritePlan/)
  })

  test('history UI is honest empty and labeled Featured-cleared', () => {
    const history = read('components/ParlayHistory.js')
    const page = read('app/parlays/page.js')
    const results = read('components/ParlayResults.js')
    expect(history).toMatch(/Featured Parlay Track/)
    expect(history).toMatch(/No Featured-cleared parlays yet/)
    expect(history).toMatch(/Empty until a Published-eligible 3-leg card clears Featured/)
    expect(history).not.toMatch(/No saved parlays yet/)
    expect(page).toMatch(/onFeaturedReady/)
    expect(page).toMatch(/Featured track/)
    expect(page).not.toMatch(/Save &amp; Track<\/span> any parlay/)
    expect(results).toMatch(/isFeaturedWorthyParlay/)
    expect(results).toMatch(/Explorer — not tracked/)
  })

  test('ops script snapshots Featured without calling The Odds API', () => {
    const script = read('scripts/record-featured-parlays.js')
    const pkg = read('package.json')
    expect(script).toMatch(/does not call The Odds API/)
    expect(script).toMatch(/generateSimpleParlays/)
    expect(script).toMatch(/persistFeaturedClearedParlays/)
    expect(script).toMatch(/featured: true/)
    expect(pkg).toMatch(/"record:featured": "node scripts\/record-featured-parlays\.js"/)
  })
})
