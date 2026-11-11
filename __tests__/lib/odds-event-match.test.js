import { spawnSync } from 'node:child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NFL_TEAM_NAMES } from '../../lib/team-mapping.js'
import {
  classifyUnmappedOddsEvent,
  formatUnmappedOddsEventLine,
  matchOddsApiEventToGame,
  oddsEventSlateBounds,
  oddsTeamsMatch,
  summarizeUnmappedOddsReasons,
  UNMAPPED_ODDS_REASONS,
} from '../../lib/live-odds-landing.js'

const WEDNESDAY = '2026-11-11'
const WEDNESDAY_MORNING = new Date('2026-11-11T13:09:00.000Z') // 8:09 AM ET
const TNF = '2026-11-13T01:15:00.000Z' // Thu 8:15 PM ET
const SUN_1PM = '2026-11-15T18:00:00.000Z'
const SUN_425 = '2026-11-15T21:25:00.000Z'
const SNF = '2026-11-16T01:20:00.000Z' // Sun 8:20 PM ET
const MNF = '2026-11-17T01:15:00.000Z' // Mon 8:15 PM ET
const NEXT_THU = '2026-11-20T01:15:00.000Z'

const NAME_BY_ABBR = Object.fromEntries(
  Object.entries(NFL_TEAM_NAMES).map(([name, abbr]) => [abbr, name]),
)
NAME_BY_ABBR.WSH = 'Washington Commanders'
NAME_BY_ABBR.LAR = 'Los Angeles Rams'
NAME_BY_ABBR.JAX = 'Jacksonville Jaguars'

function dbGame({ away, home, commence, status = 'scheduled' }) {
  const etDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(commence))
  return {
    id: `${away}_at_${home}_${etDate}`,
    date: commence.replace(/Z$/, ''),
    status,
    oddsApiEventId: null,
    home: { abbr: home, name: NAME_BY_ABBR[home] || home },
    away: { abbr: away, name: NAME_BY_ABBR[away] || away },
  }
}

function oddsEvent({ away, home, commence, id }) {
  return {
    id: id || `evt-${away}-${home}`,
    home_team: NAME_BY_ABBR[home] || home,
    away_team: NAME_BY_ABBR[away] || away,
    commence_time: commence,
  }
}

const THIS_WEEK = [
  { away: 'WSH', home: 'NYG', commence: TNF },
  { away: 'CHI', home: 'MIN', commence: SUN_1PM },
  { away: 'GB', home: 'NYJ', commence: SUN_1PM },
  { away: 'HOU', home: 'TEN', commence: SUN_1PM },
  { away: 'JAX', home: 'IND', commence: SUN_1PM },
  { away: 'LAR', home: 'SEA', commence: SUN_1PM },
  { away: 'NE', home: 'TB', commence: SUN_1PM },
  { away: 'NO', home: 'CAR', commence: SUN_1PM },
  { away: 'ATL', home: 'NO', commence: SUN_425 },
  { away: 'DAL', home: 'LV', commence: SUN_425 },
  { away: 'DEN', home: 'KC', commence: SUN_425 },
  { away: 'PHI', home: 'DET', commence: SNF },
  { away: 'BAL', home: 'CLE', commence: MNF },
  { away: 'LAC', home: 'JAX', commence: MNF },
]

const NEXT_WEEK = [
  { away: 'ARI', home: 'SF', commence: NEXT_THU },
  { away: 'BUF', home: 'MIA', commence: '2026-11-22T18:00:00.000Z' },
  { away: 'CIN', home: 'PIT', commence: '2026-11-22T18:00:00.000Z' },
  { away: 'DAL', home: 'PHI', commence: '2026-11-22T18:00:00.000Z' },
  { away: 'GB', home: 'MIN', commence: '2026-11-22T18:00:00.000Z' },
  { away: 'KC', home: 'LV', commence: '2026-11-22T21:25:00.000Z' },
  { away: 'LAR', home: 'TB', commence: '2026-11-22T21:25:00.000Z' },
  { away: 'NE', home: 'NYJ', commence: '2026-11-22T21:25:00.000Z' },
  { away: 'SEA', home: 'TEN', commence: '2026-11-23T01:20:00.000Z' },
  { away: 'WSH', home: 'DAL', commence: '2026-11-23T01:20:00.000Z' },
  { away: 'CHI', home: 'DET', commence: '2026-11-24T01:15:00.000Z' },
  { away: 'HOU', home: 'IND', commence: '2026-11-24T01:15:00.000Z' },
  { away: 'ATL', home: 'CAR', commence: '2026-11-22T18:00:00.000Z' },
]

