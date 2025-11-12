// API endpoint to update game scores with rate limiting (5 minutes)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// In-memory rate limiting (resets on server restart)
// In production, consider using Redis or database for persistence
let lastUpdateTime = null
const RATE_LIMIT_MS = 5 * 60 * 1000 // 5 minutes

function normalizeStatus(status) {
  if (!status) return 'scheduled'
  
  if (typeof status === 'string' && !status.toLowerCase().startsWith('status_')) {
    return status
  }
  
  let cleanStatus = status.toLowerCase().replace(/^status_/i, '')
  
  const statusMap = {
    'in_progress': 'in_progress',
    'in-progress': 'in_progress',
    'halftime': 'halftime',
    'final': 'final',
    'scheduled': 'scheduled',
    'pre-game': 'pre-game',
    'pre_game': 'pre-game',
    'delayed': 'delayed',
    'postponed': 'postponed',
    'cancelled': 'cancelled'
  }
  
  return statusMap[cleanStatus] || cleanStatus
}

async function updateScoresForSport(sport) {
  const now = new Date().toISOString()
  
  // Get active games (in progress, halftime, or scheduled today)
  const { data: games, error: gamesError } = await supabase
    .from('Game')
    .select('*, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', sport)
    .in('status', ['scheduled', 'in_progress', 'in-progress', 'halftime', 'pre-game', 'pre_game'])
    .order('date', { ascending: true })
  
  if (gamesError) {
    throw new Error(`Failed to fetch ${sport} games: ${gamesError.message}`)
  }
  
  if (!games || games.length === 0) {
    return { updated: 0, errors: 0 }
  }
  
  let updated = 0
  let errors = 0
  
  // Dynamic imports to avoid Vercel build issues
  let fetchNHLGameDetail, fetchNFLGameDetail, fetchLiveGameData
  
  try {
    // Import all modules dynamically
    const [nhlModule, nflModule, statsModule] = await Promise.all([
      import('../../../../lib/vendors/nhl-stats.js').catch(() => null),
      import('../../../../lib/vendors/nfl-stats.js').catch(() => null),
      import('../../../../lib/vendors/stats.js').catch(() => null)
    ])
    
    fetchNHLGameDetail = nhlModule?.fetchNHLGameDetail
    fetchNFLGameDetail = nflModule?.fetchNFLGameDetail
    fetchLiveGameData = statsModule?.fetchLiveGameData
  } catch (importError) {
    console.error(`⚠️ Error importing stats modules:`, importError.message)
    // Continue anyway - some sports might still work
  }
  
  for (const game of games) {
    try {
      let liveData = null
      
      if (sport === 'nhl' && game.espnGameId && fetchNHLGameDetail) {
        liveData = await fetchNHLGameDetail(game.espnGameId)
      } else if (sport === 'nfl' && game.espnGameId && fetchNFLGameDetail) {
        liveData = await fetchNFLGameDetail(game.espnGameId)
      } else if (game.espnGameId && fetchLiveGameData) {
        liveData = await fetchLiveGameData(game.espnGameId, sport)
      }
      
      if (!liveData) {
        continue
      }
      
      const updateData = {
        homeScore: liveData.homeScore ?? game.homeScore,
        awayScore: liveData.awayScore ?? game.awayScore,
        status: normalizeStatus(liveData.status),
        lastUpdate: new Date().toISOString()
      }
      
      if (sport === 'nhl' && liveData.period) {
        updateData.lastPlay = liveData.periodDescriptor || 
          `Period ${liveData.period}${liveData.clock ? ` - ${liveData.clock}` : ''}`
      } else if (sport === 'mlb' && liveData.inning) {
        updateData.inning = liveData.inning
        updateData.inningHalf = liveData.inningHalf
        updateData.outs = liveData.outs
        updateData.balls = liveData.balls
        updateData.strikes = liveData.strikes
        updateData.lastPlay = liveData.lastPlay
      }
      
      let targetGameId = game.id
      
      if (game.espnGameId) {
        const { data: duplicates } = await supabase
          .from('Game')
          .select('id, oddsApiEventId')
          .eq('espnGameId', game.espnGameId)
          .eq('sport', sport)
        
        if (duplicates && duplicates.length > 1) {
          const withOdds = duplicates.find(g => g.oddsApiEventId)
          if (withOdds) {
            targetGameId = withOdds.id
          }
        }
      }
      
      const { error: updateError } = await supabase
        .from('Game')
        .update(updateData)
        .eq('id', targetGameId)
      
      if (updateError) {
        errors++
      } else {
        updated++
      }
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
    } catch (error) {
      errors++
    }
  }
  
  return { updated, errors }
}

