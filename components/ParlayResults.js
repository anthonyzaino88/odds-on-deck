'use client'

import { useState, useEffect } from 'react'

export default function ParlayResults({ generatedParlays = null, onParlaySaved = null }) {
  const [parlays, setParlays] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savingParlay, setSavingParlay] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  // Update parlays when props change
  useEffect(() => {
    console.log('ParlayResults: generatedParlays changed:', generatedParlays)
    if (generatedParlays) {
      console.log('ParlayResults: Setting parlays from props:', generatedParlays.length)
      setParlays(generatedParlays)
      setLoading(false)
      setError(null)
    } else {
      // Fetch sample parlays on component mount if no props
      console.log('ParlayResults: No props, fetching sample parlays')
      fetchSampleParlays()
    }
  }, [generatedParlays])

  const fetchSampleParlays = async () => {
    setLoading(true)
    setError(null)
    
    try {
      console.log('ParlayResults: Fetching sample parlays...')
      const response = await fetch('/api/parlays/generate?sport=mlb&legs=3&maxParlays=5')
      const data = await response.json()
      
      console.log('ParlayResults: API response:', data)
      
      if (data.success) {
        console.log('ParlayResults: Setting sample parlays:', data.parlays.length)
        setParlays(data.parlays)
      } else {
        console.error('ParlayResults: API error:', data.error)
        setError(data.error || 'Failed to fetch parlays')
      }
    } catch (err) {
      console.error('ParlayResults: Fetch error:', err)
      setError('Error fetching parlays')
    } finally {
      setLoading(false)
    }
  }

  const formatOdds = (decimalOdds) => {
    // Convert decimal odds to American odds
    // Decimal odds < 2.0 = negative American odds
    // Decimal odds >= 2.0 = positive American odds
    if (decimalOdds >= 2.0) {
      const americanOdds = Math.round((decimalOdds - 1) * 100)
      return `+${americanOdds}`
    } else {
      const americanOdds = Math.round(-100 / (decimalOdds - 1))
      return americanOdds.toString()
    }
  }

  const saveParlay = async (parlay) => {
    setSavingParlay(parlay.id)
    try {
      console.log('Saving parlay:', parlay)
      const response = await fetch('/api/parlays/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parlay })
      })

      const data = await response.json()
      
      if (data.success) {
        console.log('✅ Parlay saved successfully:', data.parlay.id)
        alert('✅ Parlay saved successfully! Check "Your Saved Parlays" below.')
        
        // Trigger refresh of parlay history
        if (onParlaySaved) {
          onParlaySaved()
        }
      } else {
        console.error('❌ Failed to save parlay:', data.error)
        alert('Failed to save parlay: ' + data.error)
      }
    } catch (error) {
      console.error('❌ Error saving parlay:', error)
      alert('Error saving parlay: ' + error.message)
    } finally {
      setSavingParlay(null)
    }
  }

  const formatProbability = (prob) => {
    return `${(prob * 100).toFixed(1)}%`
  }

  const formatEdge = (edge) => {
    return `${(edge * 100).toFixed(1)}%`
  }

  const calculatePayout = (decimalOdds, stake) => {
    const profit = stake * (decimalOdds - 1)
    const totalReturn = stake + profit
    
    return {
      stake: Math.round(stake * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100
    }
  }

  const convertToDecimalOdds = (americanOdds) => {
    if (americanOdds > 0) {
      return (americanOdds / 100) + 1
    } else {
      return (100 / Math.abs(americanOdds)) + 1
    }
  }

  const getConfidenceColor = (confidence) => {
    switch (confidence) {
      case 'very_high': return 'bg-green-900/30 text-green-400 border-green-500/50'
      case 'high': return 'bg-blue-900/30 text-blue-400 border-blue-500/50'
      case 'medium': return 'bg-yellow-900/30 text-yellow-400 border-yellow-500/50'
      case 'low': return 'bg-red-900/30 text-red-400 border-red-500/50'
      default: return 'bg-slate-700 text-gray-400 border-slate-600'
    }
  }

  const getBetTypeIcon = (betType) => {
    switch (betType) {
      case 'moneyline': return '🏆'
      case 'spread': return '📊'
      case 'total': return '📈'
      case 'prop': return '⚾'
      default: return '🎯'
    }
  }

  if (loading) {
    return (
      <div className="card p-6">
        <h2 className="text-2xl font-bold text-white mb-6">
          📊 Generated Parlays
        </h2>
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-blue-400 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-400">Generating optimized parlays...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6">
        <h2 className="text-2xl font-bold text-white mb-6">
          📊 Generated Parlays
        </h2>
        <div className="text-center py-12">
          <div className="text-red-400 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchSampleParlays}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
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
        <h2 className="text-2xl font-bold text-white">
          📊 Generated Parlays
        </h2>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="text-gray-400 hover:text-gray-300 text-sm font-medium"
          >
            {showHelp ? '✕ Close Help' : 'ℹ️ What do these mean?'}
          </button>
          <button
            onClick={fetchSampleParlays}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Help Panel */}
      {showHelp && (
        <div className="mb-6 bg-blue-900/20 border border-blue-500/50 rounded-lg p-4 text-sm">
          <h3 className="font-bold text-blue-300 mb-3">📚 Understanding Your Parlay Metrics</h3>
          <div className="space-y-2 text-gray-300">
            <div>
              <span className="font-semibold text-green-400">Edge:</span> Your mathematical advantage over the sportsbook. 
              <span className="text-xs ml-1 text-gray-400">(10%+ = strong value, 20%+ = exceptional)</span>
            </div>
            <div>
              <span className="font-semibold text-blue-400">Win Chance:</span> Our model's calculated probability this parlay wins.
              <span className="text-xs ml-1 text-gray-400">(Higher = more likely to hit)</span>
            </div>
            <div>
              <span className="font-semibold text-purple-400">Expected Value:</span> Average profit/loss per $1 bet over many trials.
              <span className="text-xs ml-1 text-gray-400">(Positive = profitable long-term)</span>
            </div>
            <div>
              <span className="font-semibold text-orange-400">Odds:</span> What the sportsbook pays if you win.
              <span className="text-xs ml-1 text-gray-400">(+550 = bet $100 to win $550)</span>
            </div>
            <div className="pt-2 mt-2 border-t border-blue-500/30">
              <span className="font-semibold">💡 Tip:</span> Look for parlays with <span className="font-bold">high edge</span> (10%+) 
              and <span className="font-bold">positive expected value</span> for the best long-term results!
            </div>
          </div>
        </div>
      )}

      {parlays.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <p className="text-gray-400 mb-4">No parlays generated yet</p>
          <p className="text-sm text-gray-500">Use the builder to generate optimized parlays</p>
        </div>
      ) : (
        <div className="space-y-4">
          {parlays.map((parlay, index) => (
            <div key={index} className="border border-slate-700 rounded-lg p-4 hover:border-blue-500 hover:shadow-md transition-all bg-slate-800/50">
              {/* Parlay Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <span className="bg-blue-600 text-white text-xs font-medium px-2.5 py-0.5 rounded">
                    #{index + 1}
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded ${getConfidenceColor(parlay.confidence)}`}>
                    {parlay.confidence.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-gray-400">
                    {parlay.legs.length} Legs
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-green-400">
                    {formatOdds(parlay.totalOdds)}
                  </div>
                  <div className="text-xs text-gray-400">
                    ({parlay.totalOdds.toFixed(2)}x payout)
                  </div>
                </div>
              </div>

              {/* Payout Calculator */}
              <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 border border-green-500/30 rounded-lg p-4 mb-4">
                <div className="text-sm font-bold text-white mb-2">💰 Payout Calculator</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[10, 25, 50, 100].map(stake => {
                    const payout = calculatePayout(parlay.totalOdds, stake)
                    return (
                      <div key={stake} className="flex justify-between bg-slate-700 rounded px-2 py-1.5">
                        <span className="font-medium text-gray-300">${stake}</span>
                        <span className="font-bold text-green-400">
                          +${payout.profit.toFixed(0)} → ${payout.totalReturn.toFixed(0)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Parlay Metrics */}
              <div className="grid grid-cols-3 gap-4 mb-4 text-center bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div>
                  <div className="text-sm font-bold text-green-400">
                    {formatEdge(parlay.edge)}
                  </div>
                  <div className="text-xs text-gray-400">Edge</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {parlay.edge > 0.15 ? '🔥 Great!' : parlay.edge > 0.10 ? '✅ Good' : '👍 Decent'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-bold text-blue-400">
                    {formatProbability(parlay.probability)}
                  </div>
                  <div className="text-xs text-gray-400">Win Chance</div>
                  <div className="text-xs text-gray-500 mt-1">
                    1 in {Math.round(1 / parlay.probability)} chance
                  </div>
                </div>
                <div>
                  <div className={`text-sm font-bold ${parlay.expectedValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {parlay.expectedValue > 0 ? '+' : ''}{parlay.expectedValue.toFixed(3)}
                  </div>
                  <div className="text-xs text-gray-400">Expected Value</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {parlay.expectedValue > 0 ? '📈 Profitable' : '📉 Negative'}
                  </div>
                </div>
              </div>

              {/* Parlay Legs */}
              <div className="space-y-2">
                {parlay.legs.map((leg, legIndex) => (
                  <div key={legIndex} className="flex items-center justify-between py-2 px-3 bg-slate-800 rounded border border-slate-700">
                    <div className="flex items-center space-x-3">
                      <span className="text-lg">{getBetTypeIcon(leg.betType)}</span>
                      <div>
                        <div className="text-sm font-medium text-white">
                          {leg.betType === 'prop' 
                            ? `${leg.playerName} ${(leg.propType || leg.type || '').replace(/_/g, ' ')} ${leg.selection} ${leg.threshold}`
                            : `${leg.team} ${leg.betType} ${leg.selection}`
                          }
                        </div>
                        {(leg.team || leg.opponent) && (
                          <div className="text-xs text-gray-400">
                            {leg.betType === 'prop' 
                              ? (leg.team && leg.opponent ? `${leg.team} vs ${leg.opponent}` : leg.team || leg.opponent || '')
                              : leg.opponent ? `${leg.team} vs ${leg.opponent}` : leg.team || ''
                            }
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-white">
                        {formatOdds(leg.odds)}
                      </div>
                      <div className="text-xs text-gray-400">
                        {formatEdge(leg.edge)} edge
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700">
                <div className="text-xs text-gray-400">
                  Generated {new Date().toLocaleTimeString()}
                </div>
                <div className="flex space-x-2">
                  <button className="text-blue-400 hover:text-blue-300 text-sm font-medium">
                    📋 Copy
                  </button>
                  <button 
                    onClick={() => saveParlay(parlay)}
                    disabled={savingParlay === parlay.id}
                    className="text-green-400 hover:text-green-300 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingParlay === parlay.id ? '⏳ Saving...' : '⭐ Save'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
