/**
 * Local Path B archive writes (JSONL on the operator laptop / checkout).
 *
 * Default dirs (relative to the repo root / process.cwd()):
 *   research/archive/prop-lines
 *   research/archive/box-scores
 *
 * Optional env overrides:
 *   ARCHIVE_PROP_LINES_DIR
 *   ARCHIVE_BOX_SCORES_DIR
 */

import fs from 'fs'
import path from 'path'

export const PROP_LINES_PREFIX = 'prop-lines'
export const BOX_SCORES_PREFIX = 'box-scores'

export const DEFAULT_PROP_LINES_REL = path.join('research', 'archive', 'prop-lines')
export const DEFAULT_BOX_SCORES_REL = path.join('research', 'archive', 'box-scores')

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

/**
 * Append one JSON object per line to `{dir}/{prefix}-YYYY-MM-DD.jsonl`.
 * Creates `dir` recursively. No-op on empty/missing rows. Returns count written.
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
 * Scan every *.jsonl in `dir` and collect unique values of `field`.
 * Used to skip GameBoxScore games that are already on disk.
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
