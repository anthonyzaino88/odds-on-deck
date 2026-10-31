import {
  MLB_TEAM_CODE_ALIASES,
  MLB_TEAM_NAMES,
  canonicalizeMlbAbbr,
  createGameId,
  espnEventSeasonYear,
  getTeamAbbr,
  getTeamName,
  lookupByMlbAbbr,
  mlbTeamCodesEqual,
  resolveMlbTeamCode,
} from '../../lib/team-mapping.js'

describe('espnEventSeasonYear', () => {
  test('reads event.season.year for Game.season ingest', () => {
    expect(espnEventSeasonYear({ season: { year: 2026, type: 2 } })).toBe('2026')
    expect(espnEventSeasonYear({ season: { year: 2027, type: 1 } })).toBe('2027')
    expect(espnEventSeasonYear({ season: 2026 })).toBe('2026')
    expect(espnEventSeasonYear({})).toBeNull()
    expect(espnEventSeasonYear(null)).toBeNull()
  })
})

describe('MLB stored team codes ATH/CHW', () => {
  test('name map stores ESPN codes, not OAK/CWS', () => {
    expect(MLB_TEAM_NAMES['Chicago White Sox']).toBe('CHW')
    expect(MLB_TEAM_NAMES.Athletics).toBe('ATH')
    expect(MLB_TEAM_NAMES['Oakland Athletics']).toBe('ATH')
    expect(getTeamAbbr('Chicago White Sox')).toBe('CHW')
    expect(getTeamAbbr('Athletics')).toBe('ATH')
  })

  test('alias table maps ATH↔OAK and CHW↔CWS onto stored codes', () => {
    expect(MLB_TEAM_CODE_ALIASES.OAK).toBe('ATH')
    expect(MLB_TEAM_CODE_ALIASES.ATH).toBe('ATH')
    expect(MLB_TEAM_CODE_ALIASES.CWS).toBe('CHW')
    expect(MLB_TEAM_CODE_ALIASES.CHW).toBe('CHW')
    expect(canonicalizeMlbAbbr('oak')).toBe('ATH')
    expect(canonicalizeMlbAbbr('CWS')).toBe('CHW')
    expect(canonicalizeMlbAbbr('MLB_OAK')).toBe('ATH')
    expect(resolveMlbTeamCode('OAK')).toBe('ATH')
    expect(resolveMlbTeamCode('Chicago White Sox')).toBe('CHW')
    expect(mlbTeamCodesEqual('OAK', 'ATH')).toBe(true)
    expect(mlbTeamCodesEqual('CWS', 'CHW')).toBe(true)
    expect(mlbTeamCodesEqual('OAK', 'CHW')).toBe(false)
    expect(getTeamName('OAK')).toBe('Oakland Athletics')
    expect(getTeamName('CWS')).toBe('Chicago White Sox')
  })

  test('createGameId writes ATH/CHW even when the input is OAK/CWS', () => {
    expect(createGameId('Athletics', 'Texas Rangers', '2026-04-26'))
      .toBe('ATH_at_TEX_2026-04-26')
    expect(createGameId('OAK', 'TEX', '2026-04-26'))
      .toBe('ATH_at_TEX_2026-04-26')
    expect(createGameId('Chicago White Sox', 'Houston Astros', '2026-04-20'))
      .toBe('CHW_at_HOU_2026-04-20')
    expect(createGameId('CWS', 'HOU', '2026-04-20'))
      .toBe('CHW_at_HOU_2026-04-20')
  })

  test('lookups accept either historical or stored codes', () => {
    const parks = { ATH: 0.93, CHW: 1.01 }
    expect(lookupByMlbAbbr(parks, 'OAK')).toBe(0.93)
    expect(lookupByMlbAbbr(parks, 'CWS')).toBe(1.01)
    expect(lookupByMlbAbbr(parks, 'ATH')).toBe(0.93)
  })
})
