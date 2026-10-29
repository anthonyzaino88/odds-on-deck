const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('private NHL shadow-published track stays off Published surfaces', () => {
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

  test('Published surfaces drop every shadow tag; archive/insights drop shadow-only only', () => {
    const hook = read('lib/homepage-hook.js')
    const picks = read('lib/picks.js')
    const generator = read('lib/simple-parlay-generator.js')
    const validation = read('lib/validation.js')
    const report = read('scripts/report-published-clv.js')
    const insights = read('lib/performance-analyzer.js')
    const api = read('app/api/validation/route.js')
    const page = read('app/validation/page.js')

    expect(hook).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(hook).toMatch(/\.in\('sport', PUBLISHED_SPORTS\)/)
    expect(hook).not.toMatch(/SHADOW_PUBLISHED_SPORTS/)

    expect(picks).toMatch(/\.in\('sport', PUBLISHED_SPORTS\)/)
    expect(picks).not.toMatch(/SHADOW_PUBLISHED_SPORTS/)
    expect(picks).not.toMatch(/cohort:shadow-published/)

    expect(generator).toMatch(/return \[\.\.\.PUBLISHED_SPORTS\]/)
    expect(generator).not.toMatch(/SHADOW_PUBLISHED_SPORTS/)

    const publishedFetch = validation.slice(
      validation.indexOf('async function fetchPublishedStatsRecords'),
      validation.indexOf('export async function getPublishedPicksStats'),
    )
    expect(publishedFetch).toMatch(/applyShadowPublishedNotesExclusion/)
    expect(publishedFetch).toMatch(/withoutShadowPublished/)
    expect(report).toMatch(/applyShadowPublishedNotesExclusion/)

    const archiveFetch = validation.slice(
      validation.indexOf('async function fetchCompletedValidations'),
      validation.indexOf('async function fetchPublishedStatsRecords'),
    )
    expect(archiveFetch).toMatch(/applyPublicArchiveNotesFilter/)
    expect(archiveFetch).toMatch(/filterPublicArchiveRows/)

    const recordsFetch = validation.slice(
      validation.indexOf('export async function getValidationRecords'),
      validation.indexOf('export async function getValidationCounts'),
    )
    expect(recordsFetch).toMatch(/applyPublicArchiveNotesFilter/)
    expect(recordsFetch).toMatch(/filterPublicArchiveRows/)

    const countsFetch = validation.slice(
      validation.indexOf('export async function getValidationCounts'),
      validation.indexOf('export async function getAccuracyByEdge'),
    )
    expect(countsFetch).toMatch(/applyPublicArchiveNotesFilter/)

    const edgeFetch = validation.slice(
      validation.indexOf('export async function getAccuracyByEdge'),
      validation.indexOf('export async function getMostAccuratePropTypes'),
    )
    expect(edgeFetch).toMatch(/applyPublicArchiveNotesFilter/)
    expect(edgeFetch).toMatch(/filterPublicArchiveRows/)

    expect(insights).toMatch(/applyPrivateShadowPublishedNotesExclusion/)
    expect(insights).toMatch(/withoutPrivateShadowPublished/)
    expect(page).toMatch(/getValidationRecords\(\{ limit: 50, excludePending: true \}\)/)
    expect(page).toMatch(/getValidationCounts/)
    expect(api).toMatch(/toPublicValidationRecord/)
    expect(api).toMatch(/getAccuracyByEdge/)
  })

  test('repair and NHL grade writers preserve cohort tags instead of overwriting notes', () => {
    const unplayed = read('lib/unplayed-game-grades.js')
    const sog = read('lib/repair-nhl-sog-grades.js')
    const dnp = read('lib/repair-dnp-grades.js')
    const forceAll = read('scripts/force-validate-all-nhl.js')
    const revalidate = read('scripts/revalidate-nhl-props.js')
    const forceOld = read('scripts/force-validate-old-props.js')
    const validation = read('lib/validation.js')
    expect(unplayed).toMatch(/UNPLAYED_PROP_SELECT/)
    expect(unplayed).toMatch(/notes/)
    expect(read('scripts/report-unplayed-game-grades.js')).toMatch(/loadUnplayedValidations/)
    expect(read('scripts/repair-nhl-sog-grades.js')).toMatch(/\.select\('\*'\)/)
    expect(read('scripts/repair-dnp-grades.js')).toMatch(/\.select\('\*'\)/)
    expect(unplayed).toMatch(/withPreservedCohortNotes\(item\.notes/)
    expect(sog).toMatch(/withPreservedCohortNotes\(\s*row\.notes/)
    expect(dnp).toMatch(/withPreservedCohortNotes\(row\?\.notes/)
    expect(forceAll).toMatch(/withPreservedCohortNotes\(prop\.notes/)
    expect(revalidate).toMatch(/withPreservedCohortNotes\(\s*validation\.notes/)
    expect(forceOld).toMatch(/withPreservedCohortNotes\(prop\.notes/)
    expect(validation).toMatch(/publishedValidationUpdateFields\(existing, fields, game/)
    expect(validation).toMatch(/publishedPersistNotes\(existing\?\.notes/)
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
