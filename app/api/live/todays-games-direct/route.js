// Direct fetch from ESPN APIs - NO DATABASE
// Shows what games are actually happening today

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const result = {
      date: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      mlb: [],
      nfl: [],
      nhl: []
    }
    
    // MLB - Check for Oct 31, 2025
    try {
      const mlbUrl = 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=20251031'
      const mlbRes = await fetch(mlbUrl)
      const mlbData = await mlbRes.json()
      
      if (mlbData.dates && mlbData.dates[0] && mlbData.dates[0].games) {
        result.mlb = mlbData.dates[0].games.map(g => ({
          away: g.teams.away.team.name,
          home: g.teams.home.team.name,
          time: new Date(g.gameDate).toLocaleString('en-US', { timeZone: 'America/New_York' }),
          status: g.status.detailedState
        }))
      }
    } catch (e) {
      result.mlb = { error: e.message }
    }
    
    // NFL
    try {
      const nflUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
      const nflRes = await fetch(nflUrl, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' }
      })
      const nflData = await nflRes.json()
      
      // Filter for Oct 31
      const todayGames = nflData.events?.filter(e => {
        const d = new Date(e.date)
        const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' })
        return day === '10/31/2025'
      }) || []
      
      result.nfl = todayGames.map(g => ({
        away: g.competitions[0].competitors[1].team.displayName,
        home: g.competitions[0].competitors[0].team.displayName,
        time: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        status: g.status.type.description
      }))
    } catch (e) {
      result.nfl = { error: e.message }
    }
    
    // NHL
    try {
      const nhlUrl = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
      const nhlRes = await fetch(nhlUrl, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' }
      })
      const nhlData = await nhlRes.json()
      
      // Filter for Oct 31
      const todayGames = nhlData.events?.filter(e => {
        const d = new Date(e.date)
        const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' })
        return day === '10/31/2025'
      }) || []
      
      result.nhl = todayGames.map(g => ({
        away: g.competitions[0].competitors[1].team.displayName,
        home: g.competitions[0].competitors[0].team.displayName,
        time: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        status: g.status.type.description
      }))
    } catch (e) {
      result.nhl = { error: e.message }
    }
    
    return NextResponse.json({
      ...result,
      summary: {
        mlb: Array.isArray(result.mlb) ? result.mlb.length : 0,
        nfl: Array.isArray(result.nfl) ? result.nfl.length : 0,
        nhl: Array.isArray(result.nhl) ? result.nhl.length : 0
      }
    })
    
  } catch (error) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

