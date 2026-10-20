import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ACTIVE_GAME_STATUSES,
  DEAD,
  FINAL,
  LIVE,
  PRE_START,
  RETIRABLE_PRE_START,
  classifyVendorStatus,
  isDeadStatus,
  isFinalStatus,
  isLiveStatus,
  isPreStartStatus,
  isStartedOrEndedStatus,
} from '../../lib/game-status.js'
import { mapNFLStatus } from '../../lib/vendors/nfl-stats.js'
import { ACTIVE_GAME_STATUSES as MlbActive } from '../../lib/mlb-live-status.js'

function statusMapValues(src) {
  const blocks = [...src.matchAll(/const statusMap = \{[\s\S]*?\}/g)]
  expect(blocks.length).toBeGreaterThanOrEqual(3)
  return blocks.flatMap((block) => [...block[0].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]))
}

describe('game-status buckets', () => {
  test('LIVE includes halftime and warmup; DEAD includes not_needed', () => {
    expect(LIVE.has('halftime')).toBe(true)
    expect(LIVE.has('warmup')).toBe(true)
    expect(DEAD.has('cancelled')).toBe(true)
    expect(DEAD.has('postponed')).toBe(true)
    expect(DEAD.has('not_needed')).toBe(true)
    expect(RETIRABLE_PRE_START).toBe(PRE_START)
    expect(RETIRABLE_PRE_START.has('scheduled')).toBe(true)
    expect(RETIRABLE_PRE_START.has('not_needed')).toBe(false)
  })

  test('ACTIVE_GAME_STATUSES includes halftime so the updater keeps selecting NFL', () => {
    expect(ACTIVE_GAME_STATUSES).toContain('halftime')
    expect(ACTIVE_GAME_STATUSES).toContain('warmup')
    expect(MlbActive).toBe(ACTIVE_GAME_STATUSES)
  })

  test('membership helpers accept aliases', () => {
    expect(isLiveStatus('STATUS_IN_PROGRESS')).toBe(true)
    expect(isLiveStatus('in-progress')).toBe(true)
    expect(isLiveStatus('halftime')).toBe(true)
    expect(isFinalStatus('STATUS_FINAL')).toBe(true)
    expect(isFinalStatus('game over')).toBe(true)
    expect(isPreStartStatus('pre-game')).toBe(true)
    expect(isPreStartStatus('delayed_start')).toBe(true)
    expect(isDeadStatus('canceled')).toBe(true)
    expect(isDeadStatus('not_needed')).toBe(true)
    expect(isStartedOrEndedStatus('warmup')).toBe(true)
    expect(isStartedOrEndedStatus('halftime')).toBe(true)
    expect(isStartedOrEndedStatus('scheduled')).toBe(false)
  })

  test('ESPN state=post postponed is never FINAL', () => {
    expect(FINAL.has('post')).toBe(false)
    expect(isFinalStatus('post')).toBe(false)
    expect(isFinalStatus('postponed')).toBe(false)
    expect(classifyVendorStatus('postponed')).toBe('dead')
    expect(isStartedOrEndedStatus('postponed')).toBe(false)

    const postponed = {
      type: { state: 'post', name: 'STATUS_POSTPONED', detail: 'Postponed' },
    }
    expect(isFinalStatus(postponed)).toBe(false)
    expect(isDeadStatus(postponed)).toBe(true)
    expect(classifyVendorStatus(postponed)).toBe('dead')

    const cancelled = {
      type: { state: 'post', name: 'STATUS_CANCELED', detail: 'Canceled' },
    }
    expect(isFinalStatus(cancelled)).toBe(false)
    expect(isDeadStatus(cancelled)).toBe(true)

    const barePost = { type: { state: 'post' } }
    expect(isFinalStatus(barePost)).toBe(false)
    expect(classifyVendorStatus(barePost)).toBeNull()

    const finished = {
      type: { state: 'post', name: 'STATUS_FINAL', completed: true },
    }
    expect(isFinalStatus(finished)).toBe(true)
    expect(isDeadStatus(finished)).toBe(false)
    expect(classifyVendorStatus(finished)).toBe('final')
  })
})

describe('vendor-emitted Game.status contract', () => {
  test('every status fetch-fresh-games and mapNFLStatus write is classified', () => {
    const freshSrc = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')
    expect(freshSrc).toMatch(/STATUS_HALFTIME/)
    const fromMaps = statusMapValues(freshSrc)

    const fromNflMapper = [
      mapNFLStatus({ type: { state: 'pre' } }),
      mapNFLStatus({ type: { state: 'in', detail: 'Halftime' } }),
      mapNFLStatus({ type: { state: 'in', detail: 'Q2 4:12' } }),
      mapNFLStatus({ type: { state: 'post' } }),
      mapNFLStatus({ type: { state: 'post', detail: 'Final' } }),
      mapNFLStatus({ type: { detail: 'Postponed' } }),
      mapNFLStatus({ type: { detail: 'Cancelled' } }),
      mapNFLStatus({ type: { detail: 'Canceled' } }),
      mapNFLStatus({ type: { detail: 'Suspended' } }),
      mapNFLStatus({ type: { detail: 'Delayed' } }),
      mapNFLStatus({}),
    ]

    const emitted = [...new Set([...fromMaps, ...fromNflMapper])]
    expect(emitted).toEqual(expect.arrayContaining([
      'scheduled',
      'in_progress',
      'final',
      'halftime',
      'delayed',
      'postponed',
      'cancelled',
      'suspended',
    ]))

    const unclassified = emitted.filter((status) => classifyVendorStatus(status) == null)
    expect(unclassified).toEqual([])
  })
})
