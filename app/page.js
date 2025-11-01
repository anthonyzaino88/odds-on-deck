'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'

export default function HomePage() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchGames = async () => {
      try {
        console.log('🏠 HomePage: Fetching games from API...')
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
        setGames({ mlb: [], nfl: [], nhl: [] })
      } finally {
        setLoading(false)
      }
    }

    fetchGames()
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchGames, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Odds on Deck
          </h1>
          <p className="text-slate-400 text-lg">
            AI-powered sports analytics for MLB, NFL & NHL
          </p>
          <p className="text-slate-500 text-sm mt-2">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-600 rounded-lg p-6 mb-8">
            <p className="text-red-200">⚠️ {error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="text-red-300 text-sm mt-2 underline hover:no-underline"
            >
              Try refreshing
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading games...</p>
          </div>
        )}

        {/* Main Grid - Sport Boxes */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {/* MLB Box */}
            <Link href="/games?sport=mlb">
              <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg p-8 hover:shadow-lg hover:shadow-blue-500/50 transition cursor-pointer h-full">
                <h2 className="text-3xl font-bold mb-2">⚾ MLB</h2>
                <p className="text-blue-200 mb-6">Major League Baseball</p>
                <div className="bg-blue-900/50 rounded p-4">
                  <p className="text-3xl font-bold">{games.mlb.length}</p>
                  <p className="text-blue-200 text-sm">Games Today</p>
                </div>
              </div>
            </Link>

            {/* NFL Box */}
            <Link href="/games?sport=nfl">
              <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-lg p-8 hover:shadow-lg hover:shadow-green-500/50 transition cursor-pointer h-full">
                <h2 className="text-3xl font-bold mb-2">🏈 NFL</h2>
                <p className="text-green-200 mb-6">National Football League</p>
                <div className="bg-green-900/50 rounded p-4">
                  <p className="text-3xl font-bold">{games.nfl.length}</p>
                  <p className="text-green-200 text-sm">Games This Week</p>
                </div>
              </div>
            </Link>

            {/* NHL Box */}
            <Link href="/games?sport=nhl">
              <div className="bg-gradient-to-br from-red-600 to-red-800 rounded-lg p-8 hover:shadow-lg hover:shadow-red-500/50 transition cursor-pointer h-full">
                <h2 className="text-3xl font-bold mb-2">🏒 NHL</h2>
                <p className="text-red-200 mb-6">National Hockey League</p>
                <div className="bg-red-900/50 rounded p-4">
                  <p className="text-3xl font-bold">{games.nhl.length}</p>
                  <p className="text-red-200 text-sm">Games Today</p>
                </div>
              </div>
            </Link>
          </div>
        )}

        {/* Quick Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <Link href="/picks">
            <div className="bg-slate-700/50 hover:bg-slate-600/50 rounded-lg p-6 transition cursor-pointer border border-slate-600">
              <h3 className="text-xl font-bold mb-2">🎯 Editor's Picks</h3>
              <p className="text-slate-400">Top recommended plays</p>
            </div>
          </Link>
          <Link href="/props">
            <div className="bg-slate-700/50 hover:bg-slate-600/50 rounded-lg p-6 transition cursor-pointer border border-slate-600">
              <h3 className="text-xl font-bold mb-2">📊 Player Props</h3>
              <p className="text-slate-400">Detailed prop analysis</p>
            </div>
          </Link>
          <Link href="/dfs">
            <div className="bg-slate-700/50 hover:bg-slate-600/50 rounded-lg p-6 transition cursor-pointer border border-slate-600">
              <h3 className="text-xl font-bold mb-2">💰 DFS Rankings</h3>
              <p className="text-slate-400">Player value rankings</p>
            </div>
          </Link>
        </div>

        {/* Info Section */}
        <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-8">
          <h3 className="text-2xl font-bold mb-4">How It Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-3xl mb-2">📈</div>
              <h4 className="font-bold mb-2">AI Analysis</h4>
              <p className="text-slate-400 text-sm">Machine learning models analyze trends and find value in the market</p>
            </div>
            <div>
              <div className="text-3xl mb-2">🎲</div>
              <h4 className="font-bold mb-2">Live Odds</h4>
              <p className="text-slate-400 text-sm">Real-time odds tracking across multiple sportsbooks</p>
            </div>
            <div>
              <div className="text-3xl mb-2">✅</div>
              <h4 className="font-bold mb-2">Tracking</h4>
              <p className="text-slate-400 text-sm">Detailed validation of every pick for continuous improvement</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

