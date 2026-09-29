import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const apiRoot = join(process.cwd(), 'app/api')

function walkJs(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files.push(...walkJs(full))
    else if (name.endsWith('.js')) files.push(full)
  }
  return files
}

describe('public API surface does not ship debug leftovers', () => {
  test('one-off / debug routes verified unreferenced are gone', () => {
    expect(existsSync(join(apiRoot, 'live/todays-games-direct'))).toBe(false)
    expect(existsSync(join(apiRoot, 'games/live-scores'))).toBe(false)
    expect(existsSync(join(apiRoot, 'nfl/games'))).toBe(false)
    expect(existsSync(join(apiRoot, 'live/game-data'))).toBe(false)
    expect(existsSync(join(apiRoot, 'nfl/live-roster'))).toBe(false)
    expect(existsSync(join(apiRoot, 'nfl/props-advanced'))).toBe(false)
  })

  test('no API route returns error.stack to clients', () => {
    for (const file of walkJs(apiRoot)) {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/stack:\s*error\.stack/)
      expect(src).not.toMatch(/error\.stack/)
    }
  })

  test('props/save and parlays/save 410 shims remain', () => {
    const propsSave = readFileSync(join(apiRoot, 'props/save/route.js'), 'utf8')
    const parlaysSave = readFileSync(join(apiRoot, 'parlays/save/route.js'), 'utf8')
    expect(propsSave).toMatch(/gone\(/)
    expect(parlaysSave).toMatch(/gone\(/)
    expect(propsSave).toMatch(/export async function POST/)
    expect(parlaysSave).toMatch(/export async function POST/)
  })
})
