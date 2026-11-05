#!/usr/bin/env node
/**
 * Read-only: stored final Game scores vs the ESPN source box.
 *
 * Does not write. Does not call The Odds API.
 *
 * Usage:
 *   node scripts/report-final-score-mismatch.js
 *   node scripts/report-final-score-mismatch.js --sport nhl --days 14
 *   node scripts/report-final-score-mismatch.js --gameId NJ_at_VGK_2026-10-14
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  collectFinalScoreMismatches,
  formatFinalScoreMismatchLine,
  parseReportFinalScoreArgs,
} from '../lib/final-score-mismatch.js'
import { fetchNHLGameDetail } from '../lib/vendors/nhl-stats.js'

export const REPORT_FINAL_SCORE_USAGE = `Usage:
  node scripts/report-final-score-mismatch.js [--sport nhl] [--days N] [--gameId ID] [--json]

Read-only stored-vs-ESPN final score check. Does not write.
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
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    homeAbbr: row.home?.abbr || null,
    awayAbbr: row.away?.abbr || null,
  }
}

async function loadSourceScore(row) {
  if (String(row.sport || '').toLowerCase() !== 'nhl') return null
  if (!row.espnGameId) return null
  return fetchNHLGameDetail(row.espnGameId)
}

async function main() {
  const args = parseReportFinalScoreArgs(process.argv.slice(2))
  if (args.help) {
    console.log(REPORT_FINAL_SCORE_USAGE)
    return
  }

  const { createScriptSupabaseClient } = await import('../lib/supabase-script-client.js')
  const supabase = createScriptSupabaseClient()

  let query = supabase
    .from('Game')
    .select('id, sport, status, espnGameId, date, homeScore, awayScore, home:homeId(abbr), away:awayId(abbr)')
    .eq('sport', args.sport)
    .eq('status', 'final')
    .gte('date', gameDateCutoff(args.days))
    .order('date', { ascending: false })
    .limit(200)

  if (args.gameId) query = query.eq('id', args.gameId)

  const { data, error } = await query
  if (error) throw new Error(`Game lookup failed: ${error.message}`)

  const rows = (data || []).map(storedRow)
  const sourceByKey = new Map()
  for (const row of rows) {
    const source = await loadSourceScore(row)
    if (source) {
      sourceByKey.set(row.id, source)
      if (row.espnGameId) sourceByKey.set(String(row.espnGameId), source)
    }
  }

  const flags = collectFinalScoreMismatches(rows, sourceByKey, { sport: args.sport })
  if (args.json) {
    console.log(JSON.stringify({ scanned: rows.length, mismatches: flags }, null, 2))
    return
  }

  console.log(`📌 Final games scanned: ${rows.length}`)
  console.log(`📌 Score mismatches: ${flags.length}`)
  console.log('   (this script does not write)')
  for (const flag of flags) {
    console.log(`  ${formatFinalScoreMismatchLine(flag)}`)
  }
}

const isDirect = process.argv[1] && process.argv[1].endsWith('report-final-score-mismatch.js')
if (isDirect) {
  main().catch((error) => {
    console.error('❌ report-final-score-mismatch failed:', error)
    process.exit(1)
  })
}
