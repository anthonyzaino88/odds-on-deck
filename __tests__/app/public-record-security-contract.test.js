import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('public-record write surfaces stay closed', () => {
  test('validation GET remains; POST handler is gone', () => {
    const route = read('app/api/validation/route.js')
    expect(route).toMatch(/export async function GET/)
    expect(route).not.toMatch(/export async function POST/)
    expect(route).not.toMatch(/updatePropResult/)
  })

  test('props save route does not call recordPropPrediction', () => {
    const route = read('app/api/props/save/route.js')
    expect(route).toMatch(/gone\(/)
    expect(route).not.toMatch(/recordPropPrediction/)
    expect(route).not.toMatch(/user_saved/)
  })

  test('Track/Save uses localStorage only and never POSTs the cache propId', () => {
    const ui = read('components/PlayerPropsFilter.js')
    expect(ui).toMatch(/function addSavedProp/)
    expect(ui).toMatch(/addSavedProp\(propKey\)/)
    expect(ui).not.toMatch(/\/api\/props\/save/)
    expect(ui).not.toMatch(/JSON\.stringify\(\{ prop \}\)/)
    expect(ui).toMatch(/not part of the public record/)
    expect(ui).toMatch(/this browser only/)
    expect(ui).toMatch(/isSaved \? '✓ Saved' : isSaving \? '\.\.\.' : 'Save'/)
    expect(ui).not.toMatch(/Track/)
    expect(ui).not.toMatch(/Tracking/)
  })

  test('Published stats SQL and homepage yesterday queries require system_generated', () => {
    const validation = read('lib/validation.js')
    const hook = read('lib/homepage-hook.js')
    const published = read('lib/published-picks.js')
    expect(validation).toMatch(/\.eq\('source', PUBLISHED_STATS_PREFILTER\.source\)/)
    expect(validation).toMatch(/SQL \+ JS both require source=system_generated/)
    expect(validation).not.toMatch(/source filters are not applied — this is the brand card/)
    expect(validation).not.toMatch(/\.not\('source', 'eq', GAME_LINE_SOURCE\)/)
    expect(hook).toMatch(/\.eq\('source', PUBLISHED_SOURCE\)/)
    expect(published).toMatch(/isPublishedTrackSource/)
    expect(published).toMatch(/source: PUBLISHED_SOURCE/)
  })

  test('CRON_SECRET is not referenced from client components', () => {
    const filter = read('components/PlayerPropsFilter.js')
    const results = read('components/ParlayResults.js')
    expect(filter).not.toMatch(/CRON_SECRET/)
    expect(results).not.toMatch(/CRON_SECRET/)
    expect(filter).not.toMatch(/NEXT_PUBLIC_CRON/)
    expect(results).not.toMatch(/NEXT_PUBLIC_CRON/)
  })

  test('no API route imports recordPropPrediction; only generate persists Featured', () => {
    const { readdirSync, readFileSync, statSync } = require('fs')
    const { join } = require('path')
    const walk = (dir) => {
      const files = []
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) files.push(...walk(full))
        else if (name.endsWith('.js')) files.push(full)
      }
      return files
    }
    const generate = join(process.cwd(), 'app/api/parlays/generate/route.js')
    for (const file of walk(join(process.cwd(), 'app/api'))) {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/recordPropPrediction/)
      if (file !== generate) {
        expect(src).not.toMatch(/persistFeaturedClearedParlay/)
      }
    }
    const generateSrc = readFileSync(generate, 'utf8')
    expect(generateSrc).toMatch(/persistFeaturedClearedParlays/)
    expect(generateSrc).toMatch(/persistFeaturedIfNeeded/)
    expect(generateSrc.match(/resolveFeaturedGenerate/g).length).toBeGreaterThanOrEqual(3)
  })

  test('privacy and validation copy no longer claim visitor saves live in the DB', () => {
    const privacy = read('app/privacy/page.js')
    const validation = read('app/validation/page.js')
    expect(privacy).toMatch(/stored only in your browser/)
    expect(privacy).not.toMatch(/stored anonymously in our database/)
    expect(validation).not.toMatch(/Your Saved Picks/)
    expect(validation).toMatch(/Visitor saves now live in the browser only/)
    expect(validation).toMatch(/record\.result === 'void'/)
    expect(validation).toMatch(/manual_closed/)
  })
})
