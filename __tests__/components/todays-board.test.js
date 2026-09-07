/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import TodaysBoard from '../../components/TodaysBoard.js'
import { todaysBoardSlateState } from '../../lib/published-picks.js'

function publishedRow(name, overrides = {}) {
  return {
    key: name,
    source: 'published',
    playerName: name,
    sport: 'mlb',
    market: 'batter hits',
    pick: 'over',
    line: 1.5,
    odds: '-110',
    why: '+4.0% edge',
    href: null,
    ...overrides,
  }
}

describe('TodaysBoard honest slate UI', () => {
  test('empty slate does not invent filler rows', () => {
    const html = renderToStaticMarkup(
      <TodaysBoard
        board={{
          rows: [],
          lastNight: [],
          nextSlateAt: null,
          slate: todaysBoardSlateState(0),
          cohort: 'published',
        }}
      />,
    )
    expect(html).toContain('No Published-eligible props on the board yet.')
    expect(html).toContain('juice favorites')
    expect(html).not.toMatch(/Short slate/)
    expect(html).not.toContain('Juice Fav')
  })

  test('short slate (1–2) shows the real picks and says it will not pad', () => {
    const rows = [publishedRow('Only Pick')]
    const html = renderToStaticMarkup(
      <TodaysBoard
        board={{
          rows,
          lastNight: [],
          nextSlateAt: null,
          slate: todaysBoardSlateState(rows.length),
          cohort: 'published',
        }}
      />,
    )
    expect(html).toContain('Only Pick')
    expect(html).toContain('Published')
    expect(html).toContain('Short slate')
    expect(html).toContain('1 Published pick')
    expect(html).not.toContain('Juice Fav')
  })

  test('full slate labels Published and omits the short-slate note', () => {
    const rows = ['A', 'B', 'C'].map((name) => publishedRow(name))
    const html = renderToStaticMarkup(
      <TodaysBoard
        board={{
          rows,
          lastNight: [],
          nextSlateAt: null,
          slate: todaysBoardSlateState(rows.length),
          cohort: 'published',
        }}
      />,
    )
    expect(html).toContain('>A<')
    expect(html).toContain('>B<')
    expect(html).toContain('>C<')
    expect(html).toContain('Published')
    expect(html).not.toMatch(/Short slate/)
  })
})
