'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function ParlayHistory({ refreshTrigger = 0 }) {
  const [parlays, setParlays] = useState([])
  const [performance, setPerformance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchParlayHistory()
  }, [refreshTrigger]) // Re-fetch when refreshTrigger changes

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

  const formatOdds = (decimalOdds) => {
    if (!decimalOdds || decimalOdds === 1) return '+100'
    
    if (decimalOdds >= 2) {
      const americanOdds = Math.round((decimalOdds - 1) * 100)
      return `+${americanOdds}`
    } else {
      const americanOdds = Math.round(-100 / (decimalOdds - 1))
      return `${americanOdds}`
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'won': return 'bg-green-900/30 text-green-400 border-green-500/50'
      case 'lost': return 'bg-red-900/30 text-red-400 border-red-500/50'
      case 'pending': return 'bg-yellow-900/30 text-yellow-400 border-yellow-500/50'
      case 'cancelled': return 'bg-gray-700 text-gray-400 border-gray-600'
      default: return 'bg-slate-700 text-gray-400 border-slate-600'
    }
  }

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-slate-700 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-20 bg-slate-700 rounded"></div>
            <div className="h-20 bg-slate-700 rounded"></div>
            <div className="h-20 bg-slate-700 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-center py-8">
          <div className="text-red-400 mb-2">❌</div>
          <p className="text-red-400">{error}</p>
          <button 
            onClick={fetchParlayHistory}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">
            📋 Your Saved Parlays
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Track your saved parlays • View performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/validation"
            className="text-sm text-purple-400 hover:text-purple-300 font-medium"
          >
            📊 Detailed Stats
          </Link>
          <button
            onClick={fetchParlayHistory}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="text-2xl">💡</div>
          <div className="flex-1">
            <h3 className="font-semibold text-blue-300 mb-1">Quick Bet Reference</h3>
            <p className="text-sm text-blue-200">
              This is your "bet sheet" - parlays you've saved for placing bets. 
              For detailed performance analysis, visit the <Link href="/validation" className="underline font-medium text-blue-300 hover:text-blue-200">Validation Dashboard</Link>.
            </p>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      {performance && performance.totalParlays > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="text-sm font-medium text-gray-400">Total Saved</div>
            <div className="mt-1 text-2xl font-bold text-white">{parlays.length}</div>
          </div>
          <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-4">
            <div className="text-sm font-medium text-green-400">Win Rate</div>
            <div className="mt-1 text-2xl font-bold text-green-400">{performance.winRate.toFixed(1)}%</div>
            <div className="text-xs text-green-300 mt-1">{performance.wonParlays}W / {performance.lostParlays}L</div>
          </div>
          <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-400">Avg Edge</div>
            <div className="mt-1 text-2xl font-bold text-blue-400">{(performance.avgEdge * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-purple-900/20 border border-purple-500/50 rounded-lg p-4">
            <div className="text-sm font-medium text-purple-400">ROI</div>
            <div className="mt-1 text-2xl font-bold text-purple-400">{performance.roi.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/* Parlays List */}
      {parlays.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <p className="text-gray-400 mb-2">No saved parlays yet</p>
          <p className="text-sm text-gray-500">Generate and save parlays above to track them here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {parlays.map((parlay) => (
            <div key={parlay.id} className="border border-slate-700 rounded-lg p-4 hover:border-blue-500 hover:shadow-md transition-all bg-slate-800/50">
              {/* Parlay Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium border ${getStatusColor(parlay.status)}`}>
                    {parlay.status.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-400">
                    {parlay.sport?.toUpperCase()} • {parlay.legs?.length || 0} Legs
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-green-400">
                    {formatOdds(parlay.totalOdds)}
                  </div>
                  <div className="text-xs text-gray-400">
                    ({parlay.totalOdds?.toFixed(2)}x)
                  </div>
                </div>
              </div>

              {/* Parlay Stats */}
              <div className="flex gap-4 text-xs text-gray-400 mb-3">
                <span>Win: {((parlay.probability || 0.5) * 100).toFixed(0)}%</span>
                <span>Edge: {((parlay.edge || 0) * 100).toFixed(1)}%</span>
                <span className="capitalize">{parlay.confidence || 'medium'}</span>
              </div>

              {/* Parlay Legs */}
              {parlay.legs && parlay.legs.length > 0 && (
                <div className="space-y-2">
                  {parlay.legs.map((leg, idx) => {
                    // Determine bet type and display text
                    const betType = (leg.betType || leg.propType || 'prop').toLowerCase()
                    const selectionLower = (leg.selection || '').toLowerCase()
                    
                    // Detect moneyline: betType contains 'moneyline' or 'ml', or notes mention ML
                    const isMoneyline = betType === 'moneyline' || betType === 'ml' || 
                      betType.includes('moneyline') ||
                      (leg.notes && leg.notes.toLowerCase().includes(' ml'))
                    
                    // Detect game total: betType is 'total' OR selection is over/under without a player
                    const isTotal = betType === 'total' || betType === 'over_under' || betType === 'totals' ||
                      (!leg.playerName && (selectionLower === 'over' || selectionLower === 'under'))
                    
                    // Build display name
                    let displayName = ''
                    let displayType = ''
                    
                    if (leg.playerName) {
                      // Player prop
                      displayName = leg.playerName
                      displayType = leg.propType?.replace(/_/g, ' ') || ''
                    } else if (isMoneyline) {
                      // Moneyline bet - extract team from selection or notes
                      const teamName = leg.selection || 
                        (leg.notes && leg.notes.split(' ')[0]) || 
                        'Team'
                      displayName = teamName
                      displayType = 'Moneyline'
                    } else if (isTotal) {
                      // Over/Under game total bet
                      displayName = 'Game Total'
                      const threshold = leg.threshold || 
                        (leg.notes && leg.notes.match(/[\d.]+/)?.[0]) || ''
                      displayType = `${(leg.selection || '').toUpperCase()} ${threshold}`.trim()
                    } else {
                      // Fallback - use whatever info we have
                      displayName = leg.selection || 
                        (leg.notes && leg.notes.split(' ')[0]) || 
                        'Bet'
                      // Try to make betType readable
                      displayType = (leg.propType || leg.betType || leg.notes || '')
                        .replace(/_/g, ' ')
                        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
                    }
                    
                    return (
                      <div key={leg.id || idx} className={`rounded p-2 text-sm ${
                        leg.validationResult === 'correct' ? 'bg-green-900/30 border border-green-500/30' :
                        leg.validationResult === 'incorrect' ? 'bg-red-900/30 border border-red-500/30' :
                        'bg-slate-900/50'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1">
                            {/* Result indicator */}
                            {leg.validationResult === 'correct' && (
                              <span className="text-green-400 text-lg">✅</span>
                            )}
                            {leg.validationResult === 'incorrect' && (
                              <span className="text-red-400 text-lg">❌</span>
                            )}
                            {leg.validationResult === 'push' && (
                              <span className="text-yellow-400 text-lg">🟰</span>
                            )}
                            {!leg.validationResult && leg.validationStatus !== 'completed' && (
                              <span className="text-gray-500 text-lg">⏳</span>
                            )}
                            
                            <div>
                              <span className="text-white font-medium">{displayName}</span>
                              <span className="text-gray-400 ml-2">{displayType}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            {leg.playerName ? (
                              // Player prop - show selection and threshold
                              <div className="text-gray-400">
                                {leg.selection?.toUpperCase()} {leg.threshold}
                              </div>
                            ) : isMoneyline ? (
                              // Moneyline - show ML badge
                              <div className="px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded text-xs font-medium">
                                ML
                              </div>
                            ) : (
                              // Other bets
                              <div className="text-gray-400">
                                {leg.selection?.toUpperCase()} {leg.threshold}
                              </div>
                            )}
                            {leg.actualValue !== null && leg.actualValue !== undefined && (
                              <div className="text-xs text-gray-500">
                                Actual: {leg.actualValue}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700">
                <span className="text-xs text-gray-500">
                  {formatDate(parlay.createdAt)}
                </span>
                {parlay.notes && (
                  <span className="text-xs text-gray-400 italic">
                    {parlay.notes}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
