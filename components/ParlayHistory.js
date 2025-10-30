'use client'

import { useState, useEffect } from 'react'

export default function ParlayHistory() {
  const [parlays, setParlays] = useState([])
  const [performance, setPerformance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchParlayHistory()
  }, [])

  const fetchParlayHistory = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/parlays/history?limit=20')
      const data = await response.json()
      
      if (data.success) {
        setParlays(data.parlays)
        setPerformance(data.performance)
      } else {
        setError(data.error || 'Failed to fetch parlay history')
      }
    } catch (err) {
      setError('Error fetching parlay history')
      console.error('Error:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatOdds = (odds) => {
    if (odds > 0) return `+${odds}`
    return odds.toString()
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getOutcomeColor = (outcome) => {
    switch (outcome) {
      case 'won': return 'text-green-600 bg-green-100'
      case 'lost': return 'text-red-600 bg-red-100'
      case 'pending': return 'text-yellow-600 bg-yellow-100'
      case 'cancelled': return 'text-gray-600 bg-gray-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          📈 Parlay History
        </h2>
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Loading parlay history...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            📋 Your Saved Parlays
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Quick reference for placing bets • Track your active parlays
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/validation"
            className="text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            📊 View Detailed Stats
          </a>
          <button
            onClick={fetchParlayHistory}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="text-2xl">💡</div>
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900 mb-1">Quick Bet Reference</h3>
            <p className="text-sm text-blue-800">
              This is your "bet sheet" - parlays you've saved for placing bets. 
              Click <strong>📋 Copy</strong> to copy the parlay legs, then paste into your sportsbook. 
              For detailed performance analysis, visit the <a href="/validation" className="underline font-medium">Validation Dashboard</a>.
            </p>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      {performance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {performance.totalParlays}
            </div>
            <div className="text-sm text-blue-800">Total Parlays</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {performance.winRate}%
            </div>
            <div className="text-sm text-green-800">Win Rate</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {performance.avgEdge}%
            </div>
            <div className="text-sm text-purple-800">Avg Edge</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-orange-600">
              {performance.roi}%
            </div>
            <div className="text-sm text-orange-800">ROI</div>
          </div>
        </div>
      )}

      {error ? (
        <div className="text-center py-12">
          <div className="text-red-600 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchParlayHistory}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      ) : parlays.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <p className="text-gray-600 mb-4">No parlay history yet</p>
          <p className="text-sm text-gray-500">Generated parlays will appear here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {parlays.map((parlay) => (
            <div key={parlay.id} className="border border-gray-200 rounded-lg p-4">
              {/* Parlay Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className="bg-gray-100 text-gray-800 text-xs font-medium px-2.5 py-0.5 rounded">
                    {parlay.sport.toUpperCase()}
                  </span>
                  <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded">
                    {parlay.legCount}-Leg
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded ${getOutcomeColor(parlay.outcome || 'pending')}`}>
                    {parlay.outcome || 'Pending'}
                  </span>
                  <button
                    onClick={() => {
                      const text = parlay.legs.map((leg, idx) => 
                        leg.betType === 'prop' 
                          ? `${idx + 1}. ${leg.playerName || 'Player'} ${leg.propType?.replace(/_/g, ' ') || ''} ${leg.selection?.toUpperCase() || ''} ${leg.threshold || ''} (${formatOdds(leg.odds)})`
                          : `${idx + 1}. ${leg.gameIdRef || 'Game'} ${leg.betType} ${leg.selection} (${formatOdds(leg.odds)})`
                      ).join('\n')
                      navigator.clipboard.writeText(`📋 Parlay (${parlay.legCount} legs):\n${text}\n\nTotal Odds: ${formatOdds(parlay.totalOdds)} | Win Prob: ${(parlay.probability * 100).toFixed(1)}%`)
                      alert('✅ Parlay copied to clipboard!')
                    }}
                    className="text-xs text-gray-500 hover:text-blue-600 font-medium"
                    title="Copy parlay to clipboard"
                  >
                    📋 Copy
                  </button>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">
                    {formatOdds(parlay.totalOdds)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(parlay.createdAt)}
                  </div>
                </div>
              </div>

              {/* Parlay Metrics */}
              <div className="grid grid-cols-4 gap-4 mb-3 text-center text-sm">
                <div>
                  <div className="font-medium text-gray-900">
                    {(parlay.edge * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">Edge</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">
                    {(parlay.probability * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">Probability</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">
                    {parlay.expectedValue > 0 ? '+' : ''}{parlay.expectedValue.toFixed(3)}
                  </div>
                  <div className="text-xs text-gray-500">Expected Value</div>
                </div>
                <div>
                  <div className="font-medium text-gray-900">
                    {parlay.confidence.replace('_', ' ')}
                  </div>
                  <div className="text-xs text-gray-500">Confidence</div>
                </div>
              </div>

              {/* Parlay Legs Summary */}
              <div className="text-sm text-gray-600">
                <div className="font-medium mb-1">Legs:</div>
                <div className="space-y-1">
                  {parlay.legs.slice(0, 3).map((leg, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span>
                        {leg.betType === 'prop' 
                          ? `${leg.playerName || 'Player'} ${leg.propType?.replace(/_/g, ' ') || ''} ${leg.selection?.toUpperCase() || ''} ${leg.threshold || ''}`
                          : `${leg.gameIdRef || 'Game'} ${leg.betType} ${leg.selection}`
                        }
                      </span>
                      <span className="text-gray-500">
                        {formatOdds(leg.odds)}
                      </span>
                    </div>
                  ))}
                  {parlay.legs.length > 3 && (
                    <div className="text-gray-500 text-xs">
                      +{parlay.legs.length - 3} more legs
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

