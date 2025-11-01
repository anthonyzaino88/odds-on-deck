import Link from 'next/link'
import { getFastData } from '../lib/data-manager.js'

// CRITICAL: This page should NEVER fetch external APIs or do heavy work
// All data should be pre-loaded into the database by background cron jobs
// This page just reads from the cache/database

export const revalidate = 60 // ISR - revalidate every 60 seconds
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  try {
    console.log('🏠 HomePage loading - fetching cached data only...')
    
    // ONLY read from cache - no external API calls, no timeouts
    const data = await getFastData()
    
    const { mlbGames = [], nflGames = [], nhlGames = [], picks = [], playerProps = [], lastUpdated } = data
    
    console.log(`✅ HomePage loaded: ${mlbGames.length} MLB, ${nflGames.length} NFL, ${nhlGames.length} NHL`)

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
            {lastUpdated && (
              <p className="text-slate-500 text-sm mt-2">
                Last updated: {new Date(lastUpdated).toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {/* MLB Box */}
            <Link href="/games?sport=mlb">
              <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg p-8 hover:shadow-lg hover:shadow-blue-500/50 transition cursor-pointer h-full">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-3xl font-bold">⚾ MLB</h2>
                    <p className="text-blue-200 mt-2">Major League Baseball</p>
                  </div>
                </div>
                <div className="bg-blue-900/50 rounded p-4 mt-6">
                  <p className="text-2xl font-bold">{mlbGames.length}</p>
                  <p className="text-blue-200">Games Today</p>
                </div>
              </div>
            </Link>

            {/* NFL Box */}
            <Link href="/games?sport=nfl">
              <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-lg p-8 hover:shadow-lg hover:shadow-green-500/50 transition cursor-pointer h-full">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-3xl font-bold">🏈 NFL</h2>
                    <p className="text-green-200 mt-2">National Football League</p>
                  </div>
                </div>
                <div className="bg-green-900/50 rounded p-4 mt-6">
                  <p className="text-2xl font-bold">{nflGames.length}</p>
                  <p className="text-green-200">Games This Week</p>
                </div>
              </div>
            </Link>

            {/* NHL Box */}
            <Link href="/games?sport=nhl">
              <div className="bg-gradient-to-br from-red-600 to-red-800 rounded-lg p-8 hover:shadow-lg hover:shadow-red-500/50 transition cursor-pointer h-full">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-3xl font-bold">🏒 NHL</h2>
                    <p className="text-red-200 mt-2">National Hockey League</p>
                  </div>
                </div>
                <div className="bg-red-900/50 rounded p-4 mt-6">
                  <p className="text-2xl font-bold">{nhlGames.length}</p>
                  <p className="text-red-200">Games Today</p>
                </div>
              </div>
            </Link>
          </div>

          {/* Quick Links */}
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
  } catch (error) {
    console.error('❌ HomePage error:', error)
    
    // Fallback UI - page still renders even if data fails
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-5xl font-bold mb-4">Odds on Deck</h1>
          <div className="bg-yellow-900/20 border border-yellow-600 rounded-lg p-6 mb-8">
            <p className="text-yellow-200">
              📡 Data is loading. If you see this message, check back in a few moments.
            </p>
            <p className="text-yellow-300 text-sm mt-2">
              Background jobs are populating the database. Try refreshing in 30 seconds.
            </p>
          </div>
          <Link href="/games" className="text-blue-400 hover:text-blue-300 underline">
            → View All Games
          </Link>
        </div>
      </div>
    )
  }
}

