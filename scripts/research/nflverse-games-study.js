#!/usr/bin/env node
/**
 * Read-only nflverse / Lee Sharpe games.csv study.
 *
 * Downloads (or reads a local path) and writes a markdown report.
 * Does not import Supabase, Prisma, or The Odds API. Does not flip
 * eligibleForPublic or any public-board switch.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import {
  NFLVERSE_GAMES_URL,
  NFLVERSE_STUDY_CONSTRAINTS,
  parseStudyArgs,
  renderStudyMarkdown,
  runNflverseGamesStudy,
} from '../../lib/research/nflverse-games-study.js'

export const STUDY_CLI_CONSTRAINTS = NFLVERSE_STUDY_CONSTRAINTS

const HELP = `Read-only nflverse games study (research only).

Usage:
  node scripts/research/nflverse-games-study.js --input path/to/games.csv
  node scripts/research/nflverse-games-study.js [--url URL] [--cache path]

This path does not call The Odds API, write production Supabase, regrade
picks, merge, or enable public NFL selections.

Options:
  --input <path>          Local games.csv (no network)
  --url <url>             Default ${NFLVERSE_GAMES_URL}
  --cache <path>          Write the downloaded CSV here
  --include-playoffs      Add WC/DIV/CON/SB (REG is always included)
  --min-season <year>
  --max-season <year>
  --min-team-games <n>    Default 4
  --report <path>         Markdown report (default docs/research/nflverse-games-study.md)
  --json <path>           Optional machine-readable summary (evaluations omitted)
`

function downloadText(url, { timeoutMs = 60000, redirectsLeft = 5 } = {}) {
  return new Promise((resolveDownload, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'odds-on-deck-nflverse-research/1.0 (read-only offline study)',
        Accept: 'text/csv,text/plain,*/*',
      },
    }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        resolveDownload(downloadText(nextUrl, { timeoutMs, redirectsLeft: redirectsLeft - 1 }))
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`nflverse download failed: HTTP ${status}`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolveDownload(Buffer.concat(chunks).toString('utf8')))
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('nflverse download timed out'))
    })
    req.on('error', reject)
  })
}

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
      evaluations: undefined,
      evaluationCount: result.moneyline?.evaluations?.length ?? 0,
    },
    totals: {
      ...result.totals,
      chronologicalOos: (result.totals?.chronologicalOos || []).map((row) => ({
        ...row,
        trainFit: {
          n: row.trainFit?.n,
          mean: row.trainFit?.mean,
          variance: row.trainFit?.variance,
          sd: row.trainFit?.sd,
          validationStatus: row.trainFit?.validationStatus,
        },
      })),
    },
  }
}

export async function loadStudyCsv(args) {
  if (args.input) {
    const path = resolve(args.input)
    const csvText = await readFile(path, 'utf8')
    return { csvText, sourcePath: path, sourceUrl: null, downloaded: false }
  }

  const csvText = await downloadText(args.url)
  if (args.cache) {
    const cachePath = resolve(args.cache)
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, csvText, 'utf8')
  }
  return {
    csvText,
    sourcePath: args.cache ? resolve(args.cache) : null,
    sourceUrl: args.url,
    downloaded: true,
  }
}

export async function runStudyCli(argv = process.argv.slice(2), { stdout = console } = {}) {
  assertResearchOnly()
  const args = parseStudyArgs(argv)
  if (args.help) {
    stdout.log(HELP)
    return { ok: true, help: true }
  }

  const loaded = await loadStudyCsv(args)
  const result = runNflverseGamesStudy({
    csvText: loaded.csvText,
    includePlayoffs: args.includePlayoffs,
    minSeason: Number.isFinite(args.minSeason) ? args.minSeason : null,
    maxSeason: Number.isFinite(args.maxSeason) ? args.maxSeason : null,
    minTeamGames: Number.isFinite(args.minTeamGames) ? args.minTeamGames : 4,
    sourceUrl: loaded.downloaded ? loaded.sourceUrl : null,
    sourcePath: loaded.sourcePath || args.input,
  })

  const report = renderStudyMarkdown(result)
  const reportPath = resolve(args.report)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, report, 'utf8')

  if (args.json) {
    const jsonPath = resolve(args.json)
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, `${JSON.stringify(slimResult(result), null, 2)}\n`, 'utf8')
  }

  stdout.log('nflverse offline study (research only)')
  stdout.log(`eligibleForPublic=${result.constraints.eligibleForPublic} oddsApi=${result.constraints.usesOddsApi} dbWrite=${result.constraints.writesProductionDb}`)
  stdout.log(`rows parsed=${result.source.parsedRows} filtered=${result.source.filteredRows} completed=${result.source.completedRows}`)
  stdout.log(`totals n=${result.totals.inSample.n} mean=${result.totals.inSample.mean?.toFixed?.(3) ?? 'n/a'} sd=${result.totals.inSample.sd?.toFixed?.(3) ?? 'n/a'}`)
  stdout.log(`moneyline n=${result.moneyline.nEvaluated} logloss model/market=${result.moneyline.logLoss.model?.toFixed?.(4) ?? 'n/a'}/${result.moneyline.logLoss.market?.toFixed?.(4) ?? 'n/a'}`)
  stdout.log(`flat-stake model-preferred ROI=${result.moneyline.flatStake.modelPreferred.roi ?? 'n/a'} n=${result.moneyline.flatStake.modelPreferred.n}`)
  stdout.log(`report ${reportPath}`)
  return { ok: true, result, reportPath }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  runStudyCli().catch((error) => {
    console.error(error.message || error)
    process.exitCode = 1
  })
}
