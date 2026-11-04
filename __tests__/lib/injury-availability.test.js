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
  INJURY_AMBIGUOUS_FLAG,
  INJURY_FILTER_EMPTY_LINE,
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

  test('NHL goalie props skip backup only when the starter is confirmed', () => {
    expect(isNhlGoaliePropType('saves')).toBe(true)
    expect(isNhlGoaliePropType('player_total_saves')).toBe(true)
    expect(isNhlGoaliePropType('points')).toBe(false)
    const probable = applyInjuryAvailability([
      { playerName: 'Igor Shesterkin', sport: 'nhl', team: 'NYR', type: 'saves' },
      { playerName: 'Jonathan Quick', sport: 'nhl', team: 'NYR', type: 'saves' },
      { playerName: 'Jacob Markstrom', sport: 'nhl', team: 'NJD', type: 'saves' },
      { playerName: 'Jack Hughes', sport: 'nhl', team: 'NJD', type: 'points' },
    ], snapshot)
    expect(probable.skipped.some((row) => row.playerName === 'Jonathan Quick')).toBe(false)
    const igor = probable.kept.find((row) => row.playerName === 'Igor Shesterkin')
    expect(igor.availabilityFlags).toContain('starter:unconfirmed')
    const quick = probable.kept.find((row) => row.playerName === 'Jonathan Quick')
    expect(quick.availabilityFlags).toContain('starter:unconfirmed')
    const markstrom = probable.kept.find((row) => row.playerName === 'Jacob Markstrom')
    expect(markstrom.availabilityFlags || []).not.toContain('starter:unconfirmed')
    expect(probable.kept.some((row) => row.playerName === 'Jack Hughes')).toBe(true)

    const confirmedSnapshot = {
      ...snapshot,
      goalies: snapshot.goalies.map((row) => (
        row.teamAbbr === 'NYR' ? { ...row, confirmed: true } : row
      )),
    }
    const confirmed = applyInjuryAvailability([
      { playerName: 'Jonathan Quick', sport: 'nhl', team: 'NYR', type: 'saves' },
      { playerName: 'Igor Shesterkin', sport: 'nhl', team: 'NYR', type: 'saves' },
    ], confirmedSnapshot)
    expect(confirmed.skipped.some((row) => row.playerName === 'Jonathan Quick')).toBe(true)
    expect(confirmed.kept.some((row) => row.playerName === 'Igor Shesterkin')).toBe(true)
  })

  test('Josh Allen BUF is not skipped as Out because of JAX Josh Allen', () => {
    const injuries = [
      { sport: 'nfl', teamAbbr: 'JAX', playerName: 'Josh Allen', status: 'Out' },
    ]
    const bufProp = {
      playerName: 'Josh Allen',
      sport: 'nfl',
      gameId: 'BUF_at_MIA_2026-11-04',
      type: 'passing_yards',
    }
    const scoped = applyInjuryAvailability([bufProp], { injuries, goalies: [] })
    expect(scoped.skipped).toEqual([])
    expect(scoped.kept).toHaveLength(1)
    expect(scoped.kept[0].availabilityFlags).toContain(INJURY_AMBIGUOUS_FLAG)

    const unresolved = applyInjuryAvailability(
      [{ playerName: 'Josh Allen', sport: 'nfl', type: 'passing_yards' }],
      { injuries, goalies: [] },
    )
    expect(unresolved.skipped).toEqual([])
    expect(unresolved.kept[0].availabilityFlags).toContain(INJURY_AMBIGUOUS_FLAG)

    const jaxGame = applyInjuryAvailability(
      [{ playerName: 'Josh Allen', sport: 'nfl', gameId: 'JAX_at_IND_2026-11-04', type: 'passing_yards' }],
      { injuries, goalies: [] },
    )
    expect(jaxGame.skipped.map((row) => row.playerName)).toEqual(['Josh Allen'])
  })

  test('Out Keller on UTA_at_COL is skipped including UTAH alias', () => {
    const injuries = [
      { sport: 'nhl', teamAbbr: 'UTAH', playerName: 'Clayton Keller', status: 'Out' },
    ]
    const skipped = applyInjuryAvailability([
      { playerName: 'Clayton Keller', sport: 'nhl', gameId: 'UTA_at_COL_2026-11-04', type: 'points' },
    ], { injuries, goalies: [] })
    expect(skipped.skipped.map((row) => row.playerName)).toEqual(['Clayton Keller'])

    const utahId = applyInjuryAvailability([
      { playerName: 'Clayton Keller', sport: 'nhl', gameId: 'UTAH_at_COL_2026-11-04', type: 'points' },
    ], { injuries: [{ ...injuries[0], teamAbbr: 'UTA' }], goalies: [] })
    expect(utahId.skipped.map((row) => row.playerName)).toEqual(['Clayton Keller'])
  })

  test('emits injury filter skipped when the snapshot has no rows today', () => {
    const lines = []
    const result = applyInjuryAvailability(
      [{ playerName: 'Josh Allen', sport: 'nfl', gameId: 'BUF_at_MIA_2026-11-04' }],
      { injuries: [], goalies: [] },
      { log: (msg) => lines.push(msg) },
    )
    expect(result.kept).toHaveLength(1)
    expect(lines.join('\n')).toContain(INJURY_FILTER_EMPTY_LINE)
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

  function writeClient(ops, { upsertError = null } = {}) {
    return {
      from: (table) => {
        const filters = {}
        const chain = {}
        chain.upsert = async (rows) => {
          ops.push({ op: 'upsert', table, rows })
          return { error: upsertError }
        }
        chain.delete = () => {
          chain._delete = true
          return chain
        }
        chain.eq = (key, value) => {
          filters[key] = value
          return chain
        }
        chain.not = (column, operator, value) => {
          filters.not = [column, operator, value]
          return chain
        }
        chain.then = (ok, bad) => {
          if (chain._delete) ops.push({ op: 'delete', table, ...filters })
          return Promise.resolve({ error: null }).then(ok, bad)
        }
        return chain
      },
    }
  }

  test('upserts first then prunes ids not in the new set', async () => {
    const ops = []
    await persistInjurySnapshot({
      asOfDate: '2026-11-04',
      injuries: [{
        id: 'inj:nfl:2026-11-04:KC:travis-kelce',
        sport: 'nfl',
        teamAbbr: 'KC',
        playerName: 'Travis Kelce',
        status: 'Questionable',
        asOfDate: '2026-11-04',
        fetchedAt: '2026-11-04T16:00:00.000Z',
      }],
      goalies: [],
    }, {
      replace: { nflInjuries: true, nhlInjuries: false, goalies: false },
      supabase: writeClient(ops),
    })
    expect(ops.map((row) => row.op)).toEqual(['upsert', 'delete'])
    expect(ops[0].rows[0].playerName).toBe('Travis Kelce')
    expect(ops[1].sport).toBe('nfl')
    expect(ops[1].not[2]).toContain('inj:nfl:2026-11-04:KC:travis-kelce')
  })

  test('empty payload does not delete existing rows', async () => {
    const ops = []
    const result = await persistInjurySnapshot({
      asOfDate: '2026-11-04',
      injuries: [],
      goalies: [],
    }, {
      replace: { nflInjuries: true, nhlInjuries: true, goalies: true },
      supabase: writeClient(ops),
    })
    expect(ops).toEqual([])
    expect(result.persisted).toBe(true)
  })

  test('upsert failure retains existing rows (no delete)', async () => {
    const ops = []
    const result = await persistInjurySnapshot({
      asOfDate: '2026-11-04',
      injuries: [{
        id: 'inj:nfl:2026-11-04:KC:x',
        sport: 'nfl',
        teamAbbr: 'KC',
        playerName: 'X',
        status: 'Out',
        asOfDate: '2026-11-04',
        fetchedAt: '2026-11-04T16:00:00.000Z',
      }],
      goalies: [],
    }, {
      log: { log() {}, warn() {} },
      replace: { nflInjuries: true, nhlInjuries: false, goalies: false },
      supabase: writeClient(ops, { upsertError: { message: 'write failed' } }),
    })
    expect(ops.map((row) => row.op)).toEqual(['upsert'])
    expect(result.persisted).toBe(false)
    expect(result.retained).toBe(true)
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
  const nhlOneInjury = {
    injuries: [{
      team: { abbreviation: 'TOR' },
      injuries: [{
        status: 'DTD',
        athlete: { displayName: 'Auston Matthews', position: { abbreviation: 'C' } },
      }],
    }],
  }

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
          return { ok: true, json: async () => nhlOneInjury }
        }
        if (href.includes('/hockey/nhl/scoreboard')) {
          return { ok: true, json: async () => board }
        }
        throw new Error(`unexpected url ${href}`)
      },
      supabase: {
        from: (table) => ({
          upsert: async (rows) => {
            upserts[table] = (upserts[table] || []).concat(rows)
            return { error: null }
          },
        }),
      },
    })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.counts.nflInjuries).toBe(4)
    expect(result.counts.nhlInjuries).toBe(1)
    expect(result.counts.goalies).toBe(2)
    expect(upserts.InjuryReport).toHaveLength(5)
    expect(upserts.NhlStartingGoalie).toHaveLength(2)
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=ok/)
    expect(logs.join('\n')).not.toMatch(/ODDS_API_KEY/)
    expect(logs.join('\n')).not.toMatch(/secret/)
  })

  test('empty or malformed ESPN payloads keep existing rows and are partial', async () => {
    const logs = []
    const ops = []
    const empty = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      retries: 0,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      supabase: {
        from: (table) => {
          const chain = {
            upsert: async (rows) => {
              ops.push({ op: 'upsert', table, rows })
              return { error: null }
            },
            delete: () => {
              ops.push({ op: 'delete', table })
              return chain
            },
            eq: () => chain,
            not: () => chain,
            then: (ok, bad) => Promise.resolve({ error: null }).then(ok, bad),
          }
          return chain
        },
      },
    })
    expect(empty.status).toBe('partial')
    expect(empty.exitCode).toBe(0)
    expect(ops).toEqual([])
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=partial/)

    const malformed = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log() {}, warn() {} },
      retries: 0,
      fetchImpl: async () => ({ ok: true, json: async () => ({ injuries: 'nope', events: 1 }) }),
      supabase: {
        from: () => ({
          upsert: async () => {
            ops.push({ op: 'upsert' })
            return { error: null }
          },
          delete: () => {
            ops.push({ op: 'delete' })
            return { eq: () => ({ not: async () => ({ error: null }) }) }
          },
        }),
      },
    })
    expect(malformed.status).toBe('partial')
    expect(malformed.counts.nflInjuries).toBe(0)
    expect(ops).toEqual([])
  })

  test('falls back to NHL api-web when ESPN scoreboard has no goalies', async () => {
    const logs = []
    const landing = loadJson('nhl-web-landing-goalies.json')
    const result = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.includes('/football/nfl/injuries')) {
          return { ok: true, json: async () => loadJson('espn-nfl-injuries.json') }
        }
        if (href.includes('/hockey/nhl/injuries')) {
          return { ok: true, json: async () => nhlOneInjury }
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

  test('goalie fallback failure is INJURIES_STATUS=partial', async () => {
    const logs = []
    const result = await runFetchInjuries({
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      retries: 0,
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.includes('/football/nfl/injuries') || href.includes('/hockey/nhl/injuries')) {
          return { ok: true, json: async () => ({ injuries: [] }) }
        }
        if (href.includes('/hockey/nhl/scoreboard')) {
          return {
            ok: true,
            json: async () => ({
              events: [{
                id: '401802099',
                competitions: [{
                  competitors: [
                    { homeAway: 'away', team: { abbreviation: 'TOR' } },
                    { homeAway: 'home', team: { abbreviation: 'BOS' } },
                  ],
                }],
              }],
            }),
          }
        }
        return { ok: false, status: 500, json: async () => ({}) }
      },
      supabase: { from: () => ({ upsert: async () => ({ error: null }) }) },
    })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('partial')
    expect(result.counts.goalies).toBe(0)
    expect(logs.join('\n')).toMatch(/INJURIES_STATUS=partial/)
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
    expect(readme).toMatch(/ignoreQuietPeriod/)
    expect(readme).toMatch(/injury filter skipped \(no rows today\)/)
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-injuries.js'), 'utf8')
    expect(src).toMatch(/INJURIES_STATUS/)
    expect(src).toMatch(/ignoreQuietPeriod/)
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
