/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import EditorsPicksDesk from '../../components/EditorsPicksDesk.js'

jest.mock('../../components/ShareButton.js', () => {
  return function ShareButtonMock() {
    return null
  }
})

function publishedPick(name, overrides = {}) {
  return {
    propId: `p-${name}`,
    gameId: `g-${name}`,
    type: 'player_prop',
    propType: 'batter_hits',
    playerName: name,
    pick: 'over',
    threshold: 1.5,
    odds: -110,
    edge: 0.05,
    qualityScore: 50,
    sport: 'mlb',
    probability: 0.54,
    ...overrides,
  }
}

describe("EditorsPicksDesk honest Published-shaped UI", () => {
  test('empty slate does not invent filler rows', () => {
    const html = renderToStaticMarkup(<EditorsPicksDesk picks={[]} loading={false} />)
    expect(html).toContain("No Published-shaped Editor")
    expect(html).toContain('juice favorites')
    expect(html).not.toMatch(/Short slate/)
    expect(html).not.toContain('Juice Fav')
  })

  test('short slate (1–2) shows the real picks and says it will not pad', () => {
    const html = renderToStaticMarkup(
      <EditorsPicksDesk picks={[publishedPick('Only Pick')]} loading={false} />,
    )
    expect(html).toContain('Only Pick')
    expect(html).toContain('Published')
    expect(html).toContain('Short slate')
    expect(html).toContain("1 Editor's pick")
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('NHL')
  })

  test('full slate labels Published and omits NHL / short-slate note', () => {
    const picks = [
      publishedPick('A', { sport: 'mlb' }),
      publishedPick('B', { sport: 'nfl' }),
      publishedPick('C', { sport: 'mlb' }),
    ]
    const html = renderToStaticMarkup(<EditorsPicksDesk picks={picks} loading={false} />)
    expect(html).toContain('>A<')
    expect(html).toContain('>B<')
    expect(html).toContain('>C<')
    expect(html).toContain('Published')
    expect(html).toContain('Published-shaped bar')
    expect(html).not.toMatch(/Short slate/)
    expect(html).not.toContain('NHL Picks')
  })
})