describe('oddsEventSlateBounds NFL week', () => {
  test('Wednesday morning includes SNF and MNF, not next Thursday', () => {
    const bounds = oddsEventSlateBounds({
      sport: 'nfl',
      date: WEDNESDAY,
      now: WEDNESDAY_MORNING,
    })
    expect(bounds.startKey).toBe('2026-11-11')
    expect(bounds.endKey).toBe('2026-11-17')
    const start = Date.parse(bounds.startIso)
    const end = Date.parse(bounds.endIso)
    expect(start).toBeLessThanOrEqual(Date.parse(TNF))
    expect(start).toBeLessThanOrEqual(Date.parse(SUN_1PM))
    expect(end).toBeGreaterThanOrEqual(Date.parse(SNF))
    expect(end).toBeGreaterThanOrEqual(Date.parse(MNF))
    expect(end).toBeLessThan(Date.parse(NEXT_THU))
  })

  test('MLB/NHL stay on an ET ±3/+4 window, not host local midnight', () => {
    const bounds = oddsEventSlateBounds({
      sport: 'mlb',
      date: WEDNESDAY,
      now: WEDNESDAY_MORNING,
    })
    expect(bounds.startKey).toBe('2026-11-08')
    expect(bounds.endKey).toBe('2026-11-15')
  })
})

