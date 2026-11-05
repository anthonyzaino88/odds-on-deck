import { readFileSync } from 'fs'
import { join } from 'path'
import {
  canonicalMlbTeamAbbr,
  gameIdHasLegacyMlbAbbr,
  remapLegacyMlbGameId,
  summarizeLegacyMlbAbbrRows,
} from '../../lib/mlb-abbr-backfill.js'

describe('legacy MLB OAK/CWS leftovers', () => {
  test('detects and remaps Team.abbr and Game.id without touching NFL OAK', () => {
    expect(canonicalMlbTeamAbbr('OAK')).toBe('ATH')
    expect(canonicalMlbTeamAbbr('CWS')).toBe('CHW')
    expect(gameIdHasLegacyMlbAbbr('OAK_at_TEX_2026-04-26')).toBe(true)
    expect(gameIdHasLegacyMlbAbbr('HOU_at_CWS_2026-04-20')).toBe(true)
    expect(gameIdHasLegacyMlbAbbr('ATH_at_TEX_2026-04-26')).toBe(false)
    expect(remapLegacyMlbGameId('OAK_at_TEX_2026-04-26')).toBe('ATH_at_TEX_2026-04-26')
    expect(remapLegacyMlbGameId('CHW_at_HOU_2026-10-30_if_necessary')).toBe(
      'CHW_at_HOU_2026-10-30_if_necessary',
    )

    const summary = summarizeLegacyMlbAbbrRows({
      teams: [
        { id: '133', name: 'Athletics', abbr: 'OAK', sport: 'mlb' },
        { id: '145', name: 'White Sox', abbr: 'CWS', sport: 'mlb' },
        { id: 'raiders', name: 'Raiders', abbr: 'OAK', sport: 'nfl' },
        { id: '11', name: 'Athletics', abbr: 'ATH', sport: 'mlb' },
      ],
      games: [
        { id: 'OAK_at_TEX_2026-04-26', sport: 'mlb' },
        { id: 'ATH_at_TEX_2026-04-27', sport: 'mlb' },
        { id: 'LV_at_OAK_2026-09-13', sport: 'nfl' },
      ],
    })
    expect(summary.teamCount).toBe(2)
    expect(summary.gameCount).toBe(1)
    expect(summary.teams.map((row) => row.nextAbbr)).toEqual(['ATH', 'CHW'])
    expect(summary.games[0].nextId).toBe('ATH_at_TEX_2026-04-26')
  })

  test('report script and docs are read-only; SQL is Anthony-only', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/report-mlb-legacy-abbr.js'), 'utf8')
    expect(script).toMatch(/Does not write/)
    expect(script).toMatch(/Anthony's OK/)
    expect(script).not.toMatch(/\.update\(/)
    expect(script).not.toMatch(/the-odds-api|ODDS_API_KEY/)
    const docs = readFileSync(join(process.cwd(), 'docs/mlb-ath-chw-backfill.md'), 'utf8')
    expect(docs).toMatch(/Do not run this SQL from CI/)
    expect(docs).toMatch(/Anthony's OK/)
    expect(docs).toMatch(/UPDATE "Team" SET abbr = 'ATH'/)
    expect(docs).toMatch(/UPDATE "Team" SET abbr = 'CHW'/)
    expect(docs).toMatch(/ROLLBACK/)
  })
})
