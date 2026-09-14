/**
 * Archive-only NFL box-score job: coverage audit + ESPN backfill/refresh.
 * Never talks to The Odds API. Never deletes cache or archive files.
 */

import {
  configuredNflSeasonYear,
  detectPartialNflArchive,
  espnScoreboardUrl,
  espnSummaryUrl,
  fetchEspnJson,
  filterCompletedNflEvents,
  latestCompleteVersion,
  loadNflArchiveIndex,
  parseEspnNflScoreboardEvents,
  parseEspnNflSummary,
  sleep,
  summarizeNflCoverage,
  writeNflBoxScoreArchive,
} from './nfl-box-score-archive.js'
import { resolveNflBoxScoresDir } from './local-archive.js'

export const REGULAR_SEASON_WEEKS = 18
export const DEFAULT_REQUEST_GAP_MS = 200

export function parseArchiveNflArgs(argv) {
  const args = [...argv]
  const opts = {
    audit: args.includes('--audit'),
    dryRun: args.includes('--dry-run'),
    refresh: args.includes('--refresh'),
    includePreseason: args.includes('--include-preseason'),
    includePostseason: args.includes('--include-postseason'),
    season: configuredNflSeasonYear(),
    week: null,
    from: null,
    to: null,
    event: null,
    archiveRoot: null,
  }

  const take = (flag) => {
    const i = args.indexOf(flag)
    if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
    return null
  }

  if (take('--season')) opts.season = Number(take('--season'))
  if (take('--week')) opts.week = Number(take('--week'))
  if (take('--from')) opts.from = take('--from')
  if (take('--to')) opts.to = take('--to')
  if (take('--event')) opts.event = String(take('--event'))
  if (take('--dir')) opts.archiveRoot = take('--dir')

  return opts
}

export function seasonTypeWeeks({ includePreseason, includePostseason, week } = {}) {
  const types = []
  if (includePreseason) types.push({ seasonType: 1, weeks: week ? [week] : [1, 2, 3, 4] })
  types.push({ seasonType: 2, weeks: week ? [week] : Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1) })
  if (includePostseason) types.push({ seasonType: 3, weeks: week ? [week] : [1, 2, 3, 4, 5] })
  return types
}

export function dateListInclusive(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T23:59:59.999Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error(`Invalid date range ${from} .. ${to}`)
  }
  const days = []
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export async function discoverCompletedNflGames(opts, { fetchImpl, sleepImpl, requestGapMs = DEFAULT_REQUEST_GAP_MS } = {}) {
  const failedFetches = []
  const events = []
  const seen = new Set()

  const remember = (parsed) => {
    for (const event of filterCompletedNflEvents(parsed, { from: opts.from, to: opts.to })) {
      if (!event.provider_event_id || seen.has(event.provider_event_id)) continue
      seen.add(event.provider_event_id)
      events.push(event)
    }
  }

  const get = async (url) => {
    try {
      const json = await fetchEspnJson(url, { fetchImpl })
      return json
    } catch (err) {
      failedFetches.push({ url, error: err.message, status: err.status || null })
      return null
    }
  }

  if (opts.from && opts.to) {
    for (const day of dateListInclusive(opts.from, opts.to)) {
      const json = await get(espnScoreboardUrl({ dates: day }))
      if (json) remember(parseEspnNflScoreboardEvents(json))
      await sleep(requestGapMs, { sleepImpl })
    }
  } else {
    const plan = seasonTypeWeeks(opts)
    for (const { seasonType, weeks } of plan) {
      for (const week of weeks) {
        const json = await get(espnScoreboardUrl({ season: opts.season, week, seasonType }))
        if (json) remember(parseEspnNflScoreboardEvents(json))
        await sleep(requestGapMs, { sleepImpl })
      }
    }
  }

  events.sort((a, b) => String(a.game_time || '').localeCompare(String(b.game_time || '')))
  return { events, failedFetches }
}

export async function archiveNflEvent(eventId, {
  archiveRoot,
  fetchImpl,
  now,
  dryRun = false,
} = {}) {
  const raw = await fetchEspnJson(espnSummaryUrl(eventId), { fetchImpl })
  const fetchedAt = (now instanceof Date ? now : new Date(now || Date.now())).toISOString()
  const normalized = parseEspnNflSummary(raw, { fetchedAt })
  if (!normalized) {
    return { wrote: false, reason: 'unparseable', eventId, complete: false }
  }
  if (!normalized.completed) {
    return {
      wrote: false,
      reason: 'not_completed_from_source',
      eventId,
      complete: false,
      completeness: normalized.completeness,
    }
  }
  if (dryRun) {
    return {
      wrote: false,
      reason: 'dry_run',
      eventId,
      complete: Boolean(normalized.completeness?.ok),
      completeness: normalized.completeness,
      observation_hash: normalized.observation_hash,
    }
  }
  return writeNflBoxScoreArchive({ archiveRoot, raw, normalized, now })
}

