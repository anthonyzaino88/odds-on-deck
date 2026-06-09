'use client'

import { useState, useEffect } from 'react'

export default function NFLMatchupSection({ gameId }) {
  const [matchupData, setMatchupData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchMatchup() {
      try {
        setLoading(true)
        const response = await fetch(`/api/nfl/matchups?gameId=${gameId}`)
        const data = await response.json()
        
        if (response.ok) {
          setMatchupData(data)
        } else {
          setError(data.error || 'Failed to fetch matchup data')
        }
      } catch (error) {
        console.error('Error fetching NFL matchup:', error)
        setError('Failed to fetch matchup data')
      } finally {
        setLoading(false)
      }
    }

    if (gameId) {
      fetchMatchup()
    }
  }, [gameId])

  if (loading) {
    return (
      <div className="card">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Matchup Analysis</h2>
          <p className="text-sm text-slate-400 mt-1">
            Historical performance and offensive vs defensive trends
          </p>
        </div>
        <div className="p-4">
          <div className="text-center text-slate-400">Loading matchup analysis...</div>
        </div>
      </div>
    )
  }

  if (error || !matchupData) {
    return (
      <div className="card">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Matchup Analysis</h2>
          <p className="text-sm text-slate-400 mt-1">
            Historical performance and offensive vs defensive trends
          </p>
        </div>
        <div className="p-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">
                Away Offense vs Home Defense
              </h3>
              <div className="text-sm text-slate-400 italic">
                No historical data available
              </div>
            </div>
            <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">
                Home Offense vs Away Defense
              </h3>
              <div className="text-sm text-slate-400 italic">
                No historical data available
              </div>
            </div>
          </div>
          
          {/* Warning Message */}
          <div className="mt-6 p-4 bg-amber-500/[0.08] border border-amber-500/20 rounded-[4px]">
            <div>
              <p className="text-sm text-amber-400">
                <span className="font-semibold">Limited historical data.</span> Sample size low confidence.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Historical matchup data will be available once teams have played each other recently.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const { game, advantages, insights } = matchupData

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Matchup Analysis</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Historical performance and offensive vs defensive trends
        </p>
      </div>
      <div className="p-4 space-y-6">
        
        {/* Historical Performance */}
        <div className="grid md:grid-cols-2 gap-4">
          <MatchupCard 
            title={`${game.away.abbr} Offense vs ${game.home.abbr} Defense`}
            advantages={advantages.away}
            teamSide="away"
          />
          <MatchupCard 
            title={`${game.home.abbr} Offense vs ${game.away.abbr} Defense`}
            advantages={advantages.home}
            teamSide="home"
          />
        </div>

        {/* Key Insights */}
        {insights && insights.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Key Insights</h3>
            <div className="space-y-2">
              {insights.map((insight, index) => (
                <InsightCard key={index} insight={insight} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MatchupCard({ title, advantages, teamSide }) {
  // Check if we have any data (either historical or season stats)
  const hasData = advantages && (
    advantages.pointsAvg != null ||
    advantages.totalYardsAvg != null ||
    advantages.turnoversAvg != null ||
    advantages.thirdDownPct != null ||
    advantages.redZonePct != null
  )
  
  if (!hasData) {
    return (
      <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
        <h4 className="font-medium text-slate-300 mb-2">{title}</h4>
        <div className="text-sm text-slate-400 italic">
          No historical data available
        </div>
      </div>
    )
  }

  const getTrendColor = (trend) => {
    switch (trend) {
      case 'improving': return 'text-green-400'
      case 'declining': return 'text-red-400'
      default: return 'text-slate-400'
    }
  }

  const getEfficiencyColor = (efficiency) => {
    if (!efficiency) return 'text-slate-400'
    if (efficiency >= 70) return 'text-green-400'
    if (efficiency >= 50) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
      <h4 className="font-medium text-slate-100 mb-3">{title}</h4>
      
      <div className="space-y-2 text-sm">
        {advantages.pointsAvg != null && (
          <div className="flex justify-between">
            <span className="text-slate-400">Avg Points:</span>
            <span className="font-medium text-slate-100 tabular-nums font-mono">{advantages.pointsAvg}</span>
          </div>
        )}
        
        {advantages.totalYardsAvg != null && (
          <div className="flex justify-between">
            <span className="text-slate-400">Avg Yards:</span>
            <span className="font-medium text-slate-100 tabular-nums font-mono">{advantages.totalYardsAvg}</span>
          </div>
        )}
        
        {advantages.turnoversAvg != null && (
          <div className="flex justify-between">
            <span className="text-slate-400">Turnovers:</span>
            <span className="font-medium text-slate-100 tabular-nums font-mono">{advantages.turnoversAvg}</span>
          </div>
        )}
        
        {advantages.thirdDownPct && (
          <div className="flex justify-between">
            <span className="text-slate-400">3rd Down %:</span>
            <span className="font-medium text-slate-100 tabular-nums font-mono">{advantages.thirdDownPct}%</span>
          </div>
        )}
        
        {advantages.redZonePct && (
          <div className="flex justify-between">
            <span className="text-slate-400">Red Zone %:</span>
            <span className="font-medium text-slate-100 tabular-nums font-mono">{advantages.redZonePct}%</span>
          </div>
        )}
        
        {advantages.efficiency && (
          <div className="flex justify-between">
            <span className="text-slate-400">Efficiency:</span>
            <span className={`font-medium ${getEfficiencyColor(advantages.efficiency)}`}>
              {advantages.efficiency}/100
            </span>
          </div>
        )}
        
        <div className="flex justify-between">
          <span className="text-slate-400">Trend:</span>
          <span className={`font-medium capitalize ${getTrendColor(advantages.trend)}`}>
            {advantages.trend.replace('_', ' ')}
          </span>
        </div>
        
        <div className="mt-3 pt-2 border-t border-white/[0.06]">
          <span className="text-xs text-slate-500">
            {advantages.gamesAnalyzed > 0 
              ? `Based on ${advantages.gamesAnalyzed} game${advantages.gamesAnalyzed !== 1 ? 's' : ''}`
              : 'Based on current season stats'
            }
          </span>
        </div>
      </div>
    </div>
  )
}

function InsightCard({ insight }) {
  const getInsightDot = (type) => {
    switch (type) {
      case 'advantage': return 'bg-green-400'
      case 'trend': return 'bg-blue-400'
      case 'strength': return 'bg-green-400'
      case 'warning': return 'bg-amber-400'
      default: return 'bg-slate-400'
    }
  }

  const getConfidenceColor = (confidence) => {
    switch (confidence) {
      case 'very_high': return 'text-green-400'
      case 'high': return 'text-blue-400'
      case 'medium': return 'text-amber-400'
      case 'low': return 'text-slate-400'
      default: return 'text-slate-400'
    }
  }

  return (
    <div className="flex items-start space-x-3 p-3 bg-elevated border border-white/[0.06] rounded-[4px]">
      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${getInsightDot(insight.type)}`} />
      <div className="flex-1">
        <div className="text-sm text-slate-100">{insight.message}</div>
        <div className="flex items-center mt-1 space-x-2">
          <span className="text-xs text-slate-400 capitalize">{insight.category.replace('_', ' ')}</span>
          <span className="text-xs text-slate-600">•</span>
          <span className={`text-xs font-medium capitalize ${getConfidenceColor(insight.confidence)}`}>
            {insight.confidence.replace('_', ' ')} confidence
          </span>
        </div>
      </div>
    </div>
  )
}
