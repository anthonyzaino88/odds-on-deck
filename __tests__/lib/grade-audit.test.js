import {
  isMissingColumnError,
  propValidationGradeAudit,
  updateWithOptionalAudit,
  withoutAuditFields,
} from '../../lib/grade-audit.js'

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

  test('isMissingColumnError recognizes PostgREST / Postgres codes', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingColumnError({ message: 'column gradedAt does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(withoutAuditFields({ status: 'completed', gradedAt: 'x', foo: 1 })).toEqual({
      status: 'completed',
      foo: 1,
    })
  })
})
