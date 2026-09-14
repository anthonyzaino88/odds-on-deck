import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  detectPartialNflArchive,
  filterCompletedNflEvents,
  isEspnNflEventCompleted,
  latestCompleteVersion,
  latestIndexRow,
  loadNflArchiveIndex,
  observationContentHash,
  parseEspnNflScoreboardEvents,
  parseEspnNflSummary,
  parseNullableNumber,
  summarizeNflCoverage,
  toGradingAdapterPlayerMap,
  utcDay,
  verifyNflArchiveVersion,
  writeNflBoxScoreArchive,
} from '../../lib/nfl-box-score-archive.js'
import { fetchNFLGameStats, getPlayerGameStat } from '../../lib/vendors/nfl-game-stats.js'
import { nflArchiveJobExitCode, runNflBoxScoreJob } from '../../lib/nfl-archive-job.js'
import {
  COMPLETED_EVENT_ID,
  SNF_ET_EVENT_ID,
  TO_DAY_EVENT_ID,
  completedNflSummaryFixture,
  completedNflSummaryWithoutWeekFixture,
  correctedNflSummaryFixture,
  dateRangeScoreboardFixture,
  emptyAwayTeamBlockSummaryFixture,
  inProgressNflSummaryFixture,
  mismatchedBoxscoreTeamSummaryFixture,
  nflScoreboardFixture,
  oneTeamBoxScoreSummaryFixture,
} from '../fixtures/espn-nfl-boxscore.fixture.js'

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ood-nfl-archive-'))
}

describe('NFL archival parser', () => {
  test('preserves provider event/player/team IDs and season/week/game time', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryFixture(), {
      fetchedAt: '2026-09-14T12:00:00.000Z',
    })
    expect(parsed.provider_event_id).toBe(COMPLETED_EVENT_ID)
    expect(parsed.season).toBe('2025')
    expect(parsed.week).toBe(1)
    expect(parsed.season_type).toBe(2)
    expect(parsed.completeness.ok).toBe(true)
    expect(parsed.completeness.both_teams_have_player_stats).toBe(true)
    expect(parsed.game_time).toBe('2025-09-05T00:20:00.000Z')
    expect(parsed.fetched_at).toBe('2026-09-14T12:00:00.000Z')
    expect(parsed.source).toBe('espn-site-api-v2-summary')
    expect(parsed.schema_version).toBe(1)
    expect(parsed.completed).toBe(true)

    const mahomes = parsed.players.find((p) => p.player_name === 'Patrick Mahomes')
    expect(mahomes.provider_player_id).toBe('3139477')
    expect(mahomes.provider_team_id).toBe('12')
    expect(mahomes.team_abbr).toBe('KC')
    expect(mahomes.stats.passingYards).toBe(258)
    expect(mahomes.stats.passingTouchdowns).toBe(2)
    expect(mahomes.stats.interceptions).toBe(0)

    expect(parsed.teams.map((t) => t.provider_team_id).sort()).toEqual(['12', '9'])
  })

  test('keeps missing stats null and genuine zeros as zero', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryFixture())
    const missing = parsed.players.find((p) => p.player_name === 'Missing Yards QB')
    expect(missing.stats.passingYards).toBeNull()
    expect(missing.stats.passingCompletions).toBe(1)
    expect(missing.stats.passingAttempts).toBe(2)

    const pacheco = parsed.players.find((p) => p.player_name === 'Isiah Pacheco')
    expect(pacheco.stats.rushingYards).toBe(0)
    expect(pacheco.stats.rushingAttempts).toBe(10)
    expect(pacheco.stats.passingYards).toBeUndefined()

    expect(parseNullableNumber('')).toBeNull()
    expect(parseNullableNumber('-')).toBeNull()
    expect(parseNullableNumber('0')).toBe(0)
  })

  test('does not infer DNP from absent statistics', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryFixture())
    const hurst = parsed.players.find((p) => p.player_name === 'Jalen Hurts')
    expect(hurst.stats.rushingYards).toBeUndefined()
    expect(hurst.stats.receptions).toBeUndefined()
    expect(parsed.completeness.unresolved_player_ids).toContain('Unidentified Receiver')
  })

  test('grading adapter still coerces present-but-missing stats to 0', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryFixture())
    const adapter = toGradingAdapterPlayerMap(parsed)
    expect(adapter['Missing Yards QB'].passingYards).toBe(0)
    expect(adapter['Isiah Pacheco'].rushingYards).toBe(0)
    expect(adapter['Jalen Hurts'].rushingYards).toBeUndefined()
  })

  test('fetchNFLGameStats keeps historical zero-coercion for grading', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: async () => ({ boxscore: {} }),
    })
    expect(await fetchNFLGameStats('1')).toBeNull()

    global.fetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: async () => completedNflSummaryFixture(),
    })
    const stats = await fetchNFLGameStats(COMPLETED_EVENT_ID)
    expect(stats['Missing Yards QB'].passingYards).toBe(0)
    expect(stats['Patrick Mahomes'].passingYards).toBe(258)
    expect(stats['Jalen Hurts'].rushingYards).toBeUndefined()

    global.fetch.mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: async () => completedNflSummaryFixture(),
    })
    await expect(
      getPlayerGameStat(COMPLETED_EVENT_ID, 'Patrick Mahomes', 'passing_yards')
    ).resolves.toBe(258)
  })
})

