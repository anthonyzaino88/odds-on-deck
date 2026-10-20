import { ensurePrismaClient, PRISMA_CLIENT_INDEX } from '../../lib/prisma-preflight.js'

function silentLogger() {
  return { error: jest.fn(), log: jest.fn() }
}

describe('ensurePrismaClient', () => {
  test('no-ops when the generated client exists and PrismaClient imports', () => {
    const generate = jest.fn()
    const result = ensurePrismaClient({
      exists: () => true,
      importPrisma: () => function PrismaClient() {},
      generate,
      logger: silentLogger(),
    })
    expect(result).toEqual(expect.objectContaining({ ok: true, generated: false }))
    expect(result.clientPath).toMatch(new RegExp(`${PRISMA_CLIENT_INDEX.replace(/\./g, '\\.')}$`))
    expect(generate).not.toHaveBeenCalled()
  })

  test('runs prisma generate when the client file is missing, then succeeds', () => {
    let present = false
    const logger = silentLogger()
    const generate = jest.fn(() => {
      present = true
      return { status: 0 }
    })
    const result = ensurePrismaClient({
      exists: () => present,
      importPrisma: () => function PrismaClient() {},
      generate,
      logger,
    })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.generated).toBe(true)
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/PRISMA PREFLIGHT FAILED/)
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/npx prisma generate/)
  })

  test('runs prisma generate when PrismaClient cannot be imported', () => {
    let importable = false
    const generate = jest.fn(() => {
      importable = true
      return { status: 0 }
    })
    const result = ensurePrismaClient({
      exists: () => true,
      importPrisma: () => {
        if (!importable) throw new Error("Cannot find module '.prisma/client/default'")
        return function PrismaClient() {}
      },
      generate,
      logger: silentLogger(),
    })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.generated).toBe(true)
  })

  test('throws after a loud log when generate fails', () => {
    const logger = silentLogger()
    expect(() => ensurePrismaClient({
      exists: () => false,
      importPrisma: () => function PrismaClient() {},
      generate: () => ({ status: 1, stderr: 'engine download failed' }),
      logger,
    })).toThrow(/generate exited 1/)
    const logs = logger.error.mock.calls.flat().join('\n')
    expect(logs).toMatch(/PRISMA PREFLIGHT FAILED/)
    expect(logs).toMatch(/engine download failed/)
    expect(logs).toMatch(/Never junction node_modules/)
    expect(logs).toMatch(/cmd \/c rmdir/)
  })

  test('throws when the client is still missing after generate', () => {
    const logger = silentLogger()
    expect(() => ensurePrismaClient({
      exists: () => false,
      importPrisma: () => function PrismaClient() {},
      generate: () => ({ status: 0 }),
      logger,
    })).toThrow(/still broken|missing/i)
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/cmd \/c rmdir <link>/)
    expect(logger.error.mock.calls.flat().join('\n')).not.toMatch(/rmdir <link> \/s/)
  })
})
