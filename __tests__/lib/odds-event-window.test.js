import {
  eventCommenceMs,
  eventStartDriftMs,
  msSinceEtMidnight,
  ODDS_EVENT_MATCH_WINDOW_MS,
  pickUnmappedOddsGame,
  shouldRemapEvent,
} from '../../lib/live-odds-landing.js'

// Real TB @ CLE 2026 ALCS rows (Game.date is zone-less UTC).
const G15 = { id: 'TB_at_CLE_2026-10-15', date: '2026-10-15T17:00:00', oddsApiEventId: '2572-stale', status: 'scheduled' }
const G16 = { id: 'TB_at_CLE_2026-10-16', date: '2026-10-17T00:00:00', oddsApiEventId: null, status: 'scheduled' }
const G17 = { id: 'TB_at_CLE_2026-10-17', date: '2026-10-18T00:00:00', oddsApiEventId: null, status: 'scheduled' }

describe('pickUnmappedOddsGame ±6h window', () => {
  test('event outside window of every open row stays unmapped (no next-day cascade)', () => {
    // 10/15 1 PM ET event; same-day row is mapped, next open row is +31h.
    expect(pickUnmappedOddsGame([G15, G16, G17], eventCommenceMs('2026-10-15T17:00:00Z'))).toBeNull()
  })

  test('event picks the row within window', () => {
    expect(pickUnmappedOddsGame([G16, G17], eventCommenceMs('2026-10-17T00:00:00Z')).id).toBe(G16.id)
    // small time change (+2h) still matches
    expect(pickUnmappedOddsGame([G16, G17], eventCommenceMs('2026-10-17T02:00:00Z')).id).toBe(G16.id)
  })

  test('window boundary', () => {
    const t = Date.parse('2026-10-17T00:00:00Z')
    expect(pickUnmappedOddsGame([G16], t + ODDS_EVENT_MATCH_WINDOW_MS).id).toBe(G16.id)
    expect(pickUnmappedOddsGame([G16], t + ODDS_EVENT_MATCH_WINDOW_MS + 1)).toBeNull()
  })

  test('reclaims a row whose mapped event left the feed', () => {
    const feed = new Set(['a681-new'])
    const isReclaimable = (g) => Boolean(g.oddsApiEventId) && !feed.has(g.oddsApiEventId)
    const picked = pickUnmappedOddsGame([G15, G16], eventCommenceMs('2026-10-15T17:00:00Z'), { isReclaimable })
    expect(picked.id).toBe(G15.id)
  })

  test('does not reclaim a row whose event is still in the feed', () => {
    const isReclaimable = () => false
    expect(pickUnmappedOddsGame([G15], eventCommenceMs('2026-10-15T17:00:00Z'), { isReclaimable })).toBeNull()
  })

  test('does not reclaim live, final, or dead rows even when the event left the feed', () => {
    const isReclaimable = () => true
    const t = eventCommenceMs('2026-10-15T17:00:00Z')
    expect(pickUnmappedOddsGame([{ ...G15, status: 'in_progress' }], t, { isReclaimable })).toBeNull()
    expect(pickUnmappedOddsGame([{ ...G15, status: 'halftime' }], t, { isReclaimable })).toBeNull()
    expect(pickUnmappedOddsGame([{ ...G15, status: 'final' }], t, { isReclaimable })).toBeNull()
    expect(pickUnmappedOddsGame([{ ...G15, status: 'postponed' }], t, { isReclaimable })).toBeNull()
  })

  test('does not map unmapped live, final, or dead rows', () => {
    const t = eventCommenceMs('2026-10-15T17:00:00Z')
    expect(pickUnmappedOddsGame([{ ...G15, oddsApiEventId: null, status: 'in_progress' }], t)).toBeNull()
    expect(pickUnmappedOddsGame([{ ...G15, oddsApiEventId: null, status: 'final' }], t)).toBeNull()
    expect(pickUnmappedOddsGame([{ ...G15, oddsApiEventId: null, status: 'postponed' }], t)).toBeNull()
    expect(pickUnmappedOddsGame([{ ...G15, oddsApiEventId: null, status: 'scheduled' }], t).id).toBe(G15.id)
  })

  test('traditional doubleheader: each event lands on its own game', () => {
    const dh1 = { id: 'NYY_at_BOS_2026-07-04', date: '2026-07-04T17:05:00', oddsApiEventId: null, status: 'scheduled' }
    const dh2 = { id: 'NYY_at_BOS_2026-07-04_2', date: '2026-07-04T23:10:00', oddsApiEventId: null, status: 'scheduled' }
    expect(pickUnmappedOddsGame([dh1, dh2], eventCommenceMs('2026-07-04T17:05:00Z')).id).toBe(dh1.id)
    expect(pickUnmappedOddsGame([dh1, dh2], eventCommenceMs('2026-07-04T23:10:00Z')).id).toBe(dh2.id)
    // game 1 already mapped: game-2 event still goes to game 2, not stolen
    const mapped1 = { ...dh1, oddsApiEventId: 'ev-g1' }
    expect(pickUnmappedOddsGame([mapped1, dh2], eventCommenceMs('2026-07-04T23:10:00Z')).id).toBe(dh2.id)
    expect(pickUnmappedOddsGame([mapped1, dh2], eventCommenceMs('2026-07-04T17:05:00Z'))).toBeNull()
  })

  test('unknown event time maps only an unambiguous single unmapped row', () => {
    expect(pickUnmappedOddsGame([G16], NaN).id).toBe(G16.id)
    expect(pickUnmappedOddsGame([G16, G17], NaN)).toBeNull()
  })
})

describe('shouldRemapEvent', () => {
  test('flags mapped rows whose start differs by > 3h', () => {
    const wrong = { ...G17, oddsApiEventId: 'b9d2' }
    const ev = eventCommenceMs('2026-10-17T00:00:00Z')
    expect(eventStartDriftMs(wrong, ev)).toBe(24 * 3600000)
    expect(shouldRemapEvent(wrong, ev)).toBe(true)
    expect(shouldRemapEvent({ ...G16, oddsApiEventId: 'b9d2' }, ev)).toBe(false)
    expect(shouldRemapEvent({ ...G16 }, ev + 2 * 3600000)).toBe(false)
    expect(shouldRemapEvent({ date: null }, ev)).toBe(false)
  })
})

describe('msSinceEtMidnight', () => {
  test('EDT and EST', () => {
    expect(msSinceEtMidnight(new Date('2026-10-16T12:25:00Z'))).toBe((8 * 60 + 25) * 60000)
    expect(msSinceEtMidnight(new Date('2026-12-16T05:30:00Z'))).toBe(30 * 60000)
    expect(msSinceEtMidnight(new Date('2026-10-16T04:00:00Z'))).toBe(0)
  })
})
