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
    // REMOVED: No interval needed - data is persistent in Supabase
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-6xl font-bold mb-3 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Odds on Deck
          </h1>
          <p className="text-slate-300 text-lg font-light">
            AI-powered sports analytics for MLB, NFL & NHL
          </p>
          <p className="text-slate-500 text-sm mt-3">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-6 mb-8">
            <p className="text-red-200 font-medium">⚠️ {error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="text-red-400 text-sm mt-3 underline hover:text-red-300 transition"
            >
              Try refreshing
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-16">
            <div className="inline-block">
              <div className="animate-spin h-8 w-8 border-4 border-slate-600 border-t-blue-400 rounded-full"></div>
            </div>
            <p className="text-slate-400 mt-4">Loading games...</p>
          </div>
        )}

        {/* Main Grid - Sport Boxes */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {/* MLB Box */}
            <Link href="/games#mlb">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-8 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition cursor-pointer h-full group">
                <h2 className="text-4xl font-bold mb-2 group-hover:text-blue-400 transition">⚾ MLB</h2>
                <p className="text-slate-400 mb-8">Major League Baseball</p>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
                  <p className="text-5xl font-bold text-blue-400">{games.mlb.length}</p>
                  <p className="text-slate-400 text-sm mt-2">Games Today</p>
                </div>
              </div>
            </Link>

            {/* NFL Box */}
            <Link href="/games#nfl">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-8 hover:border-green-500 hover:shadow-lg hover:shadow-green-500/20 transition cursor-pointer h-full group">
                <h2 className="text-4xl font-bold mb-2 group-hover:text-green-400 transition">🏈 NFL</h2>
                <p className="text-slate-400 mb-8">National Football League</p>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
                  <p className="text-5xl font-bold text-green-400">{games.nfl.length}</p>
                  <p className="text-slate-400 text-sm mt-2">Games This Week</p>
                </div>
              </div>
            </Link>

            {/* NHL Box */}
            <Link href="/games#nhl">
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-8 hover:border-cyan-500 hover:shadow-lg hover:shadow-cyan-500/20 transition cursor-pointer h-full group">
                <h2 className="text-4xl font-bold mb-2 group-hover:text-cyan-400 transition">🏒 NHL</h2>
                <p className="text-slate-400 mb-8">National Hockey League</p>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
                  <p className="text-5xl font-bold text-cyan-400">{games.nhl.length}</p>
                  <p className="text-slate-400 text-sm mt-2">Games Today</p>
                </div>
              </div>
            </Link>
          </div>
        )}

        {/* Quick Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <Link href="/picks">
            <div className="bg-slate-800/50 border border-slate-700 hover:border-slate-600 rounded-lg p-6 transition cursor-pointer group">
              <h3 className="text-xl font-bold mb-2 group-hover:text-blue-400 transition">🎯 Editor's Picks</h3>
              <p className="text-slate-400">Top recommended plays</p>
            </div>
          </Link>
          <Link href="/props">
            <div className="bg-slate-800/50 border border-slate-700 hover:border-slate-600 rounded-lg p-6 transition cursor-pointer group">
              <h3 className="text-xl font-bold mb-2 group-hover:text-purple-400 transition">📊 Player Props</h3>
              <p className="text-slate-400">Detailed prop analysis</p>
            </div>
          </Link>
          <Link href="/dfs">
            <div className="bg-slate-800/50 border border-slate-700 hover:border-slate-600 rounded-lg p-6 transition cursor-pointer group">
              <h3 className="text-xl font-bold mb-2 group-hover:text-pink-400 transition">💰 DFS Rankings</h3>
              <p className="text-slate-400">Player value rankings</p>
            </div>
          </Link>
        </div>

        {/* Info Section */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
          <h3 className="text-3xl font-bold mb-8">How It Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="group">
              <div className="text-5xl mb-4 group-hover:scale-110 transition transform">📈</div>
              <h4 className="font-bold text-lg mb-2 text-slate-200">AI Analysis</h4>
              <p className="text-slate-400 text-sm leading-relaxed">Machine learning models analyze trends and find value in the market</p>
            </div>
            <div className="group">
              <div className="text-5xl mb-4 group-hover:scale-110 transition transform">🎲</div>
              <h4 className="font-bold text-lg mb-2 text-slate-200">Live Odds</h4>
              <p className="text-slate-400 text-sm leading-relaxed">Real-time odds tracking across multiple sportsbooks</p>
            </div>
            <div className="group">
              <div className="text-5xl mb-4 group-hover:scale-110 transition transform">✅</div>
              <h4 className="font-bold text-lg mb-2 text-slate-200">Tracking</h4>
              <p className="text-slate-400 text-sm leading-relaxed">Detailed validation of every pick for continuous improvement</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

