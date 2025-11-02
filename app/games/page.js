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
        </div>

        {/* MLB Games */}
        {games.mlb.length > 0 && (
          <div className="mb-12">
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
          <div className="mb-12">
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
          <div className="mb-12">
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
  const gameTime = new Date(game.date)
  
  // Format time - database stores times in Eastern Time
  const timeString = gameTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York'  // Use EST since that's what database stores
  })
  
  return (
    <Link href={`/game/${game.id}`}>
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition cursor-pointer">
        
        {/* Game Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-bold text-slate-100">
                {game.away?.abbr || '?'} @ {game.home?.abbr || '?'}
              </h3>
              <span className={`px-3 py-1 rounded text-xs font-semibold ${
                game.status === 'in_progress' ? 'bg-green-900/50 text-green-300' :
                game.status === 'final' ? 'bg-slate-700 text-slate-300' :
                'bg-blue-900/50 text-blue-300'
              }`}>
                {game.status === 'in_progress' ? '🔴 LIVE' : 
                 game.status === 'final' ? 'FINAL' :
                 timeString}
              </span>
            </div>
            <p className="text-slate-400 text-sm">
              {game.away?.name} vs {game.home?.name}
            </p>
            {/* Show inning for MLB games */}
            {game.sport === 'mlb' && game.status === 'in_progress' && game.inning && (
              <p className="text-slate-500 text-xs mt-1">
                {game.inningHalf === 'top' ? '▲' : '▼'} {game.inning}
              </p>
            )}
          </div>
          
          {/* Score Display */}
          {game.homeScore !== null && game.awayScore !== null && (
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-400">
                <div>{game.awayScore}</div>
                <div className="text-xs text-slate-500 my-1">-</div>
                <div>{game.homeScore}</div>
              </div>
            </div>
          )}
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