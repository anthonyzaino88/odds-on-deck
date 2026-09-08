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
    expect(html).toContain('Slate')
    expect(html).toContain('locked')
    expect(html).toContain('nothing we')
    expect(html).toContain('morning odds pull')
    expect(html).toContain('bad prices')
    expect(html).not.toContain('Published-eligible')
    expect(html).not.toContain('Published filters')
    expect(html).not.toMatch(/Short slate/)
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('Pile B')
    expect(html).not.toContain('no-edge fill')
  })

  test('empty slate with upcoming games says nothing cleared, not filter jargon', () => {
    const html = renderToStaticMarkup(
      <TodaysBoard
        board={{
          rows: [],
          lastNight: [],
          nextSlateAt: 'Wed, Sep 9, 7:05 PM ET',
          slate: todaysBoardSlateState(0),
          cohort: 'published',
        }}
      />,
    )
    expect(html).toContain('Nothing cleared we')
    expect(html).toContain('Next games Wed, Sep 9, 7:05 PM ET')
    expect(html).toContain('bad prices')
    expect(html).not.toContain('Published-eligible')
    expect(html).not.toContain('Next slate locks')
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
    expect(html).toContain('1 pick')
    expect(html).toContain('bad prices')
    expect(html).not.toContain('Juice Fav')
    expect(html).not.toContain('no-edge')
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
