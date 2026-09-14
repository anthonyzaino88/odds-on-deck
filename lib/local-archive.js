/**
 * Local Path B archive writes (JSONL on the operator laptop / checkout).
 *
 * Default dirs (relative to the repo root / process.cwd()):
 *   research/archive/prop-lines
 *   research/archive/box-scores
 *   research/archive/box-scores/nfl   (NFL versioned box scores)
 *
 * Optional env overrides:
 *   ARCHIVE_PROP_LINES_DIR
 *   ARCHIVE_BOX_SCORES_DIR
 *   ARCHIVE_NFL_BOX_SCORES_DIR
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const PROP_LINES_PREFIX = 'prop-lines'
export const BOX_SCORES_PREFIX = 'box-scores'
export const NFL_INDEX_FILENAME = 'index.jsonl'

export const DEFAULT_PROP_LINES_REL = path.join('research', 'archive', 'prop-lines')
export const DEFAULT_BOX_SCORES_REL = path.join('research', 'archive', 'box-scores')
export const DEFAULT_NFL_BOX_SCORES_REL = path.join('research', 'archive', 'box-scores', 'nfl')

export class ArchiveWriteError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'ArchiveWriteError'
    Object.assign(this, extra)
  }
}

/**
 * UTC calendar day YYYY-MM-DD. Accepts Date or parseable string.
 * Invalid / missing values fall back to now.
 */
export function toUtcDayStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export function dailyJsonlFilename(filenamePrefix, date = new Date()) {
  return `${filenamePrefix}-${toUtcDayStamp(date)}.jsonl`
}

/**
 * First usable timestamp among `fields` on `row`, else now.
 * Used to split export dumps by archived_at / fetched_at / game_time.
 */
export function rowArchiveDate(row, fields = []) {
  if (row && fields.length) {
    for (const field of fields) {
      if (row[field]) {
        const d = new Date(row[field])
        if (!Number.isNaN(d.getTime())) return d
      }
    }
  }
  return new Date()
}

export function resolvePropLinesDir(repoRoot = process.cwd()) {
  return process.env.ARCHIVE_PROP_LINES_DIR || path.join(repoRoot, DEFAULT_PROP_LINES_REL)
}

export function resolveBoxScoresDir(repoRoot = process.cwd()) {
  return process.env.ARCHIVE_BOX_SCORES_DIR || path.join(repoRoot, DEFAULT_BOX_SCORES_REL)
}

export function resolveNflBoxScoresDir(repoRoot = process.cwd()) {
  return process.env.ARCHIVE_NFL_BOX_SCORES_DIR || path.join(repoRoot, DEFAULT_NFL_BOX_SCORES_REL)
}

export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])])
    )
  }
  return value
}

export function stableHash(value) {
  const json = JSON.stringify(sortKeysDeep(value))
  return crypto.createHash('sha256').update(json).digest('hex')
}

export function parseJsonlLines(text) {
  const records = []
  const corrupt = []
  if (!text) return { records, corrupt }
  const lines = String(text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      corrupt.push({ lineNumber: i + 1, line })
    }
  }
  return { records, corrupt }
}

export function readJsonlFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { records: [], corrupt: [], missing: true }
  }
  const text = fs.readFileSync(filePath, 'utf8')
  const parsed = parseJsonlLines(text)
  return { ...parsed, missing: false }
}

/**
 * Recursively collect records from every *.jsonl under `dir` (non-recursive
 * by default; set `recursive` to include nested folders).
 */
export function readJsonlDir(dir, { recursive = false } = {}) {
  const records = []
  const corrupt = []
  if (!dir || !fs.existsSync(dir)) {
    return { records, corrupt, missing: true }
  }

  const files = []
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        if (recursive) walk(full)
        continue
      }
      if (name.endsWith('.jsonl')) files.push(full)
    }
  }
  walk(dir)
  files.sort()

  for (const file of files) {
    const parsed = readJsonlFile(file)
    records.push(...parsed.records)
    for (const item of parsed.corrupt) {
      corrupt.push({ file, ...item })
    }
  }
  return { records, corrupt, missing: false }
}

export function atomicWriteFile(filePath, contents) {
  if (!filePath) throw new ArchiveWriteError('atomicWriteFile requires a path')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`
  fs.writeFileSync(tmp, contents, 'utf8')
  try {
    const fd = fs.openSync(tmp, 'r+')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    // fsync is best-effort; rename still happens
  }
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    if (err && (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EACCES')) {
      fs.rmSync(filePath, { force: true })
      fs.renameSync(tmp, filePath)
    } else {
      try {
        fs.rmSync(tmp, { force: true })
      } catch {
        // ignore cleanup
      }
      throw err
    }
  }
}

export function verifyFileContents(filePath, expected) {
  if (!fs.existsSync(filePath)) {
    throw new ArchiveWriteError(`archive verify failed: missing ${filePath}`, { filePath })
  }
  const actual = fs.readFileSync(filePath, 'utf8')
  if (actual !== expected) {
    throw new ArchiveWriteError(`archive verify failed: contents mismatch for ${filePath}`, {
      filePath,
    })
  }
  return true
}

export function writeJsonAtomic(filePath, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`
  atomicWriteFile(filePath, contents)
  verifyFileContents(filePath, contents)
  JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return filePath
}