describe('completed-game gating', () => {
  test('requires source completion; elapsed time is not enough', () => {
    expect(isEspnNflEventCompleted(completedNflSummaryFixture())).toBe(true)
    expect(isEspnNflEventCompleted(inProgressNflSummaryFixture())).toBe(false)

    const events = parseEspnNflScoreboardEvents(nflScoreboardFixture())
    const completed = filterCompletedNflEvents(events)
    expect(completed.map((e) => e.provider_event_id)).toEqual([COMPLETED_EVENT_ID])
    expect(events.find((e) => e.provider_event_id === '401547000').completed).toBe(false)
    expect(events.find((e) => e.provider_event_id === '401547399').completed).toBe(false)
  })

  test('--to YYYY-MM-DD includes games after midnight UTC on that calendar day', () => {
    const events = parseEspnNflScoreboardEvents(dateRangeScoreboardFixture())
    const midnightTo = new Date('2026-09-14').getTime()
    const lateGame = events.find((e) => e.provider_event_id === TO_DAY_EVENT_ID)
    expect(lateGame.game_time).toBe('2026-09-14T20:15:00.000Z')
    expect(new Date(lateGame.game_time).getTime()).toBeGreaterThan(midnightTo)

    const onToDay = filterCompletedNflEvents(events, { from: '2026-09-14', to: '2026-09-14' })
    expect(onToDay.map((e) => e.provider_event_id)).toEqual([TO_DAY_EVENT_ID])

    const throughToDay = filterCompletedNflEvents(events, { from: '2026-09-13', to: '2026-09-14' })
    expect(throughToDay.map((e) => e.provider_event_id)).toEqual(['401772500', TO_DAY_EVENT_ID])

    const nextDay = filterCompletedNflEvents(events, { from: '2026-09-15', to: '2026-09-15' })
    expect(nextDay.map((e) => e.provider_event_id)).toEqual([SNF_ET_EVENT_ID])
  })

  test('8:15 PM ET on the named Eastern date is the next UTC calendar day', () => {
    const snfUtc = '2026-09-15T00:15:00.000Z'
    expect(utcDay(snfUtc)).toBe('2026-09-15')
    expect(utcDay('2026-09-14T20:15:00.000Z')).toBe('2026-09-14')

    const events = parseEspnNflScoreboardEvents(dateRangeScoreboardFixture())
    const namedEasternAsUtc = filterCompletedNflEvents(events, { from: '2026-09-14', to: '2026-09-14' })
    expect(namedEasternAsUtc.map((e) => e.provider_event_id)).toEqual([TO_DAY_EVENT_ID])
    expect(namedEasternAsUtc.map((e) => e.provider_event_id)).not.toContain(SNF_ET_EVENT_ID)
  })
})

