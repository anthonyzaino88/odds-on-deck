import {
  clampHistoryLimit,
  clampMaxParlays,
  clampParlayLegs,
  clampPropsLimit,
  clampValidationLimit,
  HISTORY_LIMIT_DEFAULT,
  HISTORY_LIMIT_MAX,
  MAX_PARLAYS_DEFAULT,
  MAX_PARLAYS_MAX,
  parseInteger,
  parsePublicValidationStatus,
  PROPS_LIMIT_DEFAULT,
  PROPS_LIMIT_MAX,
  VALIDATION_LIMIT_DEFAULT,
  VALIDATION_LIMIT_MAX,
} from '../../lib/api-limits.js'

describe('parseInteger', () => {
  test('truncates numeric POST body values before clamping', () => {
    expect(parseInteger(2.5)).toBe(2)
    expect(parseInteger(6.9)).toBe(6)
    expect(parseInteger(-1.2)).toBe(-1)
    expect(parseInteger(Number.NaN)).toBeNaN()
    expect(parseInteger(Number.POSITIVE_INFINITY)).toBeNaN()
  })
})

describe('clampValidationLimit', () => {
  test('NaN, 0, negative, and missing default to 100', () => {
    expect(clampValidationLimit(Number.NaN)).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit('NaN')).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit(0)).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit('0')).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit(-5)).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit('-12')).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit(null)).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit(undefined)).toBe(VALIDATION_LIMIT_DEFAULT)
    expect(clampValidationLimit('')).toBe(VALIDATION_LIMIT_DEFAULT)
  })

  test('values above 200 clamp to 200', () => {
    expect(clampValidationLimit(500)).toBe(VALIDATION_LIMIT_MAX)
    expect(clampValidationLimit('500')).toBe(VALIDATION_LIMIT_MAX)
  })

  test('in-range values pass through', () => {
    expect(clampValidationLimit(1)).toBe(1)
    expect(clampValidationLimit(50)).toBe(50)
    expect(clampValidationLimit(200)).toBe(200)
  })
})

describe('clampParlayLegs', () => {
  test('missing or non-numeric values use the default of 3', () => {
    expect(clampParlayLegs(null)).toBe(3)
    expect(clampParlayLegs(undefined)).toBe(3)
    expect(clampParlayLegs('')).toBe(3)
    expect(clampParlayLegs('abc')).toBe(3)
    expect(clampParlayLegs(Number.NaN)).toBe(3)
  })

  test('out-of-range numbers clamp to the nearest bound', () => {
    expect(clampParlayLegs(-1)).toBe(2)
    expect(clampParlayLegs(0)).toBe(2)
    expect(clampParlayLegs(1)).toBe(2)
    expect(clampParlayLegs(10)).toBe(6)
    expect(clampParlayLegs('10')).toBe(6)
  })

  test('truncates fractional POST numbers then clamps', () => {
    expect(clampParlayLegs(2.5)).toBe(2)
    expect(clampParlayLegs(6.9)).toBe(6)
    expect(clampParlayLegs(1.9)).toBe(2)
  })

  test('keeps 2-6 including Featured and Builder values', () => {
    expect(clampParlayLegs(2)).toBe(2)
    expect(clampParlayLegs(3)).toBe(3)
    expect(clampParlayLegs('6')).toBe(6)
  })
})

describe('clampMaxParlays', () => {
  test('NaN, 0, negative, and missing default to 10', () => {
    expect(clampMaxParlays(Number.NaN)).toBe(MAX_PARLAYS_DEFAULT)
    expect(clampMaxParlays(0)).toBe(MAX_PARLAYS_DEFAULT)
    expect(clampMaxParlays(-3)).toBe(MAX_PARLAYS_DEFAULT)
    expect(clampMaxParlays(null)).toBe(MAX_PARLAYS_DEFAULT)
  })

  test('caps at 20', () => {
    expect(clampMaxParlays(50)).toBe(MAX_PARLAYS_MAX)
    expect(clampMaxParlays('999')).toBe(MAX_PARLAYS_MAX)
    expect(clampMaxParlays(20)).toBe(20)
    expect(clampMaxParlays(1)).toBe(1)
  })
})

describe('history and props caps', () => {
  test('history defaults to 50 and caps at 100', () => {
    expect(clampHistoryLimit(null)).toBe(HISTORY_LIMIT_DEFAULT)
    expect(clampHistoryLimit(20)).toBe(20)
    expect(clampHistoryLimit(500)).toBe(HISTORY_LIMIT_MAX)
  })

  test('props defaults to 1000 and caps at 1000', () => {
    expect(clampPropsLimit(null)).toBe(PROPS_LIMIT_DEFAULT)
    expect(clampPropsLimit(0)).toBe(PROPS_LIMIT_DEFAULT)
    expect(clampPropsLimit(50000)).toBe(PROPS_LIMIT_MAX)
  })
})

describe('parsePublicValidationStatus', () => {
  test('status=pending is rejected', () => {
    const result = parsePublicValidationStatus('pending')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/pending/i)
  })

  test('allow-listed statuses pass', () => {
    expect(parsePublicValidationStatus('completed')).toEqual({ ok: true, status: 'completed' })
    expect(parsePublicValidationStatus('manual_closed')).toEqual({ ok: true, status: 'manual_closed' })
    expect(parsePublicValidationStatus('needs_review')).toEqual({ ok: true, status: 'needs_review' })
  })

  test('missing status is allowed so the caller can exclude pending', () => {
    expect(parsePublicValidationStatus(null)).toEqual({ ok: true, status: undefined })
    expect(parsePublicValidationStatus('')).toEqual({ ok: true, status: undefined })
  })

  test('unknown statuses are rejected', () => {
    expect(parsePublicValidationStatus('open')).toMatchObject({ ok: false })
  })
})
