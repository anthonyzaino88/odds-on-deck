import { readFileSync } from 'fs'
import { join } from 'path'
import {
  espnHomeAwayCompetitors,
  mapEspnTypeState,
  parseEspnScore,
} from '../../lib/espn-scoreboard.js'
import { mapNHLGameDetail } from '../../lib/vendors/nhl-stats.js'
import { mapNFLGameDetail } from '../../lib/vendors/nfl-stats.js'
import { buildScoreUpdate } from '../../lib/score-updater.js'

function headerDetail({ homeScore, awayScore, homeFirst = false, statusName = 'STATUS_FINAL' }) {
  const home = { homeAway: 'home', score: homeScore, team: { abbreviation: 'BOS' } }
  const away = { homeAway: 'away', score: awayScore, team: { abbreviation: 'CAR' } }
  return {
    header: {
      id: '401772001',
      competitions: [{
        competitors: homeFirst ? [home, away] : [away, home],
        status: { type: { name: statusName, state: 'post', completed: true } },
      }],
    },
  }
}

describe('parseEspnScore keeps a shutout zero', () => {
  test('Number.isFinite keeps 0 and drops junk', () => {
    expect(parseEspnScore(0)).toBe(0)
    expect(parseEspnScore('0')).toBe(0)
    expect(parseEspnScore(3)).toBe(3)
    expect(parseEspnScore('')).toBeNull()
    expect(parseEspnScore(null)).toBeNull()
    expect(parseEspnScore('final')).toBeNull()
  })

  test('pre-game 0 stays null; live and final keep a real 0', () => {
    expect(parseEspnScore(0, { status: 'scheduled' })).toBeNull()
    expect(parseEspnScore('0', { status: 'pre_game' })).toBeNull()
    expect(parseEspnScore(0, { status: 'in_progress' })).toBe(0)
    expect(parseEspnScore('0', { status: 'final' })).toBe(0)
    expect(parseEspnScore(0, { status: { type: { name: 'STATUS_FINAL', completed: true } } })).toBe(0)
  })
})

describe('espnHomeAwayCompetitors', () => {
  test('uses homeAway, not competitors[0]', () => {
    const awayFirst = {
      competitors: [
        { homeAway: 'away', team: { abbreviation: 'CAR' }, score: '0' },
        { homeAway: 'home', team: { abbreviation: 'GB' }, score: '27' },
      ],
    }
    const { home, away } = espnHomeAwayCompetitors(awayFirst)
    expect(home.team.abbreviation).toBe('GB')
    expect(away.team.abbreviation).toBe('CAR')
    expect(parseEspnScore(home.score)).toBe(27)
    expect(parseEspnScore(away.score)).toBe(0)
  })

  test('falls back to index order when homeAway is missing', () => {
    const unlabeled = {
      competitors: [
        { team: { abbreviation: 'GB' }, score: '27' },
        { team: { abbreviation: 'CAR' }, score: '0' },
      ],
    }
    const { home, away } = espnHomeAwayCompetitors(unlabeled)
    expect(home.team.abbreviation).toBe('GB')
    expect(away.team.abbreviation).toBe('CAR')
  })
})

describe('NHL / NFL detail mappers keep a 0-N shutout', () => {
  test('mapNHLGameDetail writes 0, not null', () => {
    const mapped = mapNHLGameDetail(headerDetail({ homeScore: '0', awayScore: '4' }))
    expect(mapped.homeScore).toBe(0)
    expect(mapped.awayScore).toBe(4)
  })

  test('mapNFLGameDetail writes 0, not null', () => {
    const mapped = mapNFLGameDetail(headerDetail({ homeScore: 16, awayScore: 0 }))
    expect(mapped.homeScore).toBe(16)
    expect(mapped.awayScore).toBe(0)
  })
})

describe('score-updater writes the shutout zero', () => {
  test('buildScoreUpdate keeps homeScore 0 from live data', () => {
    const plan = buildScoreUpdate({
      game: {
        id: 'CAR_at_GB_2026-10-29',
        status: 'in_progress',
        date: '2026-10-29T23:15:00.000Z',
        homeScore: null,
        awayScore: null,
      },
      liveData: { status: 'final', homeScore: 0, awayScore: 4 },
      sport: 'nhl',
      now: Date.parse('2026-10-29T23:45:00.000Z'),
    })
    expect(plan.updateData.homeScore).toBe(0)
    expect(plan.updateData.awayScore).toBe(4)
    expect(plan.updateData.status).toBe('final')
  })
})

describe('fetch-fresh-games scoreboard mapping', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')

  test('home/away come from homeAway and NFL maps STATUS_END_PERIOD', () => {
    expect(src).toMatch(/espnHomeAwayCompetitors/)
    expect(src).not.toMatch(/competitors\?\.\[0\]/)
    expect(src).toMatch(/'STATUS_END_PERIOD': 'in_progress'/)
    expect(src).toMatch(/mapEspnTypeState\(event\.status\?\.type\?\.state\)/)
    expect(src).toMatch(/parseEspnScore\(home\?\.score,\s*\{\s*status:\s*gameStatus\s*\}\)/)
    expect(mapEspnTypeState('in')).toBe('in_progress')
    expect(mapEspnTypeState('pre')).toBe('scheduled')
  })
})
