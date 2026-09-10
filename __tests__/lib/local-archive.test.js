import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  appendJsonl,
  dailyJsonlFilename,
  groupRowsByUtcDay,
  loadJsonlFieldSet,
  resolveBoxScoresDir,
  resolvePropLinesDir,
  toUtcDayStamp,
} from '../../lib/local-archive.js'

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ood-archive-'))
}

describe('toUtcDayStamp / dailyJsonlFilename', () => {
  test('formats UTC calendar day', () => {
    expect(toUtcDayStamp(new Date('2026-04-12T23:15:00.000Z'))).toBe('2026-04-12')
    expect(dailyJsonlFilename('prop-lines', '2026-04-12T01:00:00.000Z')).toBe(
      'prop-lines-2026-04-12.jsonl'
    )
  })

  test('falls back to today for invalid dates', () => {
    expect(toUtcDayStamp('not-a-date')).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe('resolvePropLinesDir / resolveBoxScoresDir', () => {
  const prevProp = process.env.ARCHIVE_PROP_LINES_DIR
  const prevBox = process.env.ARCHIVE_BOX_SCORES_DIR

  afterEach(() => {
    if (prevProp === undefined) delete process.env.ARCHIVE_PROP_LINES_DIR
    else process.env.ARCHIVE_PROP_LINES_DIR = prevProp
    if (prevBox === undefined) delete process.env.ARCHIVE_BOX_SCORES_DIR
    else process.env.ARCHIVE_BOX_SCORES_DIR = prevBox
  })

  test('defaults are repo-relative under research/archive', () => {
    delete process.env.ARCHIVE_PROP_LINES_DIR
    delete process.env.ARCHIVE_BOX_SCORES_DIR
    const root = '/tmp/ood-checkout'
    expect(resolvePropLinesDir(root)).toBe(path.join(root, 'research', 'archive', 'prop-lines'))
    expect(resolveBoxScoresDir(root)).toBe(path.join(root, 'research', 'archive', 'box-scores'))
  })

  test('env overrides win when set', () => {
    process.env.ARCHIVE_PROP_LINES_DIR = 'C:\\Users\\zaino\\Desktop\\Odds on Deck\\research\\archive\\prop-lines'
    process.env.ARCHIVE_BOX_SCORES_DIR = 'C:\\Users\\zaino\\Desktop\\Odds on Deck\\research\\archive\\box-scores'
    expect(resolvePropLinesDir('/ignored')).toBe(process.env.ARCHIVE_PROP_LINES_DIR)
    expect(resolveBoxScoresDir('/ignored')).toBe(process.env.ARCHIVE_BOX_SCORES_DIR)
  })
})

describe('appendJsonl', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('no-ops on empty or missing rows', () => {
    expect(appendJsonl(dir, 'prop-lines', [])).toBe(0)
    expect(appendJsonl(dir, 'prop-lines', null)).toBe(0)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  test('creates nested dirs and writes one JSON object per line (snake_case preserved)', () => {
    const nested = path.join(dir, 'research', 'archive', 'prop-lines')
    const rows = [
      { prop_id: 'p1', game_id: 'g1', player_name: 'Ada', threshold: 1.5 },
      { prop_id: 'p2', game_id: 'g1', player_name: 'Bea', threshold: 2.5 },
    ]
    const written = appendJsonl(nested, 'prop-lines', rows, new Date('2026-09-10T12:00:00.000Z'))
    expect(written).toBe(2)

    const file = path.join(nested, 'prop-lines-2026-09-10.jsonl')
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toEqual(rows[0])
    expect(JSON.parse(lines[1])).toEqual(rows[1])
    expect(lines[0]).toContain('prop_id')
    expect(lines[0]).not.toContain('propId')
  })

  test('appends to an existing daily file', () => {
    appendJsonl(dir, 'box-scores', [{ game_id: 'g1', stats: { hits: 1 } }], '2026-09-10')
    appendJsonl(dir, 'box-scores', [{ game_id: 'g2', stats: { hits: 2 } }], '2026-09-10')

    const file = path.join(dir, 'box-scores-2026-09-10.jsonl')
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).game_id).toBe('g1')
    expect(JSON.parse(lines[1]).stats).toEqual({ hits: 2 })
  })
})

describe('loadJsonlFieldSet / groupRowsByUtcDay', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('collects game_id values across daily files and skips junk lines', () => {
    fs.writeFileSync(
      path.join(dir, 'box-scores-2026-09-09.jsonl'),
      JSON.stringify({ game_id: 'alpha', player_name: 'A' }) + '\nnot-json\n'
    )
    appendJsonl(dir, 'box-scores', [{ game_id: 'beta', player_name: 'B' }], '2026-09-10')

    const ids = loadJsonlFieldSet(dir, 'game_id')
    expect(ids.has('alpha')).toBe(true)
    expect(ids.has('beta')).toBe(true)
    expect(ids.size).toBe(2)
    expect(loadJsonlFieldSet(path.join(dir, 'missing'), 'game_id').size).toBe(0)
  })

  test('groups export rows by archived_at then game_time', () => {
    const groups = groupRowsByUtcDay(
      [
        { prop_id: 'a', archived_at: '2026-04-01T04:00:00.000Z' },
        { prop_id: 'b', game_time: '2026-04-02T18:00:00.000Z' },
        { prop_id: 'c', archived_at: '2026-04-01T20:00:00.000Z' },
      ],
      ['archived_at', 'game_time']
    )
    expect([...groups.keys()].sort()).toEqual(['2026-04-01', '2026-04-02'])
    expect(groups.get('2026-04-01').map((r) => r.prop_id)).toEqual(['a', 'c'])
    expect(groups.get('2026-04-02').map((r) => r.prop_id)).toEqual(['b'])
  })
})
