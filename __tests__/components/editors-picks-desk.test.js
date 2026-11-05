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
    expect(html).toContain("Slate")
    expect(html).toContain('morning odds pull')
    expect(html).toContain('public track record')
    expect(html).not.toMatch(/Just 1 pick/)
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('Published-shaped')
    expect(html).not.toContain('no-edge fill')
    expect(html).not.toContain('odds refresh')
    expect(html).not.toMatch(/>\s*\/validation\s*</)
  })

  test('short slate (1–2) shows the real picks and says it will not pad', () => {
    const html = renderToStaticMarkup(
      <EditorsPicksDesk picks={[publishedPick('Only Pick')]} loading={false} />,
    )
    expect(html).toContain('Only Pick')
    expect(html).toContain('Published')
    expect(html).toContain('Just 1 pick today')
    expect(html).toContain('invent a longer list')
    expect(html).toContain('public track record')
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('NHL')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('Published-shaped')
    expect(html).not.toMatch(/>\s*\/validation\s*</)
  })

  test('player-prop cards reuse LineShopMeta ladder, vs cons, and stale flags', () => {
    const pick = publishedPick('Tyler Shough', {
      sport: 'nfl',
      propType: 'player_pass_yds',
      bookmaker: 'FanDuel',
      numBooks: 2,
      bestBook: 'DraftKings',
      consensusAmerican: 105,
      staleQuotes: true,
      quotes: [
        { book: 'FanDuel', american: -110, decimal: 1.91, ageMs: 120000, stale: false },
        { book: 'DraftKings', american: 110, decimal: 2.10, ageMs: 8 * 60 * 60 * 1000, stale: true },
      ],
    })
    const html = renderToStaticMarkup(
      <EditorsPicksDesk picks={[pick]} loading={false} />,
    )
    expect(html).toContain('Tyler Shough')
    expect(html).toContain('2-book')
    expect(html).toContain('vs cons')
    expect(html).toContain('+105')
    expect(html).toContain('2-book ladder')
    expect(html).toContain('FanDuel')
    expect(html).toContain('DraftKings')
    expect(html).toContain('stale')
    expect(html).not.toContain('Pile B')
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
    expect(html).toContain('public track record')
    expect(html).not.toMatch(/Just \d+ pick/)
    expect(html).not.toContain('NHL Picks')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('Published-shaped')
    expect(html).not.toMatch(/>\s*\/validation\s*</)
  })
})
