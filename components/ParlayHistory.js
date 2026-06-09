'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { cn } from '../lib/utils'

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
    } catch {
      setError('Error fetching parlay history')
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
      case 'won': return 'bg-green-500/10 text-green-400 border-green-500/20'
      case 'lost': return 'bg-red-500/10 text-red-400 border-red-500/20'
      case 'pending': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'cancelled': return 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
      default: return 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
    }
  }

  if (loading) {
    return (
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
        <div className="animate-pulse">
          <div className="h-3 w-40 bg-white/[0.06] rounded mb-4"></div>
          <div className="space-y-3">
            <div className="h-20 bg-white/[0.04] rounded-[4px]"></div>
            <div className="h-20 bg-white/[0.04] rounded-[4px]"></div>
            <div className="h-20 bg-white/[0.04] rounded-[4px]"></div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
        <div className="text-center py-8">
          <p className="text-sm text-red-400 mb-4">{error}</p>
          <button 
            onClick={fetchParlayHistory}
            className="px-3 py-1.5 text-xs font-medium bg-elevated hover:bg-white/[0.08] text-slate-200 border border-white/[0.06] rounded-[4px] transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Your Saved Parlays
          </h2>
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed max-w-2xl">
            <span className="text-slate-200 font-medium">Track the full record, not just the good ones.</span>{' '}
            Saved parlays stay here so you can review results over time and build a clearer
            picture of how your combinations are actually performing.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            href="/validation"
            className="text-xs text-slate-400 hover:text-slate-200 font-medium transition-colors"
          >
            Detailed Stats
          </Link>
          <button
            onClick={fetchParlayHistory}
            className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-bg border border-white/[0.06] rounded-[4px] p-3 mb-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Quick Bet Reference</h3>
        <p className="text-sm text-slate-400">
          This is your bet sheet &mdash; parlays you&apos;ve saved for placing bets.
          For detailed performance analysis, visit the{' '}
          <Link href="/validation" className="underline font-medium text-slate-300 hover:text-slate-100">Validation Dashboard</Link>.
        </p>
      </div>

      {/* Performance Metrics */}
      {performance && performance.totalParlays > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-bg border border-white/[0.06] rounded-[4px] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total Saved</div>
            <div className="mt-1 text-2xl font-semibold text-slate-100 tabular-nums font-mono">{parlays.length}</div>
          </div>
          <div className="bg-bg border border-white/[0.06] rounded-[4px] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Win Rate</div>
            <div className="mt-1 text-2xl font-semibold text-green-400 tabular-nums font-mono">{performance.winRate.toFixed(1)}%</div>
            <div className="text-[11px] text-slate-500 mt-1 tabular-nums font-mono">{performance.wonParlays}W / {performance.lostParlays}L</div>
          </div>
          <div className="bg-bg border border-white/[0.06] rounded-[4px] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Avg Edge</div>
            <div className="mt-1 text-2xl font-semibold text-blue-400 tabular-nums font-mono">{(performance.avgEdge * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-bg border border-white/[0.06] rounded-[4px] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">ROI</div>
            <div className={cn('mt-1 text-2xl font-semibold tabular-nums font-mono', performance.roi >= 0 ? 'text-green-400' : 'text-red-400')}>{performance.roi.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/* Parlays List */}
      {parlays.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-slate-300 mb-1">No saved parlays yet</p>
          <p className="text-sm text-slate-500">Generate and save parlays above to track them here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {parlays.map((parlay) => (
            <div key={parlay.id} className="border border-white/[0.06] rounded-[4px] p-4 bg-bg">
              {/* Parlay Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border', getStatusColor(parlay.status))}>
                    {parlay.status}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums font-mono">
                    {parlay.sport?.toUpperCase()} &middot; {parlay.legs?.length || 0} legs
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-green-400 tabular-nums font-mono">
                    {formatOdds(parlay.totalOdds)}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums font-mono">
                    {parlay.totalOdds?.toFixed(2)}x
                  </div>
                </div>
              </div>

              {/* Parlay Stats */}
              <div className="flex gap-4 text-[11px] text-slate-500 mb-3 tabular-nums font-mono">
                <span>Win {((parlay.probability || 0.5) * 100).toFixed(0)}%</span>
                <span>Edge {((parlay.edge || 0) * 100).toFixed(1)}%</span>
                <span className="capitalize font-sans">{parlay.confidence || 'medium'}</span>
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
                    
                    // Determine leg result - check multiple fields
                    // Priority: validationResult > outcome > status > inferred from parlay
                    const legResult = leg.validationResult || 
                      (leg.outcome === 'won' ? 'correct' : leg.outcome === 'lost' ? 'incorrect' : null) ||
                      (leg.status === 'won' ? 'correct' : leg.status === 'lost' ? 'incorrect' : null)
                    
                    // INFERENCE LOGIC:
                    // - If parlay WON → ALL legs must have won (we can infer this for any leg type)
                    // - If parlay LOST → at least one leg lost, but we don't know which
                    //   - For ML/Total without individual data, assume this leg lost (often the case)
                    //   - For player props without data, leave as pending (we genuinely don't know)
                    const parlayCompleted = parlay.status === 'won' || parlay.status === 'lost'
                    const canInferWon = !legResult && parlayCompleted && parlay.status === 'won'
                    const canInferLost = !legResult && parlayCompleted && parlay.status === 'lost' && 
                      (isMoneyline || isTotal) // Only infer lost for ML/Total (not player props)
                    
                    const isWon = legResult === 'correct' || leg.outcome === 'won' || leg.status === 'won' || canInferWon
                    const isLost = legResult === 'incorrect' || leg.outcome === 'lost' || leg.status === 'lost' || canInferLost
                    const isPush = legResult === 'push' || leg.outcome === 'push' || leg.status === 'push'
                    const isPending = !isWon && !isLost && !isPush
                    
                    const dotColor = isWon ? 'bg-green-400' : isLost ? 'bg-red-400' : isPush ? 'bg-amber-400' : 'bg-slate-600'
                    const dotTitle = isWon ? 'Won' : isLost ? 'Lost' : isPush ? 'Push' : 'Pending'
                    
                    return (
                      <div key={leg.id || idx} className={cn(
                        'rounded-[3px] p-2 text-sm border',
                        isWon ? 'bg-green-500/[0.06] border-green-500/20' :
                        isLost ? 'bg-red-500/[0.06] border-red-500/20' :
                        isPush ? 'bg-amber-500/[0.06] border-amber-500/20' :
                        'bg-surface border-white/[0.06]',
                      )}>
                      <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotColor)} title={dotTitle} />
                            <div className="min-w-0">
                              <span className="text-slate-100 font-medium">{displayName}</span>
                              <span className="text-slate-400 ml-2">{displayType}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-2">
                            {leg.playerName ? (
                              // Player prop - show selection and threshold
                              <div className="text-slate-400 tabular-nums font-mono text-xs">
                                {leg.selection?.toUpperCase()} {leg.threshold}
                              </div>
                            ) : isMoneyline ? (
                              // Moneyline - show ML badge
                              <div className="inline-flex items-center px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide">
                                ML
                              </div>
                            ) : (
                              // Other bets
                              <div className="text-slate-400 tabular-nums font-mono text-xs">
                                {leg.selection?.toUpperCase()} {leg.threshold}
                              </div>
                            )}
                            {leg.actualValue !== null && leg.actualValue !== undefined && (
                              <div className="text-[11px] text-slate-500 tabular-nums font-mono">
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
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                <span className="text-[11px] text-slate-500 tabular-nums font-mono">
                  {formatDate(parlay.createdAt)}
                </span>
                {parlay.notes && (
                  <span className="text-[11px] text-slate-400 italic">
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
