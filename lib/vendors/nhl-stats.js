// NHL-specific stats functions using ESPN API

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Fetch NHL schedule from ESPN
 * @param {string|null} date - Date string (YYYY-MM-DD), or null for today
 */
export async function fetchNHLSchedule(date = null) {
  try {
    // If no date specified, fetch current scoreboard
    let url = `${ESPN_NHL_BASE}/scoreboard`
    
    if (date) {
      url += `?dates=${date.replace(/-/g, '')}`
    }
    
    console.log(`Fetching NHL schedule from: ${url}`)
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NHL API error: ${res.status}`)
    }
    
    const data = await res.json()
    
    console.log(`ESPN API returned ${data.events?.length || 0} NHL games`)
    
    return mapNHLScheduleData(data)
  } catch (error) {
    console.error('Failed to fetch NHL schedule:', error)
    return []
  }
}

/**
 * Fetch NHL game detail with live data
 */
export async function fetchNHLGameDetail(gameId) {
  try {
    const url = `${ESPN_NHL_BASE}/summary?event=${gameId}`
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NHL API error: ${res.status}`)
    }
    
    const data = await res.json()
    return mapNHLGameDetail(data)
  } catch (error) {
    console.error('Failed to fetch NHL game detail:', error)
    return null
  }
}

/**
 * Fetch NHL teams
 */
export async function fetchNHLTeams() {
  try {
    const url = `${ESPN_NHL_BASE}/teams?limit=100`
    
    console.log(`Fetching NHL teams from: ${url}`)
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NHL API error: ${res.status}`)
    }
    
    const data = await res.json()
    
    const teams = data.sports?.[0]?.leagues?.[0]?.teams || []
    
    return teams.map(item => {
      const team = item.team
      return {
        id: `NHL_${team.id}`, // Prefix with NHL_ to avoid conflicts
        name: team.displayName,
        abbr: team.abbreviation,
        sport: 'nhl',
        league: team.groups?.leagues?.[0]?.shortName || null, // Eastern/Western
        division: team.groups?.leagues?.[0]?.groupings?.[0]?.name || null
      }
    })
  } catch (error) {
    console.error('Failed to fetch NHL teams:', error)
    return []
  }
}

/**
 * Map ESPN NHL schedule data to our format
 */
function mapNHLScheduleData(data) {
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
        // Prefix ESPN IDs with NHL_ to match our team IDs
        homeId: `NHL_${homeTeam.team.id}`,
        awayId: `NHL_${awayTeam.team.id}`,
        status: mapNHLStatus(competition.status),
        homeScore: parseInt(homeTeam.score) || null,
        awayScore: parseInt(awayTeam.score) || null,
        // Note: period is not in the Game model, skip it for now
        season: event.season?.year?.toString() || '2026',
        sport: 'nhl'
      })
    }
  } catch (error) {
    console.error('Error mapping NHL schedule data:', error)
  }
  
  return games
}

/**
 * Map ESPN NHL game detail to our format
 */
function mapNHLGameDetail(data) {
  try {
    const header = data.header
    const competition = header?.competitions?.[0]
    
    if (!competition) return null
    
    const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')
    const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')
    
    return {
      id: data.header.id,
      status: mapNHLStatus(competition.status),
      homeScore: parseInt(homeTeam?.score) || null,
      awayScore: parseInt(awayTeam?.score) || null,
      period: competition.status?.period || null,
      clock: competition.status?.displayClock || null,
      periodDescriptor: competition.status?.type?.shortDetail || null
    }
  } catch (error) {
    console.error('Error mapping NHL game detail:', error)
    return null
  }
}

/**
 * Map ESPN status to our standard status
 */
function mapNHLStatus(status) {
  const typeId = status?.type?.id
  const typeName = status?.type?.name
  
  if (!typeId && !typeName) return 'scheduled'
  
  // ESPN status type IDs
  // 1 = scheduled, 2 = in progress, 3 = final
  const statusMap = {
    '1': 'scheduled',
    '2': 'in_progress',
    '3': 'final',
    'STATUS_SCHEDULED': 'scheduled',
    'STATUS_IN_PROGRESS': 'in_progress',
    'STATUS_FINAL': 'final',
    'STATUS_FINAL_OVERTIME': 'final',
    'STATUS_END_PERIOD': 'in_progress'
  }
  
  const mappedStatus = statusMap[typeId] || statusMap[typeName]
  
  return mappedStatus || 'scheduled'
}

/**
 * Fetch NHL team roster
 */
export async function fetchNHLRoster(teamId) {
  try {
    const url = `${ESPN_NHL_BASE}/teams/${teamId}/roster`
    
    console.log(`Fetching NHL roster for team ${teamId}: ${url}`)
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!res.ok) {
      throw new Error(`ESPN NHL API error: ${res.status}`)
    }
    
    const data = await res.json()
    
    return mapNHLRoster(data, teamId)
  } catch (error) {
    console.error(`Failed to fetch NHL roster for team ${teamId}:`, error)
    return null
  }
}

/**
 * Map NHL roster data
 */
function mapNHLRoster(data, teamId) {
  try {
    const athletes = data.athletes || []
    
    const roster = {
      teamId: teamId,
      forwards: [],
      defensemen: [],
      goalies: []
    }
    
    for (const athlete of athletes) {
      const player = {
        id: athlete.id,
        name: athlete.displayName,
        position: athlete.position?.abbreviation || 'F',
        jersey: parseInt(athlete.jersey) || null
      }
      
      const position = player.position
      
      if (position === 'G') {
        roster.goalies.push(player)
      } else if (position === 'D') {
        roster.defensemen.push(player)
      } else {
        // C, LW, RW, F = forwards
        roster.forwards.push(player)
      }
    }
    
    console.log(`Mapped ${roster.forwards.length} forwards, ${roster.defensemen.length} defensemen, ${roster.goalies.length} goalies for team ${teamId}`)
    
    return roster
  } catch (error) {
    console.error('Error mapping NHL roster:', error)
    return null
  }
}

export default {
  fetchNHLSchedule,
  fetchNHLGameDetail,
  fetchNHLTeams,
  fetchNHLRoster
}