describe('NFL box-score completeness', () => {
  test('one-team boxscore.players is incomplete and does not overwrite a complete version', () => {
    const dir = makeTempDir()
    try {
      const raw = completedNflSummaryFixture()
      const complete = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T12:00:00.000Z' })
      const first = writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized: complete })
      expect(first.wrote).toBe(true)
      expect(first.version).toBe(1)

      const oneTeamRaw = oneTeamBoxScoreSummaryFixture()
      const oneTeam = parseEspnNflSummary(oneTeamRaw, { fetchedAt: '2026-09-14T13:00:00.000Z' })
      expect(oneTeam.completeness.ok).toBe(false)
      expect(oneTeam.completeness.both_teams_have_player_stats).toBe(false)

      const result = writeNflBoxScoreArchive({ archiveRoot: dir, raw: oneTeamRaw, normalized: oneTeam })
      expect(result.wrote).toBe(false)
      expect(result.reason).toBe('incomplete_observation')

      const latest = latestCompleteVersion(loadNflArchiveIndex(dir).records, COMPLETED_EVENT_ID)
      expect(latest.version).toBe(1)
      expect(latest.fetched_at).toBe('2026-09-14T12:00:00.000Z')
      const v1 = JSON.parse(fs.readFileSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json'), 'utf8'))
      expect(v1.completeness.ok).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('empty team statistics block is incomplete', () => {
    const parsed = parseEspnNflSummary(emptyAwayTeamBlockSummaryFixture())
    expect(parsed.completeness.ok).toBe(false)
    expect(parsed.completeness.both_teams_have_player_stats).toBe(false)
  })

  test('boxscore team IDs that do not match competitors are incomplete', () => {
    const parsed = parseEspnNflSummary(mismatchedBoxscoreTeamSummaryFixture())
    expect(parsed.completeness.ok).toBe(false)
    expect(parsed.completeness.boxscore_teams_match_competitors).toBe(false)
  })

  test('legitimate missing individual stats stay null and do not fail completeness', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryFixture())
    const missing = parsed.players.find((p) => p.player_name === 'Missing Yards QB')
    expect(missing.stats.passingYards).toBeNull()
    expect(parsed.completeness.ok).toBe(true)
  })

  test('carries verified season/week/seasonType from scoreboard discovery when summary omits them', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryWithoutWeekFixture(), {
      fetchedAt: '2026-09-14T12:00:00.000Z',
      discovered: { season: '2025', week: 1, season_type: 2 },
    })
    expect(parsed.season).toBe('2025')
    expect(parsed.week).toBe(1)
    expect(parsed.season_type).toBe(2)
    expect(parsed.metadata_consistency.ok).toBe(true)
    expect(parsed.metadata_consistency.summary.week).toBeNull()
  })

  test('records a metadata mismatch without dropping discovery values', () => {
    const parsed = parseEspnNflSummary(completedNflSummaryFixture(), {
      discovered: { season: '2025', week: 2, season_type: 2 },
    })
    expect(parsed.week).toBe(2)
    expect(parsed.metadata_consistency.ok).toBe(false)
    expect(parsed.metadata_consistency.mismatches).toEqual([
      { field: 'week', discovery: 2, summary: 1 },
    ])
  })
})

