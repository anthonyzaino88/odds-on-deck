#!/usr/bin/env node
/**
 * Record today's sides & totals into PropValidation (source=game_line)
 * and grade any pending game-line rows from Game scores already in the DB.
 *
 * NFL + NHL: private shadow mode. One moneyline and one total per game
 * at lock (upcoming), as long as the model produced a probability and
 * market odds exist. Ignores public gates and the 5% edge floor.
 * Tagged cohort:shadow-published — never public. Model version lives
 * on the row so a later research tag can plug in beside the live one.
 *
 * MLB: unpublished on purpose — no new rows. Already-recorded pending MLB
 * game lines still grade via persistGameLines → gradePendingGameLines.
 *
 * Every sport prints a section (edges read, picks recorded, skips by
 * reason, plus one skip line per game/market with no pick).
 * Reads EdgeSnapshot + Odds + Game only — does not call The Odds API.
 * Homepage / /api/picks no longer persist on render. Run after the morning
 * odds pull (and again after scores update if you want same-day grades).
 *
 * Usage:
 *   node scripts/record-game-lines.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const {
    GAME_LINE_SKIP_REASONS,
    GAME_LINE_SPORTS,
    bumpGameLineSkip,
    emptyGameLineRecorderSummary,
    formatGameLineRecorderSection,
    generatePicksFromSupabase,
    isRecordedGameLineSport,
  } = await import('../lib/picks.js')
  const { persistGameLines } = await import('../lib/validation.js')

  const summaries = GAME_LINE_SPORTS.map((sport) => emptyGameLineRecorderSummary(sport))
  const persistBatch = []

  for (const summary of summaries) {
    const sport = summary.sport
    if (!isRecordedGameLineSport(sport)) {
      summary.unpublished = true
      bumpGameLineSkip(summary, GAME_LINE_SKIP_REASONS.UNPUBLISHED)
      continue
    }

    const picks = await generatePicksFromSupabase(sport, null, 0, {
      quiet: true,
      diagnostics: summary,
      shadow: true,
    })
    summary.picks = picks.length
    persistBatch.push(...picks)
  }

  const saved = await persistGameLines(persistBatch)
  const savedBySport = {}
  for (const row of saved) {
    const sport = String(row?.sport || '').toLowerCase()
    savedBySport[sport] = (savedBySport[sport] || 0) + 1
  }
  for (const summary of summaries) {
    summary.recorded = savedBySport[summary.sport] || 0
    if (isRecordedGameLineSport(summary.sport) && summary.picks > summary.recorded) {
      bumpGameLineSkip(
        summary,
        GAME_LINE_SKIP_REASONS.PERSIST_SKIPPED,
        summary.picks - summary.recorded,
      )
    }
    console.log(formatGameLineRecorderSection(summary))
  }

  console.log(`📌 Game-line shadow track: recorded ${saved.length} private PropValidation row(s) from ${persistBatch.length} candidate line(s)`)
}

main().catch((error) => {
  console.error('❌ record-game-lines failed:', error)
  process.exit(1)
})
