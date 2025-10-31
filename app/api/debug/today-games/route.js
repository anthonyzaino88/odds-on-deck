// Check what games ESPN says are happening TODAY (Oct 31, 2025)

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const results = {
      currentDate: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      mlb: { error: null, games: [] },
      nfl: { error: null, games: [] },
      nhl: { error: null, games: [] }
    }
    
    // Check MLB - World Series Game 5 (if scheduled)
    try {
      const mlbDate = '20251031' // Oct 31, 2025
      const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${mlbDate}`
      const mlbRes = await fetch(mlbUrl)
      const mlbData = await mlbRes.json()
      
      results.mlb.games = mlbData.dates?.[0]?.games?.map(g => ({
        id: g.gamePk,
        time: g.gameDate,
        timeET: new Date(g.gameDate).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        away: g.teams.away.team.name,
        home: g.teams.home.team.name,
        status: g.status.detailedState
      })) || []
      
      results.mlb.count = results.mlb.games.length
    } catch (error) {
      results.mlb.error = error.message
    }
    
    // Check NFL
    try {
      const nflUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
      const nflRes = await fetch(nflUrl, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' }
      })
      const nflData = await nflRes.json()
      
      // Filter for Oct 31 games
      const oct31Games = nflData.events?.filter(event => {
        const gameDate = new Date(event.date)
        const gameDay = gameDate.toLocaleDateString('en-US', { timeZone: 'America/New_York', day: '2-digit', month: '2-digit', year: 'numeric' })
        return gameDay === '10/31/2025'
      }) || []
      
      results.nfl.games = oct31Games.map(g => ({
        id: g.id,
        time: g.date,
        timeET: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        away: g.competitions[0].competitors[1].team.displayName,
        home: g.competitions[0].competitors[0].team.displayName,
        status: g.status.type.name
      }))
      
      results.nfl.count = results.nfl.games.length
      results.nfl.totalInAPI = nflData.events?.length || 0
    } catch (error) {
      results.nfl.error = error.message
    }
    
    // Check NHL
    try {
      const nhlUrl = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
      const nhlRes = await fetch(nhlUrl, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' }
      })
      const nhlData = await nhlRes.json()
      
      // Filter for Oct 31 games
      const oct31Games = nhlData.events?.filter(event => {
        const gameDate = new Date(event.date)
        const gameDay = gameDate.toLocaleDateString('en-US', { timeZone: 'America/New_York', day: '2-digit', month: '2-digit', year: 'numeric' })
        return gameDay === '10/31/2025'
      }) || []
      
      results.nhl.games = oct31Games.map(g => ({
        id: g.id,
        time: g.date,
        timeET: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        away: g.competitions[0].competitors[1].team.displayName,
        home: g.competitions[0].competitors[0].team.displayName,
        status: g.status.type.name
      }))
      
      results.nhl.count = results.nhl.games.length
      results.nhl.totalInAPI = nhlData.events?.length || 0
    } catch (error) {
      results.nhl.error = error.message
    }
    
    return NextResponse.json(results)
    
  } catch (error) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

