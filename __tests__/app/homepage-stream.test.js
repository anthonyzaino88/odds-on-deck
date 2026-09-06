const fs = require('fs')
const path = require('path')

const pageSrc = fs.readFileSync(path.join(__dirname, '../../app/page.js'), 'utf8')

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
