// Test if fetch works in Vercel environment
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    console.log('Testing fetch to ESPN NFL API...')
    
    const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams'
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    console.log('Response status:', res.status)
    console.log('Response OK:', res.ok)
    
    if (!res.ok) {
      return Response.json({
        success: false,
        error: `HTTP ${res.status}`,
        url
      })
    }
    
    const data = await res.json()
    console.log('Data received, sports length:', data.sports?.length)
    
    const teams = data.sports?.[0]?.leagues?.[0]?.teams || []
    console.log('Teams found:', teams.length)
    
    return Response.json({
      success: true,
      teamsFound: teams.length,
      sampleTeam: teams[0]?.team ? {
        id: teams[0].team.id,
        name: teams[0].team.displayName,
        abbr: teams[0].team.abbreviation
      } : null,
      dataStructure: {
        hasSports: !!data.sports,
        hasLeagues: !!data.sports?.[0]?.leagues,
        hasTeams: !!data.sports?.[0]?.leagues?.[0]?.teams
      }
    })
  } catch (error) {
    console.error('Fetch error:', error)
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

