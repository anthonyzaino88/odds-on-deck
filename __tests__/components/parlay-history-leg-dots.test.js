/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import ParlayHistory from '../../components/ParlayHistory.js'

jest.mock('next/link', () => {
  return function LinkMock({ href, children, ...props }) {
    return <a href={href} {...props}>{children}</a>
  }
})

function featuredCard({ id, status, legs }) {
  return {
    id,
    status,
    sport: 'mlb',
    totalOdds: 6.97,
    probability: 0.14,
    edge: 0.12,
    confidence: 'medium',
    createdAt: '2026-09-13T20:00:00.000Z',
    notes: 'cohort:featured snapshot:featured:mlb:multi:2026-09-13',
    legs,
  }
}

function propLeg({ name, selection, threshold, actualValue, validationResult, outcome, propType = 'batter_hits' }) {
  return {
    id: `leg-${name}`,
    playerName: name,
    propType,
    selection,
    threshold,
    actualValue,
    validationResult,
    outcome,
  }
}

describe('Featured history leg dots', () => {
  test('losing overs with actual below the line render red, not green', () => {
    const html = renderToStaticMarkup(
      <ParlayHistory
        initialParlays={[
          featuredCard({
            id: 'otton-lost',
            status: 'lost',
            legs: [
              propLeg({
                name: 'Cade Otton',
                selection: 'over',
                threshold: 3.5,
                actualValue: 3,
                validationResult: 'correct',
                outcome: 'lost',
                propType: 'player_receptions',
              }),
              propLeg({
                name: 'Vinnie Pasquantino',
                selection: 'over',
                threshold: 1.5,
                actualValue: 0,
                validationResult: 'correct',
                outcome: 'lost',
                propType: 'batter_total_bases',
              }),
            ],
          }),
        ]}
      />,
    )

    expect(html).toContain('>lost<')
    expect(html).toContain('Cade Otton')
    expect(html).toContain('Vinnie Pasquantino')
    expect(html).toContain('Actual: 3')
    expect(html).toContain('Actual: 0')
    expect(html).toContain('title="Lost"')
    expect(html).not.toContain('title="Won"')
    expect(html).toMatch(/bg-red-400/)
    expect(html).not.toMatch(/bg-green-400/)
  })

  test('Schultz / Murray / Goff hits render green on a WON card', () => {
    const html = renderToStaticMarkup(
      <ParlayHistory
        initialParlays={[
          featuredCard({
            id: 'sunday-won',
            status: 'won',
            legs: [
              propLeg({
                name: 'Dalton Schultz',
                selection: 'over',
                threshold: 3.5,
                actualValue: 4,
                propType: 'player_receptions',
              }),
              propLeg({
                name: 'Kyler Murray',
                selection: 'under',
                threshold: 1.5,
                actualValue: 0,
                propType: 'player_pass_tds',
              }),
              propLeg({
                name: 'Jared Goff',
                selection: 'over',
                threshold: 1.5,
                actualValue: 2,
                propType: 'player_pass_tds',
              }),
            ],
          }),
        ]}
      />,
    )

    expect(html).toContain('>won<')
    expect(html).toContain('Dalton Schultz')
    expect(html).toContain('Kyler Murray')
    expect(html).toContain('Jared Goff')
    expect(html).toContain('title="Won"')
    expect(html).not.toContain('title="Lost"')
    expect(html).toMatch(/bg-green-400/)
    expect(html).not.toMatch(/bg-red-400/)
  })
})
