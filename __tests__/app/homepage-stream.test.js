const fs = require('fs')
const path = require('path')

const pageSrc = fs.readFileSync(path.join(__dirname, '../../app/page.js'), 'utf8')
const hookSrc = fs.readFileSync(path.join(__dirname, '../../lib/homepage-hook.js'), 'utf8')
const boardSrc = fs.readFileSync(path.join(__dirname, '../../components/TodaysBoard.js'), 'utf8')

describe('homepage first-paint path', () => {
  test('hero is a sync server render and does not wait on board/proof/slate data', () => {
    expect(pageSrc).toMatch(/export default function HomePage/)
    expect(pageSrc).not.toMatch(/export default async function HomePage/)
    expect(pageSrc).toMatch(/<HomeHero/)
    expect(pageSrc).toMatch(/<Suspense/)
    expect(pageSrc).not.toMatch(/await Promise\.all/)
    expect(pageSrc).not.toMatch(/getHomepageProofStats\(/)
    expect(pageSrc).not.toMatch(/getHomepageBoard\(/)
    expect(pageSrc).not.toMatch(/getTodaysGames\(/)
  })

  test('Published proof and today\'s board stay on the page behind Suspense', () => {
    expect(pageSrc).toMatch(/<HomeProof/)
    expect(pageSrc).toMatch(/<HomeBoard/)
    expect(pageSrc).toMatch(/ProofStripSkeleton/)
    expect(pageSrc).toMatch(/BoardSkeleton/)
  })
})

describe('homepage public board is Published-only', () => {
  test('hook selects via selectTodaysBoardRows without Editor fill', () => {
    expect(hookSrc).toMatch(/selectTodaysBoardRows\(/)
    expect(hookSrc).not.toMatch(/editorsFill/)
    expect(hookSrc).toMatch(/homepage-board-published-only/)
    expect(hookSrc).toMatch(/todaysBoardSlateState/)
    expect(hookSrc).toMatch(/PUBLISHED_STATS_PREFILTER/)
  })

  test('board UI labels Published and tells an honest short/empty story', () => {
    expect(boardSrc).toMatch(/Published/)
    expect(boardSrc).toMatch(/Short slate/)
    expect(boardSrc).toMatch(/juice favorites/)
    expect(boardSrc).not.toMatch(/Editor's fill/)
  })
})
