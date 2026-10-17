import {
  applyEventRemap,
  doubleheaderTwins,
  etDateKey,
  planEventRemap,
  shouldCheckPropsCache,
} from '../../lib/odds-event-remap.js'
import { eventCommenceMs } from '../../lib/live-odds-landing.js'

const G16 = { id: 'TB_at_CLE_2026-10-16', date: '2026-10-17T00:00:00', oddsApiEventId: 'a681-stale' }
const G17 = { id: 'TB_at_CLE_2026-10-17', date: '2026-10-18T00:00:00', oddsApiEventId: 'b9d2' }
const EV = eventCommenceMs('2026-10-17T00:00:00Z') // tonight 8 PM ET

function mockSupabase(failures = []) {
  const ops = []
  return {
    ops,
    from(table) {
      return {
        update(payload) {
          const op = { table, payload, filters: [] }
          const chain = {
            eq(col, val) {
              op.filters.push([col, val])
              return chain
            },
            then(resolve, reject) {
              ops.push(op)
              const idx = ops.length - 1
              const fail = failures.find((f) => f.at === idx)
              return Promise.resolve({ error: fail ? fail.error : null }).then(resolve, reject)
            },
          }
          return chain
        },
      }
    },
  }
}
const quiet = { error() {}, log() {} }

describe('etDateKey / doubleheaderTwins', () => {
  test('ET calendar date of a zone-less UTC Game.date', () => {
    expect(etDateKey('2026-10-17T00:00:00')).toBe('2026-10-16') // 8 PM ET 10/16
    expect(etDateKey(null)).toBeNull()
  })
  test('finds same-ET-day twins', () => {
    const g1 = { id: 'a', date: '2026-07-04T17:05:00' }
    const g2 = { id: 'b', date: '2026-07-04T23:10:00' }
    const g3 = { id: 'c', date: '2026-07-05T23:10:00' }
    expect(doubleheaderTwins(g1, [g1, g2, g3]).map((g) => g.id)).toEqual(['b'])
    expect(doubleheaderTwins(g3, [g1, g2])).toEqual([])
  })
})

describe('planEventRemap', () => {
  const feed = new Set(['b9d2'])
  const isReclaimable = (g) => Boolean(g.oddsApiEventId) && !feed.has(g.oddsApiEventId)

  test('TB@CLE 10/16: b9d2 on -17 (24h drift) moves to -16 (stale a681 reclaimable)', () => {
    const plan = planEventRemap({ mapped: G17, siblings: [G16], eventTime: EV, isReclaimable })
    expect(plan.action).toBe('remap')
    expect(plan.target.id).toBe(G16.id)
    expect(plan.driftMs).toBe(24 * 3600000)
  })
  test('no drift -> none', () => {
    expect(planEventRemap({ mapped: { ...G16, oddsApiEventId: 'b9d2' }, siblings: [G17], eventTime: EV }).action).toBe('none')
  })
  test('drift but no row within 3h -> keep', () => {
    expect(planEventRemap({ mapped: G17, siblings: [], eventTime: EV }).action).toBe('keep')
    // sibling mapped to an event still in the feed is not reclaimable
    expect(planEventRemap({ mapped: G17, siblings: [{ ...G16, oddsApiEventId: 'b9d2-other' }], eventTime: EV, isReclaimable: () => false }).action).toBe('keep')
  })
  test('doubleheader rows are never re-mapped', () => {
    const dh1 = { id: 'NYY_at_BOS_2026-07-04', date: '2026-07-04T17:05:00', oddsApiEventId: 'ev2' }
    const dh2 = { id: 'NYY_at_BOS_2026-07-04_2', date: '2026-07-04T23:10:00', oddsApiEventId: null }
    const ev2 = eventCommenceMs('2026-07-04T23:10:00Z')
    expect(planEventRemap({ mapped: dh1, siblings: [dh2], eventTime: ev2 }).action).toBe('skip_doubleheader')
    // target is half of a doubleheader
    const lone = { id: 'NYY_at_BOS_2026-07-03', date: '2026-07-03T23:10:00', oddsApiEventId: 'ev2' }
    expect(planEventRemap({ mapped: lone, siblings: [dh1, dh2], eventTime: ev2 }).action).toBe('skip_doubleheader')
  })
})

