'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'

export default function GamesPage() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchGames = async () => {
      try {
        console.log('📋 GamesPage: Fetching games...')
        setLoading(true)
        
        const response = await fetch('/api/games/today', {
          cache: 'no-store'
        })
        
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`)
        }
        
        const result = await response.json()
        
        if (result.success) {
          setGames(result.data)
          console.log(`✅ Loaded: ${result.data.mlb.length} MLB, ${result.data.nfl.length} NFL, ${result.data.nhl.length} NHL`)
        } else {
          setError(result.error || 'Failed to load games')
        }
      } catch (err) {
        console.error('❌ Error fetching games:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchGames()
  }, [])

  // Handle scroll to sport section on mount or URL change
  useEffect(() => {
    if (loading) return

    const scrollToSport = () => {
      // Check URL hash first (e.g., /games#nfl)
      const hash = window.location.hash.slice(1) // Remove #
      
      // Check query parameter (e.g., /games?sport=nfl)
      const urlParams = new URLSearchParams(window.location.search)
      const sportParam = urlParams.get('sport')
      
      const sport = hash || sportParam
      
      if (sport && (sport === 'mlb' || sport === 'nfl' || sport === 'nhl')) {
        // Wait a bit for DOM to render
        setTimeout(() => {
          const element = document.getElementById(sport)
          if (element) {
            // Get header height for offset
            const headerOffset = 80
            const elementPosition = element.getBoundingClientRect().top
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset

            window.scrollTo({
              top: offsetPosition,
              behavior: 'smooth'
            })
          }
        }, 100)
      }
    }

    scrollToSport()
  }, [loading])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="text-center py-16">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-slate-600 border-t-blue-400 rounded-full"></div>
            </div>
            <p className="text-slate-400 mt-4">Loading games...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="bg-red-950 border border-red-800 rounded-lg p-6">
            <p className="text-red-200 font-medium">⚠️ {error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="text-red-400 text-sm mt-3 underline hover:text-red-300 transition"
            >
              Try refreshing
            </button>
          </div>
        </div>
      </div>
    )
  }

  const totalGames = games.mlb.length + games.nfl.length + games.nhl.length

  if (totalGames === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <h1 className="text-4xl font-bold mb-4 text-slate-100">Today's Slate</h1>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
            <p className="text-slate-400 text-lg mb-4">No games scheduled for today</p>
            <p className="text-slate-500 text-sm">Check back tomorrow!</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-3">Today's Slate</h1>
          <p className="text-slate-400">
            {totalGames} games • ⚾ {games.mlb.length} MLB • 🏈 {games.nfl.length} NFL • 🏒 {games.nhl.length} NHL
          </p>
          <p className="text-slate-500 text-sm mt-2">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          
          {/* Live Games Indicator */}
          {(() => {
            const allGames = [...games.mlb, ...games.nfl, ...games.nhl]
            // Use the same logic as GameCard to determine live games
            const liveGames = allGames.filter(g => {
              // Normalize status: remove "status_" prefix if present, handle hyphens
              let statusNormalized = (g.status || '').toLowerCase()
              statusNormalized = statusNormalized.replace(/^status_/i, '') // Remove "status_" prefix
              statusNormalized = statusNormalized.replace(/-/g, '_') // Convert hyphens to underscores
              
              // Only count as live if status is explicitly 'in_progress'
              return statusNormalized === 'in_progress'
            })
            
            if (liveGames.length > 0) {
              return (
                <div className="mt-4 flex items-center gap-2 px-4 py-2 bg-red-900/20 border border-red-500/50 rounded-lg">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  <span className="text-red-400 font-semibold text-sm">
                    {liveGames.length} {liveGames.length === 1 ? 'Game' : 'Games'} Live
                  </span>
                </div>
              )
            }
            return null
          })()}
          
          {/* Quick Navigation */}
          {(games.mlb.length > 0 || games.nfl.length > 0 || games.nhl.length > 0) && (
            <div className="flex flex-wrap gap-3 mt-6">
              {games.mlb.length > 0 && (
                <a 
                  href="#mlb" 
                  className="px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-lg text-blue-400 hover:bg-blue-600/30 hover:border-blue-500 transition text-sm font-medium"
                >
                  ⚾ Jump to MLB ({games.mlb.length})
                </a>
              )}
              {games.nfl.length > 0 && (
                <a 
                  href="#nfl" 
                  className="px-4 py-2 bg-green-600/20 border border-green-500/50 rounded-lg text-green-400 hover:bg-green-600/30 hover:border-green-500 transition text-sm font-medium"
                >
                  🏈 Jump to NFL ({games.nfl.length})
                </a>
              )}
              {games.nhl.length > 0 && (
                <a 
                  href="#nhl" 
                  className="px-4 py-2 bg-cyan-600/20 border border-cyan-500/50 rounded-lg text-cyan-400 hover:bg-cyan-600/30 hover:border-cyan-500 transition text-sm font-medium"
                >
                  🏒 Jump to NHL ({games.nhl.length})
                </a>
              )}
            </div>
          )}
        </div>

        {/* MLB Games */}
        {games.mlb.length > 0 && (
          <div id="mlb" className="mb-12 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-6 text-slate-100">⚾ MLB Games</h2>
            <div className="grid grid-cols-1 gap-4">
              {games.mlb.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </div>
        )}

        {/* NFL Games */}
        {games.nfl.length > 0 && (
          <div id="nfl" className="mb-12 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-6 text-slate-100">🏈 NFL Games</h2>
            <div className="grid grid-cols-1 gap-4">
              {games.nfl.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </div>
        )}

        {/* NHL Games */}
        {games.nhl.length > 0 && (
          <div id="nhl" className="mb-12 scroll-mt-20">
            <h2 className="text-2xl font-bold mb-6 text-slate-100">🏒 NHL Games</h2>
            <div className="grid grid-cols-1 gap-4">
              {games.nhl.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GameCard({ game }) {
  // Database stores times as UTC without the Z marker
  // Add Z to tell JavaScript to treat as UTC, then convert to local timezone
  // Parse date - handle both with and without 'Z' (dates from API may be normalized)
  const dateStr = game.date || ''
  const gameTime = new Date(dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/[+-]\d{2}:\d{2}$/) 
    ? dateStr 
    : dateStr + 'Z')
  const now = new Date()
  
  // Format time - convert UTC to Eastern Time
  const timeString = gameTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'  // Eastern Time (EST/EDT)
  })
  
  // Check if game is live - ONLY if status is explicitly 'in_progress'
  // Don't infer live status from times/scores to avoid false positives
  // Normalize status: remove "status_" prefix if present, handle hyphens
  let statusNormalized = (game.status || '').toLowerCase()
  statusNormalized = statusNormalized.replace(/^status_/i, '') // Remove "status_" prefix
  statusNormalized = statusNormalized.replace(/-/g, '_') // Convert hyphens to underscores
  
  // Only mark as live if status is explicitly 'in_progress'
  // Games with midnight UTC times can appear as "started" even if they haven't
  const isLive = statusNormalized === 'in_progress'
  
  return (
    <Link href={`/game/${game.id}`}>
      <div className={`bg-gradient-to-br from-slate-800 to-slate-900 border rounded-lg p-6 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition cursor-pointer ${
        isLive ? 'border-red-500/50 shadow-red-500/20' : 'border-slate-700'
      }`}>
        
        {/* Game Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-bold text-slate-100">
                {game.away?.abbr || '?'} @ {game.home?.abbr || '?'}
              </h3>
              
              {/* Live Indicator - Red Dot + LIVE Text */}
              {isLive && (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  <span className="px-2 py-0.5 bg-red-900/50 border border-red-500/50 rounded text-xs font-bold text-red-400 uppercase tracking-wide">
                    LIVE
                  </span>
                </div>
              )}
              
              {/* Status Badge */}
              {!isLive && (
                <span className={`px-3 py-1 rounded text-xs font-semibold ${
                  game.status === 'final' ? 'bg-slate-700 text-slate-300' :
                  'bg-blue-900/50 text-blue-300'
                }`}>
                  {game.status === 'final' ? 'FINAL' : timeString}
                </span>
              )}
            </div>
            <p className="text-slate-400 text-sm">
              {game.away?.name} vs {game.home?.name}
            </p>
            {/* Show inning for MLB games or period for NHL */}
            {isLive && (
              <p className="text-red-400 text-xs mt-1 font-medium">
                {game.sport === 'mlb' && game.inning ? (
                  <>{game.inningHalf === 'top' ? '▲' : '▼'} {game.inning}</>
                ) : game.sport === 'nhl' && game.lastPlay ? (
                  <>{game.lastPlay}</>
                ) : game.sport === 'nfl' && game.nflData?.quarter ? (
                  <>Q{game.nflData.quarter} {game.nflData.timeLeft || ''}</>
                ) : (
                  <>Game in progress</>
                )}
              </p>
            )}
          </div>
          
          {/* Score Display - Highlight if live */}
          <div className="text-right">
            <div className={`text-2xl font-bold ${isLive ? 'text-red-400' : 'text-blue-400'}`}>
              <div>{game.awayScore ?? 0}</div>
              <div className="text-xs text-slate-500 my-1">-</div>
              <div>{game.homeScore ?? 0}</div>
            </div>
            {isLive && (
              <p className="text-xs text-red-400/80 mt-1 font-medium">Live</p>
            )}
          </div>
        </div>

        {/* View Details */}
        <div className="pt-4 border-t border-slate-700">
          <p className="text-blue-400 text-sm font-medium hover:text-blue-300">
            View Details →
          </p>
        </div>
      </div>
    </Link>
  )
}