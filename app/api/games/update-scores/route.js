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

// Process games in parallel with concurrency limit to avoid timeouts
async function processGameBatch(games, processFn, concurrency = 5) {
  const results = { updated: 0, errors: 0 }
  const batches = []
  
  for (let i = 0; i < games.length; i += concurrency) {
    batches.push(games.slice(i, i + concurrency))
  }
  
  for (const batch of batches) {
    const batchResults = await Promise.allSettled(
      batch.map(game => processFn(game))
    )
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        if (result.value.success) {
          results.updated++
        } else {
          results.errors++
        }
      } else {
        results.errors++
      }
    }
  }
  
  return results
}

async function updateScoresForSport(sport, startTime, maxDuration = 8000) {
  // Prioritize games that are actually in progress (not just scheduled)
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
  
  // Sort: in-progress games first, then scheduled
  games.sort((a, b) => {
    const aActive = ['in_progress', 'in-progress', 'halftime'].includes(a.status)
    const bActive = ['in_progress', 'in-progress', 'halftime'].includes(b.status)
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    return 0
  })
  
  // Limit to first 10 games to avoid timeout
  const gamesToProcess = games.slice(0, 10)
  
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
    return { updated: 0, errors: gamesToProcess.length }
  }
  
  // Process games in parallel batches
  const processGame = async (game) => {
    // Check timeout
    if (Date.now() - startTime > maxDuration) {
      return { success: false, timeout: true }
    }
    
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
        return { success: false }
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
        return { success: false }
      }
      
      return { success: true }
      
    } catch (error) {
      return { success: false }
    }
  }
  
  // Process in parallel batches of 5
  const results = await processGameBatch(gamesToProcess, processGame, 5)
  
  return results
}

export async function POST(request) {
  const startTime = Date.now()
  const MAX_DURATION = 8000 // 8 seconds to leave buffer for Vercel's 10s limit
  
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
    
    // Update all sports with error handling and timeout protection
    // Process in-progress games first, then scheduled
    try {
      // Check timeout before each sport
      if (Date.now() - startTime > MAX_DURATION) {
        return NextResponse.json({
          success: true,
          updated: totalUpdated,
          errors: totalErrors,
          message: `Updated ${totalUpdated} games (timeout protection)`,
          partial: true,
          nextUpdateAvailable: new Date(now + RATE_LIMIT_MS).toISOString()
        })
      }
      
      const nhlResult = await updateScoresForSport('nhl', startTime, MAX_DURATION).catch(err => {
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
      if (Date.now() - startTime > MAX_DURATION) {
        return NextResponse.json({
          success: true,
          updated: totalUpdated,
          errors: totalErrors,
          message: `Updated ${totalUpdated} games (timeout protection)`,
          partial: true,
          nextUpdateAvailable: new Date(now + RATE_LIMIT_MS).toISOString()
        })
      }
      
      const nflResult = await updateScoresForSport('nfl', startTime, MAX_DURATION).catch(err => {
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
      if (Date.now() - startTime > MAX_DURATION) {
        return NextResponse.json({
          success: true,
          updated: totalUpdated,
          errors: totalErrors,
          message: `Updated ${totalUpdated} games (timeout protection)`,
          partial: true,
          nextUpdateAvailable: new Date(now + RATE_LIMIT_MS).toISOString()
        })
      }
      
      const mlbResult = await updateScoresForSport('mlb', startTime, MAX_DURATION).catch(err => {
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
      duration: Date.now() - startTime,
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
        duration: Date.now() - startTime,
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