describe('versioned NFL archive writes', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('idempotent for identical observations; corrections write a new version', () => {
    const raw = completedNflSummaryFixture()
    const first = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T12:00:00.000Z' })
    const w1 = writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized: first })
    expect(w1.wrote).toBe(true)
    expect(w1.reason).toBe('new')
    expect(w1.version).toBe(1)

    const again = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T18:00:00.000Z' })
    const w2 = writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized: again })
    expect(w2.wrote).toBe(false)
    expect(w2.reason).toBe('identical')
    expect(w2.version).toBe(1)

    const correctedRaw = correctedNflSummaryFixture()
    const corrected = parseEspnNflSummary(correctedRaw, { fetchedAt: '2026-09-15T12:00:00.000Z' })
    const w3 = writeNflBoxScoreArchive({
      archiveRoot: dir,
      raw: correctedRaw,
      normalized: corrected,
    })
    expect(w3.wrote).toBe(true)
    expect(w3.reason).toBe('correction')
    expect(w3.version).toBe(2)

    const index = loadNflArchiveIndex(dir)
    const latest = latestCompleteVersion(index.records, COMPLETED_EVENT_ID)
    expect(latest.version).toBe(2)
    expect(latest.observation_hash).toBe(corrected.observation_hash)

    const v1 = JSON.parse(
      fs.readFileSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json'), 'utf8')
    )
    expect(v1.players.find((p) => p.player_name === 'Patrick Mahomes').stats.passingYards).toBe(258)
    expect(v1.fetched_at).toBe('2026-09-14T12:00:00.000Z')
    const v2 = JSON.parse(
      fs.readFileSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v2.json'), 'utf8')
    )
    expect(v2.players.find((p) => p.player_name === 'Patrick Mahomes').stats.passingYards).toBe(271)
    expect(v2.fetched_at).toBe('2026-09-15T12:00:00.000Z')
    expect(fs.existsSync(path.join(dir, 'raw', COMPLETED_EVENT_ID, 'v1.json'))).toBe(true)
  })

  test('does not mark archived until verified; recovers from partial writes', () => {
    const raw = completedNflSummaryFixture()
    const normalized = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T12:00:00.000Z' })

    fs.mkdirSync(path.join(dir, 'raw', COMPLETED_EVENT_ID), { recursive: true })
    fs.writeFileSync(path.join(dir, 'raw', COMPLETED_EVENT_ID, 'v1.json'), '{not-json', 'utf8')
    fs.mkdirSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json'),
      JSON.stringify({ provider_event_id: COMPLETED_EVENT_ID, completeness: { ok: false } }),
      'utf8'
    )
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'index.jsonl'),
      JSON.stringify({
        provider_event_id: COMPLETED_EVENT_ID,
        version: 1,
        complete: true,
        observation_hash: 'stale',
      }) + '\n',
      'utf8'
    )

    const partial = detectPartialNflArchive(dir, COMPLETED_EVENT_ID)
    expect(partial.issues.length).toBeGreaterThan(0)

    const recovered = writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized })
    expect(recovered.wrote).toBe(true)
    expect(recovered.complete).toBe(true)
    expect(recovered.version).toBe(2)
    expect(fs.readFileSync(path.join(dir, 'raw', COMPLETED_EVENT_ID, 'v1.json'), 'utf8')).toBe('{not-json')

    const after = detectPartialNflArchive(dir, COMPLETED_EVENT_ID)
    expect(after.hasComplete).toBe(true)
    expect(after.latest.version).toBe(2)
    const latest = latestCompleteVersion(loadNflArchiveIndex(dir).records, COMPLETED_EVENT_ID)
    expect(latest.observation_hash).toBe(normalized.observation_hash)
    expect(latest.version).toBe(2)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'raw', COMPLETED_EVENT_ID, `v${recovered.version}.json`), 'utf8')).header.id).toBe(
      COMPLETED_EVENT_ID
    )
  })

  test('refuses to archive an in-progress game even if kickoff was long ago', () => {
    const raw = inProgressNflSummaryFixture()
    const normalized = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T12:00:00.000Z' })
    const result = writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized })
    expect(result.wrote).toBe(false)
    expect(result.reason).toBe('incomplete_observation')
    expect(fs.existsSync(path.join(dir, 'index.jsonl'))).toBe(false)
  })
})

