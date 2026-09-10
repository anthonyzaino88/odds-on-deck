#!/usr/bin/env node
/**
 * Research evaluator for NFL moneyline / totals cross-book price gaps.
 *
 * Reads a local Odds API-shaped JSON snapshot (or the bundled fixture).
 * Does not call The Odds API, write production Supabase, regrade picks,
 * merge, or flip eligibleForPublic.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  CROSS_BOOK_CONSTRAINTS,
  evaluateSnapshot,
  flattenQuotes,
  flattenSides,
} from '../../lib/research/nfl-cross-book-sides.js'

const HELP = `NFL cross-book sides evaluator (research only).

Usage:
  node scripts/research/nfl-cross-book-sides.js --input path/to/snapshot.json
  node scripts/research/nfl-cross-book-sides.js --fixture

Does not call The Odds API, write production Supabase, regrade picks,
merge, or enable public NFL selections.

Options:
  --input <path>     Odds API-shaped JSON (historical wrapper or event array)
  --fixture          Use scripts/research/fixtures/nfl-cross-book-sides-snapshot.json
  --phase <name>     Label snapshot phase (early|late|adhoc)
  --json <path>      Write evaluation JSON
  --report <path>    Markdown (default docs/research/nfl-cross-book-sides.md is the design doc; use a different path for a run)
`

const DEFAULT_FIXTURE = 'scripts/research/fixtures/nfl-cross-book-sides-snapshot.json'

function parseArgs(argv) {
  const args = { help: false, input: null, fixture: false, phase: 'adhoc', json: null, report: null }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--help' || token === '-h') args.help = true
    else if (token === '--fixture') args.fixture = true
    else if (token === '--input') args.input = argv[++i]
    else if (token === '--phase') args.phase = argv[++i]
    else if (token === '--json') args.json = argv[++i]
    else if (token === '--report') args.report = argv[++i]
  }
  return args
}

function assertResearchOnly() {
  if (CROSS_BOOK_CONSTRAINTS.eligibleForPublic) {
    throw new Error('Refusing to run: evaluator must keep eligibleForPublic=false')
  }
  if (CROSS_BOOK_CONSTRAINTS.writesProductionDb || CROSS_BOOK_CONSTRAINTS.usesOddsApi) {
    throw new Error('Refusing to run: evaluator must stay offline and read-only')
  }
}

function renderRunMarkdown(evaluation) {
  const sides = flattenSides(evaluation)
  const ok = sides.filter((row) => row.ok)
  const lines = [
    '# NFL cross-book sides run (research only)',
    '',
    '**Not a public-board switch.** `eligibleForPublic` stays false.',
    '',
    `| Snapshots events | ${evaluation.eventCount} |`,
    `| Phase | ${evaluation.phase} |`,
    `| Formula | \`${evaluation.formula}\` |`,
    `| Evaluable sides | ${ok.length} |`,
    '',
    '| Event | Market | Side | Line | Books | Consensus fair | Best book | Best implied | Price gap |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const row of ok) {
    const gap = Number.isFinite(row.priceGap) ? row.priceGap.toFixed(4) : 'n/a'
    const fair = Number.isFinite(row.consensusFair) ? row.consensusFair.toFixed(4) : 'n/a'
    const implied = Number.isFinite(row.bestImplied) ? row.bestImplied.toFixed(4) : 'n/a'
    lines.push(`| ${row.awayTeam} @ ${row.homeTeam} | ${row.market} | ${row.side} | ${row.line ?? ''} | ${row.numBooks} | ${fair} | ${row.bestBook} | ${implied} | ${gap} |`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

export async function runCrossBookCli(argv = process.argv.slice(2), { stdout = console } = {}) {
  assertResearchOnly()
  const args = parseArgs(argv)
  if (args.help) {
    stdout.log(HELP)
    return { ok: true, help: true }
  }

  const inputPath = resolve(args.input || (args.fixture ? DEFAULT_FIXTURE : ''))
  if (!args.input && !args.fixture) {
    stdout.log(HELP)
    throw new Error('Provide --input or --fixture')
  }

  const payload = JSON.parse(await readFile(inputPath, 'utf8'))
  const evaluation = evaluateSnapshot(payload, { phase: args.phase })
  const sides = flattenSides(evaluation)
  const quotes = flattenQuotes(evaluation)

  if (args.json) {
    const jsonPath = resolve(args.json)
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, `${JSON.stringify({ evaluation, sides, quotes }, null, 2)}\n`, 'utf8')
  }
  if (args.report) {
    const reportPath = resolve(args.report)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, renderRunMarkdown(evaluation), 'utf8')
  }

  stdout.log('NFL cross-book sides (research only)')
  stdout.log(`eligibleForPublic=${evaluation.constraints.eligibleForPublic} oddsApi=${evaluation.constraints.usesOddsApi}`)
  stdout.log(`events=${evaluation.eventCount} sides=${sides.length} quotes=${quotes.length} formula=${evaluation.formula}`)
  return { ok: true, evaluation, sides, quotes }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  runCrossBookCli().catch((error) => {
    console.error(error.message || error)
    process.exitCode = 1
  })
}
