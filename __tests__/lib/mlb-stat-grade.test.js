import {
  isMlbPitcherProp,
  lookupMlbPlayerStat,
  mlbBatterAppeared,
  mlbPitcherAppeared,
  parseMlbBoxscorePlayers,
  planMlbPlayerStatGrade,
  toLegacyMlbPlayerStatsMap,
} from '../../lib/mlb-stat-grade.js'
import { gradePropFromActual, planPlayerAppearanceGrade } from '../../lib/player-stat-grade.js'
import { getPlayerGameStat, lookupPlayerGameStat } from '../../lib/vendors/mlb-game-stats.js'
import { mlbBoxscoreFixture } from '../fixtures/mlb-boxscore.fixture.js'

const players = parseMlbBoxscorePlayers(mlbBoxscoreFixture())

describe('MLB appearance vs empty stat line', () => {
  test('empty batting {} is not an appearance — DNP voids, not actual 0', () => {
    expect(mlbBatterAppeared({})).toBe(false)
    expect(players['Vinnie Pasquantino'].batting).toBeNull()
    expect(lookupMlbPlayerStat(players, 'Vinnie Pasquantino', 'batter_hits')).toMatchObject({
      didNotPlay: true,
      reason: 'no_plate_appearances',
      matchStatus: 'matched',
      value: null,
    })
    expect(planMlbPlayerStatGrade(players, 'Christian Walker', 'batter_runs_scored')).toEqual({
      action: 'void',
      reason: 'no_plate_appearances',
    })
  })

  test('defensive sub with a batting object but 0 PA still voids batter props', () => {
    expect(players['Nick Allen'].plateAppearances).toBe(0)
    expect(planMlbPlayerStatGrade(players, 'Nick Allen', 'batter_hits').action).toBe('void')
  })

  test('a real 0 (PA > 0, 0 hits) grades as a loss on the over', () => {
    const lookup = lookupMlbPlayerStat(players, 'Cam Smith', 'batter_hits')
    expect(lookup).toMatchObject({
      didNotPlay: false,
      value: 0,
      plateAppearances: 4,
      matchStatus: 'matched',
    })
    expect(planPlayerAppearanceGrade(lookup)).toEqual({
      action: 'grade',
      reason: 'appeared',
      actualValue: 0,
    })
    expect(gradePropFromActual('over', 0.5, 0)).toBe('incorrect')
    expect(gradePropFromActual('under', 0.5, 0)).toBe('correct')
  })

  test('pitcher with no batters faced voids; 0 K with BF > 0 grades', () => {
    expect(isMlbPitcherProp('pitcher_strikeouts')).toBe(true)
    expect(isMlbPitcherProp('batter_hits')).toBe(false)
    expect(mlbPitcherAppeared({})).toBe(false)

    expect(lookupMlbPlayerStat(players, 'Tomoyuki Sugano', 'pitcher_strikeouts')).toMatchObject({
      didNotPlay: true,
      reason: 'no_batters_faced',
    })
    expect(planMlbPlayerStatGrade(players, 'Hunter Brown', 'pitcher_strikeouts').action).toBe('void')

    const hader = lookupMlbPlayerStat(players, 'Josh Hader', 'pitcher_strikeouts')
    expect(hader).toMatchObject({ didNotPlay: false, value: 0, battersFaced: 3 })
    expect(gradePropFromActual('over', 0.5, hader.value)).toBe('incorrect')
    expect(gradePropFromActual('under', 1.5, hader.value)).toBe('correct')
  })

  test('player missing from the box score is treated as DNP (not in box)', () => {
    expect(lookupMlbPlayerStat(players, 'Nobody Fake', 'batter_hits')).toMatchObject({
      didNotPlay: true,
      reason: 'not_in_box',
      matchStatus: 'unmatched',
    })
  })

  test('accent-insensitive name match still sees a bench DNP', () => {
    expect(lookupMlbPlayerStat(players, 'Maikel Garcia', 'batter_total_bases').didNotPlay).toBe(true)
  })

  test('legacy map omits empty-line DNP players and keeps real zeros', () => {
    const map = toLegacyMlbPlayerStatsMap(players)
    expect(map['Vinnie Pasquantino']).toBeUndefined()
    expect(map['Cam Smith'].hits).toBe(0)
    expect(map['Josh Hader'].strikeouts).toBe(0)
    expect(map['Yordan Alvarez'].hits).toBe(2)
  })
})

describe('getPlayerGameStat does not coerce DNP to 0', () => {
  function mockFetch(payload) {
    return jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    }))
  }

  test('DNP returns null; appeared 0 returns 0', async () => {
    const fetchImpl = mockFetch(mlbBoxscoreFixture())
    expect(await getPlayerGameStat('824141', 'Vinnie Pasquantino', 'batter_hits', { fetchImpl }))
      .toBeNull()
    expect(await getPlayerGameStat('824141', 'Cam Smith', 'batter_hits', { fetchImpl }))
      .toBe(0)
    expect(await getPlayerGameStat('824141', 'Tomoyuki Sugano', 'pitcher_strikeouts', { fetchImpl }))
      .toBeNull()
    expect(await getPlayerGameStat('824141', 'Josh Hader', 'pitcher_strikeouts', { fetchImpl }))
      .toBe(0)

    const dnp = await lookupPlayerGameStat('824141', 'Christian Walker', 'batter_runs_scored', { fetchImpl })
    expect(dnp.didNotPlay).toBe(true)
    expect(dnp.value).toBeNull()
  })
})
