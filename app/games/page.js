// Today's Slate - Main games listing page

import Link from 'next/link'
import { getAllData } from '../../lib/data-manager.js'
import { formatEdge, formatOdds } from '../../lib/implied.js'
import { format } from 'date-fns'
import { PrismaClient } from '@prisma/client'
import SimpleRefreshButton from '../../components/SimpleRefreshButton'
import LiveScoreDisplay from '../../components/LiveScoreDisplay'
import ClientDate from '../../components/ClientDate'
import AutoRefreshWrapper from '../../components/AutoRefreshWrapper.js'

const prisma = new PrismaClient()

export const metadata = {
  title: "Today's Slate - Odds on Deck",
  description: 'MLB, NFL, and NHL games with matchup edges and betting insights',
}

// Force dynamic rendering to always fetch fresh data
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function GamesPage() {
  // Get all data from centralized data manager
  const { mlbGames, nflGames, nhlGames, lastUpdated } = await getAllData()
  
  // Fetch pitcher names for MLB games
  const mlbGamesWithPitchers = await Promise.all(
    mlbGames.map(async (game) => {
      const [homePitcher, awayPitcher] = await Promise.all([
        game.probableHomePitcherId ? 
          prisma.player.findUnique({ where: { id: game.probableHomePitcherId } }) : 
          null,
        game.probableAwayPitcherId ? 
          prisma.player.findUnique({ where: { id: game.probableAwayPitcherId } }) : 
          null
      ])
      
      return {
        ...game,
        probableHomePitcher: homePitcher,
        probableAwayPitcher: awayPitcher
      }
    })
  )
  
  // Helper function to check if a game has ended
  const isGameEnded = (status) => {
    const endedStatuses = ['final', 'completed', 'postponed', 'cancelled', 'suspended']
    return endedStatuses.includes(status?.toLowerCase())
  }
  
  // Helper function to check if game has actually started
  const hasGameStarted = (game) => {
    const gameTime = new Date(game.date)
    const now = new Date()
    return now >= gameTime
  }
  
  // Helper function to check if game is live (started AND has live data)
  const isGameLive = (game) => {
    return hasGameStarted(game) && (game.status === 'in_progress' || game.homeScore !== null)
  }
  
  // Filter out finished games for display
  const activeMLBGames = mlbGamesWithPitchers.filter(g => !isGameEnded(g.status))
  const activeNFLGames = nflGames.filter(g => !isGameEnded(g.status))
  const activeNHLGames = nhlGames.filter(g => !isGameEnded(g.status))
  
  if (activeMLBGames.length === 0 && activeNFLGames.length === 0 && activeNHLGames.length === 0) {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Today's Slate</h1>
        <p className="text-gray-600 mb-4">
          No games scheduled for today. Check back tomorrow!
        </p>
        <div className="text-sm text-gray-500 space-y-2">
          <p>Try fetching games manually:</p>
          <div className="flex gap-2 justify-center">
            <a
              href="/api/nhl/fetch-games"
              target="_blank"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              🏒 Fetch NHL Games
            </a>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <AutoRefreshWrapper refreshInterval={30000} refreshEndpoint="/api/refresh-all">
      <div>
        <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">All Games - Today's Slate</h1>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">
            {activeMLBGames.length + activeNFLGames.length + activeNHLGames.length} games • ⚾ {activeMLBGames.length} MLB • 🏈 {activeNFLGames.length} NFL • 🏒 {activeNHLGames.length} NHL
          </span>
        </div>
      </div>

      {/* Simple Refresh Button */}
      <SimpleRefreshButton />
      
      {/* MLB Games Section */}
      {activeMLBGames.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              ⚾ MLB Games • <ClientDate formatString="EEEE, MMMM d" />
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header px-6 py-3">Game</th>
                  <th className="table-header px-6 py-3">Probables</th>
                  <th className="table-header px-6 py-3">Market Total</th>
                  <th className="table-header px-6 py-3">Our Total</th>
                  <th className="table-header px-6 py-3">ML Edge%</th>
                  <th className="table-header px-6 py-3">O/U Edge%</th>
                  <th className="table-header px-6 py-3">ML Odds</th>
                  <th className="table-header px-6 py-3">Last Updated</th>
                  <th className="table-header px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {activeMLBGames.map((game) => (
                  <GameRow key={game.id} game={game} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* NFL Games Section */}
      {activeNFLGames.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              🏈 NFL Games • Week {nflGames[0]?.week || '?'}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header px-6 py-3">Game</th>
                  <th className="table-header px-6 py-3">Status</th>
                  <th className="table-header px-6 py-3">Score</th>
                  <th className="table-header px-6 py-3">Spread</th>
                  <th className="table-header px-6 py-3">Total</th>
                  <th className="table-header px-6 py-3">ML Odds</th>
                  <th className="table-header px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {activeNFLGames.map((game) => (
                  <NFLGameRow key={game.id} game={game} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* NHL Games Section */}
      {activeNHLGames.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              🏒 NHL Games • <ClientDate formatString="EEEE, MMMM d" />
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header px-6 py-3">Game</th>
                  <th className="table-header px-6 py-3">Status</th>
                  <th className="table-header px-6 py-3">Score</th>
                  <th className="table-header px-6 py-3">Puck Line</th>
                  <th className="table-header px-6 py-3">Total</th>
                  <th className="table-header px-6 py-3">ML Odds</th>
                  <th className="table-header px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {activeNHLGames.map((game) => (
                  <NHLGameRow key={game.id} game={game} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    </AutoRefreshWrapper>
  )
}

function GameRow({ game }) {
  const hasLiveScore = game.homeScore !== null && game.awayScore !== null
  const edge = game.edges?.[0]
  const totalOdds = game.odds?.find(o => o.market === 'totals')
  
  // Check if game has actually started (current time >= scheduled time)
  const gameTime = new Date(game.date)
  const now = new Date()
  const hasStarted = now >= gameTime
  
  // Only show live data if game has started AND has live score
  const shouldShowLiveData = hasStarted && hasLiveScore
  
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <Link href={`/game/${game.id}`} className="block hover:text-blue-600">
          <div className="flex items-center">
            <div>
              <div className="text-sm font-medium text-gray-900">
                {game.away.abbr} @ {game.home.abbr}
              </div>
              <div className="text-sm text-gray-500">
                {format(new Date(game.date), 'h:mm a')}
              </div>
              {shouldShowLiveData && (
                <LiveScoreDisplay game={game} />
              )}
            </div>
          </div>
        </Link>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        <div>
          <div>{game.probableHomePitcher?.fullName || 'TBD'}</div>
          <div>{game.probableAwayPitcher?.fullName || 'TBD'}</div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {totalOdds?.total || 'N/A'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {edge?.ourTotal ? edge.ourTotal.toFixed(1) : 'N/A'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <div className="space-y-1">
          <div className={edge?.edgeMlHome > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
            H: {edge?.edgeMlHome ? `${(edge.edgeMlHome * 100).toFixed(1)}%` : '0%'}
          </div>
          <div className={edge?.edgeMlAway > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
            A: {edge?.edgeMlAway ? `${(edge.edgeMlAway * 100).toFixed(1)}%` : '0%'}
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        <div className="space-y-1">
          <div className={edge?.edgeTotalO > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
            O: {edge?.edgeTotalO ? `${(edge.edgeTotalO * 100).toFixed(1)}%` : '0%'}
          </div>
          <div className={edge?.edgeTotalU > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
            U: {edge?.edgeTotalU ? `${(edge.edgeTotalU * 100).toFixed(1)}%` : '0%'}
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const mlOdds = game.odds?.find(o => o.market === 'h2h')
          if (!mlOdds) return 'N/A'
          return (
            <div className="flex flex-col">
              <div className="text-xs text-gray-600">Away: {mlOdds.priceAway > 0 ? '+' : ''}{mlOdds.priceAway || 'N/A'}</div>
              <div className="text-xs text-gray-600">Home: {mlOdds.priceHome > 0 ? '+' : ''}{mlOdds.priceHome || 'N/A'}</div>
            </div>
          )
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" suppressHydrationWarning>
        {edge?.ts ? format(new Date(edge.ts), 'h:mm a') : 'N/A'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <Link href={`/game/${game.id}`} className="text-blue-600 hover:text-blue-900">
          View Details
        </Link>
      </td>
    </tr>
  )
}

function NFLGameRow({ game }) {
  const hasLiveScore = game.homeScore !== null && game.awayScore !== null
  const gameStatus = game.nflData?.quarter ? 
    `Q${game.nflData.quarter} ${game.nflData.timeLeft || ''}` : 
    game.status
  
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <Link href={`/game/${game.id}`} className="block hover:text-blue-600">
          <div className="flex items-center">
            <div>
              <div className="text-sm font-medium text-gray-900">
                {game.away.abbr} @ {game.home.abbr}
              </div>
              <div className="text-sm text-gray-500">
                {format(new Date(game.date), 'EEE h:mm a')}
              </div>
            </div>
          </div>
        </Link>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
          game.status === 'in_progress' ? 'bg-green-100 text-green-800' :
          game.status === 'final' ? 'bg-gray-100 text-gray-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          {gameStatus}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        {hasLiveScore ? (
          <div className="font-bold text-blue-600">
            {game.awayScore}-{game.homeScore}
          </div>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const spreadOdds = game.odds?.find(o => o.market === 'spreads')
          return spreadOdds?.spread ? `${spreadOdds.spread > 0 ? '+' : ''}${spreadOdds.spread}` : 'N/A'
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const totalOdds = game.odds?.find(o => o.market === 'totals')
          return totalOdds?.total || 'N/A'
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const mlOdds = game.odds?.find(o => o.market === 'h2h')
          if (!mlOdds) return 'N/A'
          return (
            <div className="flex flex-col">
              <div className="text-xs text-gray-600">Away: {mlOdds.priceAway > 0 ? '+' : ''}{mlOdds.priceAway || 'N/A'}</div>
              <div className="text-xs text-gray-600">Home: {mlOdds.priceHome > 0 ? '+' : ''}{mlOdds.priceHome || 'N/A'}</div>
            </div>
          )
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <Link href={`/game/${game.id}`} className="text-blue-600 hover:text-blue-900">
          View Details
        </Link>
      </td>
    </tr>
  )
}

function NHLGameRow({ game }) {
  const hasLiveScore = game.homeScore !== null && game.awayScore !== null
  const gameStatus = game.status
  
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <Link href={`/game/${game.id}`} className="block hover:text-blue-600">
          <div className="flex items-center">
            <div>
              <div className="text-sm font-medium text-gray-900">
                {game.away.abbr} @ {game.home.abbr}
              </div>
              <div className="text-sm text-gray-500">
                {format(new Date(game.date), 'h:mm a')}
              </div>
            </div>
          </div>
        </Link>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
          game.status === 'in_progress' ? 'bg-green-100 text-green-800' :
          game.status === 'final' ? 'bg-gray-100 text-gray-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          {gameStatus}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm">
        {hasLiveScore ? (
          <div className="font-bold text-blue-600">
            {game.awayScore}-{game.homeScore}
          </div>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const spreadOdds = game.odds?.find(o => o.market === 'spreads')
          return spreadOdds?.spread ? `${spreadOdds.spread > 0 ? '+' : ''}${spreadOdds.spread}` : 'N/A'
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const totalOdds = game.odds?.find(o => o.market === 'totals')
          return totalOdds?.total || 'N/A'
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {(() => {
          const mlOdds = game.odds?.find(o => o.market === 'h2h')
          if (!mlOdds) return 'N/A'
          return (
            <div className="flex flex-col">
              <div className="text-xs text-gray-600">Away: {mlOdds.priceAway > 0 ? '+' : ''}{mlOdds.priceAway || 'N/A'}</div>
              <div className="text-xs text-gray-600">Home: {mlOdds.priceHome > 0 ? '+' : ''}{mlOdds.priceHome || 'N/A'}</div>
            </div>
          )
        })()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <Link href={`/game/${game.id}`} className="text-blue-600 hover:text-blue-900">
          View Details
        </Link>
      </td>
    </tr>
  )
}