describe('NFL archive job (injected fetch)', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function mockFetch(scoreboard, summaries) {
    return async (url) => {
      if (String(url).includes('/scoreboard')) {
        return { ok: true, json: async () => scoreboard, text: async () => '' }
      }
      const match = String(url).match(/event=(\d+)/)
      const id = match?.[1]
      const body = summaries[id]
      if (!body) return { ok: false, status: 404, json: async () => ({}), text: async () => 'missing' }
      return { ok: true, json: async () => body, text: async () => '' }
    }
  }

  test('audit is read-only against completed source games', async () => {
    const result = await runNflBoxScoreJob(
      { audit: true, season: 2025, week: 1, archiveRoot: dir },
      {
        fetchImpl: mockFetch(nflScoreboardFixture(), {}),
        sleepImpl: async () => {},
        requestGapMs: 0,
      }
    )
    expect(result.mode).toBe('audit')
    expect(result.coverage.expected_games).toBe(1)
    expect(result.coverage.complete_archives).toBe(0)
    expect(result.coverage.missing_games).toHaveLength(1)
    expect(fs.existsSync(path.join(dir, 'index.jsonl'))).toBe(false)
  })

  test('archive-only backfill writes verified complete games and records capture time', async () => {
    const now = new Date('2026-09-14T15:30:00.000Z')
    const result = await runNflBoxScoreJob(
      { season: 2025, week: 1, archiveRoot: dir },
      {
        fetchImpl: mockFetch(nflScoreboardFixture(), {
          [COMPLETED_EVENT_ID]: completedNflSummaryFixture(),
        }),
        sleepImpl: async () => {},
        requestGapMs: 0,
        now,
      }
    )
    expect(result.mode).toBe('archive')
    expect(result.coverage.complete_archives).toBe(1)
    expect(result.coverage.missing_games).toHaveLength(0)
    const latest = latestCompleteVersion(loadNflArchiveIndex(dir).records, COMPLETED_EVENT_ID)
    expect(latest.fetched_at).toBe('2026-09-14T15:30:00.000Z')
    expect(latest.game_time).toBe('2025-09-05T00:20:00.000Z')
    expect(latest.fetched_at).not.toBe(latest.game_time)
  })

  test('audit --from/--to keeps completed games after 00:00Z on the --to day', async () => {
    const result = await runNflBoxScoreJob(
      { audit: true, from: '2026-09-14', to: '2026-09-14', archiveRoot: dir },
      {
        fetchImpl: mockFetch(dateRangeScoreboardFixture(), {}),
        sleepImpl: async () => {},
        requestGapMs: 0,
      }
    )
    expect(result.coverage.expected_games).toBe(1)
    expect(result.coverage.missing_games.map((g) => g.provider_event_id)).toEqual([TO_DAY_EVENT_ID])
    expect(result.coverage.expected_date_coverage).toEqual(['2026-09-14'])
  })

  test('archive job writes scoreboard season/week/seasonType onto normalized records', async () => {
    const result = await runNflBoxScoreJob(
      { season: 2025, week: 1, archiveRoot: dir },
      {
        fetchImpl: mockFetch(nflScoreboardFixture(), {
          [COMPLETED_EVENT_ID]: completedNflSummaryWithoutWeekFixture(),
        }),
        sleepImpl: async () => {},
        requestGapMs: 0,
        now: new Date('2026-09-14T15:30:00.000Z'),
      }
    )
    expect(result.coverage.complete_archives).toBe(1)
    const latest = latestIndexRow(loadNflArchiveIndex(dir).records, COMPLETED_EVENT_ID)
    expect(latest.season).toBe('2025')
    expect(latest.week).toBe(1)
    expect(latest.season_type).toBe(2)
    const normalized = JSON.parse(
      fs.readFileSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json'), 'utf8')
    )
    expect(normalized.week).toBe(1)
    expect(normalized.season).toBe('2025')
    expect(normalized.season_type).toBe(2)
  })
})

