process.env.TZ = 'UTC'

import {
  getNFLWeekBounds,
  isGameInNflWeek,
  isHiddenFromTodaysSlate,
  isPriorDayFinal,
} from '../../lib/todays-games.js'

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

describe('NFL week includes Monday night games when the host is UTC', () => {
  test('8:15 PM ET Monday is in the week; the next ET day is not', () => {
    expect(process.env.TZ).toBe('UTC')

    // Live CHI @ SEA window: Monday 2026-11-02 8:15 PM ET = 2026-11-03T01:15:00Z
    const week = getNFLWeekBounds(new Date('2026-11-03T01:00:00Z'))
    expect(week.mondayKey).toBe('2026-11-02')
    expect(week.thursdayKey).toBe('2026-10-29')
    expect(week.monday.toISOString()).toBe('2026-11-03T04:59:59.999Z')
    expect(week.thursday.toISOString()).toBe('2026-10-29T04:00:00.000Z')

    expect(isGameInNflWeek(new Date('2026-11-03T01:15:00Z'), week)).toBe(true)
    expect(isGameInNflWeek(new Date('2026-11-04T01:00:00Z'), week)).toBe(false)
  })
})
