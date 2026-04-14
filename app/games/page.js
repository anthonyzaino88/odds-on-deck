'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import ScoreRefreshButton from '../../components/ScoreRefreshButton'

export default function GamesPage() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [todayStr, setTodayStr] = useState('')

  useEffect(() => {
    setTodayStr(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))
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
  }, [refreshKey])
  
  // Callback for score refresh button
  const handleScoreRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
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
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-12">
          <div className="mb-4 sm:mb-8">
            <h1 className="text-4xl font-bold mb-3">Today&apos;s Slate</h1>
            <div className="h-5 w-64 bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-4 sm:p-5 animate-pulse">
                <div className="flex items-center justify-between gap-4">
                  <div className="w-16 flex justify-center">
                    <div className="h-4 w-10 bg-slate-700 rounded" />
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="h-4 w-20 bg-slate-700 rounded" />
                      <div className="h-5 w-8 bg-slate-700 rounded" />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="h-4 w-24 bg-slate-700 rounded" />
                      <div className="h-5 w-8 bg-slate-700 rounded" />
                    </div>
                  </div>
                  <div className="w-16 flex justify-center">
                    <div className="h-4 w-4 bg-slate-700/40 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-12">
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
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-12">
          <h1 className="text-4xl font-bold mb-3 text-slate-100">Today&apos;s Slate</h1>
          <p className="text-slate-500 text-sm mb-6">{todayStr}</p>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
            <div className="text-5xl mb-4">📅</div>
            <p className="text-slate-300 text-lg font-medium mb-2">No games scheduled today</p>
            <p className="text-slate-500 text-sm">
              Check back tomorrow for the next slate of games. Schedules update each morning.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-12">
        {/* Header */}
        <div className="mb-4 sm:mb-8">
          <h1 className="text-4xl font-bold mb-3">Today's Slate</h1>
          <p className="text-slate-400">
            {totalGames} games • ⚾ {games.mlb.length} MLB • 🏈 {games.nfl.length} NFL • 🏒 {games.nhl.length} NHL
          </p>
          <p className="text-slate-500 text-sm mt-2">
            {todayStr}
          </p>
          
          {/* Score Refresh Button */}
          <div className="mt-4">
            <ScoreRefreshButton onRefreshComplete={handleScoreRefresh} />
          </div>
          
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

function BasesDiamond({ runner1st, runner2nd, runner3rd }) {
  const baseSize = 8
  const activeColor = '#fbbf24'
  const emptyColor = '#334155'
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" className="inline-block">
      {/* 2nd base (top) */}
      <rect x={16 - baseSize/2} y={2} width={baseSize} height={baseSize} rx={1}
        transform={`rotate(45 16 ${2 + baseSize/2})`}
        fill={runner2nd ? activeColor : emptyColor} />
      {/* 3rd base (left) */}
      <rect x={4} y={14} width={baseSize} height={baseSize} rx={1}
        transform={`rotate(45 ${4 + baseSize/2} ${14 + baseSize/2})`}
        fill={runner3rd ? activeColor : emptyColor} />
      {/* 1st base (right) */}
      <rect x={20} y={14} width={baseSize} height={baseSize} rx={1}
        transform={`rotate(45 ${20 + baseSize/2} ${14 + baseSize/2})`}
        fill={runner1st ? activeColor : emptyColor} />
    </svg>
  )
}

function OutsDots({ outs }) {
  return (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map(i => (
        <div key={i} className={`w-2 h-2 rounded-full ${i < (outs || 0) ? 'bg-yellow-400' : 'bg-slate-600'}`} />
      ))}
    </div>
  )
}

