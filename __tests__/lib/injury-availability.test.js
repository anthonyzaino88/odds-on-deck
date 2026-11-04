import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEspnInjuriesPayload } from '../../lib/espn-injuries.js'
import {
  parseEspnNhlGoalies,
  parseNhlWebGoalies,
  mergeGoalieRows,
} from '../../lib/nhl-starting-goalies.js'
import {
  applyInjuryAvailability,
  fetchJsonWithRetry,
  formatInjuriesStatus,
  isMissingInjuryTableError,
  isNhlGoaliePropType,
  loadInjurySnapshot,
  persistInjurySnapshot,
  runFetchInjuries,
} from '../../lib/injury-availability.js'
import { runFetchInjuriesCli } from '../../scripts/fetch-injuries.js'

const FIXTURES = join(process.cwd(), '__tests__/fixtures')

function loadJson(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

describe('parseEspnInjuriesPayload', () => {
  test('maps KC names and Out/IR/Doubtful/Questionable', () => {
    const rows = parseEspnInjuriesPayload(loadJson('espn-nfl-injuries.json'), {
      sport: 'nfl',
      asOfDate: '2026-11-04',
      now: new Date('2026-11-04T16:00:00.000Z'),
    })
    const byName = Object.fromEntries(rows.map((row) => [row.playerName, row]))
    expect(byName['Isiah Pacheco']).toMatchObject({
      teamAbbr: 'KC',
      status: 'Out',
      statusCode: 'O',
      source: 'espn',
    })
    expect(byName['Rashee Rice'].status).toBe('Doubtful')
    expect(byName['Travis Kelce'].status).toBe('Questionable')
    expect(byName['Juju Smith-Schuster'].status).toBe('IR')
  })
})

describe('NHL starting goalies', () => {
  test('parses ESPN scoreboard probables and confirmed flag', () => {
    const rows = parseEspnNhlGoalies(loadJson('espn-nhl-scoreboard-goalies.json'), {
      asOfDate: '2026-11-04',
    })
    const byTeam = Object.fromEntries(rows.map((row) => [row.teamAbbr, row]))
    expect(byTeam.NYR.playerName).toBe('Igor Shesterkin')
    expect(byTeam.NYR.confirmed).toBe(false)
    expect(byTeam.NJD.playerName).toBe('Jacob Markstrom')
    expect(byTeam.NJD.confirmed).toBe(true)
    expect(byTeam.NJD.opponentAbbr).toBe('NYR')
  })

  test('parses NHL api-web landing goalieComparison', () => {
    const rows = parseNhlWebGoalies(loadJson('nhl-web-landing-goalies.json'), {
      asOfDate: '2026-11-04',
    })
    const byTeam = Object.fromEntries(rows.map((row) => [row.teamAbbr, row]))
    expect(byTeam.TOR.playerName).toBe('Anthony Stolarz')
    expect(byTeam.BOS.playerName).toBe('Jeremy Swayman')
    expect(byTeam.TOR.source).toBe('nhl')
  })

  test('merge prefers ESPN names and confirmed rows', () => {
    const espn = parseEspnNhlGoalies(loadJson('espn-nhl-scoreboard-goalies.json'), {
      asOfDate: '2026-11-04',
    })
    const nhl = [{
      teamAbbr: 'NYR',
      playerName: 'Jonathan Quick',
      confirmed: false,
      source: 'nhl',
    }]
    const merged = mergeGoalieRows(espn, nhl)
    expect(merged.find((row) => row.teamAbbr === 'NYR').playerName).toBe('Igor Shesterkin')
    expect(merged.find((row) => row.teamAbbr === 'NYR').source).toBe('espn')
  })
})

describe('applyInjuryAvailability', () => {
  const snapshot = {
    injuries: parseEspnInjuriesPayload(loadJson('espn-nfl-injuries.json'), {
      sport: 'nfl',
      asOfDate: '2026-11-04',
    }),
    goalies: parseEspnNhlGoalies(loadJson('espn-nhl-scoreboard-goalies.json'), {
      asOfDate: '2026-11-04',
    }),
  }

  test('skips Out, IR, and Doubtful; flags Questionable', () => {
    const result = applyInjuryAvailability([
      { playerName: 'Isiah Pacheco', sport: 'nfl', team: 'KC', type: 'rushing_yards' },
      { playerName: 'Rashee Rice', sport: 'nfl', team: 'KC', type: 'receiving_yards' },
      { playerName: 'Juju Smith-Schuster', sport: 'nfl', team: 'KC', type: 'receiving_yards' },
      { playerName: 'Travis Kelce', sport: 'nfl', team: 'KC', type: 'receiving_yards' },
      { playerName: 'Patrick Mahomes', sport: 'nfl', team: 'KC', type: 'passing_yards' },
    ], snapshot)
    expect(result.skipped.map((row) => row.playerName).sort()).toEqual([
      'Isiah Pacheco',
      'Juju Smith-Schuster',
      'Rashee Rice',
    ])
    const kelce = result.kept.find((row) => row.playerName === 'Travis Kelce')
    expect(kelce.availabilityFlags).toContain('injury:questionable')
    expect(result.kept.some((row) => row.playerName === 'Patrick Mahomes')).toBe(true)
  })

  test('tableMissing snapshot does not skip or flag', () => {
    const result = applyInjuryAvailability([
      { playerName: 'Isiah Pacheco', sport: 'nfl', team: 'KC', type: 'rushing_yards' },
      { playerName: 'Jonathan Quick', sport: 'nhl', team: 'NYR', type: 'saves' },
    ], { ...snapshot, tableMissing: true })
    expect(result.skipped).toEqual([])
    expect(result.kept).toHaveLength(2)
    expect(result.kept[0].availabilityFlags).toBeUndefined()
  })

  test('NHL game lines flag unconfirmed starters without skipping', () => {
    const result = applyInjuryAvailability([
      {
        playerName: 'NYR',
        sport: 'nhl',
        type: 'moneyline',
        source: 'game_line',
        team: 'NYR',
        homeTeam: 'NJD',
        awayTeam: 'NYR',
      },
    ], snapshot)
    expect(result.skipped).toEqual([])
    expect(result.kept[0].availabilityFlags).toContain('starter:unconfirmed')
  })

  test('NHL goalie props keep the starter, skip the backup, flag unconfirmed', () => {
    expect(isNhlGoaliePropType('saves')).toBe(true)
    expect(isNhlGoaliePropType('player_total_saves')).toBe(true)
    expect(isNhlGoaliePropType('points')).toBe(false)
    const result = applyInjuryAvailability([
      { playerName: 'Igor Shesterkin', sport: 'nhl', team: 'NYR', type: 'saves' },
      { playerName: 'Jonathan Quick', sport: 'nhl', team: 'NYR', type: 'saves' },
      { playerName: 'Jacob Markstrom', sport: 'nhl', team: 'NJD', type: 'saves' },
      { playerName: 'Jack Hughes', sport: 'nhl', team: 'NJD', type: 'points' },
    ], snapshot)
    expect(result.skipped.some((row) => row.playerName === 'Jonathan Quick')).toBe(true)
    const igor = result.kept.find((row) => row.playerName === 'Igor Shesterkin')
    expect(igor.availabilityFlags).toContain('starter:unconfirmed')
    const markstrom = result.kept.find((row) => row.playerName === 'Jacob Markstrom')
    expect(markstrom.availabilityFlags || []).not.toContain('starter:unconfirmed')
    expect(result.kept.some((row) => row.playerName === 'Jack Hughes')).toBe(true)
  })
})

describe('graceful degradation', () => {
  test('detects missing-table errors', () => {
    expect(isMissingInjuryTableError({ code: '42P01' })).toBe(true)
    expect(isMissingInjuryTableError({ code: 'PGRST205' })).toBe(true)
    expect(isMissingInjuryTableError({ code: 'PGRST204' })).toBe(false)
  })

  test('loadInjurySnapshot warns and returns empty when the table is missing', async () => {
    const lines = []
    const snapshot = await loadInjurySnapshot({
      asOfDate: '2026-11-04',
      log: { log: (msg) => lines.push(msg), warn: (msg) => lines.push(msg) },
      supabase: {
        from: () => ({
          select: async () => ({ data: null, error: { code: '42P01', message: 'relation InjuryReport does not exist' } }),
        }),
      },
    })
    expect(snapshot.tableMissing).toBe(true)
    expect(snapshot.injuries).toEqual([])
    expect(lines.join('\n')).toMatch(/InjuryReport table missing/)
  })

  test('persistInjurySnapshot warns and continues when the table is missing', async () => {
    const lines = []
    const result = await persistInjurySnapshot({
      injuries: [{ id: 'inj:nfl:2026-11-04:KC:x', sport: 'nfl', teamAbbr: 'KC', playerName: 'X', status: 'Out', asOfDate: '2026-11-04', fetchedAt: '2026-11-04T16:00:00.000Z' }],
      goalies: [],
    }, {
      log: { log: (msg) => lines.push(msg), warn: (msg) => lines.push(msg) },
      supabase: {
        from: () => ({
          upsert: async () => ({ error: { code: 'PGRST205', message: "Could not find the table 'public.InjuryReport' in the schema cache" } }),
        }),
      },
    })
    expect(result.tableMissing).toBe(true)
    expect(result.persisted).toBe(false)
    expect(lines.join('\n')).toMatch(/not persisted/)
  })
})

describe('fetchJsonWithRetry', () => {
  test('retries then succeeds without leaking secrets', async () => {
    let calls = 0
    const data = await fetchJsonWithRetry('https://site.api.espn.com/injuries?apiKey=secret', {
      retries: 2,
      retryMs: 1,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls += 1
        if (calls < 2) throw new Error('timeout')
        return { ok: true, json: async () => ({ ok: true }) }
      },
    })
    expect(data).toEqual({ ok: true })
    expect(calls).toBe(2)
  })
})

