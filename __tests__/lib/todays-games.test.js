import { isHiddenFromTodaysSlate, isPriorDayFinal } from '../../lib/todays-games.js'

describe('today slate hides cancelled games', () => {
  test('cancelled and canceled are hidden; live and postponed stay', () => {
    expect(isHiddenFromTodaysSlate({ status: 'cancelled' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'canceled' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'STATUS_CANCELLED' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'scheduled' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'in_progress' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'postponed' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'final' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'not_needed' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'not needed' })).toBe(true)
  })
})

describe('Games This Week hides prior-day finals', () => {
  test('CAR@GB final on 10/29 drops off on 10/31; today finals stay', () => {
    expect(isPriorDayFinal(
      { status: 'final' },
      { todayEt: '2026-10-31', gameEtDate: '2026-10-29' },
    )).toBe(true)
    expect(isPriorDayFinal(
      { status: 'final' },
      { todayEt: '2026-10-31', gameEtDate: '2026-10-31' },
    )).toBe(false)
    expect(isPriorDayFinal(
      { status: 'scheduled' },
      { todayEt: '2026-10-31', gameEtDate: '2026-10-29' },
    )).toBe(false)
    expect(isPriorDayFinal(
      { status: 'in_progress' },
      { todayEt: '2026-10-31', gameEtDate: '2026-10-29' },
    )).toBe(false)
  })
})
