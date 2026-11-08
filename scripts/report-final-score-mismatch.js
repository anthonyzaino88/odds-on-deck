#!/usr/bin/env node
import { sanitizedErrorMessage, sanitizeLoggedValue } from '../lib/sanitize-error.js'
/**
 * Read-only: stored final Game scores vs ESPN (NFL/NHL/MLB) or
 * MLB StatsAPI schedule+linescore.
 *
 * Does not write. Does not call The Odds API.
 *
 * Usage:
 *   node scripts/report-final-score-mismatch.js
 *   node scripts/report-final-score-mismatch.js --sport all --days 14
 *   node scripts/report-final-score-mismatch.js --sport mlb --days 7
 *   node scripts/report-final-score-mismatch.js --gameId NJ_at_VGK_2026-10-14
 *
 * Scan cap is 200 finals per sport (--sport all can scan 600).
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  DEFAULT_SCAN_LIMIT_PER_SPORT,
  DEFAULT_SOURCE_FETCH_GAP_MS,
  collectFinalScoreMismatches,
  formatFinalScoreMismatchLine,
  loadSourceFinalBox,
  parseReportFinalScoreArgs,
  resolveReportSports,
  sleep,
} from '../lib/final-score-mismatch.js'

export const REPORT_FINAL_SCORE_USAGE = `Usage:
  node scripts/report-final-score-mismatch.js [--sport mlb|nfl|nhl|all] [--days N] [--gameId ID] [--json]

Read-only stored-vs-source final score check (ESPN; MLB StatsAPI first).
Does not write. Does not call The Odds API.
Scan cap is ${DEFAULT_SCAN_LIMIT_PER_SPORT} finals per sport (--sport all can scan 600).
`

function gameDateCutoff(days) {
  const now = new Date()
  now.setUTCDate(now.getUTCDate() - Number(days || 14))
  return now.toISOString()
}

function storedRow(row) {
  return {
    id: row.id,
    sport: row.sport,
    status: row.status,
    espnGameId: row.espnGameId,
    mlbGameId: row.mlbGameId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    homeAbbr: row.home?.abbr || null,
    awayAbbr: row.away?.abbr || null,
  }
}

function indexSource(sourceByKey, row, source) {
  if (!source) return
  sourceByKey.set(row.id, source)
  if (row.espnGameId) sourceByKey.set(String(row.espnGameId), source)
  if (row.mlbGameId) sourceByKey.set(String(row.mlbGameId), source)
}

async function loadFinalGames(supabase, { sports, days, gameId, limit }) {
  const rows = []
  for (const sport of sports) {
    let query = supabase
      .from('Game')
      .select('id, sport, status, espnGameId, mlbGameId, date, homeScore, awayScore, home:homeId(abbr), away:awayId(abbr)')
      .eq('sport', sport)
      .eq('status', 'final')
      .gte('date', gameDateCutoff(days))
      .order('date', { ascending: false })
      .limit(limit)

    if (gameId) query = query.eq('id', gameId)

    const { data, error } = await query
    if (error) throw new Error(`Game lookup failed (${sport}): ${sanitizedErrorMessage(error)}`)
    rows.push(...(data || []).map(storedRow))
  }
  return rows
}

export async function runFinalScoreMismatchReport({
  argv = process.argv.slice(2),
  supabase,
  loadSource = loadSourceFinalBox,
  wait = sleep,
  gapMs = DEFAULT_SOURCE_FETCH_GAP_MS,
  limit = DEFAULT_SCAN_LIMIT_PER_SPORT,
  stdout = console,
} = {}) {
  const args = parseReportFinalScoreArgs(argv)
  if (args.help) {
    stdout.log?.(REPORT_FINAL_SCORE_USAGE)
    return { scanned: 0, mismatches: [], help: true }
  }

  const sports = resolveReportSports(args.sport)
  if (!sports) {
    const message = `Unknown --sport ${JSON.stringify(args.sport)}. Use mlb, nfl, nhl, or all.`
    stdout.error?.(message)
    stdout.error?.(REPORT_FINAL_SCORE_USAGE)
    stdout.log?.(message)
    stdout.log?.(REPORT_FINAL_SCORE_USAGE)
    return { scanned: 0, mismatches: [], error: 'unknown_sport', exitCode: 2, help: true }
  }
  if (!supabase) {
    const { createScriptSupabaseClient } = await import('../lib/supabase-script-client.js')
    supabase = createScriptSupabaseClient()
  }

  const rows = await loadFinalGames(supabase, {
    sports,
    days: args.days,
    gameId: args.gameId,
    limit,
  })
  const sourceByKey = new Map()
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const source = await loadSource(row)
    indexSource(sourceByKey, row, source)
    if (i < rows.length - 1) await wait(gapMs)
  }

  const flags = collectFinalScoreMismatches(rows, sourceByKey)
  if (args.json) {
    stdout.log?.(JSON.stringify({ scanned: rows.length, sports, mismatches: flags }, null, 2))
    return { scanned: rows.length, mismatches: flags, sports }
  }

  stdout.log?.(`📌 Final games scanned: ${rows.length} (${sports.join(', ')})`)
  stdout.log?.(`📌 Score mismatches: ${flags.length}`)
  stdout.log?.('   (this script does not write)')
  for (const flag of flags) {
    stdout.log?.(`  ${formatFinalScoreMismatchLine(flag)}`)
  }
  return { scanned: rows.length, mismatches: flags, sports }
}

const isDirect = process.argv[1] && process.argv[1].endsWith('report-final-score-mismatch.js')
if (isDirect) {
  runFinalScoreMismatchReport()
    .then((result) => {
      if (result?.exitCode) process.exit(result.exitCode)
    })
    .catch((error) => {
      console.error('❌ report-final-score-mismatch failed:', sanitizeLoggedValue(error))
      process.exit(1)
    })
}
