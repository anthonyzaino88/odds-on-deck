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
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Matchup Analysis</h2>
        </div>
        <div className="p-6">
          <div className="text-center text-gray-500">Loading matchup analysis...</div>
        </div>
      </div>
    )
  }

  if (error || !matchupData) {
    return (
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Matchup Analysis</h2>
          <p className="text-sm text-gray-600 mt-1">
            Historical performance and offensive vs defensive trends
          </p>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Mock data for demonstration */}
            <div>
              <h3 className="text-md font-semibold text-gray-800 mb-3">
                {matchupData?.game?.away?.abbr || 'Away'} Offense vs {matchupData?.game?.home?.abbr || 'Home'} Defense
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Points:</span>
                  <span className="font-medium">24.2</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Total Yards:</span>
                  <span className="font-medium">385</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Passing:</span>
                  <span className="font-medium">245 yds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Rushing:</span>
                  <span className="font-medium">140 yds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">3rd Down %:</span>
                  <span className="font-medium">42%</span>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="text-md font-semibold text-gray-800 mb-3">
                {matchupData?.game?.home?.abbr || 'Home'} Offense vs {matchupData?.game?.away?.abbr || 'Away'} Defense
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Points:</span>
                  <span className="font-medium">28.5</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Total Yards:</span>
                  <span className="font-medium">415</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Passing:</span>
                  <span className="font-medium">275 yds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Avg Rushing:</span>
                  <span className="font-medium">140 yds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">3rd Down %:</span>
                  <span className="font-medium">48%</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Key Insights */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-md font-semibold text-gray-800 mb-3">Key Insights</h3>
            <div className="space-y-2">
              <div className="flex items-center text-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                <span className="text-gray-700">MIA has strong passing attack averaging 275+ yards vs NYJ defense</span>
              </div>
              <div className="flex items-center text-sm">
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                <span className="text-gray-700">NYJ rushing game has been effective in recent matchups (140+ yds/game)</span>
              </div>
              <div className="flex items-center text-sm">
                <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                <span className="text-gray-700">Both teams show strong 3rd down conversion rates (42%+ NYJ, 48%+ MIA)</span>
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
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Matchup Analysis</h2>
        <p className="text-sm text-gray-600 mt-1">
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
  if (!advantages || advantages.gamesAnalyzed === 0) {
    return (
      <div className="p-4 border border-gray-200 rounded-lg">
        <h4 className="font-medium text-gray-900 mb-2">{title}</h4>
        <div className="text-sm text-gray-500 italic">
          No historical data available
        </div>
      </div>
    )
  }

  const getTrendColor = (trend) => {
    switch (trend) {
      case 'improving': return 'text-green-600'
      case 'declining': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getEfficiencyColor = (efficiency) => {
    if (!efficiency) return 'text-gray-600'
    if (efficiency >= 70) return 'text-green-600'
    if (efficiency >= 50) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="p-4 border border-gray-200 rounded-lg">
      <h4 className="font-medium text-gray-900 mb-3">{title}</h4>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Avg Points:</span>
          <span className="font-medium">{advantages.pointsAvg}</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-gray-600">Avg Yards:</span>
          <span className="font-medium">{advantages.totalYardsAvg}</span>
        </div>
        
        <div className="flex justify-between">
          <span className="text-gray-600">Turnovers:</span>
          <span className="font-medium">{advantages.turnoversAvg}</span>
        </div>
        
        {advantages.thirdDownPct && (
          <div className="flex justify-between">
            <span className="text-gray-600">3rd Down %:</span>
            <span className="font-medium">{advantages.thirdDownPct}%</span>
          </div>
        )}
        
        {advantages.redZonePct && (
          <div className="flex justify-between">
            <span className="text-gray-600">Red Zone %:</span>
            <span className="font-medium">{advantages.redZonePct}%</span>
          </div>
        )}
        
        {advantages.efficiency && (
          <div className="flex justify-between">
            <span className="text-gray-600">Efficiency:</span>
            <span className={`font-medium ${getEfficiencyColor(advantages.efficiency)}`}>
              {advantages.efficiency}/100
            </span>
          </div>
        )}
        
        <div className="flex justify-between">
          <span className="text-gray-600">Trend:</span>
          <span className={`font-medium capitalize ${getTrendColor(advantages.trend)}`}>
            {advantages.trend.replace('_', ' ')}
          </span>
        </div>
        
        <div className="mt-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            Based on {advantages.gamesAnalyzed} game{advantages.gamesAnalyzed !== 1 ? 's' : ''}
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
      case 'very_high': return 'text-green-600'
      case 'high': return 'text-blue-600'
      case 'medium': return 'text-yellow-600'
      case 'low': return 'text-gray-600'
      default: return 'text-gray-600'
    }
  }

  return (
    <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
      <span className="text-lg">{getInsightIcon(insight.type)}</span>
      <div className="flex-1">
        <div className="text-sm text-gray-900">{insight.message}</div>
        <div className="flex items-center mt-1 space-x-2">
          <span className="text-xs text-gray-500 capitalize">{insight.category.replace('_', ' ')}</span>
          <span className="text-xs">•</span>
          <span className={`text-xs font-medium capitalize ${getConfidenceColor(insight.confidence)}`}>
            {insight.confidence.replace('_', ' ')} confidence
          </span>
        </div>
      </div>
    </div>
  )
}
