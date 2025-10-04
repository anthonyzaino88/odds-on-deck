import Link from 'next/link'
import { format } from 'date-fns'
import { getAllData } from '../lib/data-manager.js'
import SimpleRefreshButton from '../components/SimpleRefreshButton'
import AutoRefreshWrapper from '../components/AutoRefreshWrapper.js'
import LiveScoreCard from '../components/LiveScoreCard.js'

export default async function HomePage() {
  try {
    // Initialize fresh data on startup
    console.log('🚀 Home page loading - ensuring fresh data...')
    
    // Get all data from centralized data manager (will auto-refresh if stale)
    const { mlbGames, nflGames, picks, playerProps, lastUpdated } = await getAllData()
  
  const topPicks = picks.slice(0, 3)
  const topProps = playerProps.slice(0, 3) // Top 3 props for home page
  const allGames = [...mlbGames, ...nflGames]
  
  // Helper function to check if game has actually started
  const hasGameStarted = (game) => {
    const gameTime = new Date(game.date)
    const now = new Date()
    return now >= gameTime
  }
  
  // Helper function to check if game is live (started AND has live data AND not finished)
  const isGameLive = (game) => {
    return hasGameStarted(game) && !isGameEnded(game.status) && (game.status === 'in_progress' || game.status === 'warmup' || game.homeScore !== null)
  }
  
  // Helper function to check if a game has ended
  const isGameEnded = (status) => {
    const endedStatuses = ['final', 'completed', 'postponed', 'cancelled', 'suspended']
    return endedStatuses.includes(status?.toLowerCase())
  }
  
  // Sort games: Live games first, then scheduled games by time
  const sortedGames = allGames.sort((a, b) => {
    const aIsLive = isGameLive(a)
    const bIsLive = isGameLive(b)
    
    // Live games come first
    if (aIsLive && !bIsLive) return -1
    if (!aIsLive && bIsLive) return 1
    
    // Within same group (both live or both scheduled), sort by time
    return new Date(a.date) - new Date(b.date)
  })
  
  // Get live games from sorted list (live games will be first)
  const liveGames = sortedGames.filter(g => isGameLive(g)).slice(0, 4)
  
  // Sort MLB and NFL games separately with same logic
  const sortedMLBGames = mlbGames.sort((a, b) => {
    const aIsLive = isGameLive(a)
    const bIsLive = isGameLive(b)
    if (aIsLive && !bIsLive) return -1
    if (!aIsLive && bIsLive) return 1
    return new Date(a.date) - new Date(b.date)
  })
  
  const sortedNFLGames = nflGames.sort((a, b) => {
    const aIsLive = isGameLive(a)
    const bIsLive = isGameLive(b)
    if (aIsLive && !bIsLive) return -1
    if (!aIsLive && bIsLive) return 1
    return new Date(a.date) - new Date(b.date)
  })
  
  const mlbLiveGames = sortedMLBGames.filter(g => isGameLive(g))
  const nflLiveGames = sortedNFLGames.filter(g => isGameLive(g))
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🏆 Odds on Deck
          </h1>
          <p className="text-lg text-gray-600">
            Multi-Sport Betting Intelligence & Live Game Data
          </p>
          <div className="text-sm text-gray-500 mt-1" suppressHydrationWarning>
            {format(new Date(), 'EEEE, MMMM d, yyyy')} • ⚾ MLB • 🏈 NFL
          </div>
        </div>

        {/* Simple Refresh Button */}
        <SimpleRefreshButton />

        {/* Quick Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Link href="/games" className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 transition-colors">
            <div className="text-center">
              <div className="text-3xl mb-2">⚾</div>
              <div className="font-semibold text-gray-900">MLB Games</div>
              <div className="text-sm text-gray-600">{mlbGames.length} games today</div>
            </div>
          </Link>
          
          <Link href="/games" className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 transition-colors">
            <div className="text-center">
              <div className="text-3xl mb-2">🏈</div>
              <div className="font-semibold text-gray-900">All Games</div>
              <div className="text-sm text-gray-600">{allGames.length} games total</div>
            </div>
          </Link>
          
          <Link href="/picks" className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 transition-colors">
            <div className="text-center">
              <div className="text-3xl mb-2">🎯</div>
              <div className="font-semibold text-gray-900">Editor's Picks</div>
              <div className="text-sm text-gray-600">{picks.length} picks available</div>
            </div>
          </Link>
          
          <Link href="/props" className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 transition-colors">
            <div className="text-center">
              <div className="text-3xl mb-2">🏟️</div>
              <div className="font-semibold text-gray-900">Player Props</div>
              <div className="text-sm text-gray-600">{topProps.length} props available</div>
            </div>
          </Link>
          
          <Link href="/dfs" className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 transition-colors">
            <div className="text-center">
              <div className="text-3xl mb-2">💎</div>
              <div className="font-semibold text-gray-900">DFS Rankings</div>
              <div className="text-sm text-gray-600">Player values</div>
            </div>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Top Picks Section */}
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  🔥 Top Picks Today
                </h2>
                <Link href="/picks" className="text-sm text-blue-600 hover:text-blue-500">
                  View All →
                </Link>
              </div>
            </div>
            <div className="p-6">
              {topPicks.length > 0 ? (
                <div className="space-y-4">
                  {topPicks.map((pick, index) => (
                    <HomePickCard key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} rank={index + 1} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-4xl mb-2">🎯</div>
                  <p className="text-gray-500">No strong picks available yet</p>
                  <p className="text-sm text-gray-400">Check back as odds move throughout the day</p>
                </div>
              )}
            </div>
          </div>

          {/* Player Props Section */}
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  🏟️ Top Player Props
                </h2>
                <Link href="/props" className="text-sm text-blue-600 hover:text-blue-500">
                  View All →
                </Link>
              </div>
            </div>
            <div className="p-6">
              {topProps.length > 0 ? (
                <div className="space-y-3">
                  {topProps.map((prop) => (
                    <PlayerPropCard key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-4xl mb-2">🏟️</div>
                  <p className="text-gray-500">No player props yet</p>
                  <p className="text-sm text-gray-400">Lineups typically posted 2-3 hours before games</p>
                </div>
              )}
            </div>
          </div>

          {/* Live Scores Section */}
          <div className="card">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  📺 Live Scores
                </h2>
                <Link href="/games" className="text-sm text-blue-600 hover:text-blue-500">
                  View All →
                </Link>
              </div>
            </div>
            <div className="p-6">
                  {sortedGames.length > 0 ? (
                    <div className="space-y-4">
                      {/* Live Games (Active games with real-time updates) */}
                      {sortedMLBGames.filter(g => !isGameEnded(g.status) && isGameLive(g)).length > 0 && (
                        <div>
                          <div className="text-sm font-medium text-gray-700 mb-2">🔴 Live Games</div>
                          <div className="space-y-2">
                            {sortedMLBGames.filter(g => !isGameEnded(g.status) && isGameLive(g)).slice(0, 3).map((game) => (
                              <LiveScoreCard key={game.id} game={game} />
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Upcoming Games */}
                      {sortedMLBGames.filter(g => !isGameEnded(g.status) && !isGameLive(g)).length > 0 && (
                        <div>
                          <div className="text-sm font-medium text-gray-700 mb-2">⏰ Upcoming Games</div>
                          <div className="space-y-2">
                            {sortedMLBGames.filter(g => !isGameEnded(g.status) && !isGameLive(g)).slice(0, 3).map((game) => (
                              <LiveGameCard key={game.id} game={game} />
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* NFL Games */}
                      {sortedNFLGames.filter(g => !isGameEnded(g.status) && isGameLive(g)).length > 0 && (
                        <div>
                          <div className="text-sm font-medium text-gray-700 mb-2">🏈 NFL Live</div>
                          <div className="space-y-2">
                            {sortedNFLGames.filter(g => !isGameEnded(g.status) && isGameLive(g)).slice(0, 3).map((game) => (
                              <LiveScoreCard key={game.id} game={game} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-4xl mb-2">🏆</div>
                  <p className="text-gray-500">No games scheduled</p>
                  <p className="text-sm text-gray-400">Check back later</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
  } catch (error) {
    console.error('Error in HomePage:', error)
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error Loading Page</h1>
          <p className="text-gray-600">There was an error loading the application. Please try again later.</p>
        </div>
      </div>
    )
  }
}

function HomePickCard({ pick, rank }) {
  const confidenceColor = {
    'very_high': 'text-green-600',
    'high': 'text-blue-600', 
    'medium': 'text-yellow-600',
    'low': 'text-orange-600',
    'very_low': 'text-gray-600'
  }

  return (
    <Link href={`/game/${pick.gameId}`}>
      <div className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="text-lg font-bold text-blue-600">#{rank}</div>
            <div>
              <div className="font-semibold text-gray-900">
                {pick.type === 'moneyline' ? `${pick.team} ML` : `${pick.team} ${pick.pick.toUpperCase()}`}
              </div>
              <div className="text-sm text-gray-600">
                {format(new Date(pick.gameTime), 'h:mm a')}
                {pick.odds && ` • ${pick.odds > 0 ? '+' : ''}${pick.odds}`}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-lg font-bold ${confidenceColor[pick.confidence]}`}>
              +{(pick.edge * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PlayerPropCard({ prop }) {
  const propTypeEmoji = {
    'hits': '🏟️',
    'rbis': '🎯', 
    'strikeouts': '⚡'
  }

  return (
    <Link href={`/game/${prop.gameId}`}>
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
        <div className="flex items-center space-x-3">
          <div className="text-lg">{propTypeEmoji[prop.type]}</div>
          <div>
            <div className="font-medium text-gray-900">
              {prop.playerName}
            </div>
            <div className="text-sm text-gray-600">
              {prop.pick.toUpperCase()} {prop.threshold} {prop.type}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-bold text-green-600">
            +{(prop.edge * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </Link>
  )
}

function LiveGameCard({ game }) {
  const isNFL = game.sport === 'nfl'
  
  // Check if game has actually started (current time >= scheduled time)
  const gameTime = new Date(game.date)
  const now = new Date()
  const hasStarted = now >= gameTime
  
  // Consider live if game has started AND (has live data OR is in warmup/in_progress status)
  const isLive = hasStarted && (game.status === 'in_progress' || game.status === 'warmup' || game.homeScore !== null)
  
  const gameStatus = isLive ? (
    isNFL && game.nflData ? 
      `Q${game.nflData.quarter || '?'} ${game.nflData.timeLeft || ''}` :
      game.inning && game.inningHalf ? 
        `${game.inningHalf} ${game.inning}${game.outs !== null ? ` • ${game.outs} out` : ''}` :
        game.status === 'warmup' ? 'Starting Soon' :
        game.status
  ) : (
    // For scheduled games, show the game time
    format(new Date(game.date), 'h:mm a')
  )

  return (
    <Link href={`/game/${game.id}`}>
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
        <div>
          <div className="font-medium text-gray-900">
            {game.away.abbr} @ {game.home.abbr}
          </div>
          <div className="text-sm text-gray-600">
            {gameStatus}
          </div>
        </div>
        <div className="text-right">
          {isLive ? (
            <div className="text-lg font-bold text-blue-600">
              {game.awayScore !== null ? game.awayScore : 0}-{game.homeScore !== null ? game.homeScore : 0}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              {game.status}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

