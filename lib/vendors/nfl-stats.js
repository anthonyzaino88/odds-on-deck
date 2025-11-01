// NFL-specific stats functions using ESPN API

const ESPN_NFL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'

/**
 * Fetch NFL schedule from ESPN
 * @param {number|null} week - Week number (1-18), or null for current week
 * @param {number|null} seasonYear - Season year, or null for current year
 */
export async function fetchNFLSchedule(week = null, seasonYear = null) {
  try {
    // If no week specified, fetch current scoreboard which shows the current/upcoming week
    let url = `${ESPN_NFL_BASE}/scoreboard`
    
    // Add season year if specified
    if (seasonYear) {
      url += `?seasontype=2&seasonYear=${seasonYear}` // seasontype=2 is regular season
      if (week) {
        url += `&week=${week}`
      }
    } else if (week) {
      url += `?week=${week}&seasontype=2`
    }
    
    console.log(`Fetching NFL schedule from: ${url}`)
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NFL API error: ${res.status}`)
    }
    
    const data = await res.json()
    
    // Log the current week from the API response
    const currentWeek = data.week?.number || data.week || 'unknown'
    console.log(`ESPN API returned week ${currentWeek} games`)
    
    return mapNFLScheduleData(data)
  } catch (error) {
    console.error('Failed to fetch NFL schedule:', error)
    return []
  }
}

/**
 * Fetch NFL game detail with live data
 */
export async function fetchNFLGameDetail(gameId) {
  try {
    const url = `${ESPN_NFL_BASE}/summary?event=${gameId}`
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NFL API error: ${res.status}`)
    }
    
    const data = await res.json()
    return mapNFLGameDetail(data)
  } catch (error) {
    console.error(`Failed to fetch NFL game detail for ${gameId}:`, error)
    return null
  }
}

/**
 * Fetch NFL teams from ESPN
 */
export async function fetchNFLTeams() {
  try {
    const url = `${ESPN_NFL_BASE}/teams`
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NFL API error: ${res.status}`)
    }
    
    const data = await res.json()
    const teams = data.sports?.[0]?.leagues?.[0]?.teams?.map(t => ({
      id: `NFL_${t.team.id}`,
      name: t.team.displayName,
      abbr: t.team.abbreviation,
      sport: 'nfl',
      league: t.team.groups?.type === 'conference' ? t.team.groups.abbreviation : null
    })) || []
    
    console.log(`Mapped ${teams.length} NFL teams`)
    return teams
  } catch (error) {
    console.error('Failed to fetch NFL teams:', error)
    return []
  }
}

/**
 * Map ESPN NFL schedule data to our format
 */
function mapNFLScheduleData(data) {
  const games = []
  
  try {
    const events = data.events || []
    
    for (const event of events) {
      const competition = event.competitions?.[0]
      if (!competition) continue
      
      const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')
      const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')
      
      if (!homeTeam || !awayTeam) continue
      
      games.push({
        id: `${awayTeam.team.abbreviation}_at_${homeTeam.team.abbreviation}_${event.date?.split('T')[0]}`,
        espnGameId: event.id,
        date: new Date(event.date),
        homeId: homeTeam.team.id || homeTeam.team.abbreviation.toLowerCase(),
        awayId: awayTeam.team.id || awayTeam.team.abbreviation.toLowerCase(),
        status: mapNFLStatus(competition.status),
        homeScore: parseInt(homeTeam.score) || null,
        awayScore: parseInt(awayTeam.score) || null,
        week: event.week?.number || null,
        season: event.season?.year?.toString() || '2025',
        sport: 'nfl'
      })
    }
  } catch (error) {
    console.error('Error mapping NFL schedule data:', error)
  }
  
  return games
}

/**
 * Map ESPN NFL game detail to our format
 */
function mapNFLGameDetail(data) {
  try {
    const header = data.header
    const competition = header?.competitions?.[0]
    
    if (!competition) return null
    
    const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')
    const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')
    
    return {
      espnGameId: header.id,
      status: mapNFLStatus(competition.status),
      homeScore: parseInt(homeTeam?.score) || null,
      awayScore: parseInt(awayTeam?.score) || null,
      lastUpdate: new Date()
    }
  } catch (error) {
    console.error('Error mapping NFL game detail:', error)
    return null
  }
}

/**
 * Map ESPN status to our internal status
 */
export function mapNFLStatus(status) {
  const typeDetail = status?.type?.detail?.toLowerCase() || ''
  const state = status?.type?.state?.toLowerCase() || ''
  
  if (state === 'pre') {
    return 'scheduled'
  } else if (state === 'in') {
    if (typeDetail.includes('halftime')) {
      return 'halftime'
    }
    return 'in_progress'
  } else if (state === 'post') {
    return 'final'
  } else if (typeDetail.includes('postponed') || typeDetail.includes('delayed')) {
    return 'postponed'
  }
  
  return 'scheduled'
}
