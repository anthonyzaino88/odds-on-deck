const fs = require('fs')
const path = require('path')

const oddsFetch = fs.readFileSync(path.join(__dirname, '../../scripts/fetch-live-odds.js'), 'utf8')
const opsOddsFetch = fs.readFileSync(path.join(__dirname, '../../operations/fetch-live-odds.js'), 'utf8')
const saveTop = fs.readFileSync(path.join(__dirname, '../../scripts/save-top-props-for-validation.js'), 'utf8')
const recordScript = fs.readFileSync(path.join(__dirname, '../../scripts/record-published-props.js'), 'utf8')
const validationSrc = fs.readFileSync(path.join(__dirname, '../../lib/validation.js'), 'utf8')
const pkg = fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')

describe('Published props are recorded when they clear the bar', () => {
  test('validation persist keeps cache QS and skips completed / game lines', () => {
    expect(validationSrc).toMatch(/export async function recordPublishedEligibleProp/)
    expect(validationSrc).toMatch(/export async function persistPublishedEligibleProps/)
    expect(validationSrc).toMatch(/export async function persistPublishedEligibleFromCache/)
    expect(validationSrc).toMatch(/toPublishedValidationFields/)
    expect(validationSrc).toMatch(/publishedValidationWritePlan/)
    expect(validationSrc).toMatch(/skip_foreign/)
    expect(validationSrc).toMatch(/will not adopt or relabel/)
    expect(validationSrc).toMatch(/Number\.isFinite\(cachedQuality\)/)
    expect(validationSrc).not.toMatch(/source: GAME_LINE_SOURCE[\s\S]{0,200}recordPublishedEligibleProp/)
  })

  test('odds-fetch records Published-eligible cache rows without a new Odds API call', () => {
    expect(oddsFetch).toMatch(/autoSavePublishedPropsForValidation/)
    expect(oddsFetch).toMatch(/isPublishedEligibleProp/)
    expect(oddsFetch).toMatch(/persistPublishedEligibleProps/)
    expect(oddsFetch).toMatch(/Reads PlayerPropCache only|no Odds API/)
    expect(oddsFetch).toMatch(/pickUnmappedOddsGame/)
    expect(oddsFetch).toMatch(/resolveTeamNameFallback/)
    expect(oddsFetch).toMatch(/resolvePropLanding/)
    expect(oddsFetch).toMatch(/oddsInsertPayload/)
    expect(oddsFetch).not.toMatch(/if all are mapped, fall back to closest-date mapped game/)
    expect(opsOddsFetch).toMatch(/resolveTeamNameFallback/)
    expect(opsOddsFetch).toMatch(/findGameByTeamNames\([^)]*game\.id\)/)
    expect(oddsFetch).toMatch(/findGameByTeamNames\([^)]*game\.id\)/)
  })

  test('save-top-props keeps cache qualityScore and includes the Published sweep', () => {
    expect(saveTop).toMatch(/isPublishedEligibleProp/)
    expect(saveTop).toMatch(/cohort:published/)
    expect(saveTop).toMatch(/Number\.isFinite\(cachedQuality\)/)
    expect(saveTop).not.toMatch(/qualityScore: calculateQualityScore\(/)
  })

  test('ops script and npm script exist for a no-quota persist', () => {
    expect(recordScript).toMatch(/persistPublishedEligibleFromCache/)
    expect(recordScript).toMatch(/does not call The Odds API/)
    expect(pkg).toMatch(/"record:published": "node scripts\/record-published-props\.js"/)
  })
})
