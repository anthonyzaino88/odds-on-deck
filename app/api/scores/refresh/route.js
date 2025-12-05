// Simple API to refresh live scores from ESPN
// This is a lightweight endpoint - only updates scores, not odds/props

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
// Use admin client to bypass RLS for updates
import { supabaseAdmin as supabase } from '../../../../lib/supabase-admin.js'

// ESPN API endpoints
const ESPN_ENDPOINTS = {
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard'
}

export async function POST(req) {
  try {
    const { sport = 'all' } = await req.json().catch(() => ({}))
    
    console.log(`🔄 Refreshing ${sport} scores...`)
    
    const results = {
      success: true,
      updated: 0,
      errors: [],
      sports: {},
      timestamp: new Date().toISOString()
    }
    
    const sportsToRefresh = sport === 'all' ? ['nhl', 'nfl'] : [sport]
    
    for (const sportType of sportsToRefresh) {
      const sportResult = await refreshSportScores(sportType)
      results.sports[sportType] = sportResult
      results.updated += sportResult.updated
      if (sportResult.errors.length > 0) {
        results.errors.push(...sportResult.errors)
      }
    }
    
    console.log(`✅ Score refresh complete: ${results.updated} games updated`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Score refresh error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

async function refreshSportScores(sport) {
  const result = { updated: 0, errors: [], games: [] }
  
  try {
    // Fetch live scores from ESPN
    const response = await fetch(ESPN_ENDPOINTS[sport])
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`)
    }
    
    const data = await response.json()
    const events = data.events || []
    
    console.log(`📊 ESPN ${sport.toUpperCase()}: ${events.length} games`)
    
    for (const event of events) {
      try {
        const competition = event.competitions?.[0]
        if (!competition) continue
        
        // Extract team abbrs
        const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')
        const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')
        
        if (!homeTeam || !awayTeam) continue
        
        const homeAbbr = homeTeam.team?.abbreviation
        const awayAbbr = awayTeam.team?.abbreviation
        const homeScore = parseInt(homeTeam.score) || 0
        const awayScore = parseInt(awayTeam.score) || 0
        
        // Determine status
        const statusType = event.status?.type?.name?.toLowerCase() || ''
        let dbStatus = 'scheduled'
        if (statusType === 'status_in_progress' || statusType.includes('in_progress')) {
          dbStatus = 'in_progress'
        } else if (statusType === 'status_final' || statusType.includes('final')) {
          dbStatus = 'final'
        }
        
        // Get game date for ID matching
        const gameDate = new Date(event.date)
        const estDate = gameDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        
        // Try to find game in DB by pattern matching
        const gameIdPattern = `${awayAbbr}_at_${homeAbbr}_${estDate}`
        
        const { data: game, error: findError } = await supabase
          .from('Game')
          .select('id, homeScore, awayScore, status')
          .eq('id', gameIdPattern)
          .single()
        
        if (game) {
          // Update scores if changed
          if (game.homeScore !== homeScore || game.awayScore !== awayScore || game.status !== dbStatus) {
            const { error: updateError } = await supabase
              .from('Game')
              .update({
                homeScore,
                awayScore,
                status: dbStatus
              })
              .eq('id', game.id)
            
            if (updateError) {
              result.errors.push({ game: gameIdPattern, error: updateError.message })
            } else {
              result.updated++
              result.games.push({
                id: game.id,
                score: `${awayAbbr} ${awayScore} - ${homeAbbr} ${homeScore}`,
                status: dbStatus
              })
              console.log(`  ✅ ${awayAbbr} ${awayScore} - ${homeAbbr} ${homeScore} (${dbStatus})`)
            }
          }
        }
      } catch (gameError) {
        // Skip individual game errors
      }
    }
  } catch (error) {
    result.errors.push({ sport, error: error.message })
  }
  
  return result
}

// Also support GET for simple browser testing
export async function GET() {
  return POST(new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ sport: 'all' })
  }))
}

