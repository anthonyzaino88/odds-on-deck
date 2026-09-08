const fs = require('fs')
const path = require('path')

const picksLib = fs.readFileSync(path.join(__dirname, '../../lib/picks.js'), 'utf8')
const picksPage = fs.readFileSync(path.join(__dirname, '../../app/picks/page.js'), 'utf8')
const picksLayout = fs.readFileSync(path.join(__dirname, '../../app/picks/layout.js'), 'utf8')
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

  test('/picks public copy is plain-English and honest when short or empty', () => {
    expect(picksPage).toMatch(/EditorsPicksDesk/)
    expect(picksPage).toMatch(/props we/)
    expect(picksPage).toMatch(/actually bet/)
    expect(picksPage).not.toMatch(/filterMode/)
    expect(picksPage).not.toMatch(/Pile B/)
    expect(picksPage).not.toMatch(/Published-shaped/)
    expect(picksLayout).toMatch(/Props we'd actually bet/)
    expect(picksLayout).not.toMatch(/Pile B/)
    expect(picksLayout).not.toMatch(/Published-shaped/)
    expect(deskSrc).toMatch(/What makes the list/)
    expect(deskSrc).toMatch(/Nothing we/)
    expect(deskSrc).toMatch(/Just \{picks\.length === 1 \? '1 pick'/)
    expect(deskSrc).not.toMatch(/Pile B/)
    expect(deskSrc).not.toMatch(/Published-shaped/)
    expect(deskSrc).not.toMatch(/no-edge fill/)
    expect(deskSrc).not.toMatch(/NHL/)
  })

  test('API reports the published cohort and does not require a mode to loosen filters', () => {
    expect(picksApi).toMatch(/cohort: 'published'/)
    expect(picksApi).toMatch(/todaysBoardSlateState/)
    expect(picksApi).toMatch(/generateEditorPicks/)
  })
})
