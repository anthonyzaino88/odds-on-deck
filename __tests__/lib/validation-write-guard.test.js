import { shouldRefusePropPredictionWrite } from '../../lib/validation.js'

describe('shouldRefusePropPredictionWrite', () => {
  test('always refuses user_saved inserts and updates', () => {
    expect(shouldRefusePropPredictionWrite('user_saved', null)).toBe(true)
    expect(shouldRefusePropPredictionWrite('user_saved', {
      status: 'pending',
      source: 'system_generated',
    })).toBe(true)
  })

  test('refuses overwriting a Published or game-line row with another source', () => {
    expect(shouldRefusePropPredictionWrite('parlay_leg', {
      status: 'pending',
      source: 'system_generated',
    })).toBe(true)
    expect(shouldRefusePropPredictionWrite('system_generated', {
      status: 'pending',
      source: 'game_line',
    })).toBe(true)
  })

  test('refuses mutating already-graded rows', () => {
    expect(shouldRefusePropPredictionWrite('system_generated', {
      status: 'completed',
      source: 'system_generated',
    })).toBe(true)
  })

  test('allows system persist of a new or pending system row', () => {
    expect(shouldRefusePropPredictionWrite('system_generated', null)).toBe(false)
    expect(shouldRefusePropPredictionWrite('system_generated', {
      status: 'pending',
      source: 'system_generated',
    })).toBe(false)
  })
})
