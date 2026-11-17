const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('private NFL/NHL game-line shadow track stays off public surfaces', () => {
  test('recorder writes shadow mode only and keeps MLB unpublished', () => {
    const script = read('scripts/record-game-lines.js')
    const pkg = read('package.json')
    expect(script).toMatch(/shadow: true/)
    expect(script).toMatch(/private shadow/)
    expect(script).not.toMatch(/selectGameLines\(picks\)/)
    expect(script).toMatch(/GAME_LINE_SKIP_REASONS\.UNPUBLISHED/)
    expect(pkg).toMatch(/"report:game-line-shadow": "node scripts\/report-game-line-shadow\.js"/)
  })

  test('public generateGameLines still uses the public gates, not shadow inspect', () => {
    const picks = read('lib/picks.js')
    const generate = picks.slice(
      picks.indexOf('export async function generateGameLines'),
      picks.indexOf('async function attachGameLineInsights'),
    )
    expect(generate).toMatch(/PUBLISHED_GAME_LINE_SPORTS\.map/)
    expect(generate).toMatch(/selectGameLines/)
    expect(generate).not.toMatch(/shadow: true/)
    expect(generate).not.toMatch(/inspectGameLineShadowSnapshot/)
  })

  test('public sides/totals, Published, archive, and APIs exclude the shadow tag', () => {
    const published = read('lib/published-picks.js')
    const validation = read('lib/validation.js')
    const hook = read('lib/homepage-hook.js')
    const picksApi = read('app/api/picks/route.js')
    const validationApi = read('app/api/validation/route.js')
    const report = read('scripts/report-game-line-shadow.js')

    expect(published).toMatch(/if \(!opts\.includeShadow && \(isShadowPublishedCohort\(record\) \|\| isPrivateShadowPublished\(record\)\)\)/)
    expect(validation).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(validation).toMatch(/fetchSidesTotalsRecords/)
    expect(hook).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(picksApi).not.toMatch(/inspectGameLineShadowSnapshot/)
    expect(picksApi).not.toMatch(/cohort:shadow-published/)
    expect(validationApi).not.toMatch(/shadow-published/)
    expect(read('app/validation/page.js')).toMatch(/getSidesTotalsStats/)
    expect(read('app/validation/page.js')).not.toMatch(/includeShadow/)
    expect(read('lib/homepage-hook.js')).not.toMatch(/includeShadow/)
    expect(read('lib/featured-parlay-persist.js')).not.toMatch(/game-line-shadow/)
    expect(read('lib/featured-parlay-persist.js')).not.toMatch(/cohort:shadow-published/)
    expect(report).toMatch(/Never writes/)
    expect(report).toMatch(/Never calls The Odds API/)
    expect(report).toMatch(/ilike\('notes', `%\$\{SHADOW_PUBLISHED_COHORT_TAG\}%`\)/)
  })

  test('grading still reads pending game_line rows; close attach uses stored ClosingOdds', () => {
    const validation = read('lib/validation.js')
    const capture = read('scripts/capture-published-closes.js')
    const validate = read('scripts/validate-pending-props.js')
    expect(validation).toMatch(/gradePendingGameLines/)
    expect(validation).toMatch(/attachShadowGameLineCloses/)
    expect(validation).toMatch(/gameLineShadowPropId/)
    expect(validate).toMatch(/gradePendingGameLines/)
    expect(capture).toMatch(/attachShadowGameLineCloses/)
    expect(capture).toMatch(/0 Odds API/)
  })
})
