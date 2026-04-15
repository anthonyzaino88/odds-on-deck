'use client'

import { useState, useEffect } from 'react'
import ShareButton from './ShareButton'

function formatOdds(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return '+100'
  if (decimalOdds >= 2.0) return `+${Math.round((decimalOdds - 1) * 100)}`
  return `${Math.round(-100 / (decimalOdds - 1))}`
}

function buildParlayText(parlay, index) {
  const header = `Parlay #${index + 1} | ${formatOdds(parlay.totalOdds)} (${parlay.totalOdds.toFixed(2)}x)`
  const legs = parlay.legs.map((leg, i) => {
    if (leg.betType === 'prop') {
      const propLabel = (leg.propType || leg.type || '').replace(/_/g, ' ')
      return `  ${i + 1}. ${leg.playerName} ${leg.selection} ${leg.threshold} ${propLabel} @ ${formatOdds(leg.odds)}`
    }
    return `  ${i + 1}. ${leg.team} ${leg.betType} ${leg.selection} @ ${formatOdds(leg.odds)}`
  })
  return `${header}\n${legs.join('\n')}\n— Odds on Deck`
}

export default function ParlayResults({ generatedParlays = null, onParlaySaved = null }) {
  const [parlays, setParlays] = useState([])
  const [savingIndex, setSavingIndex] = useState(null)
  const [savedIndexes, setSavedIndexes] = useState(new Set())
  const [copiedIndex, setCopiedIndex] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (generatedParlays) {
      setParlays(generatedParlays)
      setSavedIndexes(new Set())
      setSaveError(null)
    }
  }, [generatedParlays])

  const copyParlay = async (parlay, index) => {
    const text = buildParlayText(parlay, index)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const saveParlay = async (parlay, index) => {
    setSavingIndex(index)
    setSaveError(null)
    try {
      const response = await fetch('/api/parlays/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parlay })
      })
      const data = await response.json()
      if (data.success) {
        setSavedIndexes(prev => new Set(prev).add(index))
        if (onParlaySaved) onParlaySaved()
      } else {
        setSaveError(`Failed to save: ${data.error}`)
        setTimeout(() => setSaveError(null), 4000)
      }
    } catch (err) {
      setSaveError(`Error: ${err.message}`)
      setTimeout(() => setSaveError(null), 4000)
    } finally {
      setSavingIndex(null)
    }
  }

  const formatProbability = (prob) => `${(prob * 100).toFixed(1)}%`
  const formatEdge = (edge) => `${(edge * 100).toFixed(1)}%`

  const calculatePayout = (decimalOdds, stake) => {
    const profit = stake * (decimalOdds - 1)
    return {
      stake: Math.round(stake * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      totalReturn: Math.round((stake + profit) * 100) / 100
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

  const getSportIcon = (sport) => {
    switch ((sport || '').toLowerCase()) {
      case 'nfl': return '🏈'
      case 'nhl': return '🏒'
      case 'mlb': return '⚾'
      case 'nba': return '🏀'
      default: return '🎯'
    }
  }

  const getBetTypeIcon = (betType, sport) => {
    switch (betType) {
      case 'moneyline': return '🏆'
      case 'spread': return '📊'
      case 'total': return '📈'
      case 'prop': return getSportIcon(sport)
      default: return getSportIcon(sport)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">
          Generated Parlays
        </h2>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-gray-400 hover:text-gray-300 text-sm font-medium"
        >
          {showHelp ? '✕ Close' : 'What do these mean?'}
        </button>
      </div>

      {/* Help Panel */}
      {showHelp && (
        <div className="mb-6 bg-blue-900/20 border border-blue-500/50 rounded-lg p-4 text-sm">
          <h3 className="font-bold text-blue-300 mb-3">Understanding Your Parlay Metrics</h3>
          <div className="space-y-2 text-gray-300">
            <div>
              <span className="font-semibold text-green-400">Edge:</span> How far the best available line differs from the vig-removed market consensus.
              <span className="text-xs ml-1 text-gray-400">(Higher = more value vs the market)</span>
            </div>
            <div>
              <span className="font-semibold text-blue-400">Win Chance:</span> Combined probability based on vig-adjusted odds from the sharpest available lines.
              <span className="text-xs ml-1 text-gray-400">(Higher = more likely to hit)</span>
            </div>
            <div>
              <span className="font-semibold text-purple-400">Expected Value:</span> Average profit/loss per $1 bet over many trials at these odds.
              <span className="text-xs ml-1 text-gray-400">(Positive = profitable long-term)</span>
            </div>
            <div>
              <span className="font-semibold text-orange-400">Odds:</span> What the sportsbook pays if you win.
              <span className="text-xs ml-1 text-gray-400">(+550 = bet $100 to win $550)</span>
            </div>
            <div className="pt-2 mt-2 border-t border-blue-500/30">
              Tip: Each leg is selected from the best available line across 10+ sportsbooks. Higher combined win chance means a safer parlay.
            </div>
          </div>
        </div>
      )}

      {/* Save feedback toast */}
      {saveError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-500/40 rounded-lg text-sm text-red-400">
          {saveError}
        </div>
      )}

      {parlays.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <p className="text-gray-400 mb-2">Choose your settings and hit Generate</p>
          <p className="text-sm text-gray-500">We&apos;ll build optimized parlays from today&apos;s best available lines</p>
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
                    1 in {parlay.probability > 0 ? Math.round(1 / parlay.probability) : '?'} chance
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
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <span className="text-lg flex-shrink-0">{getBetTypeIcon(leg.betType, leg.sport || parlay.sport)}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">
                          {leg.betType === 'prop' 
                            ? `${leg.playerName} ${leg.selection?.toUpperCase()} ${leg.threshold} ${(leg.propType || leg.type || '').replace(/_/g, ' ')}`
                            : `${leg.team} ${leg.betType} ${leg.selection}`
                          }
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {(leg.team || leg.opponent) && (
                            <span className="text-xs text-gray-400">
                              {leg.betType === 'prop' 
                                ? (leg.team && leg.opponent ? `${leg.team} vs ${leg.opponent}` : leg.team || leg.opponent || '')
                                : leg.opponent ? `${leg.team} vs ${leg.opponent}` : leg.team || ''
                              }
                            </span>
                          )}
                          {leg.bookmaker && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-700 text-[10px] text-cyan-400 font-medium border border-slate-600">
                              {leg.bookmaker}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <div className="text-sm font-medium text-white">
                        {formatOdds(leg.odds)}
                      </div>
                      {leg.edge > 0.01 && (
                        <div className="text-xs text-green-400">
                          +{formatEdge(leg.edge)} edge
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700">
                <div className="text-xs text-gray-400" suppressHydrationWarning>
                  Generated {new Date().toLocaleTimeString()}
                </div>
                <div className="flex items-center space-x-3">
                  <ShareButton
                    prop={{
                      playerName: `${parlay.legs.length}-Leg Parlay`,
                      type: `${formatOdds(parlay.totalOdds)} (${parlay.totalOdds.toFixed(1)}x)`,
                      pick: parlay.legs.map(l => l.playerName || l.team).join(', '),
                      odds: parlay.totalOdds,
                      gameId: parlay.legs[0]?.gameId
                    }}
                    variant="icon"
                  />
                  <button
                    onClick={() => copyParlay(parlay, index)}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
                  >
                    {copiedIndex === index ? (
                      <span className="text-green-400">Copied!</span>
                    ) : (
                      '📋 Copy'
                    )}
                  </button>
                  {savedIndexes.has(index) ? (
                    <span className="text-green-400 text-sm font-medium flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved
                    </span>
                  ) : (
                    <button 
                      onClick={() => saveParlay(parlay, index)}
                      disabled={savingIndex === index}
                      className="text-green-400 hover:text-green-300 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingIndex === index ? '⏳ Saving...' : '⭐ Save'}
                    </button>
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