export async function runNflBoxScoreJob(opts = {}, deps = {}) {
  const archiveRoot = opts.archiveRoot || resolveNflBoxScoresDir()
  const fetchImpl = deps.fetchImpl
  const sleepImpl = deps.sleepImpl
  const now = deps.now || new Date()
  const index = loadNflArchiveIndex(archiveRoot)

  let expectedEvents = []
  let failedFetches = []

  if (opts.event) {
    expectedEvents = [{ provider_event_id: String(opts.event), game_time: null, name: null, week: null }]
  } else {
    const discovered = await discoverCompletedNflGames(opts, { fetchImpl, sleepImpl, requestGapMs: deps.requestGapMs })
    expectedEvents = discovered.events
    failedFetches = discovered.failedFetches
  }

  const coverage = summarizeNflCoverage({
    expectedEvents,
    indexRecords: index.records,
    failedFetches,
    dateRange: { season: opts.season, from: opts.from, to: opts.to },
  })

  if (opts.audit) {
    return {
      mode: 'audit',
      archiveRoot,
      coverage,
      writes: [],
      indexCorrupt: index.corrupt.length,
    }
  }

  const writes = []
  const fetchFailures = [...failedFetches]

  for (const event of expectedEvents) {
    const eventId = event.provider_event_id
    const partial = detectPartialNflArchive(archiveRoot, eventId)
    const latest = latestCompleteVersion(loadNflArchiveIndex(archiveRoot).records, eventId)

    if (latest && !opts.refresh && !partial.partial) {
      // Still re-fetch: identical observations are a no-op write. Corrections
      // create a new version. Skip the network only when dry-run audit.
    }

    try {
      const result = await archiveNflEvent(eventId, {
        archiveRoot,
        fetchImpl,
        now,
        dryRun: opts.dryRun,
      })
      writes.push({ ...result, partial: partial.partial })
    } catch (err) {
      fetchFailures.push({ url: espnSummaryUrl(eventId), error: err.message, status: err.status || null })
      writes.push({ wrote: false, reason: 'failed_fetch', eventId, error: err.message })
    }
    await sleep(deps.requestGapMs ?? DEFAULT_REQUEST_GAP_MS, { sleepImpl })
  }

  const after = loadNflArchiveIndex(archiveRoot)
  const coverageAfter = summarizeNflCoverage({
    expectedEvents,
    indexRecords: after.records,
    failedFetches: fetchFailures,
    dateRange: { season: opts.season, from: opts.from, to: opts.to },
  })

  return {
    mode: opts.dryRun ? 'dry_run' : 'archive',
    archiveRoot,
    coverage: coverageAfter,
    coverageBefore: coverage,
    writes,
    indexCorrupt: after.corrupt.length,
  }
}

export function formatNflCoverageReport(result) {
  const c = result.coverage || {}
  const lines = [
    `Mode:                ${result.mode}`,
    `Archive root:        ${result.archiveRoot}`,
    `Season:              ${c.season ?? '(n/a)'}`,
    `Expected games:      ${c.expected_games}`,
    `Complete archives:   ${c.complete_archives}`,
    `Missing games:       ${(c.missing_games || []).length}`,
    `Failed fetches:      ${(c.failed_fetches || []).length}`,
    `Unresolved identities:${(c.unresolved_identities || []).length}`,
    `Expected dates:      ${(c.expected_date_coverage || []).join(', ') || '(none)'}`,
    `Archived dates:      ${(c.archived_date_coverage || []).join(', ') || '(none)'}`,
  ]
  if (c.from || c.to) lines.splice(3, 0, `Date range:          ${c.from || '?'} .. ${c.to || '?'}`)
  if (result.indexCorrupt) lines.push(`Corrupt index lines: ${result.indexCorrupt}`)

  if ((c.missing_games || []).length) {
    lines.push('Missing:')
    for (const g of c.missing_games) {
      lines.push(`  - ${g.provider_event_id}  week=${g.week ?? '?'}  ${g.game_time || ''}  ${g.name || ''}`)
    }
  }
  if ((c.failed_fetches || []).length) {
    lines.push('Failed fetches:')
    for (const f of c.failed_fetches) {
      lines.push(`  - ${f.status || ''} ${f.url}  ${f.error}`)
    }
  }
  if ((c.unresolved_identities || []).length) {
    lines.push('Unresolved identities:')
    for (const u of c.unresolved_identities) {
      lines.push(
        `  - ${u.provider_event_id} players=${(u.unresolved_player_ids || []).length} teams=${(u.unresolved_team_ids || []).length}`
      )
    }
  }
  return lines.join('\n')
}