function GameCard({ game }) {
  const dateStr = game.date || ''
  const gameTime = new Date(dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/[+-]\d{2}:\d{2}$/) 
    ? dateStr 
    : dateStr + 'Z')
  
  const timeString = gameTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'
  })
  
  let statusNormalized = (game.status || '').toLowerCase()
  statusNormalized = statusNormalized.replace(/^status_/i, '')
  statusNormalized = statusNormalized.replace(/-/g, '_')
  
  const isLive = statusNormalized === 'in_progress'
  const isFinal = statusNormalized === 'final'
  const isDelayed = statusNormalized === 'delayed' || statusNormalized === 'rain_delay'
  const isPostponed = statusNormalized === 'postponed'
  const isScheduled = !isLive && !isFinal && !isDelayed && !isPostponed
  const isMLB = game.sport === 'mlb'
  
  const awayAbbr = game.awayAbbr || game.away?.abbr || '?'
  const homeAbbr = game.homeAbbr || game.home?.abbr || '?'
  const awayName = game.awayName || game.away?.name || 'Away'
  const homeName = game.homeName || game.home?.name || 'Home'
  
  return (
    <Link href={`/game/${game.id}`}>
      <div className={`bg-gradient-to-br from-slate-800 to-slate-900 border rounded-lg p-4 sm:p-5 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition cursor-pointer ${
        isLive ? 'border-red-500/50 shadow-red-500/20 shadow-lg' : 
        isDelayed ? 'border-yellow-500/50' :
        isPostponed ? 'border-slate-600 opacity-60' :
        'border-slate-700'
      }`}>
        
        <div className="flex items-center justify-between gap-4">
          {/* Left: Status column */}
          <div className="flex-shrink-0 w-16 text-center">
            {isLive ? (
              <div>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">LIVE</span>
                </div>
                {isMLB && game.inning ? (
                  <div className="text-xs text-red-300 font-semibold">
                    {game.inningHalf === 'top' ? '▲' : game.inningHalf === 'bottom' ? '▼' : '●'} {game.inning}
                  </div>
                ) : game.sport === 'nhl' && game.lastPlay ? (
                  <div className="text-[10px] text-red-300">{game.lastPlay}</div>
                ) : game.sport === 'nfl' && game.nflData?.quarter ? (
                  <div className="text-xs text-red-300">Q{game.nflData.quarter}</div>
                ) : null}
              </div>
            ) : isFinal ? (
              <span className="text-xs font-semibold text-slate-400 uppercase">Final</span>
            ) : isDelayed ? (
              <div>
                <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider">DELAY</span>
                <div className="text-[10px] text-yellow-500/70 mt-0.5">{timeString}</div>
              </div>
            ) : isPostponed ? (
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">PPD</span>
            ) : (
              <span className="text-xs font-medium text-blue-400">{timeString}</span>
            )}
          </div>

          {/* Center: Teams & scores */}
          <div className="flex-1 min-w-0">
            {/* Away team row */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm font-bold ${isLive ? 'text-white' : 'text-slate-200'}`}>{awayAbbr}</span>
                <span className="text-xs text-slate-500 truncate hidden sm:inline">{awayName}</span>
              </div>
              {(isLive || isFinal) && (
                <span className={`text-lg font-bold tabular-nums ml-3 ${
                  isLive ? 'text-red-400' : 
                  (game.awayScore || 0) > (game.homeScore || 0) ? 'text-white' : 'text-slate-400'
                }`}>
                  {game.awayScore ?? 0}
                </span>
              )}
            </div>
            {/* Home team row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm font-bold ${isLive ? 'text-white' : 'text-slate-200'}`}>{homeAbbr}</span>
                <span className="text-xs text-slate-500 truncate hidden sm:inline">{homeName}</span>
              </div>
              {(isLive || isFinal) && (
                <span className={`text-lg font-bold tabular-nums ml-3 ${
                  isLive ? 'text-red-400' : 
                  (game.homeScore || 0) > (game.awayScore || 0) ? 'text-white' : 'text-slate-400'
                }`}>
                  {game.homeScore ?? 0}
                </span>
              )}
            </div>
          </div>

          {/* Right: MLB live state (diamond + count) or arrow */}
          <div className="flex-shrink-0 w-16 flex flex-col items-center">
            {isLive && isMLB && game.inning ? (
              <div className="flex flex-col items-center gap-1">
                <BasesDiamond 
                  runner1st={game.runnerOn1st} 
                  runner2nd={game.runnerOn2nd} 
                  runner3rd={game.runnerOn3rd} 
                />
                <OutsDots outs={game.outs} />
                {game.balls != null && game.strikes != null && (
                  <div className="text-[10px] text-slate-400 font-mono">{game.balls}-{game.strikes}</div>
                )}
              </div>
            ) : (
              <span className="text-slate-500 text-sm">→</span>
            )}
          </div>
        </div>

        {/* Last play for live MLB games */}
        {isLive && isMLB && game.lastPlay && (
          <div className="mt-2 pt-2 border-t border-slate-700/50">
            <p className="text-[11px] text-slate-400 truncate">{game.lastPlay}</p>
          </div>
        )}
      </div>
    </Link>
  )
}