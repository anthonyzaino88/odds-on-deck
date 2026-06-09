'use client'

import { useState, useEffect } from 'react'

export default function NHLMatchupSection({ gameId }) {
  const [matchupData, setMatchupData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchMatchup() {
      try {
        setLoading(true)
        const response = await fetch(`/api/nhl/matchups?gameId=${gameId}`)
        const data = await response.json()
        
        if (response.ok) {
          console.log('NHL Matchup API response:', data)
          console.log('Advantages structure:', {
            home: data.advantages?.home,
            away: data.advantages?.away
          })
          setMatchupData(data)
        } else {
          setError(data.error || 'Failed to fetch matchup data')
        }
      } catch (error) {
        console.error('Error fetching NHL matchup:', error)
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
        </div>
        <div className="p-4">
          <div className="text-center text-slate-500">Loading matchup analysis...</div>
        </div>
      </div>
    )
  }

  if (error || !matchupData) {
    return (
      <div className="card">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Matchup Analysis</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Team statistics and offensive vs defensive trends
          </p>
        </div>
        <div className="p-4">
          <div className="text-center text-slate-500">
            {error || 'No matchup data available'}
          </div>
        </div>
      </div>
    )
  }

  // Check if we have any actual data (not just empty placeholders)
  const homeAdv = matchupData.advantages?.home
  const awayAdv = matchupData.advantages?.away
  
  // Direct check: do we have any meaningful stats?
  // Check both home and away in a single expression to avoid any logic issues
  const hasData = (
    (homeAdv?.goalsAvg != null && homeAdv.goalsAvg !== '') ||
    (homeAdv?.powerPlayPct != null) ||
    (homeAdv?.penaltyKillPct != null) ||
    (homeAdv?.shotsAvg != null && homeAdv.shotsAvg !== '') ||
    (awayAdv?.goalsAvg != null && awayAdv.goalsAvg !== '') ||
    (awayAdv?.powerPlayPct != null) ||
    (awayAdv?.penaltyKillPct != null) ||
    (awayAdv?.shotsAvg != null && awayAdv.shotsAvg !== '')
  )

  // Debug: Log the actual values being checked
  console.log('NHL Matchup - hasData check:', {
    hasData,
    homeAdvExists: !!homeAdv,
    awayAdvExists: !!awayAdv,
    homeGoalsAvg: homeAdv?.goalsAvg,
    homePowerPlayPct: homeAdv?.powerPlayPct,
    homePenaltyKillPct: homeAdv?.penaltyKillPct,
    awayGoalsAvg: awayAdv?.goalsAvg,
    awayPowerPlayPct: awayAdv?.powerPlayPct,
    awayPenaltyKillPct: awayAdv?.penaltyKillPct,
    'homeGoalsAvg != null': homeAdv?.goalsAvg != null,
    'homePowerPlayPct != null': homeAdv?.powerPlayPct != null,
    'awayGoalsAvg != null': awayAdv?.goalsAvg != null,
    'awayPowerPlayPct != null': awayAdv?.powerPlayPct != null
  })

  if (!hasData) {
    return (
      <div className="card">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Matchup Analysis</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Team statistics and offensive vs defensive trends
          </p>
        </div>
        <div className="p-4">
          <div className="text-center space-y-3">
            <div className="text-slate-500">
              <p className="font-medium mb-2">Season statistics are being calculated</p>
              <p className="text-sm">
                Team stats will be available once we've processed recent game data.
              </p>
            </div>
            <div className="mt-4 p-4 bg-surface border border-white/[0.06] rounded-[4px]">
              <p className="text-sm text-slate-300">
                <strong>Note:</strong> ESPN NHL API doesn't provide a direct standings endpoint.
                We're working on calculating team statistics from game results.
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
          Team statistics and offensive vs defensive trends
        </p>
      </div>
      <div className="p-4 space-y-6">
        
        {/* Team Statistics Comparison */}
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
          <div className="mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-4">Key Insights</h3>
            <div className="space-y-3">
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
  if (!advantages) {
    return (
      <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
        <h4 className="font-medium text-slate-100 mb-2">{title}</h4>
        <div className="text-sm text-slate-500 italic">
          No data available
        </div>
      </div>
    )
  }

  const getTrendColor = (trend) => {
    switch (trend) {
      case 'improving': return 'text-green-400'
      case 'declining': return 'text-red-400'
      default: return 'text-slate-500'
    }
  }

  const getEfficiencyColor = (efficiency) => {
    if (!efficiency) return 'text-slate-500'
    if (efficiency >= 70) return 'text-green-400'
    if (efficiency >= 50) return 'text-amber-400'
    return 'text-red-400'
  }

  // Format values for display
  const formatValue = (value) => {
    if (value == null || value === '') return 'N/A'
    return value
  }

  const formatPercent = (value) => {
    if (value == null || value === '') return 'N/A'
    return `${value}%`
  }

  return (
    <div className="p-4 border border-white/[0.06] rounded-[4px] bg-elevated hover:bg-elevated/70 transition-colors duration-100">
      <h4 className="font-semibold text-slate-100 mb-4 text-sm">{title}</h4>
      
      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center py-1">
          <span className="text-slate-400 font-medium">Avg Goals:</span>
          <span className="font-semibold text-slate-100 text-sm tabular-nums font-mono">
            {formatValue(advantages.goalsAvg)}
          </span>
        </div>
        
        <div className="flex justify-between items-center py-1">
          <span className="text-slate-400 font-medium">Avg Shots:</span>
          <span className="font-semibold text-slate-100 text-sm tabular-nums font-mono">
            {formatValue(advantages.shotsAvg)}
          </span>
        </div>
        
        <div className="flex justify-between items-center py-1">
          <span className="text-slate-400 font-medium">Power Play %:</span>
          <span className="font-semibold text-slate-100 text-sm tabular-nums font-mono">
            {formatPercent(advantages.powerPlayPct)}
          </span>
        </div>
        
        <div className="flex justify-between items-center py-1">
          <span className="text-slate-400 font-medium">Penalty Kill %:</span>
          <span className="font-semibold text-slate-100 text-sm tabular-nums font-mono">
            {formatPercent(advantages.penaltyKillPct)}
          </span>
        </div>
        
        {advantages.efficiency && (
          <div className="flex justify-between items-center py-1">
            <span className="text-slate-400 font-medium">Efficiency:</span>
            <span className={`font-semibold text-sm tabular-nums font-mono ${getEfficiencyColor(advantages.efficiency)}`}>
              {advantages.efficiency}/100
            </span>
          </div>
        )}
        
        <div className="flex justify-between items-center py-1">
          <span className="text-slate-500 font-medium">Trend:</span>
          <span className={`font-semibold capitalize text-sm ${getTrendColor(advantages.trend)}`}>
            {advantages.trend?.replace('_', ' ') || 'stable'}
          </span>
        </div>
        
        {(advantages.gamesAnalyzed > 0) && (
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <span className="text-xs text-slate-400 font-medium">
              Based on {advantages.gamesAnalyzed} game{advantages.gamesAnalyzed !== 1 ? 's' : ''}
            </span>
          </div>
        )}
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
      case 'low': return 'text-slate-500'
      default: return 'text-slate-500'
    }
  }

  return (
    <div className="flex items-start space-x-3 p-3 bg-surface border border-white/[0.06] rounded-[4px]">
      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${getInsightDot(insight.type)}`} />
      <div className="flex-1">
        <div className="text-sm text-slate-100">{insight.message}</div>
        <div className="flex items-center mt-1 space-x-2">
          <span className="text-xs text-slate-500 capitalize">{insight.category?.replace('_', ' ')}</span>
          <span className="text-xs">•</span>
          <span className={`text-xs font-medium capitalize ${getConfidenceColor(insight.confidence)}`}>
            {insight.confidence?.replace('_', ' ')} confidence
          </span>
        </div>
      </div>
    </div>
  )
}

