import { isHiddenFromTodaysSlate } from '../../lib/todays-games.js'

describe('today slate hides cancelled games', () => {
  test('cancelled and canceled are hidden; live and postponed stay', () => {
    expect(isHiddenFromTodaysSlate({ status: 'cancelled' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'canceled' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'STATUS_CANCELLED' })).toBe(true)
    expect(isHiddenFromTodaysSlate({ status: 'scheduled' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'in_progress' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'postponed' })).toBe(false)
    expect(isHiddenFromTodaysSlate({ status: 'final' })).toBe(false)
  })
})
