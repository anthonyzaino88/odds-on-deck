import {
  ROSTER_SKIP_REASONS,
  PUBLISHED_ROSTER_GUARD_SPORTS,
  SHADOW_ROSTER_GUARD_SPORTS,
  ESPN_ROSTER_GAP_MS,
  ESPN_ROSTER_RETRY_MS,
  blockedEspnStatusReason,
  checkPlayerEventRosterEligibility,
  collectAthleteStatusSources,
  espnEventSummaryUrl,
  espnRosterUrl,
  evaluateEventRosterEligibility,
  eventRosterHasBothTeams,
  findRosterPlayer,
  formatEventLabel,
  guardPropsByEventRoster,
  isAllowedWeeklyEspnStatus,
  isBlockedEspnStatus,
  loadEventRosterPlayers,
  logEventRosterSkip,
  logRosterGuardSummary,
  parseEspnEventRosters,
  parseEspnRosterAthletes,
  resolveEspnTeamId,
  summarizeRosterGuard,
  withSharedRosterGuard,
} from '../../lib/event-roster-eligibility.js'

const NYG_PHI = {
  id: 'NYG_at_PHI_2026-11-02',
  sport: 'nfl',
  espnGameId: '401772801',
  homeId: 'NFL_21',
  awayId: 'NFL_19',
  home: { abbr: 'PHI' },
  away: { abbr: 'NYG' },
}

function nflRosterPayload(players) {
  return {
    athletes: [
      {
        items: players.map((player) => ({
          displayName: player.name,
          position: { abbreviation: player.position || 'WR' },
          status: player.status,
          injuries: player.injuries,
          id: player.id || player.name,
        })),
      },
    ],
  }
}

function fakeClock(start = 1_000_000) {
  let now = start
  const sleeps = []
  return {
    sleeps,
    nowImpl: () => now,
    sleepImpl: async (ms) => {
      sleeps.push(ms)
      now += Number(ms) || 0
    },
  }
}

function jsonResponse(payload, ok = true) {
  return {
    ok,
    json: async () => payload,
  }
}

function publishedNflProp(overrides = {}) {
  return {
    playerName: 'Malik Nabers',
    gameId: NYG_PHI.id,
    sport: 'nfl',
    type: 'receiving_yards',
    pick: 'over',
    threshold: 64.5,
    odds: -110,
    edge: 0.08,
    qualityScore: 55,
    ...overrides,
  }
}

