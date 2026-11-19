/**
 * Parse a stored timestamp. Zone-less strings are UTC (append Z), matching
 * production Game.date / Odds.ts handling in lib/published-picks.js.
 */

export function parseRecordInstant(raw) {
  if (!raw) return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  const text = String(raw)
  const iso = text.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}
