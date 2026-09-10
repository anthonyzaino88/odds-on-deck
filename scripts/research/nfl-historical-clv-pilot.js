#!/usr/bin/env node
/**
 * Budgeted Odds API historical CLV pilot (research only).
 *
 * Default is --dry-run (no network). --fixture uses local JSON.
 * --live requires ODDS_API_KEY and is hard-capped at 3000 credits.
 *
 * Writes research-local files only. Does not write production Supabase,
 * regrade picks, merge, or flip eligibleForPublic.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { config as loadEnv } from 'dotenv'
import {
  CLV_PILOT_CONSTRAINTS,
  build2024RegSnapshotPlan,
  computeClvReport,
  createPilotGuard,
  evaluateFetchedSnapshot,
  fetchHistoricalSnapshot,
  isUsableHistoricalBody,
  loadNflverseGames,
  parsePilotArgs,
  probeQuota,
  renderClvMarkdown,
  slimPair,
  toCsv,
} from '../../lib/research/nfl-historical-clv-pilot.js'
import { evaluateSnapshot } from '../../lib/research/nfl-cross-book-sides.js'
import { HARD_CREDIT_CAP } from '../../lib/research/odds-api-credit-guard.js'

loadEnv({ path: '.env.local' })
loadEnv()

const HELP = `NFL historical CLV pilot (research only, hard 3000-credit cap).

Usage:
  node scripts/research/nfl-historical-clv-pilot.js --dry-run
  node scripts/research/nfl-historical-clv-pilot.js --fixture
  ODDS_API_KEY=... node scripts/research/nfl-historical-clv-pilot.js --live

Default without --live/--fixture is dry-run (no Odds API calls).

Options:
  --dry-run              Print the 2024 REG snapshot plan; spend 0 credits
  --fixture              Evaluate bundled early/late fixtures (no network)
  --live                 Pull historical odds (requires ODDS_API_KEY)
  --weeks 1,2,3          Subset of 2024 REG weeks (default 1-18)
  --max-snapshots 36     Default 36; hard ceiling 140
  --max-credits 3000     Cannot exceed 3000
  --out <dir>            Raw + tidy outputs (default scripts/research/out/nfl-historical-clv-pilot)
  --report <path>        Markdown report (default docs/research/nfl-historical-clv-pilot-run.md)
  --nflverse <csv>       Optional local nflverse games.csv for outcomes
  --no-resume            Re-fetch even if raw snapshot files exist
`

const DEFAULT_FIXTURE = 'scripts/research/fixtures/nfl-historical-clv-pilot.json'

function assertResearchOnly() {
  if (CLV_PILOT_CONSTRAINTS.eligibleForPublic) {
    throw new Error('Refusing to run: pilot must keep eligibleForPublic=false')
  }
  if (CLV_PILOT_CONSTRAINTS.writesProductionDb || CLV_PILOT_CONSTRAINTS.regradesPicks || CLV_PILOT_CONSTRAINTS.merges) {
    throw new Error('Refusing to run: pilot must not write production, regrade, or merge')
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function maybeRead(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function runPilotCli(argv = process.argv.slice(2), {
  stdout = console,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  assertResearchOnly()
  const args = parsePilotArgs(argv)
  if (args.help) {
    stdout.log(HELP)
    return { ok: true, help: true }
  }

  const outDir = resolve(args.out)
  const plan = build2024RegSnapshotPlan({
    maxSnapshots: args.maxSnapshots,
    weeks: args.weeks,
  })
  const guard = createPilotGuard(args)
  let liveNote = null

  await mkdir(outDir, { recursive: true })
  await writeJson(join(outDir, 'plan.json'), plan)

  if (args.dryRun && !args.live && !args.fixture) {
    const report = computeClvReport({
      evaluations: [],
      credit: guard,
      plan,
      mode: 'dry-run',
    })
    const reportPath = resolve(args.report)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, renderClvMarkdown(report, { liveNote }), 'utf8')
    stdout.log('NFL historical CLV pilot (dry-run, research only)')
    stdout.log(`eligibleForPublic=false hardCap=${HARD_CREDIT_CAP} plannedSnapshots=${plan.snapshotCount} plannedCredits=${plan.expectedCostTotal}`)
    stdout.log(`No Odds API calls. Report ${reportPath}`)
    return { ok: true, mode: 'dry-run', plan, credit: guard, reportPath }
  }

  let evaluations = []
  let mode = 'fixture'

  if (args.fixture) {
    const fixturePath = resolve(typeof args.fixture === 'string' && args.fixture !== 'true' && args.fixture
      ? args.fixture
      : DEFAULT_FIXTURE)
    const payload = JSON.parse(await readFile(fixturePath, 'utf8'))
    const snaps = Array.isArray(payload.snapshots) ? payload.snapshots : [payload]
    evaluations = snaps.map((snap) => {
      const evaluation = evaluateSnapshot(snap.body || snap, {
        snapshotTs: snap.timestamp || snap.body?.timestamp,
        phase: snap.phase,
      })
      evaluation.snapshotId = snap.snapshotId || `fixture_${snap.phase}`
      evaluation.week = snap.week || null
      return evaluation
    })
    mode = 'fixture'
  }

  if (args.live) {
    mode = 'live'
    const apiKey = env.ODDS_API_KEY
    if (!apiKey) {
      stdout.log('ODDS_API_KEY missing. Refusing --live. Re-run with a key or use --dry-run / --fixture.')
      return { ok: false, mode: 'live', reason: 'missing_odds_api_key', plan, credit: guard }
    }

    try {
      await probeQuota(guard, { apiKey, fetchImpl })
      stdout.log(`Quota probe remaining=${guard.remaining ?? 'unknown'} spent=${guard.spent}`)
    } catch (error) {
      stdout.log(`Quota probe failed: ${error.message}`)
      if (error.name === 'CreditCapError') {
        return { ok: false, mode: 'live', reason: 'credit_cap', plan, credit: guard }
      }
    }

    for (const snapshot of plan.snapshots) {
      const rawPath = join(outDir, 'raw', `${snapshot.snapshotId}.json`)
      if (args.resume) {
        const existing = await maybeRead(rawPath)
        if (existing) {
          const body = JSON.parse(existing)
          if (isUsableHistoricalBody(body)) {
            const fetched = { ok: true, status: 200, snapshot, body }
            evaluations.push(evaluateFetchedSnapshot(fetched))
            stdout.log(`Resume skip ${snapshot.snapshotId} (already on disk, 0 new credits)`)
            continue
          }
          stdout.log(`Ignoring unusable cached body for ${snapshot.snapshotId} (not a historical snapshot)`)
        }
      }

      let fetched
      try {
        fetched = await fetchHistoricalSnapshot(guard, snapshot, { apiKey, fetchImpl })
      } catch (error) {
        stdout.log(`Abort at ${snapshot.snapshotId}: ${error.message}`)
        await writeJson(join(outDir, 'credit-guard.json'), guard)
        liveNote = `Live abort: ${error.message}`
        break
      }

      await mkdir(dirname(rawPath), { recursive: true })
      if (fetched.ok && isUsableHistoricalBody(fetched.body)) {
        await writeFile(rawPath, `${JSON.stringify(fetched.body, null, 2)}\n`, 'utf8')
      } else {
        const errorPath = join(outDir, 'raw', `${snapshot.snapshotId}.error.json`)
        await writeFile(errorPath, `${JSON.stringify(fetched.body, null, 2)}\n`, 'utf8')
      }
      stdout.log(`${snapshot.snapshotId} HTTP ${fetched.status} spent=${guard.spent} lastRemaining=${guard.remaining ?? 'n/a'}`)
      if (!fetched.ok) {
        const code = fetched.body?.error_code || fetched.body?.message || `HTTP ${fetched.status}`
        stdout.log(`Stopping after non-OK historical response (${code}).`)
        if (fetched.body?.error_code === 'HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN') {
          liveNote = [
            '## Live attempt',
            '',
            'ODDS_API_KEY was present. `GET /v4/sports` succeeded (0 credits). Remaining credits: **500**.',
            '',
            'Historical odds returned **401** `HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN`.',
            'The usage quota was **not** charged (`x-requests-last` = 0). No further snapshots were requested.',
            '',
            '**Credit spend: 0.** CLV / S1 metrics below are empty on purpose — not invented.',
            'Re-run `--live` locally on a paid Odds API plan. Fixture math is in `__tests__/research/nfl-historical-clv-pilot.test.js`.',
          ].join('\n')
          stdout.log('This key is on a free Odds API plan. Historical odds need a paid plan. Spent 0. Not inventing CLV.')
        } else {
          liveNote = `Live historical call failed (${code}). Spent ${guard.spent}. Not inventing CLV.`
        }
        break
      }
      evaluations.push(evaluateFetchedSnapshot(fetched))
    }
  }

  let nflverseGames = []
  if (args.nflverse) {
    const csvText = await readFile(resolve(args.nflverse), 'utf8')
    nflverseGames = loadNflverseGames(csvText)
  }

  const report = computeClvReport({
    evaluations,
    nflverseGames,
    credit: guard,
    plan,
    mode,
  })

  const reportPath = resolve(args.report)
  await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, renderClvMarkdown(report, { liveNote }), 'utf8')

  await writeJson(join(outDir, 'credit-guard.json'), guard)
  await writeJson(join(outDir, 'summary.json'), {
    ...report,
    pairs: report.pairs.map(slimPair),
    quoteRows: undefined,
    sideRows: undefined,
  })
  await writeFile(join(outDir, 'quotes.csv'), `${toCsv(report.quoteRows)}\n`, 'utf8')
  await writeFile(join(outDir, 'sides.csv'), `${toCsv(report.sideRows)}\n`, 'utf8')
  await writeFile(join(outDir, 'pairs.csv'), `${toCsv(report.pairs.map(slimPair))}\n`, 'utf8')

  stdout.log('NFL historical CLV pilot (research only)')
  stdout.log(`mode=${mode} eligibleForPublic=false spent=${guard.spent} remaining=${guard.remaining ?? 'n/a'} snapshots=${evaluations.length}`)
  stdout.log(`paired=${report.sample.pairedSides} S1 n=${report.ruleS1.n} S1 ROI=${report.ruleS1.roi ?? 'n/a'} report ${reportPath}`)
  return { ok: true, mode, plan, credit: guard, report, reportPath, evaluations }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  runPilotCli().catch((error) => {
    console.error(error.message || error)
    process.exitCode = 1
  })
}
