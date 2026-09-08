const fs = require('fs')
const path = require('path')

const PUBLIC_UI = [
  'app/picks/page.js',
  'app/page.js',
  'app/validation/page.js',
  'components/EditorsPicksDesk.js',
  'components/TodaysBoard.js',
  'components/HomeMarketing.js',
  'components/HomeHero.js',
  'components/PublishedProofStrip.js',
  'components/PublishedPicksCard.js',
  'components/SidesAndTotalsCard.js',
  'app/glossary/GlossaryArticle.js',
]

const PATH_AS_LABEL = />\s*\/(validation|picks|props|slate|games)\s*</

describe('public UI does not show route paths as link text', () => {
  test.each(PUBLIC_UI)('%s uses natural words for site links', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
    expect(src).not.toMatch(PATH_AS_LABEL)
  })
})
