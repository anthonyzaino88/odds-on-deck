/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { LineShopMeta } from '../../components/LineShopMeta.js'

describe('LineShopMeta', () => {
  test('hides the ladder when quotes are missing', () => {
    const html = renderToStaticMarkup(
      <LineShopMeta prop={{ bookmaker: 'FanDuel', odds: 1.91 }} />,
    )
    expect(html).not.toContain('ladder')
    expect(html).not.toContain('-book')
    expect(html).not.toContain('stale')
  })

  test('renders N-book, vs cons, stale, and expandable ladder', () => {
    const html = renderToStaticMarkup(
      <LineShopMeta
        prop={{
          numBooks: 2,
          consensusAmerican: -108,
          staleQuotes: true,
          quotes: [
            { book: 'FanDuel', american: -110, decimal: 1.91, ageMs: 60000, stale: false },
            { book: 'DraftKings', american: 105, decimal: 2.05, ageMs: 8 * 60 * 60 * 1000, stale: true },
          ],
        }}
      />,
    )
    expect(html).toContain('2-book')
    expect(html).toContain('vs cons')
    expect(html).toContain('-108')
    expect(html).toContain('2-book ladder')
    expect(html).toContain('FanDuel')
    expect(html).toContain('DraftKings')
    expect(html).toContain('stale')
  })
})
