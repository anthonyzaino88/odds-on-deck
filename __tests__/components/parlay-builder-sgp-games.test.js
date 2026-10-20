/**
 * @jest-environment node
 */
import {
  nextParlayBuilderGameId,
  parlayBuilderGamesForSport,
} from '../../lib/parlay-builder-games.js'

const mlbNoon = { id: 'NYY_at_BOS_2026-10-18', sport: 'mlb', status: 'scheduled' }
const mlbWarmup = { id: 'CLE_at_DET_2026-10-18', sport: 'mlb', status: 'warmup' }
const mlbLive = { id: 'CHC_at_STL_2026-10-18', sport: 'mlb', status: 'in_progress' }
const mlbFinal = { id: 'LAD_at_SDP_2026-10-18', sport: 'mlb', status: 'final' }
const mlbRetired = { id: 'CLE_at_TB_2026-10-20', sport: 'mlb', status: 'not_needed' }
const nflKick = { id: 'KC_at_BUF_2026-10-18', sport: 'nfl', status: 'pre_game' }
const nflHalf = { id: 'DAL_at_PHI_2026-10-18', sport: 'nfl', status: 'halftime' }

const cache = {
  mlb: [mlbNoon, mlbWarmup, mlbLive, mlbFinal, mlbRetired],
  nfl: [nflKick, nflHalf],
  nhl: [],
}

describe('ParlayBuilder SGP game list', () => {
  test('lists pre-start games for the selected sport, including warmup', () => {
    expect(parlayBuilderGamesForSport(cache, 'mlb').map((g) => g.id)).toEqual([
      mlbNoon.id,
      mlbWarmup.id,
    ])
    expect(parlayBuilderGamesForSport(cache, 'nfl').map((g) => g.id)).toEqual([
      nflKick.id,
    ])
    expect(parlayBuilderGamesForSport(cache, 'mlb').map((g) => g.id)).not.toContain(mlbRetired.id)
  })

  test('switching sport/type resets selectedGameId when it is not in the new list', () => {
    const mlbGames = parlayBuilderGamesForSport(cache, 'mlb')
    const nflGames = parlayBuilderGamesForSport(cache, 'nfl')

    expect(nextParlayBuilderGameId(mlbGames, '')).toBe(mlbNoon.id)
    expect(nextParlayBuilderGameId(mlbGames, mlbNoon.id)).toBe(mlbNoon.id)
    expect(nextParlayBuilderGameId(nflGames, mlbNoon.id)).toBe(nflKick.id)
    expect(nextParlayBuilderGameId([], mlbNoon.id)).toBe('')
  })
})
