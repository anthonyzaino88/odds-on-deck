#!/usr/bin/env node
/**
 * Record today's sides & totals into PropValidation (source=game_line)
 * and grade any pending game-line rows from Game scores already in the DB.
 *
 * NFL: public persist gates (eligibleForPublic, threshold, lock time).
 * NHL: same threshold / lock / model-vs-market gap checks, stored privately
 *      (cohort:shadow-published, no auto-saved). Off the public board.
 * MLB: unpublished on purpose — no new rows. Already-recorded pending MLB
 *      game lines still grade via persistGameLines → gradePendingGameLines.
 *
 * Every sport prints a section (edges read, picks recorded, skips by reason).
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
    GAME_LINE_MIN_EDGE,
    GAME_LINE_SKIP_REASONS,
    GAME_LINE_SPORTS,
    bumpGameLineSkip,
    emptyGameLineRecorderSummary,
    formatGameLineRecorderSection,
    generatePicksFromSupabase,
    isPublishedGameLineSport,
    isRecordableGameLine,
    isRecordedGameLineSport,
    selectGameLines,
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

    const picks = await generatePicksFromSupabase(sport, null, GAME_LINE_MIN_EDGE, {
      quiet: true,
      diagnostics: summary,
    })
    const selected = isPublishedGameLineSport(sport)
      ? selectGameLines(picks)
      : picks.filter((line) => isRecordableGameLine(line))
    if (picks.length > selected.length) {
      const dropped = picks.length - selected.length
      bumpGameLineSkip(
        summary,
        isPublishedGameLineSport(sport)
          ? GAME_LINE_SKIP_REASONS.PUBLIC_INELIGIBLE
          : GAME_LINE_SKIP_REASONS.LOCK_TIME,
        dropped,
      )
    }
    summary.picks = selected.length
    persistBatch.push(...selected)
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

  console.log(`📌 Game-line track: recorded ${saved.length} PropValidation row(s) from ${persistBatch.length} candidate line(s)`)
}

main().catch((error) => {
  console.error('❌ record-game-lines failed:', error)
  process.exit(1)
})
