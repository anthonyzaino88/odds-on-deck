const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('private NHL shadow-published track stays off every public surface', () => {
  test('PUBLISHED_SPORTS stays mlb+nfl; shadow is a distinct NHL cohort', () => {
    const published = read('lib/published-picks.js')
    expect(published).toMatch(/export const PUBLISHED_SPORTS = Object\.freeze\(\['mlb', 'nfl'\]\)/)
    expect(published).toMatch(/export const SHADOW_PUBLISHED_SPORTS = Object\.freeze\(\['nhl'\]\)/)
    expect(published).toMatch(/export const SHADOW_PUBLISHED_COHORT_TAG = 'cohort:shadow-published'/)
    expect(published).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(published).toMatch(/isShadowPublishedEligibleProp/)
  })

  test('record:published persists shadow in the same run; no extra ops script required', () => {
    const validation = read('lib/validation.js')
    const record = read('scripts/record-published-props.js')
    const pkg = read('package.json')
    expect(validation).toMatch(/export async function persistShadowPublishedEligibleFromCache/)
    expect(validation).toMatch(/persistShadowPublishedEligibleFromCache\(\)/)
    expect(validation).toMatch(/SHADOW_PUBLISHED_STATS_PREFILTER\.sports/)
    expect(record).toMatch(/persistPublishedEligibleFromCache/)
    expect(record).toMatch(/cohort:shadow-published/)
    expect(pkg).toMatch(/"record:published": "node scripts\/record-published-props\.js"/)
    expect(pkg).toMatch(/"report:shadow-nhl": "node scripts\/report-shadow-nhl\.js"/)
  })

  test('homepage, Editor\'s, Featured, and public stats queries exclude the shadow tag', () => {
    const hook = read('lib/homepage-hook.js')
    const picks = read('lib/picks.js')
    const generator = read('lib/simple-parlay-generator.js')
    const validation = read('lib/validation.js')
    const report = read('scripts/report-published-clv.js')
    const insights = read('lib/performance-analyzer.js')

    expect(hook).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(hook).toMatch(/\.in\('sport', PUBLISHED_SPORTS\)/)
    expect(hook).not.toMatch(/SHADOW_PUBLISHED_SPORTS/)

    expect(picks).toMatch(/\.in\('sport', PUBLISHED_SPORTS\)/)
    expect(picks).not.toMatch(/SHADOW_PUBLISHED_SPORTS/)
    expect(picks).not.toMatch(/cohort:shadow-published/)

    expect(generator).toMatch(/return \[\.\.\.PUBLISHED_SPORTS\]/)
    expect(generator).not.toMatch(/SHADOW_PUBLISHED_SPORTS/)

    expect(validation).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(validation).toMatch(/withoutShadowPublished/)
    expect(validation).toMatch(/excludeShadowPublished !== false/)
    expect(report).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(insights).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(insights).toMatch(/withoutShadowPublished/)
  })

  test('public API routes do not mention the shadow cohort', () => {
    const picksApi = read('app/api/picks/route.js')
    const validationApi = read('app/api/validation/route.js')
    const parlaysHistory = read('app/api/parlays/history/route.js')
    const parlaysValidate = read('app/api/parlays/validate/route.js')
    expect(picksApi).toMatch(/cohort: 'published'/)
    expect(picksApi).not.toMatch(/shadow-published/)
    expect(validationApi).not.toMatch(/shadow-published/)
    expect(parlaysHistory).not.toMatch(/shadow-published/)
    expect(parlaysValidate).not.toMatch(/shadow-published/)
  })

  test('grading preserves cohort tags; close capture includes shadow under the shared cap', () => {
    const validate = read('scripts/validate-pending-props.js')
    const capture = read('scripts/capture-published-closes.js')
    const report = read('scripts/report-shadow-nhl.js')
    expect(validate).toMatch(/withPreservedCohortNotes/)
    expect(capture).toMatch(/CLOSE_CAPTURE_SPORTS/)
    expect(capture).toMatch(/isCloseCaptureEligiblePick/)
    expect(capture).toMatch(/closeCaptureJobPriority/)
    expect(capture).toMatch(/shares this --max-calls budget/)
    expect(report).toMatch(/Never writes/)
    expect(report).toMatch(/Never calls The Odds API/)
    expect(report).toMatch(/ilike\('notes', `%\$\{SHADOW_PUBLISHED_COHORT_TAG\}%`\)/)
  })
})