describe('runFetchInjuries', () => {
  test('parses fixtures, persists, and prints INJURIES_STATUS=ok', async () => {
    const logs = []
    const upserts = { InjuryReport: [], NhlStartingGoalie: [] }
    const nfl = loadJson('espn-nfl-injuries.json')
    const board = loadJson('espn-nhl-scoreboard-goalies.json')
    const result = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.includes('/football/nfl/injuries')) {
          return { ok: true, json: async () => nfl }
        }
        if (href.includes('/hockey/nhl/injuries')) {
          return { ok: true, json: async () => ({ injuries: [] }) }
        }
        if (href.includes('/hockey/nhl/scoreboard')) {
          return { ok: true, json: async () => board }
        }
        throw new Error(`unexpected url ${href}`)
      },
      supabase: {
        from: (table) => ({
          upsert: async (rows) => {
            upserts[table] = rows
            return { error: null }
          },
        }),
      },
    })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.counts.nflInjuries).toBe(4)
    expect(result.counts.goalies).toBe(2)
    expect(upserts.InjuryReport).toHaveLength(4)
    expect(upserts.NhlStartingGoalie).toHaveLength(2)
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=ok/)
    expect(logs.join('\n')).not.toMatch(/ODDS_API_KEY/)
    expect(logs.join('\n')).not.toMatch(/secret/)
  })

  test('falls back to NHL api-web when ESPN scoreboard has no goalies', async () => {
    const logs = []
    const landing = loadJson('nhl-web-landing-goalies.json')
    const result = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.includes('/football/nfl/injuries') || href.includes('/hockey/nhl/injuries')) {
          return { ok: true, json: async () => ({ injuries: [] }) }
        }
        if (href.includes('/hockey/nhl/scoreboard')) {
          return { ok: true, json: async () => ({ events: [] }) }
        }
        if (href.includes('api-web.nhle.com/v1/score/')) {
          return {
            ok: true,
            json: async () => ({
              games: [{ id: 2024020123, awayTeam: { abbrev: 'TOR' }, homeTeam: { abbrev: 'BOS' } }],
            }),
          }
        }
        if (href.includes('/gamecenter/2024020123/landing')) {
          return { ok: true, json: async () => landing }
        }
        throw new Error(`unexpected url ${href}`)
      },
      supabase: {
        from: () => ({
          upsert: async () => ({ error: null }),
        }),
      },
    })
    expect(result.status).toBe('ok')
    expect(result.counts.goalies).toBe(2)
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=ok/)
  })

  test('all feed failures still exit 0 with INJURIES_STATUS=failed', async () => {
    const logs = []
    const result = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      retries: 0,
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      supabase: { from: () => ({ upsert: async () => ({ error: null }) }) },
    })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('failed')
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=failed/)
  })
})

describe('ops wiring', () => {
  test('README and scripts document the status line and 009', () => {
    const readme = readFileSync(join(process.cwd(), 'operations/README.md'), 'utf8')
    expect(readme).toMatch(/fetch-injuries\.js/)
    expect(readme).toMatch(/INJURIES_STATUS=ok\|partial\|failed/)
    expect(readme).toMatch(/009_injury_report\.sql/)
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-injuries.js'), 'utf8')
    expect(src).toMatch(/INJURIES_STATUS/)
    expect(src).not.toMatch(/ODDS_API_KEY/)
    expect(formatInjuriesStatus('partial')).toBe('INJURIES_STATUS=partial')
  })

  test('CLI still exits 0 when supabase cannot connect', async () => {
    const logs = []
    const result = await runFetchInjuriesCli({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg), error: (msg) => logs.push(msg) },
      createClient: () => { throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL') },
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      env: {},
    })
    expect(result.exitCode).toBe(0)
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=failed/)
  })
})
