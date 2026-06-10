'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { cn } from '../../lib/utils'
import { SportBadge } from '../../components/ui'

function SportSectionHeading({ sport, count }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <SportBadge sport={sport} />
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
        Games
      </h2>
      <div className="flex-1 h-px bg-white/[0.04]" />
      <span className="text-[11px] text-slate-600 tabular-nums font-mono">{count}</span>
    </div>
  )
}

export default function GamesPage() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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
      <div className="pb-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-100 tracking-tight mb-2">Today&apos;s Slate</h1>
          <div className="h-3 w-48 bg-elevated rounded-[3px] animate-pulse" />
        </div>
        <div className="rounded-[4px] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.08]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-3 py-3.5 bg-surface animate-pulse">
              <div className="flex items-center justify-between gap-4">
                <div className="w-14 flex justify-center">
                  <div className="h-3 w-10 bg-elevated rounded-[3px]" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="h-3.5 w-20 bg-elevated rounded-[3px]" />
                    <div className="h-3.5 w-6 bg-elevated rounded-[3px]" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="h-3.5 w-24 bg-elevated rounded-[3px]" />
                    <div className="h-3.5 w-6 bg-elevated rounded-[3px]" />
                  </div>
                </div>
                <div className="w-14 flex justify-center">
                  <div className="h-3.5 w-3.5 bg-elevated/40 rounded-[3px]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pb-8">
        <div className="bg-red-500/[0.08] border border-red-500/20 rounded-[4px] p-4">
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-red-400/80 text-xs mt-2 underline hover:text-red-400 transition-colors"
          >
            Try refreshing
          </button>
        </div>
      </div>
    )
  }

  const totalGames = games.mlb.length + games.nfl.length + games.nhl.length

  if (totalGames === 0) {
    return (
      <div className="pb-8">
        <h1 className="text-xl font-semibold text-slate-100 tracking-tight mb-1">Today&apos;s Slate</h1>
        <p className="text-xs text-slate-500 tabular-nums mb-6">{todayStr}</p>
        <div className="bg-surface border border-white/[0.06] rounded-[4px] p-8">
          <h3 className="text-sm font-semibold text-slate-100 mb-1">No games scheduled today</h3>
          <p className="text-sm text-slate-500">
            Check back tomorrow for the next slate of games. Schedules update each morning.
          </p>
        </div>
      </div>
    )
  }

  const liveCount = [...games.mlb, ...games.nfl, ...games.nhl].filter(g => {
    let s = (g.status || '').toLowerCase().replace(/^status_/i, '').replace(/-/g, '_')
    return s === 'in_progress'
  }).length

  const SPORT_SECTIONS = [
    { key: 'mlb', list: games.mlb },
    { key: 'nfl', list: games.nfl },
    { key: 'nhl', list: games.nhl },
  ]

  return (
    <div className="pb-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-slate-100 tracking-tight mb-2">Today&apos;s Slate</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
          <span><span className="text-slate-100 font-medium tabular-nums font-mono">{totalGames}</span> games</span>
          {SPORT_SECTIONS.filter(s => s.list.length > 0).map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-3 w-px bg-white/[0.06]" />
              <SportBadge sport={s.key} />
              <span className="text-slate-300 tabular-nums font-mono">{s.list.length}</span>
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500 tabular-nums mt-2">{todayStr}</p>

        {liveCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-500/[0.08] border border-red-500/20 rounded-[4px]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-red-400 font-semibold text-xs tabular-nums">
                {liveCount} {liveCount === 1 ? 'Game' : 'Games'} Live
              </span>
            </div>
          </div>
        )}

        {/* Quick Navigation */}
        <div className="flex flex-wrap gap-2 mt-4">
          {SPORT_SECTIONS.filter(s => s.list.length > 0).map((s) => (
            <a
              key={s.key}
              href={`#${s.key}`}
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] border border-white/[0.06] bg-surface hover:bg-elevated hover:border-white/[0.10] transition-colors"
            >
              <SportBadge sport={s.key} />
              <span className="text-[11px] text-slate-400 tabular-nums font-mono">{s.list.length}</span>
            </a>
          ))}
        </div>
      </header>

      {/* Sport Sections */}
      {SPORT_SECTIONS.filter(s => s.list.length > 0).map((s) => (
        <section key={s.key} id={s.key} className="mb-8 scroll-mt-20">
          <SportSectionHeading sport={s.key} count={s.list.length} />
          <div className="rounded-[4px] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.08]">
            {s.list.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      ))}
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
        <div key={i} className={`w-2 h-2 rounded-full ${i < (outs || 0) ? 'bg-amber-400' : 'bg-slate-700'}`} />
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
      <div className={cn(
        'bg-surface hover:bg-elevated transition-colors duration-100 cursor-pointer px-3 py-3.5',
        isPostponed && 'opacity-60',
      )}>

        <div className="flex items-center justify-between gap-4">
          {/* Left: Status column */}
          <div className="flex-shrink-0 w-14 text-center">
            {isLive ? (
              <div>
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Live</span>
                </div>
                {isMLB && game.inning ? (
                  <div className="text-[11px] text-red-400/80 font-medium tabular-nums">
                    {game.inningHalf === 'top' ? '▲' : game.inningHalf === 'bottom' ? '▼' : '●'} {game.inning}
                  </div>
                ) : game.sport === 'nhl' && game.lastPlay ? (
                  <div className="text-[10px] text-red-400/80">{game.lastPlay}</div>
                ) : game.sport === 'nfl' && game.nflData?.quarter ? (
                  <div className="text-[11px] text-red-400/80 tabular-nums">Q{game.nflData.quarter}</div>
                ) : null}
              </div>
            ) : isFinal ? (
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Final</span>
            ) : isDelayed ? (
              <div>
                <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Delay</span>
                <div className="text-[10px] text-amber-400/60 mt-0.5 tabular-nums">{timeString}</div>
              </div>
            ) : isPostponed ? (
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">PPD</span>
            ) : (
              <span className="text-xs font-medium text-slate-300 tabular-nums font-mono">{timeString}</span>
            )}
          </div>

          {/* Center: Teams & scores */}
          <div className="flex-1 min-w-0">
            {/* Away team row */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">{awayAbbr}</span>
                <span className="text-xs text-slate-500 truncate hidden sm:inline">{awayName}</span>
              </div>
              {(isLive || isFinal) && (
                <span className={cn(
                  'text-base font-semibold tabular-nums font-mono ml-3',
                  isLive ? 'text-slate-100' :
                  (game.awayScore || 0) > (game.homeScore || 0) ? 'text-slate-100' : 'text-slate-500',
                )}>
                  {game.awayScore ?? 0}
                </span>
              )}
            </div>
            {/* Home team row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-slate-100 tabular-nums">{homeAbbr}</span>
                <span className="text-xs text-slate-500 truncate hidden sm:inline">{homeName}</span>
              </div>
              {(isLive || isFinal) && (
                <span className={cn(
                  'text-base font-semibold tabular-nums font-mono ml-3',
                  isLive ? 'text-slate-100' :
                  (game.homeScore || 0) > (game.awayScore || 0) ? 'text-slate-100' : 'text-slate-500',
                )}>
                  {game.homeScore ?? 0}
                </span>
              )}
            </div>
          </div>

          {/* Right: MLB live state (diamond + count) or arrow */}
          <div className="flex-shrink-0 w-14 flex flex-col items-center">
            {isLive && isMLB && game.inning ? (
              <div className="flex flex-col items-center gap-1">
                <BasesDiamond
                  runner1st={game.runnerOn1st}
                  runner2nd={game.runnerOn2nd}
                  runner3rd={game.runnerOn3rd}
                />
                <OutsDots outs={game.outs} />
                {game.balls != null && game.strikes != null && (
                  <div className="text-[10px] text-slate-500 font-mono tabular-nums">{game.balls}-{game.strikes}</div>
                )}
              </div>
            ) : (
              <span className="text-slate-600 text-sm">→</span>
            )}
          </div>
        </div>

        {/* Last play for live MLB games */}
        {isLive && isMLB && game.lastPlay && (
          <div className="mt-2 pt-2 border-t border-white/[0.04]">
            <p className="text-[11px] text-slate-500 truncate">{game.lastPlay}</p>
          </div>
        )}
      </div>
    </Link>
  )
}