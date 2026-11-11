const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const PUBLIC_SURFACES = [
  'app/layout.js',
  'app/page.js',
  'app/validation/page.js',
  'app/sitemap.js',
  'app/picks/page.js',
  'app/props/page.js',
  'app/games/page.js',
  'app/parlays/page.js',
  'app/dfs/page.js',
  'app/mlb/page.js',
  'app/nfl/page.js',
  'app/nhl/page.js',
  'components/HomeHero.js',
  'components/HomeMarketing.js',
  'components/PublishedProofStrip.js',
  'components/PublishedPicksCard.js',
  'components/MobileNav.js',
]

describe('Insights page is retired', () => {
  test('next.config permanently redirects /insights to /validation', async () => {
    const config = require('../../next.config.js')
    const rules = await config.redirects()
    expect(rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: '/insights',
        destination: '/validation',
        permanent: true,
      }),
    ]))
  })

  test('insights route is a permanent redirect with no Insights dashboard', () => {
    const src = read('app/insights/page.js')
    expect(src).toMatch(/permanentRedirect\(['"]\/validation['"]\)/)
    expect(src).not.toMatch(/InsightsBreakdown/)
    expect(src).not.toMatch(/analyzePerformance/)
    expect(src).not.toMatch(/Profitable/)
    expect(src).not.toMatch(/Performance Insights/)
    expect(src).not.toMatch(/canonical: 'https:\/\/oddsondeck.com\/insights'/)
  })

  test('public UI copy does not link to or advertise Insights', () => {
    for (const rel of PUBLIC_SURFACES) {
      const src = read(rel)
      expect(src).not.toMatch(/href=['"]\/insights['"]/)
      expect(src).not.toMatch(/href: '\/insights'/)
      expect(src).not.toMatch(/View Insights/)
      expect(src).not.toMatch(/\$\{SITE_URL\}\/insights/)
    }
    expect(read('app/layout.js')).not.toMatch(/label: 'Insights'/)
    expect(read('app/sitemap.js')).not.toMatch(/\/insights/)
  })

  test('retired Insights dashboard files are gone', () => {
    expect(fs.existsSync(path.join(root, 'components/InsightsBreakdown.js'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'lib/performance-analyzer.js'))).toBe(false)
  })

  test('Published card shows honest CLV, not a profitability claim', () => {
    const card = read('components/PublishedPicksCard.js')
    expect(card).toMatch(/Closing-line value/)
    expect(card).toMatch(/PublishedClvBlock/)
    expect(card).toMatch(/avgClvProb/)
    expect(card).toMatch(/pctBeatClose/)
    expect(card).toMatch(/sameLine/)
    expect(card).toMatch(/small sample/)
    expect(card).toMatch(/price-quality signal/)
    expect(card).not.toMatch(/Profitable/)
    expect(card).not.toMatch(/System is profitable/)
    expect(card).toMatch(/not a claim that the track is profitable/)
    expect(card).toMatch(/shadow NHL/)
  })
})
