// NFL Roster Management API
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { 
  fetchAndStoreNFLRosters, 
  getTeamRoster, 
  getGameStarters,
  getTeamInjuryReport 
} from '../../../../lib/nfl-roster.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const teamId = searchParams.get('teamId')
    const gameId = searchParams.get('gameId')
    const season = searchParams.get('season') || '2025'
    
    switch (action) {
      case 'team-roster':
        if (!teamId) {
          return NextResponse.json({ error: 'teamId required' }, { status: 400 })
        }
        const roster = await getTeamRoster(teamId, season)
        return NextResponse.json({ roster })
        
      case 'game-starters':
        if (!gameId) {
          return NextResponse.json({ error: 'gameId required' }, { status: 400 })
        }
        const starters = await getGameStarters(gameId)
        return NextResponse.json({ starters })
        
      case 'injury-report':
        if (!teamId) {
          return NextResponse.json({ error: 'teamId required' }, { status: 400 })
        }
        const injuries = await getTeamInjuryReport(teamId, season)
        return NextResponse.json({ injuries })
        
      default:
        return NextResponse.json({ 
          error: 'Invalid action. Use: team-roster, game-starters, injury-report' 
        }, { status: 400 })
    }
    
  } catch (error) {
    console.error('Error in NFL roster API:', error)
    return NextResponse.json(
      { error: 'Failed to process roster request' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    console.log('🏈 Fetching and storing NFL rosters...')
    
    const result = await fetchAndStoreNFLRosters()
    
    if (result.success) {
      return NextResponse.json({
        message: 'NFL rosters updated successfully',
        playersAdded: result.playersAdded,
        rosterEntries: result.rosterEntries
      })
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }
    
  } catch (error) {
    console.error('Error updating NFL rosters:', error)
    return NextResponse.json(
      { error: 'Failed to update NFL rosters' },
      { status: 500 }
    )
  }
}
