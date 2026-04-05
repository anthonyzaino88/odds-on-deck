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
    
    const sportsToRefresh = sport === 'all' ? ['mlb', 'nhl', 'nfl'] : [sport]
    
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
        } else if (statusType.includes('postponed')) {
          dbStatus = 'postponed'
        } else if (statusType.includes('delay') || statusType.includes('rain') || statusType.includes('suspended')) {
          dbStatus = 'delayed'
        }
        
        // Skip postponed games entirely — nothing useful to update
        if (dbStatus === 'postponed') continue
        
        // Get game date for ID matching
        const gameDate = new Date(event.date)
        const estDate = gameDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        
        // Try to find game in DB — first by exact ID match, then by espnGameId
        const gameIdPattern = `${awayAbbr}_at_${homeAbbr}_${estDate}`
        const espnId = event.id
        
        let { data: game } = await supabase
          .from('Game')
          .select('id, homeScore, awayScore, status')
          .eq('id', gameIdPattern)
          .single()
        
        // Fallback: match by ESPN game ID if exact ID didn't work
        if (!game && espnId) {
          const { data: espnMatch } = await supabase
            .from('Game')
            .select('id, homeScore, awayScore, status')
            .eq('espnGameId', espnId)
            .single()
          if (espnMatch) game = espnMatch
        }
        
        if (game) {
          // Never downgrade a final game back to scheduled/in_progress
          // This prevents postponed or stale ESPN entries from overwriting completed games
          if (game.status === 'final' && dbStatus !== 'final') {
            console.log(`  ⏭️  Skipping ${game.id} — already final, ESPN says ${dbStatus}`)
            continue
          }
          
          const updateData = {
            homeScore,
            awayScore,
            status: dbStatus,
            lastUpdate: new Date().toISOString()
          }
          
          // MLB-specific live state
          if (sport === 'mlb') {
            if (dbStatus === 'final') {
              // Clear live-state fields when game is over
              updateData.inning = null
              updateData.inningHalf = null
              updateData.outs = null
              updateData.balls = null
              updateData.strikes = null
              updateData.lastPlay = null
              updateData.runnerOn1st = null
              updateData.runnerOn2nd = null
              updateData.runnerOn3rd = null
            } else if (dbStatus === 'in_progress') {
              const period = event.status?.period
              const detail = event.status?.type?.detail || ''
              if (period) updateData.inning = period
              if (detail.toLowerCase().includes('top')) updateData.inningHalf = 'Top'
              else if (detail.toLowerCase().includes('bot')) updateData.inningHalf = 'Bottom'
              else if (detail.toLowerCase().includes('mid')) updateData.inningHalf = 'Middle'
              else if (detail.toLowerCase().includes('end')) updateData.inningHalf = 'End'
              
              const situation = competition.situation
              if (situation) {
                if (situation.outs != null) updateData.outs = situation.outs
                if (situation.balls != null) updateData.balls = situation.balls
                if (situation.strikes != null) updateData.strikes = situation.strikes
                if (situation.lastPlay?.text) updateData.lastPlay = situation.lastPlay.text
                updateData.runnerOn1st = situation.onFirst ? 'on' : null
                updateData.runnerOn2nd = situation.onSecond ? 'on' : null
                updateData.runnerOn3rd = situation.onThird ? 'on' : null
              }
            }
          }
          
          // Check if anything actually changed
          const hasChanges = game.homeScore !== homeScore || game.awayScore !== awayScore || game.status !== dbStatus
          
          if (hasChanges || dbStatus === 'in_progress') {
            const { error: updateError } = await supabase
              .from('Game')
              .update(updateData)
              .eq('id', game.id)
            
            if (updateError) {
              result.errors.push({ game: gameIdPattern, error: updateError.message })
            } else {
              result.updated++
              const inningStr = updateData.inning ? ` ${updateData.inningHalf === 'top' ? '▲' : '▼'}${updateData.inning}` : ''
              result.games.push({
                id: game.id,
                score: `${awayAbbr} ${awayScore} - ${homeAbbr} ${homeScore}${inningStr}`,
                status: dbStatus
              })
              console.log(`  ✅ ${awayAbbr} ${awayScore} - ${homeAbbr} ${homeScore}${inningStr} (${dbStatus})`)
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

