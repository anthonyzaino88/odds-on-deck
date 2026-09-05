import { isJuiceTrap, getBookCount, attachNumBooks, filterJuiceTraps } from '../../lib/juice-traps.js'

describe('isJuiceTrap', () => {
  test('flags NHL PPP under 0.5', () => {
    expect(isJuiceTrap({
      type: 'player_power_play_points',
      pick: 'under',
      threshold: 0.5,
    })).toBe(true)
  })

  test('flags batter_hits under 0.5', () => {
    expect(isJuiceTrap({
      type: 'batter_hits',
      pick: 'under',
      threshold: 0.5,
    })).toBe(true)
  })

  test('uses prediction field (PropValidation)', () => {
    expect(isJuiceTrap({
      propType: 'player_points',
      prediction: 'under',
      threshold: 0.5,
    })).toBe(true)
  })

  test('does not flag overs or higher lines', () => {
    expect(isJuiceTrap({ type: 'batter_hits', pick: 'over', threshold: 0.5 })).toBe(false)
    expect(isJuiceTrap({ type: 'batter_hits', pick: 'under', threshold: 1.5 })).toBe(false)
  })

  test('does not flag game totals', () => {
    expect(isJuiceTrap({ type: 'total', pick: 'under', threshold: 0.5 })).toBe(false)
  })
})

describe('getBookCount', () => {
  test('returns null when cache has no book count', () => {
    expect(getBookCount({ edge: 0.04, qualityScore: 40 })).toBeNull()
  })

  test('reads numBooks / bookCount / books array', () => {
    expect(getBookCount({ numBooks: 4 })).toBe(4)
    expect(getBookCount({ bookCount: 3 })).toBe(3)
    expect(getBookCount({ books: ['a', 'b', 'c'] })).toBe(3)
  })
})

describe('attachNumBooks', () => {
  test('does not invent a book count for historical rows', () => {
    const row = { edge: 0.04, qualityScore: 40 }
    expect(attachNumBooks(row)).toEqual(row)
    expect(attachNumBooks(row).numBooks).toBeUndefined()
  })

  test('copies a known count onto the write payload', () => {
    expect(attachNumBooks({ playerName: 'X' }, { numBooks: 5 })).toEqual({
      playerName: 'X',
      numBooks: 5,
    })
  })
})

describe('filterJuiceTraps', () => {
  test('keeps real plays', () => {
    const rows = [
      { type: 'player_shots_on_goal', pick: 'over', threshold: 2.5 },
      { type: 'player_power_play_points', pick: 'under', threshold: 0.5 },
    ]
    expect(filterJuiceTraps(rows)).toHaveLength(1)
    expect(filterJuiceTraps(rows)[0].type).toBe('player_shots_on_goal')
  })
})