describe('file-level coverage audit', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function seedCompleteArchive() {
    const raw = completedNflSummaryFixture()
    const normalized = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T12:00:00.000Z' })
    writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized })
    return { raw, normalized }
  }

  function expectedEvents() {
    return parseEspnNflScoreboardEvents(nflScoreboardFixture()).filter((e) => e.completed)
  }

  test('healthy archives count as complete', () => {
    seedCompleteArchive()
    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(1)
    expect(coverage.missing_games).toHaveLength(0)
    expect(coverage.integrity_failures).toHaveLength(0)
    expect(nflArchiveJobExitCode({ coverage, writes: [], indexCorrupt: 0 })).toBe(0)
  })

  test('missing raw file is not complete', () => {
    seedCompleteArchive()
    fs.rmSync(path.join(dir, 'raw', COMPLETED_EVENT_ID, 'v1.json'))
    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(0)
    expect(coverage.missing_files_archives).toHaveLength(1)
    expect(coverage.integrity_failures[0].issues.some((i) => i.kind === 'missing_raw')).toBe(true)
    expect(nflArchiveJobExitCode({ coverage, writes: [], indexCorrupt: 0 })).toBe(2)
  })

  test('missing normalized file is not complete', () => {
    seedCompleteArchive()
    fs.rmSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json'))
    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(0)
    expect(coverage.missing_files_archives).toHaveLength(1)
    expect(coverage.integrity_failures[0].issues.some((i) => i.kind === 'missing_normalized')).toBe(true)
  })

  test('malformed JSON is corrupt, not complete', () => {
    seedCompleteArchive()
    fs.writeFileSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json'), '{not-json', 'utf8')
    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(0)
    expect(coverage.corrupt_archives).toHaveLength(1)
    expect(coverage.corrupt_archives[0].issues.some((i) => i.kind === 'corrupt_normalized')).toBe(true)
  })

  test('modified contents with unchanged stored hashes fail recomputed hash check', () => {
    const { normalized } = seedCompleteArchive()
    const file = path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    stored.players[0].stats.passingYards = 999
    expect(stored.observation_hash).toBe(normalized.observation_hash)
    fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
    expect(observationContentHash(stored)).not.toBe(stored.observation_hash)

    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(0)
    expect(coverage.corrupt_archives[0].issues.some((i) => i.kind === 'normalized_hash_stale')).toBe(true)
  })

  test('incorrect event IDs fail verification', () => {
    seedCompleteArchive()
    const file = path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v1.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    stored.provider_event_id = '999999'
    stored.observation_hash = observationContentHash(stored)
    fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(0)
    expect(coverage.corrupt_archives[0].issues.some((i) => i.kind === 'normalized_event_id_mismatch')).toBe(true)
  })

  test('does not hide a damaged latest version behind an older healthy one', () => {
    const raw = completedNflSummaryFixture()
    const first = parseEspnNflSummary(raw, { fetchedAt: '2026-09-14T12:00:00.000Z' })
    writeNflBoxScoreArchive({ archiveRoot: dir, raw, normalized: first })
    const correctedRaw = correctedNflSummaryFixture()
    const second = parseEspnNflSummary(correctedRaw, { fetchedAt: '2026-09-15T12:00:00.000Z' })
    writeNflBoxScoreArchive({ archiveRoot: dir, raw: correctedRaw, normalized: second })
    fs.writeFileSync(path.join(dir, 'normalized', COMPLETED_EVENT_ID, 'v2.json'), '{broken', 'utf8')

    const coverage = summarizeNflCoverage({
      expectedEvents: expectedEvents(),
      indexRecords: loadNflArchiveIndex(dir).records,
      archiveRoot: dir,
    })
    expect(coverage.complete_archives).toBe(0)
    expect(coverage.corrupt_archives).toHaveLength(1)
    expect(coverage.corrupt_archives[0].version).toBe(2)
    expect(latestIndexRow(loadNflArchiveIndex(dir).records, COMPLETED_EVENT_ID).version).toBe(2)
    const v1 = verifyNflArchiveVersion(
      dir,
      loadNflArchiveIndex(dir).records.find((r) => r.version === 1)
    )
    expect(v1.healthy).toBe(true)
  })

  test('incomplete HTTP 200 responses fail the job exit code', async () => {
    const result = await runNflBoxScoreJob(
      { season: 2025, week: 1, archiveRoot: dir },
      {
        fetchImpl: async (url) => {
          if (String(url).includes('/scoreboard')) {
            return { ok: true, json: async () => nflScoreboardFixture(), text: async () => '' }
          }
          return { ok: true, json: async () => oneTeamBoxScoreSummaryFixture(), text: async () => '' }
        },
        sleepImpl: async () => {},
        requestGapMs: 0,
      }
    )
    expect(result.writes[0].reason).toBe('incomplete_observation')
    expect(result.coverage.complete_archives).toBe(0)
    expect(nflArchiveJobExitCode(result)).toBe(2)
  })
})
