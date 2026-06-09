'use client'

import { useState, useEffect } from 'react'
import ShareButton from './ShareButton'
import { cn } from '../lib/utils'
import { BookBadge } from './ui'

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

const BET_TYPE_LABEL = {
  moneyline: 'ML',
  spread: 'SPR',
  total: 'TOT',
  prop: 'PROP',
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
      case 'very_high': return 'bg-green-500/10 text-green-400 border-green-500/20'
      case 'high': return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'low': return 'bg-red-500/10 text-red-400 border-red-500/20'
      default: return 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
    }
  }

  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Generated Parlays
        </h2>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showHelp ? 'Close' : 'What do these mean?'}
        </button>
      </div>

      {/* Help Panel */}
      {showHelp && (
        <div className="mb-4 bg-bg border border-white/[0.06] rounded-[4px] p-4 text-sm">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Understanding Your Parlay Metrics</h3>
          <div className="space-y-2 text-slate-400">
            <div>
              <span className="font-semibold text-green-400">Edge:</span> How far the best available line differs from the vig-removed market consensus.
              <span className="text-xs ml-1 text-slate-500">(Higher = more value vs the market)</span>
            </div>
            <div>
              <span className="font-semibold text-blue-400">Win Chance:</span> Combined probability based on vig-adjusted odds from the sharpest available lines.
              <span className="text-xs ml-1 text-slate-500">(Higher = more likely to hit)</span>
            </div>
            <div>
              <span className="font-semibold text-slate-200">Expected Value:</span> Average profit/loss per $1 bet over many trials at these odds.
              <span className="text-xs ml-1 text-slate-500">(Positive = profitable long-term)</span>
            </div>
            <div>
              <span className="font-semibold text-amber-400">Odds:</span> What the sportsbook pays if you win.
              <span className="text-xs ml-1 text-slate-500">(+550 = bet $100 to win $550)</span>
            </div>
            <div className="pt-2 mt-2 border-t border-white/[0.06] text-slate-500">
              Tip: Each leg is selected from the best available line across 10+ sportsbooks. Higher combined win chance means a safer parlay.
            </div>
          </div>
        </div>
      )}

      {/* Save feedback toast */}
      {saveError && (
        <div className="mb-4 p-3 bg-red-500/[0.08] border border-red-500/20 rounded-[4px] text-sm text-red-400">
          {saveError}
        </div>
      )}

      {parlays.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-slate-300 mb-1">Choose your settings and hit Generate</p>
          <p className="text-sm text-slate-500">We&apos;ll build optimized parlays from today&apos;s best available lines</p>
        </div>
      ) : (
        <div className="space-y-4">
          {parlays.map((parlay, index) => (
            <div key={index} className="border border-white/[0.06] rounded-[4px] p-4 bg-bg">
              {/* Parlay Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] bg-white/[0.05] text-slate-300 text-[11px] font-semibold tabular-nums font-mono">
                    #{index + 1}
                  </span>
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border', getConfidenceColor(parlay.confidence))}>
                    {parlay.confidence.replace('_', ' ')}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums font-mono">
                    {parlay.legs.length} legs
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold text-green-400 tabular-nums font-mono">
                    {formatOdds(parlay.totalOdds)}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums font-mono">
                    {parlay.totalOdds.toFixed(2)}x payout
                  </div>
                </div>
              </div>

              {/* Payout Calculator */}
              <div className="bg-surface border border-white/[0.06] rounded-[4px] p-3 mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Payout</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[10, 25, 50, 100].map(stake => {
                    const payout = calculatePayout(parlay.totalOdds, stake)
                    return (
                      <div key={stake} className="flex justify-between bg-bg border border-white/[0.06] rounded-[3px] px-2 py-1.5">
                        <span className="font-medium text-slate-400 tabular-nums font-mono">${stake}</span>
                        <span className="font-semibold text-green-400 tabular-nums font-mono">
                          +${payout.profit.toFixed(0)} → ${payout.totalReturn.toFixed(0)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Parlay Metrics */}
              <div className="grid grid-cols-3 gap-3 mb-3 text-center bg-surface rounded-[4px] p-3 border border-white/[0.06]">
                <div>
                  <div className="text-sm font-semibold text-green-400 tabular-nums font-mono">
                    {formatEdge(parlay.edge)}
                  </div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Edge</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {parlay.edge > 0.15 ? 'Great' : parlay.edge > 0.10 ? 'Good' : 'Decent'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-blue-400 tabular-nums font-mono">
                    {formatProbability(parlay.probability)}
                  </div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Win Chance</div>
                  <div className="text-[11px] text-slate-500 mt-1 tabular-nums font-mono">
                    1 in {parlay.probability > 0 ? Math.round(1 / parlay.probability) : '?'}
                  </div>
                </div>
                <div>
                  <div className={cn('text-sm font-semibold tabular-nums font-mono', parlay.expectedValue > 0 ? 'text-green-400' : 'text-red-400')}>
                    {parlay.expectedValue > 0 ? '+' : ''}{parlay.expectedValue.toFixed(3)}
                  </div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Exp. Value</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {parlay.expectedValue > 0 ? 'Profitable' : 'Negative'}
                  </div>
                </div>
              </div>

              {/* Parlay Legs */}
              <div className="space-y-2">
                {parlay.legs.map((leg, legIndex) => (
                  <div key={legIndex} className="flex items-center justify-between py-2 px-3 bg-surface rounded-[3px] border border-white/[0.06]">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-[3px] bg-white/[0.05] text-slate-400 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0">
                        {BET_TYPE_LABEL[leg.betType] || (leg.sport || parlay.sport || '').toUpperCase().slice(0, 3)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100">
                          {leg.betType === 'prop' 
                            ? `${leg.playerName} ${leg.selection?.toUpperCase()} ${leg.threshold} ${(leg.propType || leg.type || '').replace(/_/g, ' ')}`
                            : `${leg.team} ${leg.betType} ${leg.selection}`
                          }
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {(leg.team || leg.opponent) && (
                            <span className="text-xs text-slate-400">
                              {leg.betType === 'prop' 
                                ? (leg.team && leg.opponent ? `${leg.team} vs ${leg.opponent}` : leg.team || leg.opponent || '')
                                : leg.opponent ? `${leg.team} vs ${leg.opponent}` : leg.team || ''
                              }
                            </span>
                          )}
                          {leg.bookmaker && <BookBadge book={leg.bookmaker} />}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <div className="text-sm font-medium text-slate-100 tabular-nums font-mono">
                        {formatOdds(leg.odds)}
                      </div>
                      {leg.edge > 0.01 && (
                        <div className="text-xs text-green-400 tabular-nums font-mono">
                          +{formatEdge(leg.edge)} edge
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
                <div className="text-[11px] text-slate-500 tabular-nums font-mono" suppressHydrationWarning>
                  Generated {new Date().toLocaleTimeString()}
                </div>
                <div className="flex items-center gap-3">
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
                    className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {copiedIndex === index ? (
                      <span className="text-green-400">Copied</span>
                    ) : (
                      'Copy'
                    )}
                  </button>
                  {savedIndexes.has(index) ? (
                    <span className="text-green-400 text-xs font-medium flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved
                    </span>
                  ) : (
                    <button 
                      onClick={() => saveParlay(parlay, index)}
                      disabled={savingIndex === index}
                      className="text-xs font-medium text-green-400 hover:text-green-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingIndex === index ? 'Saving...' : 'Save'}
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
