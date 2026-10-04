import { readFileSync } from 'fs'
import { join } from 'path'
import {
  GAME_LINE_SPORTS,
  PUBLISHED_GAME_LINE_SPORTS,
  unpublishedGameLineSports,
} from '../../lib/game-lines.js'

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('MLB game-line public kill switch wiring', () => {
  test('record-game-lines records only published sports and logs the MLB skip', () => {
    const script = read('scripts/record-game-lines.js')
    expect(script).toMatch(/PUBLISHED_GAME_LINE_SPORTS/)
    expect(script).toMatch(/unpublishedGameLineSports/)
    expect(script).toMatch(/Skipping unpublished game-line sports/)
    expect(script).toMatch(/PUBLISHED_GAME_LINE_SPORTS\.map/)
    expect(script).not.toMatch(/(?<!PUBLISHED_)GAME_LINE_SPORTS\.map/)
    expect(unpublishedGameLineSports()).toEqual(['mlb'])
    expect(PUBLISHED_GAME_LINE_SPORTS).not.toContain('mlb')
    expect(GAME_LINE_SPORTS).toContain('mlb')
  })

  test('public picks and persist paths apply the kill switch', () => {
    const picks = read('lib/picks.js')
    expect(picks).toMatch(/PUBLISHED_GAME_LINE_SPORTS\.map/)
    expect(picks).toMatch(/if \(!isPublishedGameLineSport\(game\?\.sport\)\) return \[\]/)

    const validation = read('lib/validation.js')
    expect(validation).toMatch(/isPublishedGameLineSport\(line\.sport\)/)
    expect(validation).toMatch(/gameLineValidationWritePlan/)
    expect(validation).toMatch(/publicEligibilityAllows/)
    expect(validation).not.toMatch(/isPublishedGameLineSport\(row/)
    expect(validation).toMatch(/gradePendingGameLines/)
  })

  test('MLB game page hides pick-like totals / moneyline edge copy', () => {
    const page = read('app/game/[id]/page.js')
    expect(page).toMatch(/isPublishedGameLineSport/)
    expect(page).toMatch(/if \(edge && isPublishedGameLineSport\(game\.sport\)\)/)
    expect(page).toMatch(/showModelEdges/)
  })
})
