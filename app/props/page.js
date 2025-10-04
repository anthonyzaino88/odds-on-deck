// Player Props page - Show individual player betting recommendations

import Link from 'next/link'
import { format } from 'date-fns'
import { getAllData } from '../../lib/data-manager.js'

export default async function PlayerPropsPage() {
  // Get all data from centralized data manager (includes player props)
  const { playerProps, lastUpdated } = await getAllData()
  
  // Use all props, not just top 3
  const props = playerProps
  
  // Group props by sport and type
  const mlbProps = props.filter(p => !p.type.includes('passing') && !p.type.includes('rushing') && !p.type.includes('rec'))
  const nflProps = props.filter(p => p.type.includes('passing') || p.type.includes('rushing') || p.type.includes('rec'))
  
  // Separate batting and pitching props
  const battingProps = props.filter(p => ['hits', 'rbis', 'total_bases', 'home_runs', 'batter_strikeouts'].includes(p.type))
  const pitchingProps = props.filter(p => ['pitcher_strikeouts', 'earned_runs'].includes(p.type))
  
  // NFL props
  const passingProps = props.filter(p => p.type.includes('passing'))
  const rushingProps = props.filter(p => p.type.includes('rushing'))
  const receivingProps = props.filter(p => p.type.includes('rec'))
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">
              🎯 Player Props
            </h1>
            <p className="text-lg text-gray-600 mt-2">
              Individual player betting recommendations based on matchup analysis
            </p>
            <div className="text-sm text-gray-500 mt-1">
              <span suppressHydrationWarning>Updated: {format(new Date(), 'h:mm a')}</span> • {props.length} props available
            </div>
          </div>
        </div>

        {props.length > 0 ? (
            <div className="space-y-8">
            
            {/* Sports Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">⚾</span>
                  <div>
                    <div className="font-semibold text-blue-900">MLB Props</div>
                    <div className="text-sm text-blue-700">{mlbProps.length} opportunities</div>
                  </div>
                </div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">🏈</span>
                  <div>
                    <div className="font-semibold text-green-900">NFL Props</div>
                    <div className="text-sm text-green-700">{nflProps.length} opportunities</div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Top Props */}
            <div className="card">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">
                  🔥 Best Player Props Today
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Highest-confidence opportunities with 20%+ edge (filtered for quality)
                </p>
                <div className="mt-2 text-xs text-gray-500">
                  Showing only Very High & High confidence props with significant edges
                </div>
              </div>
              <div className="p-6">
                {props.length > 0 ? (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {props.map((prop, index) => (
                      <PlayerPropCard key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} rank={index + 1} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-gray-400 text-4xl mb-2">🎯</div>
                    <p className="text-gray-500">No high-quality props available today</p>
                    <p className="text-sm text-gray-400">Check back when lineups are posted</p>
                  </div>
                )}
              </div>
            </div>

            {/* NFL Props */}
            {nflProps.length > 0 && (
              <div className="card">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-xl font-semibold text-gray-900">
                    🏈 NFL Player Props
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Football player performance bets
                  </p>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    
                    {/* Passing Props */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">🎯 Passing</h4>
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {passingProps.map((prop) => (
                          <PropRow key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} />
                        ))}
                        {passingProps.length === 0 && (
                          <p className="text-gray-500 italic text-sm">No passing props</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Rushing Props */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">🏃 Rushing</h4>
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {rushingProps.map((prop) => (
                          <PropRow key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} />
                        ))}
                        {rushingProps.length === 0 && (
                          <p className="text-gray-500 italic text-sm">No rushing props</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Receiving Props */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">🙌 Receiving</h4>
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {receivingProps.map((prop) => (
                          <PropRow key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} />
                        ))}
                        {receivingProps.length === 0 && (
                          <p className="text-gray-500 italic text-sm">No receiving props</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MLB Props by Category - Separate Batting and Pitching */}
            {(battingProps.length > 0 || pitchingProps.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Batting Props */}
                {battingProps.length > 0 && (
                  <div className="card">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">
                        ⚾ Batting Props
                      </h3>
                      <div className="text-sm text-gray-600">{battingProps.length} high-quality opportunities</div>
                    </div>
                    <div className="p-6">
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {battingProps.map((prop) => (
                          <PropRow key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Pitching Props */}
                {pitchingProps.length > 0 && (
                  <div className="card">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">
                        🎯 Pitching Props
                      </h3>
                      <div className="text-sm text-gray-600">{pitchingProps.length} high-quality opportunities</div>
                    </div>
                    <div className="p-6">
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {pitchingProps.map((prop) => (
                          <PropRow key={`${prop.gameId}-${prop.playerId}-${prop.type}`} prop={prop} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">🎯</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Player Props Available</h3>
            <p className="text-gray-600">
              Player props require lineup data. Check back once lineups are posted (typically 2-3 hours before game time).
            </p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            <strong>Player Props Disclaimer:</strong> These recommendations are based on statistical analysis and matchup data. 
            Player performance can vary significantly game-to-game. Always consider injury reports, weather, and recent form.
          </p>
        </div>
      </div>
    </div>
  )
}

function PlayerPropCard({ prop, rank }) {
  const confidenceColor = {
    'very_high': 'bg-green-100 text-green-800 border-green-200',
    'high': 'bg-blue-100 text-blue-800 border-blue-200', 
    'medium': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'low': 'bg-orange-100 text-orange-800 border-orange-200',
    'very_low': 'bg-gray-100 text-gray-800 border-gray-200'
  }

  const confidenceText = {
    'very_high': 'Very High',
    'high': 'High',
    'medium': 'Medium', 
    'low': 'Low',
    'very_low': 'Very Low'
  }

  const propTypeEmoji = {
    'hits': '🏟️',
    'rbis': '🎯', 
    'batter_strikeouts': '⚡',
    'pitcher_strikeouts': '🎯',
    'earned_runs': '🚫',
    'total_bases': '📊',
    'home_runs': '💥',
    'passing_yards': '🎯',
    'passing_tds': '🏈',
    'rushing_yards': '🏃',
    'rushing_tds': '💨',
    'receptions': '🙌',
    'recYards': '📏',
    'recTDs': '🔥'
  }

  return (
    <Link href={`/game/${prop.gameId}`}>
      <div className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="text-2xl font-bold text-blue-600">#{rank}</div>
            <div className="text-2xl">{propTypeEmoji[prop.type]}</div>
            <div>
              <div className="font-semibold text-gray-900">
                {prop.playerName} {prop.pick.toUpperCase()} {prop.threshold} {prop.type}
              </div>
              <div className="text-sm text-gray-600">
                {prop.team} vs {prop.opponent} • {format(new Date(prop.gameTime), 'h:mm a')}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {prop.reasoning}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${confidenceColor[prop.confidence]} mb-2`}>
              {confidenceText[prop.confidence]}
            </div>
            <div className="text-lg font-bold text-green-600">
              +{(prop.edge * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500">
              Proj: {prop.projection.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PropRow({ prop }) {
  const propTypeEmoji = {
    'hits': '🏟️',
    'rbis': '🎯', 
    'batter_strikeouts': '⚡',
    'pitcher_strikeouts': '🎯',
    'earned_runs': '🚫',
    'total_bases': '📊',
    'home_runs': '💥',
    'passing_yards': '🎯',
    'passing_tds': '🏈',
    'rushing_yards': '🏃',
    'rushing_tds': '💨',
    'receptions': '🙌',
    'recYards': '📏',
    'recTDs': '🔥'
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
              {prop.pick.toUpperCase()} {prop.threshold} {prop.type} • {prop.team}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-bold text-green-600">
            +{(prop.edge * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">
            {prop.projection.toFixed(2)}
          </div>
        </div>
      </div>
    </Link>
  )
}