export function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Replace a JSONL file with `records` (atomic + verified). Does not delete
 * sibling archive files. Corrupt historical lines are the caller's problem:
 * pass them through if they must stay on disk.
 */
export function writeJsonlAtomic(filePath, records) {
  const contents =
    records.length === 0 ? '' : `${records.map((row) => JSON.stringify(row)).join('\n')}\n`
  atomicWriteFile(filePath, contents)
  verifyFileContents(filePath, contents)
  const parsed = readJsonlFile(filePath)
  if (parsed.corrupt.length > 0) {
    throw new ArchiveWriteError(`archive verify failed: corrupt JSONL in ${filePath}`, {
      filePath,
      corrupt: parsed.corrupt.length,
    })
  }
  if (parsed.records.length !== records.length) {
    throw new ArchiveWriteError(`archive verify failed: JSONL length mismatch for ${filePath}`, {
      filePath,
      expected: records.length,
      actual: parsed.records.length,
    })
  }
  return parsed.records
}

/**
 * Append one JSON object per line to `{dir}/{prefix}-YYYY-MM-DD.jsonl`.
 * Creates `dir` recursively. No-op on empty/missing rows. Returns count written.
 *
 * Unverified append — kept for MLB export compatibility. Prefer
 * `appendJsonlVerified` when a later delete depends on the write.
 */
export function appendJsonl(dir, filenamePrefix, rows, date = new Date()) {
  if (!rows || rows.length === 0) return 0
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, dailyJsonlFilename(filenamePrefix, date))
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  fs.appendFileSync(file, payload, 'utf8')
  return rows.length
}

/**
 * Append rows, then read the tail back. Throws ArchiveWriteError on mismatch
 * so callers can abort deletes. Existing bytes before the append stay intact.
 */
export function appendJsonlVerified(dir, filenamePrefix, rows, date = new Date()) {
  if (!rows || rows.length === 0) return { written: 0, file: null, records: [] }
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, dailyJsonlFilename(filenamePrefix, date))
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  const expected = before + payload
  fs.appendFileSync(file, payload, 'utf8')
  verifyFileContents(file, expected)
  const parsed = parseJsonlLines(payload)
  if (parsed.corrupt.length > 0 || parsed.records.length !== rows.length) {
    throw new ArchiveWriteError(`archive verify failed: appended JSONL unreadable in ${file}`, {
      filePath: file,
    })
  }
  for (let i = 0; i < rows.length; i++) {
    if (stableHash(parsed.records[i]) !== stableHash(rows[i])) {
      throw new ArchiveWriteError(`archive verify failed: appended row hash mismatch in ${file}`, {
        filePath: file,
        index: i,
      })
    }
  }
  return { written: rows.length, file, records: parsed.records }
}

/**
 * Append records to an existing JSONL file (or create it). Verifies the tail.
 * Does not rewrite earlier bytes.
 */
export function appendJsonlRecords(filePath, rows) {
  if (!rows || rows.length === 0) return { written: 0, file: filePath, records: [] }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  const expected = before + payload
  fs.appendFileSync(filePath, payload, 'utf8')
  verifyFileContents(filePath, expected)
  const parsed = parseJsonlLines(payload)
  if (parsed.corrupt.length > 0 || parsed.records.length !== rows.length) {
    throw new ArchiveWriteError(`archive verify failed: appended JSONL unreadable in ${filePath}`, {
      filePath,
    })
  }
  return { written: rows.length, file: filePath, records: parsed.records }
}

/**
 * Scan every *.jsonl in `dir` (top-level only) and collect unique values of `field`.
 * Used by the MLB validator to skip GameBoxScore games that are already on disk.
 */
export function loadJsonlFieldSet(dir, field) {
  const values = new Set()
  if (!dir || !fs.existsSync(dir)) return values
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj[field] != null) values.add(obj[field])
      } catch {
        // skip malformed lines
      }
    }
  }
  return values
}

/**
 * Group rows into UTC-day buckets using the first present field.
 */
export function groupRowsByUtcDay(rows, fields) {
  const groups = new Map()
  for (const row of rows) {
    const day = toUtcDayStamp(rowArchiveDate(row, fields))
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day).push(row)
  }
  return groups
}