describe('applyEventRemap', () => {
  const args = { fromId: G17.id, toId: G16.id, eventId: 'b9d2' }
  test('sets new row before clearing old', async () => {
    const sb = mockSupabase()
    const res = await applyEventRemap(sb, args, quiet)
    expect(res).toEqual({ ok: true, state: 'remapped' })
    expect(sb.ops[0]).toMatchObject({ payload: { oddsApiEventId: 'b9d2' }, filters: [['id', G16.id]] })
    expect(sb.ops[1]).toMatchObject({ payload: { oddsApiEventId: null }, filters: [['id', G17.id], ['oddsApiEventId', 'b9d2']] })
  })
  test('clear failure after set -> both_mapped, logged loudly', async () => {
    const errors = []
    const sb = mockSupabase([{ at: 1, error: { message: 'boom' } }])
    const res = await applyEventRemap(sb, args, { error: (m) => errors.push(m) })
    expect(res.state).toBe('both_mapped')
    expect(errors[0]).toMatch(/HALF-DONE/)
  })
  test('non-unique set failure -> unchanged, no clear attempted', async () => {
    const sb = mockSupabase([{ at: 0, error: { message: 'net', code: 'XX' } }])
    const res = await applyEventRemap(sb, args, quiet)
    expect(res.state).toBe('unchanged')
    expect(sb.ops).toHaveLength(1)
  })
  test('unique violation -> clear then set', async () => {
    const sb = mockSupabase([{ at: 0, error: { message: 'dup', code: '23505' } }])
    const res = await applyEventRemap(sb, args, quiet)
    expect(res.state).toBe('remapped')
    expect(sb.ops.map((o) => o.payload.oddsApiEventId)).toEqual(['b9d2', null, 'b9d2'])
  })
  test('unique violation and retry fails -> unmapped, logged loudly', async () => {
    const errors = []
    const sb = mockSupabase([{ at: 0, error: { code: '23505', message: 'dup' } }, { at: 2, error: { message: 'boom' } }])
    const res = await applyEventRemap(sb, args, { error: (m) => errors.push(m) })
    expect(res.state).toBe('unmapped')
    expect(errors[0]).toMatch(/HALF-DONE/)
  })
})

describe('shouldCheckPropsCache', () => {
  test('--cache-fresh bypasses props cache', () => {
    expect(shouldCheckPropsCache({ ignoreCache: true, ourGameId: 'g' })).toBe(false)
  })
  test('re-mapped game bypasses props cache', () => {
    expect(shouldCheckPropsCache({ ourGameId: 'g', changedGameIds: new Set(['g']) })).toBe(false)
  })
  test('normal run uses cache; no game id -> no cache', () => {
    expect(shouldCheckPropsCache({ ourGameId: 'g', changedGameIds: new Set(['x']) })).toBe(true)
    expect(shouldCheckPropsCache({ ourGameId: null })).toBe(false)
  })
})

describe('fetch-live-odds wiring', () => {
  const fs = require('fs')
  const src = fs.readFileSync(require('path').join(__dirname, '../../scripts/fetch-live-odds.js'), 'utf8')
  test('--cache-fresh is passed to fetchPlayerProps', () => {
    expect(src).toMatch(/fetchPlayerProps\(s, date, games, cacheFresh\)/)
    expect(src).toMatch(/async function fetchPlayerProps\(sport, date, oddsGames, ignoreCache = false\)/)
    expect(src).toMatch(/shouldCheckPropsCache\(\{ ignoreCache, ourGameId, changedGameIds: CHANGED_MAPPING_GAME_IDS \}\)/)
  })
  test('re-map goes through applyEventRemap (set-before-clear)', () => {
    expect(src).toMatch(/applyEventRemap\(supabase/)
    expect(src).not.toMatch(/update\(\{ oddsApiEventId: null \}\)\.eq\('id', alreadyMapped\.id\)/)
  })
})
