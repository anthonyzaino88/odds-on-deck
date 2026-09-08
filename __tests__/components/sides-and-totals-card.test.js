/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import SidesAndTotalsCard from '../../components/SidesAndTotalsCard.js'

function ml(overrides = {}) {
  return {
    gameId: 'g-ml',
    type: 'moneyline',
    pick: 'NYY',
    team: 'NYY',
    homeTeam: 'NYY',
    awayTeam: 'BOS',
    edge: 0.062,
    odds: -120,
    sport: 'mlb',
    why: 'Model sees 6.2% more than the price implies',
    matchupInsight: 'Hot streak: 8-2 recent form',
    ...overrides,
  }
}

function total(overrides = {}) {
  return {
    gameId: 'g-ou',
    type: 'total',
    pick: 'over',
    threshold: 8.5,
    homeTeam: 'NYY',
    awayTeam: 'BOS',
    edge: 0.07,
    odds: -105,
    sport: 'mlb',
    why: 'Model sees 7.0% more than the price implies',
    ...overrides,
  }
}

describe('SidesAndTotalsCard', () => {
  test('empty slate is honest and does not invent locks', () => {
    const html = renderToStaticMarkup(<SidesAndTotalsCard lines={[]} loading={false} />)
    expect(html).toContain('No sides or totals with an edge right now')
    expect(html).toContain('honest count')
    expect(html).not.toContain('Pile C')
    expect(html).not.toMatch(/>\s*\/validation\s*</)
    expect(html).not.toContain('NYY')
  })

  test('shows pick, price, and why — ML and totals in separate groups', () => {
    const html = renderToStaticMarkup(
      <SidesAndTotalsCard lines={[ml(), total()]} loading={false} />,
    )
    expect(html).toContain('NYY')
    expect(html).toContain('ML')
    expect(html).toContain('OVER 8.5')
    expect(html).toContain('-120')
    expect(html).toContain('Model sees 6.2% more than the price implies')
    expect(html).toContain('Hot streak: 8-2 recent form')
    expect(html).toContain('Moneyline')
    expect(html).toContain('Game totals')
    expect(html).not.toContain('Pile C')
    expect(html).not.toContain('NHL')
  })

  test('separate record stays honest at sample 0', () => {
    const html = renderToStaticMarkup(
      <SidesAndTotalsCard
        lines={[]}
        loading={false}
        summary={{ graded: 0, record: '0–0', units: 0 }}
      />,
    )
    expect(html).toContain('No graded sides or totals yet')
    expect(html).toContain('public track record')
    expect(html).not.toMatch(/>\s*\/validation\s*</)
  })
})