export async function POST(request) {
  try {
    const now = Date.now()
    
    // Check rate limit
    if (lastUpdateTime && (now - lastUpdateTime) < RATE_LIMIT_MS) {
      const timeRemaining = Math.ceil((RATE_LIMIT_MS - (now - lastUpdateTime)) / 1000)
      const minutes = Math.floor(timeRemaining / 60)
      const seconds = timeRemaining % 60
      
      return NextResponse.json({
        success: false,
        error: 'Rate limit exceeded',
        message: `Please wait ${minutes}m ${seconds}s before updating again`,
        timeRemaining: timeRemaining,
        nextUpdateAvailable: new Date(lastUpdateTime + RATE_LIMIT_MS).toISOString()
      }, { status: 429 })
    }
    
    // Update last update time
    lastUpdateTime = now
    
    console.log('📊 Updating game scores...')
    
    let totalUpdated = 0
    let totalErrors = 0
    
    // Update all sports with error handling
    try {
      const nhlResult = await updateScoresForSport('nhl').catch(err => {
        console.error('❌ NHL update error:', err.message)
        return { updated: 0, errors: 0 }
      })
      totalUpdated += nhlResult?.updated || 0
      totalErrors += nhlResult?.errors || 0
    } catch (err) {
      console.error('❌ NHL update failed:', err.message)
      totalErrors++
    }
    
    try {
      const nflResult = await updateScoresForSport('nfl').catch(err => {
        console.error('❌ NFL update error:', err.message)
        return { updated: 0, errors: 0 }
      })
      totalUpdated += nflResult?.updated || 0
      totalErrors += nflResult?.errors || 0
    } catch (err) {
      console.error('❌ NFL update failed:', err.message)
      totalErrors++
    }
    
    try {
      const mlbResult = await updateScoresForSport('mlb').catch(err => {
        console.error('❌ MLB update error:', err.message)
        return { updated: 0, errors: 0 }
      })
      totalUpdated += mlbResult?.updated || 0
      totalErrors += mlbResult?.errors || 0
    } catch (err) {
      console.error('❌ MLB update failed:', err.message)
      totalErrors++
    }
    
    return NextResponse.json({
      success: true,
      updated: totalUpdated,
      errors: totalErrors,
      message: `Updated ${totalUpdated} games`,
      nextUpdateAvailable: new Date(now + RATE_LIMIT_MS).toISOString()
    })
    
  } catch (error) {
    console.error('❌ Fatal error updating scores:', error)
    // Always return JSON, never HTML
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to update scores',
        details: error?.message || 'Unknown error',
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      },
      { status: 500 }
    )
  }
}

export async function GET(request) {
  // Return rate limit status
  const now = Date.now()
  
  if (!lastUpdateTime) {
    return NextResponse.json({
      available: true,
      message: 'Ready to update scores'
    })
  }
  
  const timeSinceLastUpdate = now - lastUpdateTime
  const timeRemaining = Math.max(0, RATE_LIMIT_MS - timeSinceLastUpdate)
  
  if (timeRemaining > 0) {
    const minutes = Math.floor(timeRemaining / 60000)
    const seconds = Math.floor((timeRemaining % 60000) / 1000)
    
    return NextResponse.json({
      available: false,
      timeRemaining: timeRemaining,
      message: `Please wait ${minutes}m ${seconds}s`,
      nextUpdateAvailable: new Date(lastUpdateTime + RATE_LIMIT_MS).toISOString()
    })
  }
  
  return NextResponse.json({
    available: true,
    message: 'Ready to update scores'
  })
}

