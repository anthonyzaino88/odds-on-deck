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

describe("EditorsPicksDesk honest public copy", () => {
  test('empty slate does not invent filler rows', () => {
    const html = renderToStaticMarkup(<EditorsPicksDesk picks={[]} loading={false} />)
    expect(html).toContain("Nothing we")
    expect(html).toContain('bet right now')
    expect(html).toContain('honest count')
    expect(html).not.toMatch(/Just 1 pick/)
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('Published-shaped')
    expect(html).not.toContain('no-edge fill')
  })

  test('short slate (1–2) shows the real picks and says it will not pad', () => {
    const html = renderToStaticMarkup(
      <EditorsPicksDesk picks={[publishedPick('Only Pick')]} loading={false} />,
    )
    expect(html).toContain('Only Pick')
    expect(html).toContain('Published')
    expect(html).toContain('Just 1 pick today')
    expect(html).toContain('invent a longer list')
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('NHL')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('Published-shaped')
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
    expect(html).toContain('What makes the list')
    expect(html).toContain('Skip')
    expect(html).not.toMatch(/Just \d+ pick/)
    expect(html).not.toContain('NHL Picks')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('Published-shaped')
  })
})
