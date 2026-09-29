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
  })

  test('Published stats SQL and homepage yesterday queries require system_generated', () => {
    const validation = read('lib/validation.js')
    const hook = read('lib/homepage-hook.js')
    const published = read('lib/published-picks.js')
    expect(validation).toMatch(/\.eq\('source', PUBLISHED_STATS_PREFILTER\.source\)/)
    expect(validation).toMatch(/SQL \+ JS both require source=system_generated/)
    expect(validation).not.toMatch(/source filters are not applied — this is the brand card/)
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
})
