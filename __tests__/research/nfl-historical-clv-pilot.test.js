import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  CLV_PILOT_CONSTRAINTS,
  CLV_PILOT_PUBLIC_ELIGIBLE,
  S1_MIN_BOOKS,
  S1_MIN_PRICE_GAP,
  build2024RegSnapshotPlan,
  clvFromPair,
  computeClvReport,
  loadNflverseGames,
  parsePilotArgs,
  selectedByS1,
} from '../../lib/research/nfl-historical-clv-pilot.js'
import { evaluateSnapshot } from '../../lib/research/nfl-cross-book-sides.js'

const FIXTURE = JSON.parse(readFileSync(resolve('scripts/research/fixtures/nfl-historical-clv-pilot.json'), 'utf8'))
const NFLVERSE = readFileSync(resolve('scripts/research/fixtures/nfl-historical-clv-nflverse.csv'), 'utf8')

function fixtureEvaluations() {
  return FIXTURE.snapshots.map((snap) => {
    const evaluation = evaluateSnapshot(snap.body, {
      snapshotTs: snap.timestamp,
      phase: snap.phase,
    })
    evaluation.snapshotId = snap.snapshotId
    evaluation.week = snap.week
    return evaluation
  })
}

describe('NFL historical CLV pilot (research only)', () => {
  test('stays dark and records the credit cap', () => {
    expect(CLV_PILOT_PUBLIC_ELIGIBLE).toBe(false)
    expect(CLV_PILOT_CONSTRAINTS).toMatchObject({
      eligibleForPublic: false,
      writesProductionDb: false,
      regradesPicks: false,
      merges: false,
      hardCreditCap: 3000,
    })
    expect(S1_MIN_PRICE_GAP).toBe(0.03)
    expect(S1_MIN_BOOKS).toBe(3)
  })

  test('plans 36 weekly snapshots under the 140 / 3000 budget', () => {
    const plan = build2024RegSnapshotPlan()
    expect(plan.snapshotCount).toBe(36)
    expect(plan.expectedCostEach).toBe(20)
    expect(plan.expectedCostTotal).toBe(720)
    expect(plan.expectedCostTotal).toBeLessThanOrEqual(3000)
    expect(plan.snapshots[0]).toMatchObject({
      snapshotId: '2024_W01_early',
      phase: 'early',
      date: '2024-09-03T18:00:00Z',
    })
    expect(plan.snapshots[1]).toMatchObject({
      snapshotId: '2024_W01_late',
      phase: 'late',
      date: '2024-09-08T16:55:00Z',
    })
    expect(plan.snapshots.at(-1).snapshotId).toBe('2024_W18_late')

    const capped = build2024RegSnapshotPlan({ maxSnapshots: 200 })
    expect(capped.snapshotCount).toBeLessThanOrEqual(140)
  })

  test('fixture CLV uses late consensus fair vs early best implied', () => {
    const report = computeClvReport({
      evaluations: fixtureEvaluations(),
      nflverseGames: loadNflverseGames(NFLVERSE),
      mode: 'fixture',
    })

    expect(report.constraints.eligibleForPublic).toBe(false)
    expect(report.sample.snapshots).toBe(2)
    expect(report.sample.pairedSides).toBeGreaterThanOrEqual(2)

    const buf = report.pairs.find((row) => row.eventId === 'fixture-buf-mia-2024w1' && row.side === 'away')
    expect(buf?.early?.ok).toBe(true)
    expect(buf?.late?.ok).toBe(true)
    const expected = clvFromPair(buf.early, buf.late)
    expect(buf.clvRelative).toBeCloseTo(expected.clvRelative, 8)
    expect(buf.clvRelative).toBeCloseTo(
      (buf.late.consensusFair - buf.early.bestImplied) / buf.late.consensusFair,
      8,
    )
    expect(selectedByS1(buf.early)).toBe(true)
    expect(buf.selectedS1).toBe(true)
    expect(buf.result?.gameId).toBe('2024_01_BUF_MIA')
    expect(buf.outcome).toBe('win')
    expect(buf.profit).toBeCloseTo(buf.early.bestDecimalOdds - 1, 8)
    expect(report.ruleS1.n).toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(report.ruleS1.roi)).toBe(true)
  })

  test('TNF-only early quotes are not invented as a close', () => {
    const report = computeClvReport({
      evaluations: fixtureEvaluations(),
      mode: 'fixture',
    })
    const kc = report.pairs.find((row) => row.eventId === 'fixture-kc-bal-2024w1' && row.side === 'home')
    expect(kc?.early?.ok).toBe(true)
    expect(kc?.late).toBeFalsy()
    expect(kc?.clvRelative).toBeNull()
    expect(kc?.selectedS1).toBe(false)
  })

  test('dry-run is the default and live is explicit', () => {
    expect(parsePilotArgs([]).dryRun).toBe(true)
    expect(parsePilotArgs([]).live).toBe(false)
    expect(parsePilotArgs(['--fixture']).fixture).toBe(true)
    expect(parsePilotArgs(['--live']).live).toBe(true)
    expect(parsePilotArgs(['--max-credits', '9000']).maxCredits).toBe(3000)
    expect(parsePilotArgs(['--max-snapshots', '200']).maxSnapshots).toBe(140)
  })

  test('does not call fetch when scoring fixtures', () => {
    global.fetch.mockClear()
    computeClvReport({ evaluations: fixtureEvaluations(), mode: 'fixture' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
