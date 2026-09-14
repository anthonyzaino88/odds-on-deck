#!/usr/bin/env node

/**
 * NFL BOX-SCORE ARCHIVE (independent of PropValidation)
 *
 * Public ESPN endpoints only. No Odds API. No cache deletion.
 *
 *   node scripts/archive-nfl-box-scores.js --audit
 *   node scripts/archive-nfl-box-scores.js --audit --season 2026
 *   node scripts/archive-nfl-box-scores.js --season 2026 --from 2026-09-04 --to 2026-09-14
 *
 * --from/--to are inclusive UTC calendar days, not Eastern calendar days.
 * An 8:15 PM ET kickoff on the named Eastern date is the *next* UTC day
 * (EDT: 00:15Z, EST: 01:15Z) and is NOT included in `--to` of that Eastern date.
 * Example: Sunday 2026-09-14 8:15 PM ET → `--to 2026-09-15`.
 * A 4:15 PM ET kickoff is 20:15Z the same UTC day and *is* included in `--to 2026-09-14`.
 * Default without --week/--from/--to walks regular-season weeks 1–18 and
 * re-fetches each completed summary (identical hashes are no-ops). Prefer
 * --week or --from/--to for a postgame run.
 *   node scripts/archive-nfl-box-scores.js --season 2026 --week 2
 *   node scripts/archive-nfl-box-scores.js --event 401772510
 *   node scripts/archive-nfl-box-scores.js --dry-run --season 2026 --week 1
 *
 * Capture time is the moment this process fetched the source. It is never
 * backdated to game time. Re-running is the correction refresh: identical
 * observations are no-ops; changed box scores write a new version.
 */

import { config } from 'dotenv'
import { formatNflCoverageReport, nflArchiveJobExitCode, parseArchiveNflArgs, runNflBoxScoreJob } from '../lib/nfl-archive-job.js'

config({ path: '.env.local' })

async function main() {
  const opts = parseArchiveNflArgs(process.argv.slice(2))

  console.log('\n🏈 NFL BOX-SCORE ARCHIVE')
  console.log('='.repeat(70))
  console.log(`Mode:     ${opts.audit ? 'AUDIT (read-only)' : opts.dryRun ? 'DRY RUN (no writes)' : 'ARCHIVE'}`)
  console.log(`Season:   ${opts.season}`)
  if (opts.week) console.log(`Week:     ${opts.week}`)
  if (opts.from || opts.to) console.log(`Range:    ${opts.from || '?'} .. ${opts.to || '?'}`)
  if (opts.event) console.log(`Event:    ${opts.event}`)
  console.log('Source:   ESPN site API (no Odds API)')
  console.log('='.repeat(70))

  const result = await runNflBoxScoreJob(opts)
  console.log('\n' + formatNflCoverageReport(result))

  if (result.writes?.length && !opts.audit) {
    const wrote = result.writes.filter((w) => w.wrote).length
    const identical = result.writes.filter((w) => w.reason === 'identical').length
    const corrections = result.writes.filter((w) => w.reason === 'correction').length
    const incomplete = result.writes.filter((w) => w.reason === 'incomplete_observation').length
    const failed = result.writes.filter((w) => w.reason === 'failed_fetch' || w.reason === 'not_completed_from_source').length
    console.log('\nWrites:')
    console.log(`  new/updated:  ${wrote}`)
    console.log(`  identical:    ${identical}`)
    console.log(`  corrections:  ${corrections}`)
    console.log(`  incomplete:   ${incomplete}`)
    console.log(`  failed:       ${failed}`)
  }

  console.log('\nThis job never deletes PlayerPropCache or archive files.')
  console.log('='.repeat(70) + '\n')

  process.exit(nflArchiveJobExitCode(result))
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