describe('ESPN status blocking', () => {
  test('treats FA / free agent, IR, and out as blocked', () => {
    expect(blockedEspnStatusReason({ abbreviation: 'FA' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_FA)
    expect(blockedEspnStatusReason({ name: 'Free Agent' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_FA)
    expect(blockedEspnStatusReason({ type: 'freeagent' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_FA)
    expect(blockedEspnStatusReason({ abbreviation: 'IR' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_IR)
    expect(blockedEspnStatusReason({ name: 'Injured Reserve' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_IR)
    expect(blockedEspnStatusReason({ abbreviation: 'O' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_OUT)
    expect(blockedEspnStatusReason('Out')).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_OUT)
    expect(isBlockedEspnStatus({ name: 'Active' })).toBe(false)
    expect(isBlockedEspnStatus({ abbreviation: 'ACT' })).toBe(false)
    expect(isBlockedEspnStatus({ name: 'Questionable' })).toBe(false)
    expect(isBlockedEspnStatus({ name: 'Doubtful' })).toBe(false)
    expect(isBlockedEspnStatus('day-to-day')).toBe(false)
    expect(isAllowedWeeklyEspnStatus({ name: 'Questionable' })).toBe(true)
    expect(isAllowedWeeklyEspnStatus({ name: 'Doubtful' })).toBe(true)
    expect(isAllowedWeeklyEspnStatus('Day-to-Day')).toBe(true)
  })

  test('blocks PUP, NFI, LTIR, and Suspended / Suspension', () => {
    expect(blockedEspnStatusReason({ abbreviation: 'PUP' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_PUP)
    expect(blockedEspnStatusReason({ name: 'Physically Unable to Perform' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_PUP)
    expect(blockedEspnStatusReason({ abbreviation: 'NFI' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_NFI)
    expect(blockedEspnStatusReason({ name: 'Non-Football Injury' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_NFI)
    expect(blockedEspnStatusReason({ abbreviation: 'LTIR' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_LTIR)
    expect(blockedEspnStatusReason({ name: 'Long-Term Injured Reserve' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_LTIR)
    expect(blockedEspnStatusReason({ name: 'Suspended' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED)
    expect(blockedEspnStatusReason({ name: 'Suspension' })).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED)
    expect(blockedEspnStatusReason({ name: 'News' })).toBe(null)
  })
})

describe('roster parsing and name match', () => {
  test('reads weekly designation from every injuries[] entry, not just athlete.status', () => {
    const robinson = {
      displayName: 'B. Robinson Jr.',
      status: { name: 'Active', abbreviation: 'ACT' },
      injuries: [{ status: 'Out', type: { name: 'Ankle' } }],
    }
    const walker = {
      displayName: 'Jalon Walker',
      status: { name: 'Active' },
      injuries: [
        { status: 'Questionable' },
        { status: { abbreviation: 'IR', name: 'Injured Reserve' } },
      ],
    }
    const pearce = {
      displayName: 'Pearce Jr.',
      status: { name: 'News' },
      injuries: [{ status: 'Suspension' }],
    }
    expect(collectAthleteStatusSources(robinson).map((s) => s.status || s)).toEqual(
      expect.arrayContaining(['Out', expect.objectContaining({ name: 'Active' })]),
    )
    const parsed = parseEspnRosterAthletes({
      athletes: [{ items: [robinson, walker, pearce] }],
    }, 'ATL')
    expect(evaluateEventRosterEligibility({
      playerName: 'B. Robinson Jr.',
      players: parsed,
    }).reason).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_OUT)
    expect(evaluateEventRosterEligibility({
      playerName: 'Jalon Walker',
      players: parsed,
    }).reason).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_IR)
    expect(evaluateEventRosterEligibility({
      playerName: 'Pearce Jr.',
      players: parsed,
    }).reason).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_SUSPENDED)
  })

  test('parses grouped ESPN team roster athletes', () => {
    const players = parseEspnRosterAthletes(nflRosterPayload([
      { name: 'Malik Nabers', position: 'WR', status: { name: 'Active', abbreviation: 'ACT' } },
      { name: 'Darius Slayton', position: 'WR', status: { name: 'Free Agent', abbreviation: 'FA' } },
    ]), 'NYG')
    expect(players).toHaveLength(2)
    expect(players[0]).toMatchObject({ name: 'Malik Nabers', team: 'NYG' })
    expect(isBlockedEspnStatus(players[1].status)).toBe(true)
  })

  test('parses event summary rosters', () => {
    const players = parseEspnEventRosters({
      rosters: [
        {
          team: { abbreviation: 'PHI' },
          roster: [
            { displayName: 'A.J. Brown', status: { name: 'Active' } },
          ],
        },
        {
          team: { abbreviation: 'NYG' },
          roster: [
            { athlete: { displayName: 'Malik Nabers', status: { name: 'Active' } } },
          ],
        },
      ],
    })
    expect(players.map((p) => p.name)).toEqual(['A.J. Brown', 'Malik Nabers'])
  })

  test('matches exact names and unique first-name aliases', () => {
    const players = [
      { name: 'Malik Nabers', status: { name: 'Active' } },
      { name: 'Mitchell Nabers', status: { name: 'Active' } },
    ]
    expect(findRosterPlayer(players, 'Malik Nabers').name).toBe('Malik Nabers')
    expect(findRosterPlayer([{ name: 'Mitchell Marner' }], 'Mitch Marner').name).toBe('Mitchell Marner')
  })
})

describe('evaluateEventRosterEligibility', () => {
  const players = [
    { name: 'Malik Nabers', team: 'NYG', status: { name: 'Active', abbreviation: 'ACT' } },
    { name: 'A.J. Brown', team: 'PHI', status: { name: 'Active' } },
    { name: 'Darius Slayton', team: 'NYG', status: { name: 'Free Agent', abbreviation: 'FA' } },
    { name: 'Andrew Thomas', team: 'NYG', status: { name: 'Injured Reserve', abbreviation: 'IR' } },
    { name: 'DeVonta Smith', team: 'PHI', status: { name: 'Out', abbreviation: 'O' } },
  ]

  test('allows an active player on one of the two event teams', () => {
    expect(evaluateEventRosterEligibility({
      playerName: 'Malik Nabers',
      players,
      rosterAvailable: true,
    }).ok).toBe(true)
  })

  test('skips a free agent even if ESPN still lists him', () => {
    expect(evaluateEventRosterEligibility({
      playerName: 'Darius Slayton',
      players,
      rosterAvailable: true,
    })).toMatchObject({ ok: false, reason: ROSTER_SKIP_REASONS.ESPN_STATUS_FA })
  })

  test('skips IR and out statuses', () => {
    expect(evaluateEventRosterEligibility({
      playerName: 'Andrew Thomas',
      players,
    }).reason).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_IR)
    expect(evaluateEventRosterEligibility({
      playerName: 'DeVonta Smith',
      players,
    }).reason).toBe(ROSTER_SKIP_REASONS.ESPN_STATUS_OUT)
  })

  test('skips a player who is on neither event roster', () => {
    expect(evaluateEventRosterEligibility({
      playerName: 'Darius Slayton',
      players: players.filter((p) => p.name !== 'Darius Slayton'),
    })).toMatchObject({ ok: false, reason: ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER })
  })

  test('fails closed when the roster is unavailable', () => {
    expect(evaluateEventRosterEligibility({
      playerName: 'Malik Nabers',
      players: null,
      rosterAvailable: false,
    })).toMatchObject({ ok: false, reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE })
  })
})

describe('formatEventLabel and skip logs', () => {
  test('includes both teams and the event id', () => {
    expect(formatEventLabel(NYG_PHI)).toBe('NYG @ PHI (NYG_at_PHI_2026-11-02)')
  })

  test('logs player, event, and reason', () => {
    const lines = []
    logEventRosterSkip({
      playerName: 'Darius Slayton',
      event: formatEventLabel(NYG_PHI),
      reason: ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER,
    }, (...args) => lines.push(args.join(' ')))
    expect(lines[0]).toContain('Darius Slayton')
    expect(lines[0]).toContain('NYG @ PHI (NYG_at_PHI_2026-11-02)')
    expect(lines[0]).toContain(ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER)
  })
})

describe('resolveEspnTeamId and ESPN URLs', () => {
  test('uses prefixed Game ids and NFL abbr aliases', () => {
    expect(resolveEspnTeamId('nfl', { id: 'NFL_19', abbr: 'NYG' })).toBe('19')
    expect(resolveEspnTeamId('nfl', { abbr: 'WSH' })).toBe('28')
    expect(resolveEspnTeamId('nhl', { id: 'NHL_13', abbr: 'NYR' })).toBe('13')
    expect(espnRosterUrl('nfl', 19)).toBe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/19/roster')
    expect(espnEventSummaryUrl('nhl', '401802001')).toBe('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=401802001')
  })
})

describe('loadEventRosterPlayers', () => {
  test('uses event roster when ESPN summary has athletes', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({
      rosters: [
        { team: { abbreviation: 'PHI' }, roster: [{ displayName: 'A.J. Brown', status: { name: 'Active' } }] },
        { team: { abbreviation: 'NYG' }, roster: [{ displayName: 'Malik Nabers', status: { name: 'Active' } }] },
      ],
    }))
    const roster = await loadEventRosterPlayers(NYG_PHI, {
      sport: 'nfl',
      fetchImpl,
      sleepImpl: async () => {},
    })
    expect(roster.ok).toBe(true)
    expect(roster.players.map((p) => p.name)).toEqual(['A.J. Brown', 'Malik Nabers'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toContain('/summary?event=401772801')
  })

  test('falls back to both team rosters when the event payload is empty', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/summary?')) return jsonResponse({ rosters: [] })
      if (String(url).includes('/teams/21/')) {
        return jsonResponse(nflRosterPayload([
          { name: 'A.J. Brown', status: { name: 'Active' } },
        ]))
      }
      return jsonResponse(nflRosterPayload([
        { name: 'Malik Nabers', status: { name: 'Active' } },
      ]))
    })
    const clock = fakeClock()
    const roster = await loadEventRosterPlayers(NYG_PHI, {
      sport: 'nfl',
      fetchImpl,
      nowImpl: clock.nowImpl,
      sleepImpl: clock.sleepImpl,
      gapMs: ESPN_ROSTER_GAP_MS,
      retryMs: 0,
    })
    expect(roster.ok).toBe(true)
    expect(roster.players.map((p) => p.name).sort()).toEqual(['A.J. Brown', 'Malik Nabers'])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(clock.sleeps).toEqual([ESPN_ROSTER_GAP_MS, ESPN_ROSTER_GAP_MS])
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('the-odds-api'))).toBe(false)
  })

  test('paces ESPN roster fetches from an injected clock, not wall time', async () => {
    const clock = fakeClock(5_000)
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/summary?')) return jsonResponse({ rosters: [] })
      return jsonResponse(nflRosterPayload([{ name: 'Malik Nabers', status: { name: 'Active' } }]))
    })
    await loadEventRosterPlayers(NYG_PHI, {
      sport: 'nfl',
      fetchImpl,
      nowImpl: clock.nowImpl,
      sleepImpl: clock.sleepImpl,
      gapMs: ESPN_ROSTER_GAP_MS,
      retryMs: 0,
    })
    expect(clock.sleeps).toEqual([ESPN_ROSTER_GAP_MS, ESPN_ROSTER_GAP_MS])
  })

  test('does not treat a one-team event summary as complete', () => {
    const onlyPhi = parseEspnEventRosters({
      rosters: [
        { team: { abbreviation: 'PHI' }, roster: [{ displayName: 'A.J. Brown', status: { name: 'Active' } }] },
      ],
    })
    expect(eventRosterHasBothTeams(onlyPhi, NYG_PHI, 'nfl')).toBe(false)
    expect(eventRosterHasBothTeams([
      { name: 'A.J. Brown', team: 'PHI' },
      { name: 'Malik Nabers', team: 'NYG' },
    ], NYG_PHI, 'nfl')).toBe(true)
  })

  test('falls back to team rosters when the event summary has only one team', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/summary?')) {
        return jsonResponse({
          rosters: [
            { team: { abbreviation: 'PHI' }, roster: [{ displayName: 'A.J. Brown', status: { name: 'Active' } }] },
          ],
        })
      }
      if (String(url).includes('/teams/21/')) {
        return jsonResponse(nflRosterPayload([{ name: 'A.J. Brown', status: { name: 'Active' } }]))
      }
      return jsonResponse(nflRosterPayload([{ name: 'Malik Nabers', status: { name: 'Active' } }]))
    })
    const roster = await loadEventRosterPlayers(NYG_PHI, {
      sport: 'nfl',
      fetchImpl,
      sleepImpl: async () => {},
      retryMs: 0,
    })
    expect(roster.ok).toBe(true)
    expect(roster.players.map((p) => p.name).sort()).toEqual(['A.J. Brown', 'Malik Nabers'])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[0][0]).toContain('/summary?event=')
  })

  test('retries a failed ESPN fetch once with the capped backoff', async () => {
    const clock = fakeClock()
    let nygTries = 0
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/summary?')) return jsonResponse({ rosters: [] })
      if (String(url).includes('/teams/19/')) {
        nygTries += 1
        if (nygTries === 1) return jsonResponse({}, false)
        return jsonResponse(nflRosterPayload([{ name: 'Malik Nabers', status: { name: 'Active' } }]))
      }
      return jsonResponse(nflRosterPayload([{ name: 'A.J. Brown', status: { name: 'Active' } }]))
    })
    const roster = await loadEventRosterPlayers(NYG_PHI, {
      sport: 'nfl',
      fetchImpl,
      nowImpl: clock.nowImpl,
      sleepImpl: clock.sleepImpl,
      retryMs: ESPN_ROSTER_RETRY_MS,
      retryMaxMs: ESPN_ROSTER_RETRY_MS,
    })
    expect(roster.ok).toBe(true)
    expect(nygTries).toBe(2)
    expect(clock.sleeps).toContain(ESPN_ROSTER_RETRY_MS)
  })

  test('fails closed when one team roster cannot be fetched', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/summary?')) return jsonResponse({}, false)
      if (String(url).includes('/teams/21/')) {
        return jsonResponse(nflRosterPayload([{ name: 'A.J. Brown', status: { name: 'Active' } }]))
      }
      return jsonResponse({}, false)
    })
    const roster = await loadEventRosterPlayers({ ...NYG_PHI, espnGameId: null }, {
      sport: 'nfl',
      fetchImpl,
      sleepImpl: async () => {},
      retryMs: 0,
    })
    expect(roster).toMatchObject({ ok: false, reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE })
  })

  test('caches team roster fetches across props for the same event', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/summary?')) return jsonResponse({ rosters: [] })
      return jsonResponse(nflRosterPayload([{ name: 'Malik Nabers', status: { name: 'Active' } }]))
    })
    const cache = new Map()
    const pace = { lastFetchAt: null }
    await loadEventRosterPlayers(NYG_PHI, { fetchImpl, cache, pace, sleepImpl: async () => {}, retryMs: 0 })
    await loadEventRosterPlayers(NYG_PHI, { fetchImpl, cache, pace, sleepImpl: async () => {}, retryMs: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('guardPropsByEventRoster', () => {
  const nygPlayers = [
    { name: 'Malik Nabers', status: { name: 'Active', abbreviation: 'ACT' } },
  ]
  const phiPlayers = [
    { name: 'A.J. Brown', status: { name: 'Active' } },
  ]

  function teamFetch(url) {
    if (String(url).includes('/summary?')) return jsonResponse({ rosters: [] })
    if (String(url).includes('/teams/21/')) return jsonResponse(nflRosterPayload(phiPlayers))
    if (String(url).includes('/teams/19/')) return jsonResponse(nflRosterPayload(nygPlayers))
    return jsonResponse({}, false)
  }

  test('skips Slayton, keeps an active teammate, and logs the event', async () => {
    const lines = []
    const { kept, skipped } = await guardPropsByEventRoster([
      publishedNflProp({ playerName: 'Darius Slayton' }),
      publishedNflProp({ playerName: 'Malik Nabers' }),
    ], {
      sports: ['nfl'],
      loadGame: async () => NYG_PHI,
      fetchImpl: async (url) => teamFetch(url),
      sleepImpl: async () => {},
      log: (...args) => lines.push(args.join(' ')),
    })
    expect(kept.map((p) => p.playerName)).toEqual(['Malik Nabers'])
    expect(skipped).toEqual([expect.objectContaining({
      playerName: 'Darius Slayton',
      reason: ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER,
      event: 'NYG @ PHI (NYG_at_PHI_2026-11-02)',
    })])
    expect(lines.join('\n')).toMatch(/Darius Slayton/)
    expect(lines.join('\n')).toMatch(/NYG @ PHI/)
    expect(lines.join('\n')).toMatch(/not_on_event_roster/)
  })

  test('does not publish when ESPN roster fetch fails', async () => {
    const { kept, skipped } = await guardPropsByEventRoster([
      publishedNflProp(),
    ], {
      sports: ['nfl'],
      loadGame: async () => NYG_PHI,
      fetchImpl: async () => jsonResponse({}, false),
      sleepImpl: async () => {},
      log: () => {},
    })
    expect(kept).toEqual([])
    expect(skipped[0].reason).toBe(ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE)
  })

  test('applies the same NHL skip rules without touching MLB rows', async () => {
    const nhlGame = {
      id: 'NYR_at_NJD_2026-11-02',
      sport: 'nhl',
      espnGameId: null,
      homeId: 'NHL_11',
      awayId: 'NHL_13',
      home: { abbr: 'NJD' },
      away: { abbr: 'NYR' },
    }
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/teams/11/')) {
        return jsonResponse({
          athletes: [{ displayName: 'Jack Hughes', status: { name: 'Active' } }],
        })
      }
      if (String(url).includes('/teams/13/')) {
        return jsonResponse({
          athletes: [{ displayName: 'Artemi Panarin', status: { name: 'Injured Reserve', abbreviation: 'IR' } }],
        })
      }
      return jsonResponse({}, false)
    })
    const { kept, skipped } = await guardPropsByEventRoster([
      { playerName: 'Artemi Panarin', gameId: nhlGame.id, sport: 'nhl' },
      { playerName: 'Jack Hughes', gameId: nhlGame.id, sport: 'nhl' },
      { playerName: 'Aaron Judge', gameId: 'NYY_at_BOS_2026-10-01', sport: 'mlb' },
    ], {
      sports: SHADOW_ROSTER_GUARD_SPORTS,
      loadGame: async () => nhlGame,
      fetchImpl,
      sleepImpl: async () => {},
      log: () => {},
    })
    expect(kept.map((p) => p.playerName)).toEqual(['Jack Hughes', 'Aaron Judge'])
    expect(skipped).toEqual([expect.objectContaining({
      playerName: 'Artemi Panarin',
      reason: ROSTER_SKIP_REASONS.ESPN_STATUS_IR,
    })])
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('the-odds-api'))).toBe(true)
  })

  test('Published guard sports stay NFL-only so shadow NHL stays private', () => {
    expect(PUBLISHED_ROSTER_GUARD_SPORTS).toEqual(['nfl'])
    expect(SHADOW_ROSTER_GUARD_SPORTS).toEqual(['nhl'])
  })
})

describe('roster outage summary', () => {
  test('counts unavailable skips and flags a full outage', () => {
    const stats = summarizeRosterGuard({
      kept: [],
      skipped: [
        { reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE },
        { reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE },
      ],
      guardedCount: 2,
    })
    expect(stats.unavailableCount).toBe(2)
    expect(stats.rosterOutage).toBe(true)
    const lines = []
    const errors = []
    logRosterGuardSummary(stats, {
      log: (...args) => lines.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    })
    expect(lines.join('\n')).toMatch(/unavailable=2/)
    expect(errors.join('\n')).toMatch(/Roster guard outage/)
  })

  test('does not flag an outage when some guarded props were kept', () => {
    const stats = summarizeRosterGuard({
      kept: [publishedNflProp()],
      skipped: [{ reason: ROSTER_SKIP_REASONS.ROSTER_UNAVAILABLE }],
      guardedCount: 2,
    })
    expect(stats.unavailableCount).toBe(1)
    expect(stats.rosterOutage).toBe(false)
  })

  test('shares one roster cache between persist-style calls', () => {
    const shared = withSharedRosterGuard()
    const again = withSharedRosterGuard(shared)
    expect(again.rosterCache).toBe(shared.rosterCache)
    expect(again.rosterPace).toBe(shared.rosterPace)
  })
})

describe('checkPlayerEventRosterEligibility', () => {
  test('returns the skip decision used by the generators', async () => {
    const decision = await checkPlayerEventRosterEligibility({
      playerName: 'Darius Slayton',
      game: NYG_PHI,
      sport: 'nfl',
      fetchImpl: async (url) => {
        if (String(url).includes('/summary?')) return jsonResponse({ rosters: [] })
        return jsonResponse(nflRosterPayload([
          { name: 'Malik Nabers', status: { name: 'Active' } },
        ]))
      },
      sleepImpl: async () => {},
      retryMs: 0,
    })
    expect(decision).toMatchObject({
      ok: false,
      reason: ROSTER_SKIP_REASONS.NOT_ON_EVENT_ROSTER,
      event: 'NYG @ PHI (NYG_at_PHI_2026-11-02)',
    })
  })
})
