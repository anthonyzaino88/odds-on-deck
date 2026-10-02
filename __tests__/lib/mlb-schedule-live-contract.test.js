import {
  buildHydratedScheduleUrl,
  extractLinescorePayloadFromScheduleGame,
  fetchLiveGameData,
  fetchLiveGamesByDateRange,
  lookupMlbLiveByPk,
  mapHydratedScheduleGames,
  mapLiveGameData,
  mlbScheduleDateWindow,
  pickScheduleGameForPk,
} from '../../lib/vendors/stats.js'
import { resolveMlbLinescoreStatus } from '../../lib/mlb-live-status.js'
import {
  LINESCORE_ONLY_TOR_BAL,
  SCHEDULE_GAME_LAA_ATH_LIVE,
  SCHEDULE_GAME_TOR_BAL_FINAL,
  SCHEDULE_GAME_TOR_BAL_POSTPONED,
  SCHEDULE_HYDRATE_2026_09_23,
  SCHEDULE_HYDRATE_GAMEPK_824785,
  TOR_BAL_GAME_PK,
} from '../fixtures/mlb-schedule-linescore.fixture.js'

describe('hydrated schedule fetch contract', () => {
  test('date and gamePk URLs use schedule?hydrate=linescore, never linescore or feed/live', () => {
    const byDate = buildHydratedScheduleUrl({ date: '2026-09-23' })
    const byRange = buildHydratedScheduleUrl({ startDate: '2026-09-22', endDate: '2026-09-23' })
    const byPk = buildHydratedScheduleUrl({ gamePk: TOR_BAL_GAME_PK })

    for (const url of [byDate, byRange, byPk]) {
      expect(url).toContain('/api/v1/schedule?')
      expect(url).toContain('hydrate=linescore')
      expect(url).toContain('sportId=1')
      expect(url).not.toContain('/game/')
      expect(url).not.toContain('feed/live')
      expect(url).not.toMatch(/\/linescore$/)
    }

    expect(byDate).toContain('date=2026-09-23')
    expect(byRange).toContain('startDate=2026-09-22')
    expect(byRange).toContain('endDate=2026-09-23')
    expect(byPk).toContain(`gamePk=${TOR_BAL_GAME_PK}`)
  })

  test('schedule game has status; nested linescore does not — mapper still sees Final', () => {
    const game = SCHEDULE_GAME_TOR_BAL_FINAL
    expect(game.status.codedGameState).toBe('F')
    expect(game.linescore.status).toBeUndefined()

    const payload = extractLinescorePayloadFromScheduleGame(game)
    expect(payload.status).toEqual(game.status)
    expect(payload.currentInning).toBe(9)
    expect(payload.outs).toBe(3)
    expect(payload.balls).toBe(2)
    expect(payload.strikes).toBe(3)

    expect(resolveMlbLinescoreStatus(payload)).toBe('final')
    expect(mapLiveGameData(payload).status).toBe('final')
    expect(mapLiveGameData(game).status).toBe('final')
  })

  test('raw /game/{pk}/linescore shape (no status) cannot pass as in_progress', () => {
    expect(Object.prototype.hasOwnProperty.call(LINESCORE_ONLY_TOR_BAL, 'status')).toBe(false)
    expect(resolveMlbLinescoreStatus(LINESCORE_ONLY_TOR_BAL)).toBe('unknown')
    expect(mapLiveGameData(LINESCORE_ONLY_TOR_BAL).status).toBe('unknown')
  })

  test('gamePk lookup prefers the played Final over the rain postponement', () => {
    const picked = pickScheduleGameForPk(SCHEDULE_HYDRATE_GAMEPK_824785, TOR_BAL_GAME_PK)
    expect(picked).toBe(SCHEDULE_GAME_TOR_BAL_FINAL)
    expect(picked.status.detailedState).toBe('Final')
    expect(mapLiveGameData(extractLinescorePayloadFromScheduleGame(picked)).status).toBe('final')
  })

  test('date-range mapper keeps Final for a gamePk that also has a postponed twin', () => {
    const range = {
      dates: [
        { date: '2026-09-22', games: [SCHEDULE_GAME_TOR_BAL_POSTPONED] },
        ...SCHEDULE_HYDRATE_2026_09_23.dates,
      ],
    }
    const mapped = mapHydratedScheduleGames(range)
    expect(mapped.get(String(TOR_BAL_GAME_PK)).status).toBe('final')
    expect(mapped.get(String(SCHEDULE_GAME_LAA_ATH_LIVE.gamePk)).status).toBe('in_progress')
  })

  test('mlbScheduleDateWindow pads a day on each side of game dates', () => {
    expect(mlbScheduleDateWindow([
      { date: '2026-09-23T17:35:00.000Z' },
      { date: '2026-09-22T22:35:00.000Z' },
    ])).toEqual({
      startDate: '2026-09-21',
      endDate: '2026-09-24',
    })
  })
})

describe('fetch path uses the hydrated schedule mapper', () => {
  beforeEach(() => {
    global.fetch.mockReset()
  })

  test('fetchLiveGameData requests schedule?gamePk and maps Final', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => SCHEDULE_HYDRATE_GAMEPK_824785,
    })

    const live = await fetchLiveGameData(TOR_BAL_GAME_PK, true)
    expect(live.status).toBe('final')
    expect(live.homeScore).toBe(4)
    expect(live.awayScore).toBe(2)

    const requested = global.fetch.mock.calls[0][0]
    expect(requested).toBe(buildHydratedScheduleUrl({ gamePk: TOR_BAL_GAME_PK }))
    expect(requested).not.toContain('/game/824785/linescore')
    expect(requested).not.toContain('feed/live')
  })

  test('fetchLiveGamesByDateRange is one schedule call and maps the date slate', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => SCHEDULE_HYDRATE_2026_09_23,
    })

    const byPk = await fetchLiveGamesByDateRange('2026-09-23', '2026-09-23', true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch.mock.calls[0][0]).toBe(
      buildHydratedScheduleUrl({ startDate: '2026-09-23', endDate: '2026-09-23' })
    )
    expect(byPk.get(String(TOR_BAL_GAME_PK)).status).toBe('final')
    expect(byPk.get(String(SCHEDULE_GAME_LAA_ATH_LIVE.gamePk)).status).toBe('in_progress')
  })

  test('lookupMlbLiveByPk reports found:false when the gamePk is absent', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dates: [] }),
    })
    const lookup = await lookupMlbLiveByPk('830001', true)
    expect(lookup.found).toBe(false)
    expect(lookup.liveData).toBeNull()
    expect(lookup.error).toBeNull()
  })
})
