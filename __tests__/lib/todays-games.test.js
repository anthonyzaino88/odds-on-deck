process.env.TZ = 'UTC'

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getNFLWeekBounds,
  isGameInNflWeek,
  isHiddenFromTodaysSlate,
  isPriorDayFinal,
  nflWeekEtDateKeys,
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

  test('ET date keys stay Thursday–Monday on a UTC host', () => {
    expect(process.env.TZ).toBe('UTC')
    expect(nflWeekEtDateKeys(new Date('2026-11-03T01:00:00Z'))).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
  })
})

describe('NFL week includes Tuesday/Wednesday games', () => {
  test('Wednesday 2026-11-25 includes an 8pm ET game that day through following Monday', () => {
    expect(process.env.TZ).toBe('UTC')
    // Noon ET Wednesday 2026-11-25
    const week = getNFLWeekBounds(new Date('2026-11-25T17:00:00Z'))
    expect(week.thursdayKey).toBe('2026-11-25')
    expect(week.mondayKey).toBe('2026-11-30')
    expect(week.thursday.toISOString()).toBe('2026-11-25T05:00:00.000Z')
    expect(week.monday.toISOString()).toBe('2026-12-01T04:59:59.999Z')

    // GB @ LAR Wednesday 8:00 PM ET = 2026-11-26T01:00:00Z
    expect(isGameInNflWeek(new Date('2026-11-26T01:00:00Z'), week)).toBe(true)
    expect(isGameInNflWeek(new Date('2026-12-01T01:15:00Z'), week)).toBe(true)
    expect(isGameInNflWeek(new Date('2026-12-04T01:20:00Z'), week)).toBe(false)

    expect(nflWeekEtDateKeys(new Date('2026-11-25T17:00:00Z'))).toEqual([
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
    ])
  })

  test('Tuesday starts today through the following Monday', () => {
    const week = getNFLWeekBounds(new Date('2026-11-24T17:00:00Z'))
    expect(week.thursdayKey).toBe('2026-11-24')
    expect(week.mondayKey).toBe('2026-11-30')
    expect(isGameInNflWeek(new Date('2026-11-24T17:00:00Z'), week)).toBe(true)
    expect(nflWeekEtDateKeys(new Date('2026-11-24T17:00:00Z'))[0]).toBe('2026-11-24')
  })

  test('Thursday is still Thu–Mon', () => {
    const week = getNFLWeekBounds(new Date('2026-11-26T17:00:00Z'))
    expect(week.thursdayKey).toBe('2026-11-26')
    expect(week.mondayKey).toBe('2026-11-30')
    expect(isGameInNflWeek(new Date('2026-11-25T17:00:00Z'), week)).toBe(false)
    expect(nflWeekEtDateKeys(new Date('2026-11-26T17:00:00Z'))).toEqual([
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
    ])
  })

  test('Sunday looks back to Thursday', () => {
    const week = getNFLWeekBounds(new Date('2026-11-29T18:00:00Z'))
    expect(week.thursdayKey).toBe('2026-11-26')
    expect(week.mondayKey).toBe('2026-11-30')
  })

  test('Monday night still belongs to the Thu–Mon week', () => {
    const week = getNFLWeekBounds(new Date('2026-11-30T17:00:00Z'))
    expect(week.thursdayKey).toBe('2026-11-26')
    expect(week.mondayKey).toBe('2026-11-30')
    expect(isGameInNflWeek(new Date('2026-12-01T01:15:00Z'), week)).toBe(true)
  })
})

describe('fetch-fresh-games uses the shared NFL week bounds', () => {
  test('script imports nflWeekEtDateKeys and does not keep a local-time copy', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')
    expect(src).toMatch(/import \{ nflWeekEtDateKeys \} from '\.\.\/lib\/todays-games\.js'/)
    expect(src).toMatch(/nflWeekEtDateKeys\(/)
    expect(src).not.toMatch(/function getNFLWeekBounds/)
    expect(src).not.toMatch(/referenceDate\.getFullYear\(\)/)
    expect(src).not.toMatch(/weekStart\.setHours\(0, 0, 0, 0\)/)
  })
})
