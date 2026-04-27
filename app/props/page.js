// Player Props Page - Display player prop betting opportunities

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import PlayerPropsFilter from '../../components/PlayerPropsFilter.js'
import DataFreshness from '../../components/DataFreshness.js'

export default function PropsPage() {
  const [props, setProps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sportFilter, setSportFilter] = useState('all') // 'all', 'mlb', 'nfl', 'nhl'

  useEffect(() => {
    fetchProps()
  }, [sportFilter])

  async function fetchProps() {
    try {
      setLoading(true)
      setError(null)
      
      const url = sportFilter === 'all' 
        ? '/api/props'
        : `/api/props?sport=${sportFilter}`
      
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.success) {
        setProps(data.props || [])
      } else {
        setError(data.error || 'Failed to load props')
      }
    } catch (err) {
      console.error('Error fetching props:', err)
      setError('Failed to load player props. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        
        {/* Header */}
        <div className="mb-4 sm:mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">
              📊 Player Props
            </h1>
            <p className="text-lg text-gray-400 mt-2 max-w-2xl mx-auto">
              Compare prop lines across 10+ sportsbooks side-by-side. See the best
              available number and how it stacks up against the market.
            </p>
            <div className="mt-2">
              <DataFreshness />
            </div>
          </div>
        </div>

        {/* Sport Filter */}
        <div className="mb-6">
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mb-4">
            {[
              { value: 'all', label: 'All Sports', emoji: '🎯', color: 'blue' },
              { value: 'nfl', label: 'NFL', emoji: '🏈', color: 'green' },
              { value: 'nhl', label: 'NHL', emoji: '🏒', color: 'purple' },
              { value: 'mlb', label: 'MLB', emoji: '⚾', color: 'yellow' }
            ].map((sport) => (
            <button
                key={sport.value}
                onClick={() => setSportFilter(sport.value)}
                className={`px-3 sm:px-6 py-2 sm:py-3 rounded-lg font-medium transition-all text-sm sm:text-base ${
                  sportFilter === sport.value
                    ? `bg-${sport.color}-600 text-white shadow-lg shadow-${sport.color}-500/50`
                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
              }`}
            >
                <span className="text-lg sm:text-xl mr-1 sm:mr-2">{sport.emoji}</span>
                <span className="hidden xs:inline">{sport.label}</span>
                <span className="xs:hidden">{sport.value.toUpperCase()}</span>
            </button>
          ))}
          </div>
          
          {/* Quick Stats Bar */}
          {!loading && !error && props.length > 0 && (
            <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-6 text-xs sm:text-sm text-gray-400">
              <div className="flex items-center gap-1 sm:gap-2">
                <span className="text-white font-bold">{props.length}</span>
                <span>props compared</span>
              </div>
              <div className="hidden sm:block h-4 w-px bg-slate-700"></div>
              <div className="flex items-center gap-1 sm:gap-2">
                <span className="text-green-400 font-bold">
                  {props.filter(p => (p.probability || 0) >= 0.55).length}
                </span>
                <span>strong market agreement (55%+)</span>
              </div>
              <div className="hidden sm:block h-4 w-px bg-slate-700"></div>
              <div className="flex items-center gap-1 sm:gap-2">
                <span className="text-blue-400 font-bold">
                  {props.filter(p => (p.probability || 0) >= 0.52).length}
                </span>
                <span>above breakeven (52%+)</span>
              </div>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border border-slate-700 rounded-lg p-4 bg-slate-900 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-28 bg-slate-700 rounded" />
                      <div className="h-4 w-20 bg-slate-700/50 rounded" />
                      <div className="h-5 w-14 bg-green-900/30 rounded" />
                    </div>
                    <div className="h-4 w-44 bg-slate-700/40 rounded" />
                    <div className="flex gap-4 mt-1">
                      <div className="h-3 w-16 bg-slate-700/30 rounded" />
                      <div className="h-3 w-20 bg-slate-700/30 rounded" />
                      <div className="h-3 w-18 bg-slate-700/30 rounded" />
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-4">
                    <div className="h-8 w-16 bg-slate-700/40 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 mb-6">
            <p className="text-red-400">{error}</p>
            <button
              onClick={fetchProps}
              className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Props Display */}
        {!loading && !error && (
          <>
            {props.length > 0 ? (
              <div className="mb-6">
                {/* Sport-specific header */}
                {sportFilter !== 'all' && (
                  <div className={`p-3 sm:p-4 rounded-lg mb-4 ${
                    sportFilter === 'nfl' ? 'bg-green-900/20 border border-green-500/50' :
                    sportFilter === 'nhl' ? 'bg-purple-900/20 border border-purple-500/50' :
                    'bg-yellow-900/20 border border-yellow-500/50'
                  }`}>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span className="text-2xl sm:text-3xl">
                          {sportFilter === 'nfl' ? '🏈' : sportFilter === 'nhl' ? '🏒' : '⚾'}
                        </span>
                        <div>
                          <h2 className={`text-lg sm:text-xl font-bold ${
                            sportFilter === 'nfl' ? 'text-green-400' :
                            sportFilter === 'nhl' ? 'text-purple-400' :
                            'text-yellow-400'
                          }`}>
                            {sportFilter.toUpperCase()} Props
                          </h2>
                          <p className="text-xs sm:text-sm text-gray-400">
                            {props.length} props compared
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSportFilter('all')}
                        className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs sm:text-sm transition-colors whitespace-nowrap"
                      >
                        View All
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-500 text-5xl mb-4">
                  {sportFilter === 'nfl' ? '🏈' : sportFilter === 'nhl' ? '🏒' : sportFilter === 'mlb' ? '⚾' : '📊'}
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No Player Props Available</h3>
                <p className="text-gray-400 mb-2">
                  {sportFilter === 'all' 
                    ? 'No player props are available right now. Props appear once today\'s odds are published by the sportsbooks.'
                    : `No ${sportFilter.toUpperCase()} player props available right now.`}
                </p>
                <p className="text-sm text-gray-500">
                  Props are typically available a few hours before game time.
                </p>
                {sportFilter !== 'all' && (
                  <button
                    onClick={() => setSportFilter('all')}
                    className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    View All Sports
                  </button>
                )}
              </div>
            )}
            
            {props.length > 0 && <PlayerPropsFilter props={props} />}
          </>
        )}

        {/* Info Section */}
        <div className="mt-8 p-4 bg-slate-900/60 border border-slate-700 rounded-lg">
          <p className="text-sm text-gray-400">
            <strong className="text-white">How this page works:</strong> Player props are pulled
            in real time from 10+ sportsbooks via The Odds API. Each prop is shown with the best
            available number, the bookmaker offering it, and how it compares to the rest of the
            market. Sort and filter to surface the comparisons that matter most to you.
          </p>
        </div>
      </div>
    </div>
  )
}
