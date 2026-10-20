import {
  ensurePrismaClient,
  PRISMA_CLIENT_INDEX,
  PRISMA_CLI_MODULE,
  runPrismaGenerate,
} from '../../lib/prisma-preflight.js'

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
      return { status: 0, via: 'node-cli' }
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
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/prisma\/build\/index\.js generate/)
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

  test('warnOnly does not throw when generate fails', () => {
    const logger = silentLogger()
    const result = ensurePrismaClient({
      exists: () => false,
      importPrisma: () => function PrismaClient() {},
      generate: () => ({ status: 1, stderr: "'prisma' is not recognized" }),
      logger,
      warnOnly: true,
    })
    expect(result).toEqual(expect.objectContaining({ ok: false, warned: true }))
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/warn-only/)
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

describe('runPrismaGenerate', () => {
  test('calls node at require.resolve(prisma/build/index.js) and skips npx on success', () => {
    const spawn = jest.fn(() => ({ status: 0, stdout: 'generated', stderr: '' }))
    const logger = silentLogger()
    const result = runPrismaGenerate({
      cwd: '/worktree',
      execPath: '/usr/bin/node',
      resolveCli: () => '/worktree/node_modules/prisma/build/index.js',
      spawn,
      logger,
    })
    expect(result.via).toBe('node-cli')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['/worktree/node_modules/prisma/build/index.js', 'generate'],
      expect.objectContaining({ cwd: '/worktree' }),
    )
    expect(spawn.mock.calls[0][0]).not.toMatch(/npx/)
    expect(PRISMA_CLI_MODULE).toBe('prisma/build/index.js')
  })

  test('default resolveCli finds prisma/build/index.js in this checkout', () => {
    const spawn = jest.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    const result = runPrismaGenerate({
      spawn,
      logger: silentLogger(),
      execPath: process.execPath,
    })
    expect(result.via).toBe('node-cli')
    expect(spawn.mock.calls[0][0]).toBe(process.execPath)
    expect(spawn.mock.calls[0][1][0]).toMatch(/prisma[/\\]build[/\\]index\.js$/)
    expect(spawn.mock.calls[0][1][1]).toBe('generate')
  })

  test('falls back to npx when prisma/build/index.js cannot be resolved', () => {
    const spawn = jest.fn(() => ({ status: 0, stdout: 'generated', stderr: '' }))
    const logger = silentLogger()
    const result = runPrismaGenerate({
      cwd: '/worktree',
      execPath: '/usr/bin/node',
      resolveCli: () => {
        throw new Error("Cannot find module 'prisma/build/index.js'")
      },
      spawn,
      logger,
    })
    expect(result.via).toBe('npx')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0][1]).toEqual(['prisma', 'generate'])
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/Falling back to `npx prisma generate`/)
  })

  test('falls back to npx when the node CLI generate exits non-zero', () => {
    const spawn = jest.fn((cmd) => {
      if (cmd === '/usr/bin/node') {
        return { status: 1, stdout: '', stderr: "'prisma' is not recognized" }
      }
      return { status: 0, stdout: 'generated', stderr: '' }
    })
    const logger = silentLogger()
    const result = runPrismaGenerate({
      cwd: '/worktree',
      execPath: '/usr/bin/node',
      resolveCli: () => '/worktree/node_modules/prisma/build/index.js',
      spawn,
      logger,
    })
    expect(result.via).toBe('npx')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[0][0]).toBe('/usr/bin/node')
    expect(spawn.mock.calls[1][1]).toEqual(['prisma', 'generate'])
    const logs = logger.error.mock.calls.flat().join('\n')
    expect(logs).toMatch(/node prisma CLI generate exited 1/)
    expect(logs).toMatch(/Falling back to `npx prisma generate`/)
  })
})
