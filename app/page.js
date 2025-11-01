import Link from 'next/link'
import { prisma } from '../lib/db.js'

// Simple ISR - revalidate every 30 seconds
export const revalidate = 30

export default async function HomePage() {
  try {
    console.log('🏠 HomePage loading - querying database for games...')
    
    // Get today's date range
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Query games in parallel
    const [mlbGames, nflGames, nhlGames] = await Promise.all([
      // MLB: today only
      prisma.game.findMany({
        where: {
          sport: 'mlb',
          date: { gte: today, lt: tomorrow }
        },
        select: {
          id: true,
          date: true,
          status: true,
          homeScore: true,
          awayScore: true,
          home: { select: { abbr: true, name: true } },
          away: { select: { abbr: true, name: true } }
        },
        orderBy: { date: 'asc' }
      }),
      
      // NFL: this week (7 days)
      prisma.game.findMany({
        where: {
          sport: 'nfl',
          date: { gte: today, lt: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) }
        },
        select: {
          id: true,
          date: true,
          status: true,
          homeScore: true,
          awayScore: true,
          home: { select: { abbr: true, name: true } },
          away: { select: { abbr: true, name: true } }
        },
        orderBy: { date: 'asc' }
      }),
      
      // NHL: today only
      prisma.game.findMany({
        where: {
          sport: 'nhl',
          date: { gte: today, lt: tomorrow }
        },
        select: {
          id: true,
          date: true,
          status: true,
          homeScore: true,
          awayScore: true,
          home: { select: { abbr: true, name: true } },
          away: { select: { abbr: true, name: true } }
        },
        orderBy: { date: 'asc' }
      })
    ])
    
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
            <p className="text-slate-500 text-sm mt-2">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>

          {/* Main Grid - Sport Boxes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {/* MLB Box */}
            <Link href="/games?sport=mlb">
              <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg p-8 hover:shadow-lg hover:shadow-blue-500/50 transition cursor-pointer h-full">
                <h2 className="text-3xl font-bold mb-2">⚾ MLB</h2>
                <p className="text-blue-200 mb-6">Major League Baseball</p>
                <div className="bg-blue-900/50 rounded p-4">
                  <p className="text-3xl font-bold">{mlbGames.length}</p>
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
                  <p className="text-3xl font-bold">{nflGames.length}</p>
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
                  <p className="text-3xl font-bold">{nhlGames.length}</p>
                  <p className="text-red-200 text-sm">Games Today</p>
                </div>
              </div>
            </Link>
          </div>

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
  } catch (error) {
    console.error('❌ HomePage error:', error)
    
    // Fallback UI
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-5xl font-bold mb-4">Odds on Deck</h1>
          <div className="bg-red-900/20 border border-red-600 rounded-lg p-6 mb-8">
            <p className="text-red-200">
              ⚠️ Unable to load games at this moment.
            </p>
            <p className="text-red-300 text-sm mt-2">
              Try refreshing the page. If the issue persists, please check back in a few moments.
            </p>
          </div>
          <Link href="/games" className="text-blue-400 hover:text-blue-300 underline">
            → Try Viewing All Games Anyway
          </Link>
        </div>
      </div>
    )
  }
}

