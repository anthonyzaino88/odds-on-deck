#!/usr/bin/env node
/**
 * Second-pass read-only nflverse study (richer free features).
 *
 * Does not import Supabase, Prisma, or The Odds API. Does not flip
 * eligibleForPublic or any public-board switch.
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  NFLVERSE_GAMES_URL,
  NFLVERSE_STUDY_CONSTRAINTS,
} from '../../lib/research/nflverse-games-study.js'
import {
  parseRichStudyArgs,
  renderRichStudyMarkdown,
  runNflverseRichFeaturesStudy,
} from '../../lib/research/nflverse-rich-features-study.js'
import { loadStudyCsv } from './nflverse-games-study.js'

const HELP = `Read-only nflverse rich-features study (research only, pass 2).

Usage:
  node scripts/research/nflverse-rich-features-study.js --input path/to/games.csv

Does not call The Odds API, write production Supabase, regrade picks,
merge, or enable public NFL selections.

Options:
  --input <path>          Local games.csv (no network)
  --url <url>             Default ${NFLVERSE_GAMES_URL}
  --cache <path>
  --include-playoffs
  --min-season <year>
  --max-season <year>
  --min-team-games <n>    Default 4
  --min-fit-games <n>     Default 200 (expanding prior seasons)
  --report <path>         Default docs/research/nflverse-rich-features-study.md
  --json <path>
`

function assertResearchOnly() {
  if (NFLVERSE_STUDY_CONSTRAINTS.eligibleForPublic) {
    throw new Error('Refusing to run: study must keep eligibleForPublic=false')
  }
  if (NFLVERSE_STUDY_CONSTRAINTS.writesProductionDb || NFLVERSE_STUDY_CONSTRAINTS.usesOddsApi) {
    throw new Error('Refusing to run: study must stay offline and read-only')
  }
}

function slimResult(result) {
  return {
    ...result,
    moneyline: {
      ...result.moneyline,
      candidates: (result.moneyline?.candidates || []).map((candidate) => ({
        ...candidate,
        bySeason: candidate.bySeason,
      })),
    },
    fitLog: result.fitLog,
  }
}

export async function runRichStudyCli(argv = process.argv.slice(2), { stdout = console } = {}) {
  assertResearchOnly()
  const args = parseRichStudyArgs(argv)
  if (args.help) {
    stdout.log(HELP)
    return { ok: true, help: true }
  }

  const loaded = await loadStudyCsv(args)
  const result = runNflverseRichFeaturesStudy({
    csvText: loaded.csvText,
    includePlayoffs: args.includePlayoffs,
    minSeason: Number.isFinite(args.minSeason) ? args.minSeason : null,
    maxSeason: Number.isFinite(args.maxSeason) ? args.maxSeason : null,
    minTeamGames: Number.isFinite(args.minTeamGames) ? args.minTeamGames : 4,
    minFitGames: Number.isFinite(args.minFitGames) ? args.minFitGames : 200,
    sourceUrl: loaded.downloaded ? loaded.sourceUrl : null,
    sourcePath: loaded.sourcePath || args.input,
  })

  const report = renderRichStudyMarkdown(result)
  const reportPath = resolve(args.report)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, report, 'utf8')

  if (args.json) {
    const jsonPath = resolve(args.json)
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, `${JSON.stringify(slimResult(result), null, 2)}\n`, 'utf8')
  }

  const bestIndependent = (result.moneyline.candidates || []).find((row) => (
    !row.usesClosingMarket && row.beatsClosingMarket.beats
  ))
  stdout.log('nflverse rich-features study (research only, pass 2)')
  stdout.log(`eligibleForPublic=${result.constraints.eligibleForPublic} oddsApi=${result.constraints.usesOddsApi} dbWrite=${result.constraints.writesProductionDb}`)
  stdout.log(`rows parsed=${result.source.parsedRows} filtered=${result.source.filteredRows} completed=${result.source.completedRows}`)
  for (const candidate of result.moneyline.candidates) {
    stdout.log(`ml ${candidate.candidateId} n=${candidate.nEvaluated} ll=${candidate.logLoss?.toFixed?.(4) ?? 'n/a'}/${candidate.marketLogLoss?.toFixed?.(4) ?? 'n/a'} roi=${candidate.primaryStake.roi ?? 'n/a'} beats=${candidate.beatsClosingMarket.beats}`)
  }
  stdout.log(`totals n=${result.totals.overall.nEvaluated} ll=${result.totals.overall.logLoss?.toFixed?.(4) ?? 'n/a'}/${result.totals.overall.marketLogLoss?.toFixed?.(4) ?? 'n/a'} roi=${result.totals.overall.primaryStake.roi ?? 'n/a'} beats=${result.totals.overall.beatsClosingMarket.beats}`)
  stdout.log(`independent_market_beat=${Boolean(bestIndependent)}`)
  stdout.log(`report ${reportPath}`)
  return { ok: true, result, reportPath }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  runRichStudyCli().catch((error) => {
    console.error(error.message || error)
    process.exitCode = 1
  })
}
