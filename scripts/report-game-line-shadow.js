#!/usr/bin/env node
/**
 * Read-only private NFL / NHL game-line shadow record.
 *
 *   node scripts/report-game-line-shadow.js
 *   npm run report:game-line-shadow
 *
 * Per sport and market (moneyline, total): n, W–L–P, ROI at posted odds,
 * avg CLV, % beating close. Uses createScriptSupabaseClient. Never writes.
 * Never calls The Odds API. Never used by homepage / Editor's / public APIs.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  PUBLISHED_STATS_SELECT,
  SHADOW_PUBLISHED_COHORT_TAG,
  filterSidesTotalsPicks,
  summarizeSidesTotals,
} from '../lib/published-picks.js'
import { GAME_LINE_SOURCE, gameLineMarketType } from '../lib/game-lines.js'
import {
  GAME_LINE_SHADOW_SPORTS,
  isShadowGameLineRecord,
  modelVersionFromNotes,
} from '../lib/game-line-shadow.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import { summarizePublishedClv } from '../lib/closing-line.js'
import { formatClvSummary } from './report-published-clv.js'

config({ path: '.env.local' })

const CLOSE_SELECT = `${PUBLISHED_STATS_SELECT}, closeOdds, closeLine, closeBook, closeCapturedAt`
const MARKETS = Object.freeze(['moneyline', 'total'])

function formatSigned(n, digits = 2) {
  if (!Number.isFinite(n)) return 'n/a'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}`
}

export function gameLineShadowGroupKey(row) {
  const sport = String(row?.sport || '').toLowerCase().trim()
  const market = gameLineMarketType(row) || 'line'
  return `${sport}:${market}`
}

export function groupGameLineShadowPicks(rows) {
  const groups = new Map()
  for (const sport of GAME_LINE_SHADOW_SPORTS) {
    for (const market of MARKETS) {
      groups.set(`${sport}:${market}`, [])
    }
  }
  for (const row of rows || []) {
    if (!isShadowGameLineRecord(row)) continue
    const key = gameLineShadowGroupKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}

export function summarizeGameLineShadowGroup(rows, sport) {
  const picks = filterSidesTotalsPicks(rows, {
    sports: [sport],
    includeShadow: true,
  })
  const record = summarizeSidesTotals(rows, {
    sports: [sport],
    includeShadow: true,
  })
  const clv = summarizePublishedClv(picks)
  const versions = [...new Set(picks.map((row) => (
    modelVersionFromNotes(row.notes) || row.modelRun || row.modelVersion || 'unknown'
  )))]
  return { record, clv, versions, n: record.graded }
}

export function formatGameLineShadowGroup({ sport, market, record, clv, versions }) {
  const clvLine = formatClvSummary(clv)
  const avgClv = clv.avgClvProb == null
    ? 'n/a'
    : `${clv.avgClvProb >= 0 ? '+' : ''}${(clv.avgClvProb * 100).toFixed(2)}pp`
  const beat = clv.pctBeatClose == null
    ? 'n/a'
    : `${(clv.pctBeatClose * 100).toFixed(1)}%`
  return {
    header: `${sport.toUpperCase()} ${market}`,
    n: `n: ${record.graded}`,
    record: `W-L-P: ${record.record}`,
    roi: `ROI: ${formatSigned(record.roi * 100, 1)}%   units: ${formatSigned(record.units, 2)}u`,
    clv: `avg CLV: ${avgClv}   beat close: ${beat}   same-line: ${clv.sameLine}`,
    models: `model: ${versions.join(', ') || 'n/a'}`,
    clvLine: clvLine.line,
  }
}

export async function runReportGameLineShadow({
  createClient = createScriptSupabaseClient,
  log = console,
} = {}) {
  const supabase = createClient()

  async function load(select) {
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('status', 'completed')
      .eq('source', GAME_LINE_SOURCE)
      .in('sport', GAME_LINE_SHADOW_SPORTS)
      .in('propType', MARKETS)
      .ilike('notes', `%${SHADOW_PUBLISHED_COHORT_TAG}%`)
      .order('id', { ascending: true }))
  }

  let page = await load(CLOSE_SELECT)
  if (page.error && isMissingColumnError(page.error)) {
    log.log('⚠️ closeOdds columns not applied yet (run 007 SQL). Reporting CLV as n/a.')
    page = await load(PUBLISHED_STATS_SELECT)
  }
  if (page.error) {
    log.error(`❌ Query error: ${page.error.message}`)
    return { exitCode: 1, groups: {}, picks: [] }
  }

  const picks = (page.rows || []).filter((row) => isShadowGameLineRecord(row))
  const grouped = groupGameLineShadowPicks(picks)

  log.log('\n🔒 GAME-LINE SHADOW (private, read-only)')
  log.log('='.repeat(60))
  log.log(`Cohort: ${SHADOW_PUBLISHED_COHORT_TAG}   source=${GAME_LINE_SOURCE}`)
  log.log('Nothing here is public. No moneyline or total graduates until a')
  log.log('walk-forward backtest beats the close.')

  const summaries = {}
  for (const [key, rows] of grouped) {
    const [sport, market] = key.split(':')
    const summary = summarizeGameLineShadowGroup(rows, sport)
    summaries[key] = summary
    const formatted = formatGameLineShadowGroup({
      sport,
      market,
      record: summary.record,
      clv: summary.clv,
      versions: summary.versions,
    })
    log.log('')
    log.log(formatted.header)
    log.log(`  ${formatted.n}   ${formatted.record}`)
    log.log(`  ${formatted.roi}`)
    log.log(`  ${formatted.clv}`)
    log.log(`  ${formatted.models}`)
  }

  log.log('')
  log.log('Headline CLV uses same-line closes only (closeLine = recorded line).')
  log.log('Does not write. Does not call The Odds API. Off every public surface.')
  return { exitCode: 0, groups: summaries, picks }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runReportGameLineShadow().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