describe('legacy local ±3/+4 window vs ET NFL week', () => {
  test('on an ET host the old window drops SNF; the new window keeps it', () => {
    const script = `
      import { oddsEventSlateBounds } from './lib/live-odds-landing.js'
      const date = '2026-11-11'
      const dateObj = new Date(date)
      const dateStart = new Date(dateObj)
      dateStart.setHours(0, 0, 0, 0)
      dateStart.setDate(dateStart.getDate() - 3)
      const dateEnd = new Date(dateObj)
      dateEnd.setHours(23, 59, 59, 999)
      dateEnd.setDate(dateEnd.getDate() + 4)
      const snf = Date.parse('2026-11-16T01:20:00.000Z')
      const mnf = Date.parse('2026-11-17T01:15:00.000Z')
      const bounds = oddsEventSlateBounds({ sport: 'nfl', date, now: new Date('2026-11-11T13:09:00.000Z') })
      console.log(JSON.stringify({
        tz: process.env.TZ,
        legacyIncludesSnf: snf >= dateStart.getTime() && snf <= dateEnd.getTime(),
        legacyIncludesMnf: mnf >= dateStart.getTime() && mnf <= dateEnd.getTime(),
        newIncludesSnf: snf >= Date.parse(bounds.startIso) && snf <= Date.parse(bounds.endIso),
        newIncludesMnf: mnf >= Date.parse(bounds.startIso) && mnf <= Date.parse(bounds.endIso),
      }))
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: join(__dirname, '../..'),
      env: { ...process.env, TZ: 'America/New_York' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stderr || '').not.toMatch(/Error/)
    const parsed = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1))
    expect(parsed.tz).toBe('America/New_York')
    expect(parsed.legacyIncludesSnf).toBe(false)
    expect(parsed.legacyIncludesMnf).toBe(false)
    expect(parsed.newIncludesSnf).toBe(true)
    expect(parsed.newIncludesMnf).toBe(true)
  })
})

describe('oddsTeamsMatch NFL aliases and full names', () => {
  test('WSH/WAS, LAR/LA, JAX/JAC, and Odds API full names match ESPN abbrs', () => {
    expect(oddsTeamsMatch('NYG', 'WSH', 'New York Giants', 'Washington Commanders', 'nfl')).toBe(true)
    expect(oddsTeamsMatch('NYG', 'WSH', 'New York Giants', 'WAS', 'nfl')).toBe(true)
    expect(oddsTeamsMatch('SEA', 'LAR', 'Seattle Seahawks', 'Los Angeles Rams', 'nfl')).toBe(true)
    expect(oddsTeamsMatch('SEA', 'LAR', 'Seattle Seahawks', 'LA', 'nfl')).toBe(true)
    expect(oddsTeamsMatch('IND', 'JAX', 'Indianapolis Colts', 'Jacksonville Jaguars', 'nfl')).toBe(true)
    expect(oddsTeamsMatch('IND', 'JAX', 'Indianapolis Colts', 'JAC', 'nfl')).toBe(true)
    expect(oddsTeamsMatch('NYG', 'WSH', 'New York Jets', 'Washington Commanders', 'nfl')).toBe(false)
  })

  test('allows reversed home/away from the Odds API', () => {
    expect(oddsTeamsMatch('NYG', 'WSH', 'Washington Commanders', 'New York Giants', 'nfl')).toBe(true)
  })

  test('MLB and NHL feed aliases still match stored ESPN codes', () => {
    expect(oddsTeamsMatch('CHW', 'ATH', 'Chicago White Sox', 'Athletics', 'mlb')).toBe(true)
    expect(oddsTeamsMatch('CHW', 'ATH', 'CWS', 'OAK', 'mlb')).toBe(true)
    expect(oddsTeamsMatch('TBL', 'UTA', 'Tampa Bay Lightning', 'Utah Mammoth', 'nhl')).toBe(true)
  })
})

describe('classifyUnmappedOddsEvent', () => {
  const sunday = dbGame({ away: 'CHI', home: 'MIN', commence: SUN_1PM })

  test('not_in_slate when the matchup is absent from Game', () => {
    expect(classifyUnmappedOddsEvent({
      oddsHome: 'San Francisco 49ers',
      oddsAway: 'Arizona Cardinals',
      sport: 'nfl',
      eventTime: Date.parse(NEXT_THU),
      dbGames: [sunday],
    }).reason).toBe(UNMAPPED_ODDS_REASONS.NOT_IN_SLATE)
  })

  test('team_map_miss when an Odds API name does not resolve', () => {
    expect(classifyUnmappedOddsEvent({
      oddsHome: 'New York Giants',
      oddsAway: 'Atlantis Kraken',
      sport: 'nfl',
      eventTime: Date.parse(TNF),
      dbGames: [sunday],
    }).reason).toBe(UNMAPPED_ODDS_REASONS.TEAM_MAP_MISS)
  })

  test('time_mismatch when the matchup exists but start is outside ±6h', () => {
    expect(classifyUnmappedOddsEvent({
      oddsHome: 'Minnesota Vikings',
      oddsAway: 'Chicago Bears',
      sport: 'nfl',
      eventTime: Date.parse(NEXT_THU),
      dbGames: [sunday],
    }).reason).toBe(UNMAPPED_ODDS_REASONS.TIME_MISMATCH)
  })
})

describe('matchOddsApiEventToGame Wednesday NFL morning', () => {
  const dbGames = THIS_WEEK.map(dbGame)
  const events = [...THIS_WEEK, ...NEXT_WEEK].map(oddsEvent)

  test('every this-week Game row matches, including Sunday and Monday', () => {
    const matched = events.map((event) => matchOddsApiEventToGame({
      event,
      sport: 'nfl',
      date: WEDNESDAY,
      dbGames,
    }))
    const hits = matched.filter((row) => row.game)
    const misses = matched.filter((row) => !row.game)
    expect(dbGames).toHaveLength(14)
    expect(events).toHaveLength(27)
    expect(hits).toHaveLength(14)
    expect(hits.map((row) => row.game.id).sort()).toEqual(dbGames.map((game) => game.id).sort())
    expect(misses).toHaveLength(13)
    expect(misses.every((row) => row.reason === UNMAPPED_ODDS_REASONS.NOT_IN_SLATE)).toBe(true)
  })

  test('Thursday WSH @ NYG and Sunday games fetched earlier in the week both map', () => {
    const thu = matchOddsApiEventToGame({
      event: oddsEvent({ away: 'WSH', home: 'NYG', commence: TNF }),
      sport: 'nfl',
      date: WEDNESDAY,
      dbGames,
    })
    const sun = matchOddsApiEventToGame({
      event: oddsEvent({ away: 'CHI', home: 'MIN', commence: SUN_1PM }),
      sport: 'nfl',
      date: WEDNESDAY,
      dbGames,
    })
    const snf = matchOddsApiEventToGame({
      event: oddsEvent({ away: 'PHI', home: 'DET', commence: SNF }),
      sport: 'nfl',
      date: WEDNESDAY,
      dbGames,
    })
    expect(thu.game.id).toBe('WSH_at_NYG_2026-11-12')
    expect(sun.game.id).toBe('CHI_at_MIN_2026-11-15')
    expect(snf.game.id).toBe('PHI_at_DET_2026-11-15')
  })

  test('unmapped log line and summary distinguish harmless next-week misses', () => {
    const reasons = events.map((event) => matchOddsApiEventToGame({
      event, sport: 'nfl', date: WEDNESDAY, dbGames,
    }).reason).filter(Boolean)
    const line = formatUnmappedOddsEventLine(
      oddsEvent({ away: 'ARI', home: 'SF', commence: NEXT_THU }),
      UNMAPPED_ODDS_REASONS.NOT_IN_SLATE,
    )
    expect(line).toBe('Arizona Cardinals @ San Francisco 49ers (2026-11-20T01:15:00.000Z) reason=not_in_slate')
    expect(summarizeUnmappedOddsReasons(reasons).summary).toBe(
      'Unmapped: 13 (not_in_slate=13)',
    )
  })
})

describe('fetch-live-odds matching wiring', () => {
  const src = readFileSync(join(__dirname, '../../scripts/fetch-live-odds.js'), 'utf8')

  test('uses shared slate bounds and miss reasons, not local setHours windows', () => {
    const mapStart = src.indexOf('async function mapAndSaveEventIds')
    const mapFn = src.slice(mapStart, src.indexOf('\nasync function', mapStart + 1))
    expect(mapFn).toMatch(/oddsEventSlateBounds\(\{ sport, date \}\)/)
    expect(mapFn).toMatch(/matchOddsApiEventToGame/)
    expect(mapFn).toMatch(/formatUnmappedOddsEventLine/)
    expect(mapFn).toMatch(/summarizeUnmappedOddsReasons/)
    expect(mapFn).not.toMatch(/setHours\(/)
    expect(mapFn).not.toMatch(/setDate\(/)
    expect(mapFn).not.toMatch(/not in ESPN data/)

    const propsStart = src.indexOf('async function fetchPlayerProps')
    const propsFn = src.slice(propsStart, src.indexOf('\nasync function', propsStart + 1))
    expect(propsFn).toMatch(/oddsEventSlateBounds\(\{ sport, date \}\)/)
    expect(propsFn).not.toMatch(/setHours\(/)
    expect(propsFn).not.toMatch(/setDate\(/)
  })
})
