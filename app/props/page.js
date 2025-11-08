// Player Props Page - Display player prop betting opportunities

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import PlayerPropsFilter from '../../components/PlayerPropsFilter.js'

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
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
            <p className="text-lg text-gray-400 mt-2">
              Find the best player prop betting opportunities
            </p>
          </div>
        </div>

        {/* Sport Filter */}
        <div className="mb-6 flex justify-center gap-3">
          {['all', 'mlb', 'nfl', 'nhl'].map((sport) => (
            <button
              key={sport}
              onClick={() => setSportFilter(sport)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                sportFilter === sport
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
              }`}
            >
              {sport === 'all' ? 'All Sports' : sport.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg">Loading player props...</div>
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
              <div className="mb-4 text-center">
                <p className="text-gray-400">
                  Found <span className="font-bold text-white">{props.length}</span> player props
                </p>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-gray-500 text-6xl mb-4">📊</div>
                <h3 className="text-lg font-medium text-white mb-2">No Player Props Available</h3>
                <p className="text-gray-400 mb-4">
                  {sportFilter === 'all' 
                    ? 'No player props found. Props are fetched via the odds script.'
                    : `No ${sportFilter.toUpperCase()} player props found.`}
                </p>
                <p className="text-sm text-gray-500">
                  Run <code className="bg-slate-800 px-2 py-1 rounded">node scripts/fetch-live-odds.js all</code> to fetch props.
                </p>
              </div>
            )}
            
            {props.length > 0 && <PlayerPropsFilter props={props} />}
          </>
        )}

        {/* Info Section */}
        <div className="mt-8 p-4 bg-blue-900/20 border border-blue-500/50 rounded-lg">
          <p className="text-sm text-blue-300">
            <strong>💡 How it works:</strong> Player props are fetched from The Odds API and cached in our database. 
            Props are automatically analyzed for betting edges and sorted by quality score.
          </p>
        </div>
      </div>
    </div>
  )
}
