// Game Detail Page - Detailed matchup analysis

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getGameDetail } from '../../../lib/db.js'
import { formatEdge, formatOdds, formatProbability } from '../../../lib/implied.js'
import { format } from 'date-fns'

// Import NFL components
import NFLRosterSection from '../../../components/NFLRosterSection'
import NFLMatchupSection from '../../../components/NFLMatchupSection'

export async function generateMetadata({ params }) {
  const game = await getGameDetail(params.id)
  if (!game) {
    return { title: 'Game Not Found' }
  }
  
  return {
    title: `${game.away.abbr} @ ${game.home.abbr} - Odds on Deck`,
    description: `Detailed matchup analysis for ${game.away.name} at ${game.home.name}`,
  }
}

// Revalidate every 5 minutes
export const revalidate = 300

export default async function GameDetailPage({ params }) {
  const game = await getGameDetail(params.id)
  
  if (!game) {
    notFound()
  }
  
  const edge = game.edges[0]
  const isNFL = game.sport === 'nfl'
  const isNHL = game.sport === 'nhl'
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/games"
          className="text-brand-blue hover:text-blue-700 text-sm font-medium"
        >
          ← Back to Today's Slate
        </Link>
        <div className="text-sm text-gray-600">
          {format(new Date(game.date), 'EEEE, MMMM d, yyyy h:mm a')}
        </div>
      </div>
      
      {/* Game Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          {game.away.name} @ {game.home.name}
        </h1>
        <p className="text-lg text-gray-600 mt-2">
          {game.away.abbr} @ {game.home.abbr}
        </p>
        
        {/* Live Score Display */}
        {(() => {
          // Check if game has actually started (current time >= scheduled time)
          const gameTime = new Date(game.date)
          const now = new Date()
          const hasStarted = now >= gameTime
          
          // Only show live data if game has started AND has live score
          return hasStarted && (game.status === 'in_progress' || game.homeScore !== null) && game.homeScore !== undefined
        })() ? (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-center space-x-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{game.away.abbr}</div>
                <div className="text-3xl font-bold text-blue-600">{game.awayScore}</div>
              </div>
              <div className="text-xl text-gray-500">-</div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{game.home.abbr}</div>
                <div className="text-3xl font-bold text-green-600">{game.homeScore}</div>
              </div>
            </div>
            {isNHL && game.status === 'in_progress' && (
              <div className="text-center mt-2">
                <span className="text-sm font-medium text-gray-700">
                  Game in progress
                </span>
              </div>
            )}
            {!isNHL && game.inning && (
              <div className="text-center mt-2">
                <span className="text-sm font-medium text-gray-700">
                  {game.inningHalf === 'Top' ? 'Top' : 'Bottom'} {game.inning}
                  {game.outs !== null && ` • ${game.outs} out`}
                  {(game.balls !== null || game.strikes !== null) && 
                    ` • ${game.balls || 0}-${game.strikes || 0} count`
                  }
                </span>
              </div>
            )}
            {game.lastPlay && (
              <div className="text-center mt-2">
                <span className="text-xs text-gray-600 italic">{game.lastPlay}</span>
              </div>
            )}
          </div>
        ) : game.status === 'final' && game.homeScore !== null ? (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-center space-x-6">
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900">{game.away.abbr}</div>
                <div className="text-2xl font-bold text-gray-700">{game.awayScore}</div>
              </div>
              <div className="text-lg text-gray-500">-</div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900">{game.home.abbr}</div>
                <div className="text-2xl font-bold text-gray-700">{game.homeScore}</div>
              </div>
            </div>
            <div className="text-center mt-2">
              <span className="text-sm font-medium text-gray-600">Final</span>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              {game.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        )}
      </div>
      
      {/* Key Stats Cards - Only show if we have data */}
      {(() => {
        // Get odds data
        const spreadOdds = game.odds?.find(o => o.market === 'spreads')
        const totalOdds = game.odds?.find(o => o.market === 'totals')
        const h2hOdds = game.odds?.find(o => o.market === 'h2h')
        const hasNflData = game.nflData && (game.nflData.quarter || game.nflData.timeLeft)
        
        // Only show cards section if we have at least one piece of data
        const hasSpread = spreadOdds?.spread != null
        const hasTotal = totalOdds?.total != null
        const hasH2H = h2hOdds && h2hOdds.priceHome != null && h2hOdds.priceAway != null
        const hasData = hasSpread || hasTotal || hasH2H || hasNflData || game.status === 'in_progress'
        
        if (!hasData) return null
        
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {isNFL ? (
              <>
                {spreadOdds?.spread && (
                  <StatCard
                    title="Spread"
                    value={`${spreadOdds.spread > 0 ? '+' : ''}${spreadOdds.spread}`}
                    subtitle={`${spreadOdds.book || 'Latest'}`}
                  />
                )}
                {totalOdds?.total && (
                  <StatCard
                    title="Total"
                    value={totalOdds.total.toFixed(1)}
                    subtitle={`O/U ${totalOdds.book || 'Latest'}`}
                  />
                )}
                {(hasNflData || game.status === 'in_progress') && (
                  <StatCard
                    title="Quarter"
                    value={game.nflData?.quarter ? `Q${game.nflData.quarter}` : (game.status === 'in_progress' ? 'Live' : 'Pre-Game')}
                    subtitle={game.nflData?.timeLeft || game.status}
                  />
                )}
                {h2hOdds && h2hOdds.priceHome != null && h2hOdds.priceAway != null && (
                  <StatCard
                    title="Moneyline"
                    value={`${h2hOdds.priceHome > 0 ? '+' : ''}${h2hOdds.priceHome} / ${h2hOdds.priceAway > 0 ? '+' : ''}${h2hOdds.priceAway}`}
                    subtitle={`Home / Away`}
                  />
                )}
              </>
            ) : isNHL ? (
              <>
                {spreadOdds?.spread && (
                  <StatCard
                    title="Puck Line"
                    value={`${spreadOdds.spread > 0 ? '+' : ''}${spreadOdds.spread}`}
                    subtitle={`Goal spread`}
                  />
                )}
                {totalOdds?.total && (
                  <StatCard
                    title="Total"
                    value={totalOdds.total.toFixed(1)}
                    subtitle="Over/Under goals"
                  />
                )}
                {h2hOdds && (
                  <StatCard
                    title="ML Odds"
                    value={`${h2hOdds.priceHome > 0 ? '+' : ''}${h2hOdds.priceHome} / ${h2hOdds.priceAway > 0 ? '+' : ''}${h2hOdds.priceAway}`}
                    subtitle="Home / Away"
                  />
                )}
                <StatCard
                  title="Status"
                  value={game.status === 'in_progress' ? '🔴 Live' : game.status}
                  subtitle={game.status === 'in_progress' ? 'Game in progress' : 'Scheduled'}
                />
              </>
            ) : (
              <>
                {edge?.ourTotal && (
                  <StatCard
                    title="Our Total"
                    value={edge.ourTotal.toFixed(1)}
                    subtitle="Projected runs"
                  />
                )}
                {edge && (
                  <>
                    <StatCard
                      title="ML Edge"
                      value={getBestMlEdge(edge)}
                      subtitle="Moneyline value"
                      className={getBestMlEdgeClass(edge)}
                    />
                    <StatCard
                      title="Total Edge"
                      value={getBestTotalEdge(edge)}
                      subtitle="Over/Under value"
                      className={getBestTotalEdgeClass(edge)}
                    />
                  </>
                )}
                {game.home?.parkFactor && (
                  <StatCard
                    title="Park Factor"
                    value={game.home.parkFactor.toFixed(2)}
                    subtitle="Run environment"
                  />
                )}
              </>
            )}
          </div>
        )
      })()}
      
      {/* Probable Pitchers - Only for MLB */}
      {!isNFL && !isNHL && game.sport === 'mlb' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PitcherCard
            team={game.away}
            pitcher={game.probableAwayPitcher}
            title="Away Starter"
          />
          <PitcherCard
            team={game.home}
            pitcher={game.probableHomePitcher}
            title="Home Starter"
          />
        </div>
      )}

      {/* NFL Specific Data */}
      {isNFL && game.nflData && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Game Details</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <span className="text-sm font-medium text-gray-600">Status:</span>
                <span className="ml-2 text-sm text-gray-900 capitalize">{game.status.replace('_', ' ')}</span>
              </div>
              {game.nflData.quarter && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Quarter:</span>
                  <span className="ml-2 text-sm text-gray-900">Q{game.nflData.quarter}</span>
                </div>
              )}
              {game.nflData.timeLeft && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Time Left:</span>
                  <span className="ml-2 text-sm text-gray-900">{game.nflData.timeLeft}</span>
                </div>
              )}
              {game.nflData.lastPlay && (
                <div className="md:col-span-3">
                  <span className="text-sm font-medium text-gray-600">Last Play:</span>
                  <span className="ml-2 text-sm text-gray-900">{game.nflData.lastPlay}</span>
                </div>
              )}
              {!game.nflData.quarter && !game.nflData.timeLeft && game.status === 'in_progress' && (
                <div className="md:col-span-3">
                  <p className="text-sm text-gray-500 italic">Live game data updating...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* NFL Roster and Matchup Analysis */}
      {isNFL && (
        <>
          <NFLRosterSection gameId={game.id} />
          <NFLMatchupSection gameId={game.id} />
        </>
      )}
      
      {/* Batting Lineups - Only for MLB */}
      {!isNFL && !isNHL && game.sport === 'mlb' && game.lineups && game.lineups.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Starting Lineups
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Today's batting order (1-9)
            </p>
          </div>
          <div className="p-6">
            <BattingLineupTable game={game} />
          </div>
        </div>
      )}
      
      {/* Batter vs Pitcher Analysis - Only for MLB */}
      {!isNFL && !isNHL && game.sport === 'mlb' && (game.probableHomePitcher || game.probableAwayPitcher) && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Batter vs Pitcher Matchups
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Projected performance based on handedness and historical patterns
            </p>
          </div>
          <div className="p-6">
            <BatterVsPitcherTable game={game} />
          </div>
        </div>
      )}
      
      {/* NHL Game Details Section */}
      {isNHL && (
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Game Information</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <span className="text-sm font-medium text-gray-600">Status:</span>
                <span className="ml-2 text-sm text-gray-900 capitalize">
                  {game.status === 'in_progress' ? '🔴 Live' : game.status.replace('_', ' ')}
                </span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Date & Time:</span>
                <span className="ml-2 text-sm text-gray-900">
                  {format(new Date(game.date), 'MMM d, yyyy h:mm a')}
                </span>
              </div>
              {game.homeScore !== null && game.awayScore !== null && (
                <div>
                  <span className="text-sm font-medium text-gray-600">Score:</span>
                  <span className="ml-2 text-sm text-gray-900">
                    {game.away.abbr} {game.awayScore} - {game.homeScore} {game.home.abbr}
                  </span>
                </div>
              )}
            </div>
            {game.status === 'scheduled' && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Game Scheduled:</strong> This game is scheduled for {format(new Date(game.date), 'MMMM d, yyyy')} at {format(new Date(game.date), 'h:mm a')}.
                </p>
                <p className="text-xs text-blue-700 mt-2">
                  Odds and live data will be available closer to game time.
                </p>
              </div>
            )}
            {game.status === 'in_progress' && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800">
                  <strong>🔴 Game in Progress:</strong> Live updates are being fetched.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Odds History */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Odds</h2>
          <p className="text-sm text-gray-600 mt-1">
            Latest betting lines from various books
          </p>
        </div>
        <div className="p-6">
          {isNHL && (!game.odds || game.odds.length === 0) ? (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-4">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600 mb-2">No odds data available yet</p>
              <p className="text-xs text-gray-500 mb-4">
                Odds are typically available 24-48 hours before game time
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-4 text-left">
                <p className="text-xs font-medium text-gray-700 mb-2">To fetch odds for this game:</p>
                <code className="block text-xs bg-gray-800 text-gray-100 p-2 rounded mt-2">
                  node scripts/fetch-live-odds.js nhl {game.date ? new Date(game.date).toISOString().split('T')[0] : 'YYYY-MM-DD'}
                </code>
              </div>
            </div>
          ) : (
            <OddsTable odds={game.odds} isNFL={isNFL} isNHL={isNHL} />
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, subtitle, className = 'text-gray-900' }) {
  return (
    <div className="card p-6 text-center">
      <h3 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
        {title}
      </h3>
      <p className={`text-2xl font-bold mt-2 ${className}`}>{value}</p>
      <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
    </div>
  )
}

function PitcherCard({ team, pitcher, title }) {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-3">
        <div>
          <span className="text-sm font-medium text-gray-600">Team:</span>
          <span className="ml-2 text-sm text-gray-900">
            {team.name} ({team.abbr})
          </span>
        </div>
        {pitcher ? (
          <>
            <div>
              <span className="text-sm font-medium text-gray-600">Pitcher:</span>
              <span className="ml-2 text-sm text-gray-900">{pitcher.fullName}</span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">Throws:</span>
              <span className="ml-2 text-sm text-gray-900">
                {pitcher.throws || 'Unknown'}
              </span>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-600">Probable pitcher TBD</div>
        )}
      </div>
    </div>
  )
}

function BatterVsPitcherTable({ game }) {
  return (
    <div className="space-y-8">
      {/* Home Batters vs Away Pitcher */}
      {game.probableAwayPitcher && game.home.players && (
        <div>
          <h4 className="font-medium text-gray-900 mb-4">
            {game.home.abbr} Batters vs {game.probableAwayPitcher.fullName} ({game.probableAwayPitcher.throws}HP)
          </h4>
          <MatchupTable 
            batters={game.home.players.slice(0, 12)} 
            pitcher={game.probableAwayPitcher}
            teamAbbr={game.home.abbr}
          />
        </div>
      )}
      
      {/* Away Batters vs Home Pitcher */}
      {game.probableHomePitcher && game.away.players && (
        <div>
          <h4 className="font-medium text-gray-900 mb-4">
            {game.away.abbr} Batters vs {game.probableHomePitcher.fullName} ({game.probableHomePitcher.throws}HP)
          </h4>
          <MatchupTable 
            batters={game.away.players.slice(0, 12)} 
            pitcher={game.probableHomePitcher}
            teamAbbr={game.away.abbr}
          />
        </div>
      )}
    </div>
  )
}

function MatchupTable({ batters, pitcher, teamAbbr }) {
  const { getBatterVsPitcherMatchup } = require('../../../lib/edge.js')

  if (!batters || batters.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-center">
          <div className="text-yellow-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-800">
              <strong>Limited Player Data:</strong> No roster information available for {teamAbbr}. 
              This team wasn't included in our sample dataset.
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              Add more teams to the seed data to see detailed matchup analysis.
            </p>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="table-header px-3 py-2 text-left">#</th>
            <th className="table-header px-3 py-2 text-left">Batter</th>
            <th className="table-header px-3 py-2 text-left">Hand</th>
            <th className="table-header px-3 py-2 text-left">vs {pitcher.throws}HP</th>
            <th className="table-header px-3 py-2 text-left">Proj OPS</th>
            <th className="table-header px-3 py-2 text-left">Advantage</th>
            <th className="table-header px-3 py-2 text-left">Outlook</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {batters.map((batter, index) => {
            const matchup = getBatterVsPitcherMatchup(batter, pitcher)
            return (
              <BatterRow 
                key={batter.id} 
                position={index + 1}
                batter={batter} 
                matchup={matchup} 
                pitcherHand={pitcher.throws}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BatterRow({ position, batter, matchup, pitcherHand }) {
  const getAdvantageColor = (advantage) => {
    if (advantage > 0.05) return 'text-green-600 font-medium'
    if (advantage < -0.05) return 'text-red-600 font-medium'
    return 'text-gray-600'
  }
  
  const getRecommendationIcon = (recommendation) => {
    switch (recommendation) {
      case 'strong_favorable': return '🔥'
      case 'favorable': return '✅'
      case 'unfavorable': return '❌'
      default: return '➖'
    }
  }
  
  const getRecommendationText = (recommendation) => {
    switch (recommendation) {
      case 'strong_favorable': return 'Strong'
      case 'favorable': return 'Favorable'
      case 'unfavorable': return 'Tough'
      default: return 'Neutral'
    }
  }
  
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 text-sm text-gray-600">{position}</td>
      <td className="px-3 py-2">
        <div className="text-sm font-medium text-gray-900">
          {batter.fullName}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-gray-600">
        {batter.bats || 'Unknown'}
      </td>
      <td className="px-3 py-2 text-sm">
        {matchup.batterStats ? (
          <div>
            <div className="font-medium">
              {matchup.batterStats.wOBA ? matchup.batterStats.wOBA.toFixed(3) : 'N/A'} wOBA
            </div>
            <div className="text-xs text-gray-500">
              {matchup.batterStats.samplePA} PA
            </div>
          </div>
        ) : (
          <span className="text-gray-400">No data</span>
        )}
      </td>
      <td className="px-3 py-2 text-sm font-medium">
        {matchup.projectedOPS.toFixed(3)}
      </td>
      <td className={`px-3 py-2 text-sm ${getAdvantageColor(matchup.platoonAdvantage)}`}>
        {matchup.platoonAdvantage > 0 ? '+' : ''}{(matchup.platoonAdvantage * 100).toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-sm">
        <div className="flex items-center space-x-1">
          <span>{getRecommendationIcon(matchup.recommendation)}</span>
          <span className="text-xs">
            {getRecommendationText(matchup.recommendation)}
          </span>
        </div>
      </td>
    </tr>
  )
}

function BattingLineupTable({ game }) {
  if (!game.lineups || game.lineups.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Lineups not yet available</p>
        <p className="text-sm text-gray-400 mt-1">
          Lineups are typically announced 2-3 hours before game time
        </p>
      </div>
    )
  }

  // Separate lineups by team
  const homeLineup = game.lineups
    .filter(l => l.team === 'home' && l.battingOrder)
    .sort((a, b) => a.battingOrder - b.battingOrder)
  
  const awayLineup = game.lineups
    .filter(l => l.team === 'away' && l.battingOrder)
    .sort((a, b) => a.battingOrder - b.battingOrder)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Away Team Lineup */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {game.away.name} Batting Order
        </h3>
        {awayLineup.length > 0 ? (
          <div className="space-y-2">
            {awayLineup.map((lineup) => (
              <div key={lineup.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-blue-600 w-6">
                    {lineup.battingOrder}
                  </span>
                  <div>
                    <div className="font-medium text-gray-900">
                      {lineup.player.fullName}
                    </div>
                    <div className="text-sm text-gray-500">
                      {lineup.position && `${lineup.position} • `}
                      {lineup.player.bats ? `Bats ${lineup.player.bats}` : 'Unknown'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {lineup.player.splits && lineup.player.splits.length > 0 && (
                    <div className="text-sm">
                      <div className="font-medium">
                        {lineup.player.splits[0].wOBA?.toFixed(3) || 'N/A'} wOBA
                      </div>
                      <div className="text-xs text-gray-500">
                        {lineup.player.splits[0].samplePA} PA
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">Lineup not yet announced</p>
        )}
      </div>

      {/* Home Team Lineup */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {game.home.name} Batting Order
        </h3>
        {homeLineup.length > 0 ? (
          <div className="space-y-2">
            {homeLineup.map((lineup) => (
              <div key={lineup.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-green-600 w-6">
                    {lineup.battingOrder}
                  </span>
                  <div>
                    <div className="font-medium text-gray-900">
                      {lineup.player.fullName}
                    </div>
                    <div className="text-sm text-gray-500">
                      {lineup.position && `${lineup.position} • `}
                      {lineup.player.bats ? `Bats ${lineup.player.bats}` : 'Unknown'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {lineup.player.splits && lineup.player.splits.length > 0 && (
                    <div className="text-sm">
                      <div className="font-medium">
                        {lineup.player.splits[0].wOBA?.toFixed(3) || 'N/A'} wOBA
                      </div>
                      <div className="text-xs text-gray-500">
                        {lineup.player.splits[0].samplePA} PA
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">Lineup not yet announced</p>
        )}
      </div>
    </div>
  )
}

function OddsTable({ odds, isNFL, isNHL }) {
  if (!odds || odds.length === 0) {
    return <div className="text-sm text-gray-600">No odds data available</div>
  }
  
  // Group odds by market
  const h2hOdds = odds.filter(o => o.market === 'h2h').slice(0, 5)
  const spreadOdds = odds.filter(o => o.market === 'spreads').slice(0, 5)
  const totalOdds = odds.filter(o => o.market === 'totals').slice(0, 5)
  
  return (
    <div className="space-y-6">
      {h2hOdds.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">Moneyline</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Book
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Away
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Home
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {h2hOdds.map((odds, idx) => (
                  <tr key={idx}>
                    <td className="py-2 text-sm text-gray-900">{odds.book}</td>
                    <td className="py-2 text-sm text-gray-900">
                      {formatOdds(odds.priceAway)}
                    </td>
                    <td className="py-2 text-sm text-gray-900">
                      {formatOdds(odds.priceHome)}
                    </td>
                    <td className="py-2 text-sm text-gray-600">
                      {format(new Date(odds.ts), 'h:mm a')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Spread odds for NFL or NHL */}
      {(isNFL || isNHL) && spreadOdds.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">Spread</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Book
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    {isNHL ? 'Puck Line' : 'Spread'}
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Away
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Home
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {spreadOdds.map((odds, index) => (
                  <tr key={index}>
                    <td className="py-2 text-sm text-gray-900">{odds.book}</td>
                    <td className="py-2 text-sm font-medium text-gray-900">
                      {odds.spread > 0 ? `+${odds.spread}` : odds.spread}
                    </td>
                    <td className="py-2 text-sm text-gray-900">
                      {odds.priceAway > 0 ? `+${odds.priceAway}` : odds.priceAway}
                    </td>
                    <td className="py-2 text-sm text-gray-900">
                      {odds.priceHome > 0 ? `+${odds.priceHome}` : odds.priceHome}
                    </td>
                    <td className="py-2 text-xs text-gray-500">
                      {format(new Date(odds.ts), 'h:mm a')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {totalOdds.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">Totals</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Book
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Total
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Over
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Under
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {totalOdds.map((odds, idx) => (
                  <tr key={idx}>
                    <td className="py-2 text-sm text-gray-900">{odds.book}</td>
                    <td className="py-2 text-sm text-gray-900">
                      {odds.total ? odds.total.toFixed(1) : 'N/A'}
                    </td>
                    <td className="py-2 text-sm text-gray-900">
                      {formatOdds(odds.priceHome)}
                    </td>
                    <td className="py-2 text-sm text-gray-900">
                      {formatOdds(odds.priceAway)}
                    </td>
                    <td className="py-2 text-sm text-gray-600">
                      {format(new Date(odds.ts), 'h:mm a')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper functions
function getBestMlEdge(edge) {
  if (!edge) return 'N/A'
  const homeEdge = edge.edgeMlHome || 0
  const awayEdge = edge.edgeMlAway || 0
  const bestEdge = Math.abs(homeEdge) > Math.abs(awayEdge) ? homeEdge : awayEdge
  return formatEdge(bestEdge * 100).text // Convert decimal to percentage
}

function getBestMlEdgeClass(edge) {
  if (!edge) return 'text-gray-600'
  const homeEdge = edge.edgeMlHome || 0
  const awayEdge = edge.edgeMlAway || 0
  const bestEdge = Math.abs(homeEdge) > Math.abs(awayEdge) ? homeEdge : awayEdge
  return formatEdge(bestEdge * 100).className // Convert decimal to percentage
}

function getBestTotalEdge(edge) {
  if (!edge) return 'N/A'
  const overEdge = edge.edgeTotalO || 0
  const underEdge = edge.edgeTotalU || 0
  const bestEdge = Math.abs(overEdge) > Math.abs(underEdge) ? overEdge : underEdge
  return formatEdge(bestEdge * 100).text // Convert decimal to percentage
}

function getBestTotalEdgeClass(edge) {
  if (!edge) return 'text-gray-600'
  const overEdge = edge.edgeTotalO || 0
  const underEdge = edge.edgeTotalU || 0
  const bestEdge = Math.abs(overEdge) > Math.abs(underEdge) ? overEdge : underEdge
  return formatEdge(bestEdge * 100).className // Convert decimal to percentage
}

