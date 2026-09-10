import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('Featured parlays contract — Phase A Published bar', () => {
  test('Featured fetch asks the generator for featured quality', () => {
    const page = read('app/parlays/page.js')
    expect(page).toMatch(/featured=1/)
    expect(page).toMatch(/type=single_game&featured=1/)
    expect(page).not.toMatch(/\/api\/parlays\/generate\?sport=\$\{s\}&legs=3&maxParlays=1`/)
  })

  test('Featured page is MLB + NFL only — NHL stays off the public Featured card', () => {
    const page = read('app/parlays/page.js')
    expect(page).toMatch(/const sports = \['mlb', 'nfl'\]/)
    expect(page).not.toMatch(/const sports = \['mlb', 'nhl', 'nfl'\]/)
  })

  test('Featured copy is honest: Published-eligible, empty when thin', () => {
    const page = read('app/parlays/page.js')
    expect(page).toMatch(/Published-eligible/)
    expect(page).toMatch(/Empty when the slate is thin/)
    expect(page).not.toMatch(/Auto-generated from best lines/)
    expect(page).not.toMatch(/None cleared the quality bar today/)
  })

  test('GET generate forwards featured and pins Featured to FEATURED_LEG_COUNT', () => {
    const route = read('app/api/parlays/generate/route.js')
    expect(route).toMatch(/searchParams\.get\('featured'\)/)
    expect(route).toMatch(/featured,/)
    expect(route).toMatch(/FEATURED_LEG_COUNT/)
    expect(route).toMatch(/legCount: isFeatured \? FEATURED_LEG_COUNT : legCount/)
    expect(route).toMatch(/const featuredLegCount = featured \? FEATURED_LEG_COUNT : legCount/)
  })

  test('generator never assigns playerId from propId', () => {
    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).not.toMatch(/playerId:\s*prop\.propId/)
    expect(generator).not.toMatch(/playerId:\s*prop\.propId\s*\|\|/)
    expect(generator).toMatch(/playerCorrelationKey/)
    expect(generator).toMatch(/assembleParlays/)
  })

  test('Featured path reuses Published eligibility — no forked prob/EV bar', () => {
    const integrity = read('lib/parlay-integrity.js')
    expect(integrity).toMatch(/isPublishedEligibleProp/)
    expect(integrity).toMatch(/TODAYS_BOARD_MIN_PUBLISHED/)
    expect(integrity).toMatch(/export const FEATURED_LEG_COUNT = TODAYS_BOARD_MIN_PUBLISHED/)
    expect(integrity).toMatch(/return isPublishedEligibleProp\(featuredLegAsPublishedRecord\(leg\)\)/)
    expect(integrity).not.toMatch(/FEATURED_MAX_LEG_PROBABILITY/)
    expect(integrity).not.toMatch(/FEATURED_MIN_LEG_PROBABILITY/)
    expect(integrity).not.toMatch(/FEATURED_UNDER_15_MAX_PROBABILITY/)
    expect(integrity).not.toMatch(/FEATURED_MIN_EV/)
    expect(integrity).not.toMatch(/isJuiceHeavyFavorite/)

    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).toMatch(/generateFeaturedPublishedParlays/)
    expect(generator).toMatch(/PUBLISHED_SPORTS/)
    expect(generator).toMatch(/PUBLISHED_STATS_PREFILTER/)
    expect(generator).toMatch(/isFeaturedQualityLeg/)
    expect(generator).toMatch(/\.gt\('gameTime', now\)/)
    expect(generator).toMatch(/\.eq\('isStale', false\)/)
    expect(generator).toMatch(/\.gte\('expiresAt', now\)/)
  })

  test('builder stays exploratory — no Published-mode toggle, no featured flag', () => {
    const builder = read('components/ParlayBuilder.js')
    expect(builder).not.toMatch(/featured/)
    expect(builder).not.toMatch(/Published-mode/)
    expect(builder).not.toMatch(/isPublishedEligibleProp/)
    expect(builder).toMatch(/filterMode/)
    expect(builder).toMatch(/2-Leg Parlay/)
  })
})
