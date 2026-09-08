const fs = require('fs')
const path = require('path')

const picksLib = fs.readFileSync(path.join(__dirname, '../../lib/picks.js'), 'utf8')
const picksPage = fs.readFileSync(path.join(__dirname, '../../app/picks/page.js'), 'utf8')
const picksApi = fs.readFileSync(path.join(__dirname, '../../app/api/picks/route.js'), 'utf8')
const deskSrc = fs.readFileSync(path.join(__dirname, '../../components/EditorsPicksDesk.js'), 'utf8')
const publishedSrc = fs.readFileSync(path.join(__dirname, '../../lib/published-picks.js'), 'utf8')

describe("Editor's desk stays on the Published / Pile B bar", () => {
  test('ranker uses isPublishedEligibleProp — not a looser juice fill', () => {
    expect(publishedSrc).toMatch(/export function isEditorsBoardFill/)
    expect(publishedSrc).toMatch(/return isPublishedEligibleProp\(record, opts\)/)
    expect(publishedSrc).toMatch(/export function rankEditorsPicks/)
    expect(publishedSrc).toMatch(/isPublishedEligibleProp\(record, opts\)/)
  })

  test('generateEditorPicks ranks via selectEditorPicks / rankEditorsPicks', () => {
    expect(picksLib).toMatch(/selectEditorPicks/)
    expect(picksLib).toMatch(/rankEditorsPicks/)
    expect(picksLib).toMatch(/PUBLISHED_SPORTS/)
    expect(picksLib).toMatch(/PUBLISHED_STATS_PREFILTER/)
    expect(picksLib).not.toMatch(/generatePicksFromSupabase\('nhl'/)
    expect(picksLib).not.toMatch(/filterMode === 'all'/)
    expect(picksLib).not.toMatch(/\.gte\('probability', 0\.50\)/)
  })

  test('/picks UI is Published-shaped and honest when short or empty', () => {
    expect(picksPage).toMatch(/EditorsPicksDesk/)
    expect(picksPage).toMatch(/Published-shaped/)
    expect(picksPage).not.toMatch(/filterMode/)
    expect(deskSrc).toMatch(/Published-shaped bar/)
    expect(deskSrc).toMatch(/Short slate/)
    expect(deskSrc).toMatch(/juice favorites/)
    expect(deskSrc).not.toMatch(/NHL/)
  })

  test('API reports the published cohort and does not require a mode to loosen filters', () => {
    expect(picksApi).toMatch(/cohort: 'published'/)
    expect(picksApi).toMatch(/todaysBoardSlateState/)
    expect(picksApi).toMatch(/generateEditorPicks/)
  })
})
