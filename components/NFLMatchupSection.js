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
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Matchup Analysis</h2>
          <p className="text-sm text-gray-400 mt-1">
            Historical performance and offensive vs defensive trends
          </p>
        </div>
        <div className="p-6">
          <div className="text-center text-gray-400">Loading matchup analysis...</div>
        </div>
      </div>
    )
  }

  if (error || !matchupData) {
    return (
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Matchup Analysis</h2>
          <p className="text-sm text-gray-400 mt-1">
            Historical performance and offensive vs defensive trends
          </p>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 border border-slate-700 rounded-lg bg-slate-900">
              <h3 className="text-md font-semibold text-gray-300 mb-3">
                Away Offense vs Home Defense
              </h3>
              <div className="text-sm text-gray-400 italic">
                No historical data available
              </div>
            </div>
            <div className="p-6 border border-slate-700 rounded-lg bg-slate-900">
              <h3 className="text-md font-semibold text-gray-300 mb-3">
                Home Offense vs Away Defense
              </h3>
              <div className="text-sm text-gray-400 italic">
                No historical data available
              </div>
            </div>
          </div>
          
          {/* Warning Message */}
          <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-500/50 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-400 mr-3 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="text-sm text-yellow-300">
                  <strong>Limited historical data.</strong> Sample Size Low Confidence.
                </p>
                <p className="text-xs text-yellow-400/80 mt-1">
                  Historical matchup data will be available once teams have played each other recently.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const { game, advantages, insights } = matchupData

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white">Matchup Analysis</h2>
        <p className="text-sm text-gray-400 mt-1">
          Historical performance and offensive vs defensive trends
        </p>
      </div>
      <div className="p-6 space-y-6">
        
        {/* Historical Performance */}
        <div className="grid md:grid-cols-2 gap-6">
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
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Key Insights</h3>
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
      <div className="p-4 border border-slate-700 rounded-lg bg-slate-900">
        <h4 className="font-medium text-gray-300 mb-2">{title}</h4>
        <div className="text-sm text-gray-400 italic">
          No historical data available
        </div>
      </div>
    )
  }

  const getTrendColor = (trend) => {
    switch (trend) {
      case 'improving': return 'text-green-400'
      case 'declining': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  const getEfficiencyColor = (efficiency) => {
    if (!efficiency) return 'text-gray-400'
    if (efficiency >= 70) return 'text-green-400'
    if (efficiency >= 50) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="p-4 border border-slate-700 rounded-lg bg-slate-900">
      <h4 className="font-medium text-white mb-3">{title}</h4>
      
      <div className="space-y-2 text-sm">
        {advantages.pointsAvg != null && (
          <div className="flex justify-between">
            <span className="text-gray-400">Avg Points:</span>
            <span className="font-medium text-white">{advantages.pointsAvg}</span>
          </div>
        )}
        
        {advantages.totalYardsAvg != null && (
          <div className="flex justify-between">
            <span className="text-gray-400">Avg Yards:</span>
            <span className="font-medium text-white">{advantages.totalYardsAvg}</span>
          </div>
        )}
        
        {advantages.turnoversAvg != null && (
          <div className="flex justify-between">
            <span className="text-gray-400">Turnovers:</span>
            <span className="font-medium text-white">{advantages.turnoversAvg}</span>
          </div>
        )}
        
        {advantages.thirdDownPct && (
          <div className="flex justify-between">
            <span className="text-gray-400">3rd Down %:</span>
            <span className="font-medium text-white">{advantages.thirdDownPct}%</span>
          </div>
        )}
        
        {advantages.redZonePct && (
          <div className="flex justify-between">
            <span className="text-gray-400">Red Zone %:</span>
            <span className="font-medium text-white">{advantages.redZonePct}%</span>
          </div>
        )}
        
        {advantages.efficiency && (
          <div className="flex justify-between">
            <span className="text-gray-400">Efficiency:</span>
            <span className={`font-medium ${getEfficiencyColor(advantages.efficiency)}`}>
              {advantages.efficiency}/100
            </span>
          </div>
        )}
        
        <div className="flex justify-between">
          <span className="text-gray-400">Trend:</span>
          <span className={`font-medium capitalize ${getTrendColor(advantages.trend)}`}>
            {advantages.trend.replace('_', ' ')}
          </span>
        </div>
        
        <div className="mt-3 pt-2 border-t border-slate-700">
          <span className="text-xs text-gray-500">
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
  const getInsightIcon = (type) => {
    switch (type) {
      case 'advantage': return '⚡'
      case 'trend': return '📈'
      case 'strength': return '💪'
      case 'warning': return '⚠️'
      default: return '💡'
    }
  }

  const getConfidenceColor = (confidence) => {
    switch (confidence) {
      case 'very_high': return 'text-green-400'
      case 'high': return 'text-blue-400'
      case 'medium': return 'text-yellow-400'
      case 'low': return 'text-gray-400'
      default: return 'text-gray-400'
    }
  }

  return (
    <div className="flex items-start space-x-3 p-3 bg-slate-800 border border-slate-700 rounded-lg">
      <span className="text-lg">{getInsightIcon(insight.type)}</span>
      <div className="flex-1">
        <div className="text-sm text-white">{insight.message}</div>
        <div className="flex items-center mt-1 space-x-2">
          <span className="text-xs text-gray-400 capitalize">{insight.category.replace('_', ' ')}</span>
          <span className="text-xs text-gray-600">•</span>
          <span className={`text-xs font-medium capitalize ${getConfidenceColor(insight.confidence)}`}>
            {insight.confidence.replace('_', ' ')} confidence
          </span>
        </div>
      </div>
    </div>
  )
}
