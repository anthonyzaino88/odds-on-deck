import {
  isMissingColumnError,
  propValidationGradeAudit,
  resetAuditColumnCache,
  updateWithOptionalAudit,
  withoutAuditFields,
} from '../../lib/grade-audit.js'

beforeEach(() => {
  resetAuditColumnCache()
})

describe('propValidationGradeAudit', () => {
  test('writes updatedAt / gradedAt / gradedBy / gradeSource', () => {
    const now = new Date('2026-09-20T18:00:00.000Z')
    expect(propValidationGradeAudit(now, {
      gradedBy: 'system',
      gradeSource: 'validate_pending_props',
    })).toEqual({
      updatedAt: '2026-09-20T18:00:00.000Z',
      gradedAt: '2026-09-20T18:00:00.000Z',
      gradedBy: 'system',
      gradeSource: 'validate_pending_props',
    })
  })
})

describe('updateWithOptionalAudit', () => {
  test('retries without audit columns when the migration has not run', async () => {
    const payloads = []
    const result = await updateWithOptionalAudit(async (payload) => {
      payloads.push(payload)
      if (payload.updatedAt) {
        return { error: { code: 'PGRST204', message: "Could not find the 'updatedAt' column of 'PropValidation'" } }
      }
      return { data: { id: 'pv-1', ...payload }, error: null }
    }, {
      status: 'completed',
      result: 'correct',
      ...propValidationGradeAudit(new Date('2026-09-20T18:00:00.000Z')),
    })

    expect(payloads).toHaveLength(2)
    expect(payloads[0].updatedAt).toBe('2026-09-20T18:00:00.000Z')
    expect(payloads[1].updatedAt).toBeUndefined()
    expect(payloads[1].gradedAt).toBeUndefined()
    expect(result.data.status).toBe('completed')
  })

  test('does not retry on a real write error', async () => {
    let calls = 0
    const result = await updateWithOptionalAudit(async () => {
      calls += 1
      return { error: { code: '42501', message: 'permission denied' } }
    }, { status: 'completed' })
    expect(calls).toBe(1)
    expect(result.error.code).toBe('42501')
  })

  test('isMissingColumnError recognizes only PGRST204 / 42703', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingColumnError({ message: 'column gradedAt does not exist' })).toBe(false)
    expect(isMissingColumnError({
      code: '23502',
      message: 'null value in column "result" violates not-null constraint',
    })).toBe(false)
    expect(isMissingColumnError({
      code: '42P01',
      message: 'relation "PropValidation" does not exist',
    })).toBe(false)
    expect(isMissingColumnError({
      code: '23514',
      message: 'new row for relation "PropValidation" violates check constraint',
    })).toBe(false)
    expect(isMissingColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(withoutAuditFields({ status: 'completed', gradedAt: 'x', foo: 1 })).toEqual({
      status: 'completed',
      foo: 1,
    })
  })

  test('caches a missing-column miss so later writes skip the audit fields', async () => {
    const payloads = []
    const failThenOk = async (payload) => {
      payloads.push(payload)
      if (payload.updatedAt) {
        return { error: { code: 'PGRST204', message: "Could not find the 'updatedAt' column" } }
      }
      return { data: { id: 'pv-1' }, error: null }
    }

    await updateWithOptionalAudit(failThenOk, {
      status: 'completed',
      ...propValidationGradeAudit(new Date('2026-09-20T18:00:00.000Z')),
    })
    expect(payloads).toHaveLength(2)

    payloads.length = 0
    await updateWithOptionalAudit(failThenOk, {
      status: 'completed',
      ...propValidationGradeAudit(new Date('2026-09-20T19:00:00.000Z')),
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].updatedAt).toBeUndefined()
    expect(payloads[0].gradedAt).toBeUndefined()
  })
})
