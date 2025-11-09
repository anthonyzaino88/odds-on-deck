// Editor's Picks page - Show recommended bets based on betting edges

'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'
import { getQualityTier } from '../../lib/quality-score.js'

export default function PicksPage() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState('safe')
  const lastUpdated = new Date()

  useEffect(() => {
    fetchPicks()
  }, [filterMode])

  async function fetchPicks() {
    try {
      setLoading(true)
      const response = await fetch(`/api/picks?mode=${filterMode}`)
      const data = await response.json()
      
      if (data.success) {
        setPicks(data.picks || [])
      } else {
        console.error('Failed to fetch picks:', data.error)
        setPicks([])
      }
    } catch (err) {
      console.error('Error fetching picks:', err)
      setPicks([])
    } finally {
      setLoading(false)
    }
  }

  // Separate picks by sport and type
  const nhlProps = picks.filter(p => p.type === 'player_prop' && p.sport === 'nhl')
  const nhlMoneyline = picks.filter(p => p.type === 'moneyline' && p.sport === 'nhl')
  const nhlTotals = picks.filter(p => p.type === 'total' && p.sport === 'nhl')
  
  const nflProps = picks.filter(p => p.type === 'player_prop' && p.sport === 'nfl')
  const nflMoneyline = picks.filter(p => p.type === 'moneyline' && p.sport === 'nfl')
  const nflTotals = picks.filter(p => p.type === 'total' && p.sport === 'nfl')
  
  const mlbProps = picks.filter(p => p.type === 'player_prop' && p.sport === 'mlb')
  const mlbMoneyline = picks.filter(p => p.type === 'moneyline' && p.sport === 'mlb')
  const mlbTotals = picks.filter(p => p.type === 'total' && p.sport === 'mlb')
  
  const hasNHL = nhlProps.length > 0 || nhlMoneyline.length > 0 || nhlTotals.length > 0
  const hasNFL = nflProps.length > 0 || nflMoneyline.length > 0 || nflTotals.length > 0
  const hasMLB = mlbProps.length > 0 || mlbMoneyline.length > 0 || mlbTotals.length > 0
  
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              🎯 Editor's Picks
            </h1>
            <p className="text-base sm:text-lg text-gray-400 mt-2">
              Today's best betting opportunities based on our models
            </p>
            <div className="text-sm text-gray-500 mt-1">
              Updated: {format(lastUpdated, 'h:mm a')}
            </div>
          </div>
        </div>

        {/* Filter Mode Selector */}
        <div className="mb-6 sm:mb-8">
          <div className="card">
            <div className="px-4 sm:px-6 py-3 sm:py-4">
              <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">
                📊 Pick Strategy
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <button
                  onClick={() => setFilterMode('safe')}
                  className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                    filterMode === 'safe'
                      ? 'border-green-500 bg-green-900/30 text-white'
                      : 'border-slate-700 bg-slate-800 hover:border-green-500/50 text-gray-300'
                  }`}
                >
                  <div className="font-semibold text-xs sm:text-sm">🛡️ Safe</div>
                  <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">52%+ win</div>
                  {filterMode === 'safe' && !loading && (
                    <div className="text-[10px] sm:text-xs text-green-400 mt-1 sm:mt-2 font-medium">
                      {picks.length} picks
                    </div>
                  )}
                </button>

                <button
                  onClick={() => setFilterMode('balanced')}
                  className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                    filterMode === 'balanced'
                      ? 'border-blue-500 bg-blue-900/30 text-white'
                      : 'border-slate-700 bg-slate-800 hover:border-blue-500/50 text-gray-300'
                  }`}
                >
                  <div className="font-semibold text-xs sm:text-sm">⚖️ Balanced</div>
                  <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Best quality</div>
                  {filterMode === 'balanced' && !loading && (
                    <div className="text-[10px] sm:text-xs text-blue-400 mt-1 sm:mt-2 font-medium">
                      {picks.length} picks
                    </div>
                  )}
                </button>

                <button
                  onClick={() => setFilterMode('value')}
                  className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                    filterMode === 'value'
                      ? 'border-yellow-500 bg-yellow-900/30 text-white'
                      : 'border-slate-700 bg-slate-800 hover:border-yellow-500/50 text-gray-300'
                  }`}
                >
                  <div className="font-semibold text-xs sm:text-sm">💰 Value</div>
                  <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">10%+ edge</div>
                  {filterMode === 'value' && !loading && (
                    <div className="text-[10px] sm:text-xs text-yellow-400 mt-1 sm:mt-2 font-medium">
                      {picks.length} picks
                    </div>
                  )}
                </button>

                <button
                  onClick={() => setFilterMode('all')}
                  className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                    filterMode === 'all'
                      ? 'border-purple-500 bg-purple-900/30 text-white'
                      : 'border-slate-700 bg-slate-800 hover:border-purple-500/50 text-gray-300'
                  }`}
                >
                  <div className="font-semibold text-xs sm:text-sm">🎰 All</div>
                  <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Everything</div>
                  {filterMode === 'all' && !loading && (
                    <div className="text-[10px] sm:text-xs text-purple-400 mt-1 sm:mt-2 font-medium">
                      {picks.length} picks
                    </div>
                  )}
                </button>
              </div>

              {/* Mode Description */}
              <div className="mt-3 sm:mt-4 p-2 sm:p-3 bg-slate-800 rounded-lg border border-slate-700">
                <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
                  {filterMode === 'safe' && '🛡️ Showing picks with 52%+ win probability. Safest, most consistent opportunities.'}
                  {filterMode === 'balanced' && '⚖️ Showing picks with optimal quality scores. Best combination of probability and edge.'}
                  {filterMode === 'value' && '💰 Showing picks with 10%+ edge. Market inefficiencies with higher potential value.'}
                  {filterMode === 'all' && '🎰 Showing all available picks sorted by quality. Includes all opportunities regardless of filters.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg">Loading picks...</div>
          </div>
        )}

        {/* Picks Display */}
        {!loading && picks.length > 0 ? (
          <div className="space-y-4 sm:space-y-6">
            {/* Top 5 Best Picks Overall */}
            <div className="card">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700">
                <h2 className="text-lg sm:text-xl font-semibold text-white">
                  🔥 Top Picks Today
                </h2>
                <p className="text-xs sm:text-sm text-gray-400 mt-1">
                  Highest-quality opportunities ranked by our models
                </p>
              </div>
              <div className="p-3 sm:p-6">
                <div className="space-y-3 sm:space-y-4">
                  {picks.slice(0, 5).map((pick, index) => (
                    <PickCard key={`${pick.propId || pick.gameId}-${pick.type}-${pick.pick}-${index}`} pick={pick} rank={index + 1} />
                  ))}
                </div>
              </div>
            </div>

            {/* NHL Picks */}
            {hasNHL && (
              <div className="card">
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700 bg-gradient-to-r from-cyan-900/20 to-transparent">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl sm:text-3xl">🏒</span>
                    <div>
                      <h2 className="text-lg sm:text-xl font-semibold text-cyan-400">
                        NHL Picks
                      </h2>
                      <p className="text-xs sm:text-sm text-cyan-300 mt-0.5">
                        {nhlProps.length + nhlMoneyline.length + nhlTotals.length} opportunities
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
                  {/* NHL Player Props */}
                  {nhlProps.length > 0 && (
                    <div>
                      <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                        🎯 Player Props ({nhlProps.length})
                      </h3>
                      <div className="space-y-2 sm:space-y-3">
                        {nhlProps.map((pick) => (
                          <PickRow key={`${pick.propId}-${pick.pick}`} pick={pick} />
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* NHL Game Picks */}
                  {(nhlMoneyline.length > 0 || nhlTotals.length > 0) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {nhlMoneyline.length > 0 && (
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                            💰 Moneyline ({nhlMoneyline.length})
                          </h3>
                          <div className="space-y-2">
                            {nhlMoneyline.map((pick) => (
                              <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                            ))}
                          </div>
                        </div>
                      )}
                      {nhlTotals.length > 0 && (
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                            📊 Over/Under ({nhlTotals.length})
                          </h3>
                          <div className="space-y-2">
                            {nhlTotals.map((pick) => (
                              <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* NFL Picks */}
            {hasNFL && (
              <div className="card">
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700 bg-gradient-to-r from-green-900/20 to-transparent">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl sm:text-3xl">🏈</span>
                    <div>
                      <h2 className="text-lg sm:text-xl font-semibold text-green-400">
                        NFL Picks
                      </h2>
                      <p className="text-xs sm:text-sm text-green-300 mt-0.5">
                        {nflProps.length + nflMoneyline.length + nflTotals.length} opportunities
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
                  {/* NFL Player Props */}
                  {nflProps.length > 0 && (
                    <div>
                      <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                        🎯 Player Props ({nflProps.length})
                      </h3>
                      <div className="space-y-2 sm:space-y-3">
                        {nflProps.map((pick) => (
                          <PickRow key={`${pick.propId}-${pick.pick}`} pick={pick} />
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* NFL Game Picks */}
                  {(nflMoneyline.length > 0 || nflTotals.length > 0) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {nflMoneyline.length > 0 && (
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                            💰 Moneyline ({nflMoneyline.length})
                          </h3>
                          <div className="space-y-2">
                            {nflMoneyline.map((pick) => (
                              <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                            ))}
                          </div>
                        </div>
                      )}
                      {nflTotals.length > 0 && (
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                            📊 Over/Under ({nflTotals.length})
                          </h3>
                          <div className="space-y-2">
                            {nflTotals.map((pick) => (
                              <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* MLB Picks */}
            {hasMLB && (
              <div className="card">
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700 bg-gradient-to-r from-blue-900/20 to-transparent">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl sm:text-3xl">⚾</span>
                    <div>
                      <h2 className="text-lg sm:text-xl font-semibold text-blue-400">
                        MLB Picks
                      </h2>
                      <p className="text-xs sm:text-sm text-blue-300 mt-0.5">
                        {mlbProps.length + mlbMoneyline.length + mlbTotals.length} opportunities
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
                  {/* MLB Player Props */}
                  {mlbProps.length > 0 && (
                    <div>
                      <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                        🎯 Player Props ({mlbProps.length})
                      </h3>
                      <div className="space-y-2 sm:space-y-3">
                        {mlbProps.map((pick) => (
                          <PickRow key={`${pick.propId}-${pick.pick}`} pick={pick} />
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* MLB Game Picks */}
                  {(mlbMoneyline.length > 0 || mlbTotals.length > 0) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {mlbMoneyline.length > 0 && (
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                            💰 Moneyline ({mlbMoneyline.length})
                          </h3>
                          <div className="space-y-2">
                            {mlbMoneyline.map((pick) => (
                              <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                            ))}
                          </div>
                        </div>
                      )}
                      {mlbTotals.length > 0 && (
                        <div>
                          <h3 className="text-sm sm:text-base font-semibold text-white mb-2 sm:mb-3">
                            📊 Over/Under ({mlbTotals.length})
                          </h3>
                          <div className="space-y-2">
                            {mlbTotals.map((pick) => (
                              <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : !loading && (
          <div className="text-center py-12">
            <div className="text-gray-500 text-4xl sm:text-6xl mb-4">🎯</div>
            <h3 className="text-base sm:text-lg font-medium text-white mb-2">No Picks Match This Strategy</h3>
            <p className="text-sm sm:text-base text-gray-400">
              Try a different filter mode or check back later as odds update throughout the day.
            </p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
          <p className="text-sm text-yellow-300">
            <strong>Disclaimer:</strong> These picks are for educational purposes based on statistical models. 
            Always gamble responsibly and within your means. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </div>
  )
}

function PickCard({ pick, rank }) {
  const qualityTier = getQualityTier(pick.qualityScore || 0)
  
  const formatOdds = (odds) => {
    if (!odds) return null
    const numOdds = parseFloat(odds)
    if (isNaN(numOdds)) return null
    return numOdds > 0 ? `+${numOdds}` : numOdds.toString()
  }

  const displayOdds = formatOdds(pick.odds)
  const isPlayerProp = pick.type === 'player_prop'

  return (
    <Link href={`/game/${pick.gameId}`}>
      <div className="border border-slate-700 rounded-lg p-3 sm:p-4 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer bg-slate-800/30">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="hidden sm:block text-xl sm:text-2xl font-bold text-blue-400 min-w-[40px]">
            #{rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <div className="sm:hidden text-sm font-bold text-blue-400 min-w-[32px]">
                #{rank}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold text-sm sm:text-base text-white">
                    {isPlayerProp 
                      ? pick.playerName 
                      : pick.type === 'total' && pick.awayTeam && pick.homeTeam
                        ? `${pick.awayTeam} @ ${pick.homeTeam}`
                        : pick.team
                    }
                  </div>
                  <div className="text-xs text-gray-500">
                    {pick.sport?.toUpperCase()}
                  </div>
                </div>
                <div className="text-xs sm:text-sm text-gray-400 mt-0.5">
                  {isPlayerProp 
                    ? `${pick.pick?.toUpperCase()} ${pick.threshold} ${(pick.propType || '').replace(/_/g, ' ')}`
                    : pick.type === 'moneyline' 
                      ? `${pick.pick} ML` 
                      : pick.type === 'total'
                        ? `${pick.pick.toUpperCase()} ${pick.threshold || ''}`
                        : pick.reasoning
                  }
                </div>
                {pick.quickInsight && (
                  <div className="text-[10px] sm:text-xs text-blue-400 mt-1">
                    💡 {pick.quickInsight}
                  </div>
                )}
                <div className="flex items-center gap-2 sm:gap-3 mt-1 sm:mt-2 flex-wrap">
                  {displayOdds && (
                    <span className="text-xs sm:text-sm text-amber-400 font-bold">
                      {displayOdds}
                    </span>
                  )}
                  {pick.bookmaker && (
                    <span className="text-[10px] sm:text-xs text-gray-500">
                      via {pick.bookmaker}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 pl-10 sm:pl-0">
            <div className="flex flex-col items-end gap-1">
              <div className="text-xs text-gray-500">
                {qualityTier.emoji} {qualityTier.label}
              </div>
              <div className="text-base sm:text-lg font-bold text-green-400">
                {((pick.probability || 0.5) * 100).toFixed(0)}%
              </div>
              <div className="text-xs sm:text-sm font-semibold text-blue-400">
                +{((pick.edge || 0) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PickRow({ pick }) {
  const qualityTier = getQualityTier(pick.qualityScore || 0)
  const isPlayerProp = pick.type === 'player_prop'
  
  const formatOdds = (odds) => {
    if (!odds) return null
    const numOdds = parseFloat(odds)
    if (isNaN(numOdds)) return null
    return numOdds > 0 ? `+${numOdds}` : numOdds.toString()
  }

  const displayOdds = formatOdds(pick.odds)

  return (
    <Link href={`/game/${pick.gameId}`}>
      <div className="flex items-center justify-between p-2 sm:p-3 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer border border-slate-700">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <div className="text-base sm:text-lg">{qualityTier.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm sm:text-base text-white truncate">
              {isPlayerProp 
                ? pick.playerName 
                : pick.type === 'total' && pick.awayTeam && pick.homeTeam
                  ? `${pick.awayTeam} @ ${pick.homeTeam}`
                  : pick.team
              }
            </div>
            <div className="text-xs sm:text-sm text-gray-400 truncate">
              {isPlayerProp 
                ? `${pick.pick?.toUpperCase()} ${pick.threshold} ${(pick.propType || '').replace(/_/g, ' ')}`
                : pick.type === 'moneyline' 
                  ? `${pick.pick} ML` 
                  : pick.type === 'total'
                    ? `${pick.pick.toUpperCase()} ${pick.threshold || ''}`
                    : pick.pick.toUpperCase()
              }
            </div>
            {pick.quickInsight && (
              <div className="text-[10px] sm:text-xs text-blue-400 mt-0.5 truncate">
                {pick.quickInsight}
              </div>
            )}
            {displayOdds && (
              <div className="flex items-center gap-1 sm:gap-2 mt-0.5">
                <span className="text-[10px] sm:text-xs text-amber-400 font-semibold">
                  {displayOdds}
                </span>
                {pick.bookmaker && (
                  <span className="text-[10px] text-gray-500">
                    via {pick.bookmaker}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="text-right ml-2">
          <div className="font-semibold text-sm sm:text-base text-green-400">
            {((pick.probability || 0.5) * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] sm:text-xs text-blue-400">
            +{((pick.edge || 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </Link>
  )
}
