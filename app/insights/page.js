// Insights Dashboard - Learn what's working and what's not

import Link from 'next/link'
import { analyzePerformance } from '../../lib/performance-analyzer.js'
import { getValidationStats } from '../../lib/validation.js'

export const dynamic = 'force-dynamic'

export default async function InsightsDashboard() {
  const analysis = await analyzePerformance()
  const { insights, propTypeStats, playerStats, overallAccuracy } = analysis
  
  // Get stats by sport
  const nflStats = await getValidationStats({ sport: 'nfl' })
  const nhlStats = await getValidationStats({ sport: 'nhl' })
  const mlbStats = await getValidationStats({ sport: 'mlb' })
  
  // Sort insights by type (success, warning, info)
  const successInsights = insights.filter(i => i.type === 'success')
  const warningInsights = insights.filter(i => i.type === 'warning')
  const infoInsights = insights.filter(i => i.type === 'info')
  
  // Get best and worst prop types
  const propTypeArray = Object.keys(propTypeStats).map(type => ({
    type,
    ...propTypeStats[type]
  })).filter(p => p.total >= 3).sort((a, b) => b.accuracy - a.accuracy)
  
  const bestPropTypes = propTypeArray.slice(0, 5)
  const worstPropTypes = propTypeArray.slice(-5).reverse()
  
  // Determine status based on accuracy
  const getStatusInfo = (accuracy) => {
    if (accuracy >= 0.524) {
      return { 
        label: '🎯 Profitable', 
        color: 'text-green-400',
        bg: 'bg-green-900/20',
        border: 'border-green-500/50',
        description: 'Above break-even threshold'
      }
    } else if (accuracy >= 0.45) {
      return { 
        label: '📈 Improving', 
        color: 'text-yellow-400',
        bg: 'bg-yellow-900/20',
        border: 'border-yellow-500/50',
        description: 'Close to profitability'
      }
    } else {
      return { 
        label: '🔧 Needs Work', 
        color: 'text-orange-400',
        bg: 'bg-orange-900/20',
        border: 'border-orange-500/50',
        description: 'Focus on improvement'
      }
    }
  }
  
  const statusInfo = getStatusInfo(overallAccuracy)
  const gapToBreakEven = ((0.524 - overallAccuracy) * 100).toFixed(1)

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link
            href="/validation"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Validation
          </Link>
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              💡 Performance Insights
            </h1>
            <p className="text-base sm:text-lg text-gray-400 mt-2">
              Learn what's working and improve your picks
            </p>
          </div>
        </div>

        {/* Overall Performance - Enhanced */}
        <div className={`${statusInfo.bg} border-2 ${statusInfo.border} rounded-lg p-6 mb-6 sm:mb-8`}>
          <h3 className="text-lg font-semibold text-white mb-4">📊 Overall Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className={`text-4xl sm:text-5xl font-bold ${statusInfo.color}`}>
                {(overallAccuracy * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-gray-400 mt-2">Overall Win Rate</div>
              <div className="text-xs text-gray-500 mt-1">
                Break-even: 52.4% (standard -110 odds)
              </div>
              {overallAccuracy < 0.524 && (
                <div className="text-xs text-yellow-400 mt-2">
                  Only {gapToBreakEven}% away from profitability!
                </div>
              )}
            </div>
            
            <div className="text-center">
              <div className={`text-3xl sm:text-4xl font-bold ${statusInfo.color}`}>
                {statusInfo.label}
              </div>
              <div className="text-sm text-gray-400 mt-2">{statusInfo.description}</div>
              {overallAccuracy >= 0.45 && overallAccuracy < 0.524 && (
                <div className="text-xs text-yellow-300 mt-2">
                  💪 You're getting close! Keep refining your strategy.
                </div>
              )}
            </div>
            
            <div className="text-center">
              <div className="text-4xl sm:text-5xl font-bold text-blue-400">
                {insights.length}
              </div>
              <div className="text-sm text-gray-400 mt-2">Actionable Insights</div>
              <div className="text-xs text-gray-500 mt-1">
                {successInsights.length} strengths • {warningInsights.length} improvements
              </div>
            </div>
          </div>
        </div>

        {/* Performance by Sport */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* NFL Performance */}
          {nflStats.total > 0 && (
            <div className="card p-4 sm:p-6 border-l-4 border-blue-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base sm:text-lg font-semibold text-white">🏈 NFL</h3>
                <span className={`text-2xl ${nflStats.accuracy >= 0.524 ? 'text-green-400' : nflStats.accuracy >= 0.45 ? 'text-yellow-400' : 'text-orange-400'}`}>
                  {(nflStats.accuracy * 100).toFixed(1)}%
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Record</span>
                  <span className="text-white font-medium">
                    {nflStats.correct}-{nflStats.incorrect}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ROI</span>
                  <span className={`font-medium ${nflStats.roi >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                    {(nflStats.roi * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Edge</span>
                  <span className="text-blue-400 font-medium">
                    +{(nflStats.avgEdge * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* NHL Performance */}
          {nhlStats.total > 0 && (
            <div className="card p-4 sm:p-6 border-l-4 border-cyan-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base sm:text-lg font-semibold text-white">🏒 NHL</h3>
                <span className={`text-2xl ${nhlStats.accuracy >= 0.524 ? 'text-green-400' : nhlStats.accuracy >= 0.45 ? 'text-yellow-400' : 'text-orange-400'}`}>
                  {(nhlStats.accuracy * 100).toFixed(1)}%
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Record</span>
                  <span className="text-white font-medium">
                    {nhlStats.correct}-{nhlStats.incorrect}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ROI</span>
                  <span className={`font-medium ${nhlStats.roi >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                    {(nhlStats.roi * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Edge</span>
                  <span className="text-blue-400 font-medium">
                    +{(nhlStats.avgEdge * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* MLB Performance */}
          {mlbStats.total > 0 && (
            <div className="card p-4 sm:p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base sm:text-lg font-semibold text-white">⚾ MLB</h3>
                <span className={`text-2xl ${mlbStats.accuracy >= 0.524 ? 'text-green-400' : mlbStats.accuracy >= 0.45 ? 'text-yellow-400' : 'text-orange-400'}`}>
                  {(mlbStats.accuracy * 100).toFixed(1)}%
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Record</span>
                  <span className="text-white font-medium">
                    {mlbStats.correct}-{mlbStats.incorrect}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ROI</span>
                  <span className={`font-medium ${mlbStats.roi >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                    {(mlbStats.roi * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Edge</span>
                  <span className="text-blue-400 font-medium">
                    +{(mlbStats.avgEdge * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Success Insights */}
        {successInsights.length > 0 && (
          <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-base sm:text-lg font-semibold text-green-400 mb-4">✅ What's Working</h3>
            <div className="space-y-3">
              {successInsights.map((insight, idx) => (
                <div key={idx} className="card p-4 border border-green-500/30">
                  <div className="font-semibold text-green-300">{insight.message}</div>
                  <div className="text-sm text-green-400 mt-1">
                    💡 {insight.recommendation}
                  </div>
                  {insight.boost && (
                    <div className="text-xs text-green-500 mt-2">
                      Confidence Boost: +{((insight.boost - 1) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning Insights - LIMITED TO TOP 10 */}
        {warningInsights.length > 0 && (
          <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-base sm:text-lg font-semibold text-orange-400 mb-2">
              💭 Areas for Improvement
            </h3>
            <p className="text-sm text-orange-300 mb-4">
              Focus on these {warningInsights.length > 10 ? 'top 10' : warningInsights.length} areas to boost your win rate
            </p>
            <div className="space-y-3">
              {warningInsights.slice(0, 10).map((insight, idx) => (
                <div key={idx} className="card p-4 border border-orange-500/30">
                  <div className="font-semibold text-orange-300">{insight.message}</div>
                  <div className="text-sm text-orange-400 mt-1">
                    💡 {insight.recommendation}
                  </div>
                  {insight.boost && (
                    <div className="text-xs text-orange-500 mt-2">
                      Consider reducing bet size or avoiding
                    </div>
                  )}
                </div>
              ))}
            </div>
            {warningInsights.length > 10 && (
              <div className="mt-4 text-center text-xs text-gray-500">
                Showing top 10 of {warningInsights.length} areas. Focus on these first.
              </div>
            )}
          </div>
        )}

        {/* Best Prop Types */}
        {bestPropTypes.length > 0 && (
          <div className="card p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-base sm:text-lg font-semibold text-white mb-4">🏆 Best Performing Prop Types</h3>
            
            {/* Mobile Card View */}
            <div className="block lg:hidden space-y-3">
              {bestPropTypes.map((prop, idx) => (
                <div key={idx} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-white text-sm">
                      {prop.type.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-lg font-bold ${prop.accuracy >= 0.55 ? 'text-green-400' : 'text-gray-400'}`}>
                      {(prop.accuracy * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Total:</span>
                      <span className="text-gray-300 ml-1">{prop.total}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Correct:</span>
                      <span className="text-green-400 ml-1 font-medium">{prop.correct}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Edge:</span>
                      <span className="text-blue-400 ml-1">+{(prop.avgEdge * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Prop Type</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Correct</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Accuracy</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Avg Edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {bestPropTypes.map((prop, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/30">
                      <td className="px-4 py-3 text-sm font-medium text-white">
                        {prop.type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-400">
                        {prop.total}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-green-400 font-semibold">
                        {prop.correct}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`font-bold ${prop.accuracy >= 0.55 ? 'text-green-400' : 'text-gray-400'}`}>
                          {(prop.accuracy * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-blue-400">
                        +{(prop.avgEdge * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Worst Prop Types - LIMITED TO TOP 5 */}
        {worstPropTypes.length > 0 && (
          <div className="card p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-base sm:text-lg font-semibold text-white mb-2">
              📉 Prop Types to Avoid or Reduce
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Consider reducing bet size or skipping these prop types
            </p>
            
            {/* Mobile Card View */}
            <div className="block lg:hidden space-y-3">
              {worstPropTypes.slice(0, 5).map((prop, idx) => (
                <div key={idx} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-white text-sm">
                      {prop.type.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-lg font-bold ${prop.accuracy < 0.45 ? 'text-orange-400' : 'text-gray-400'}`}>
                      {(prop.accuracy * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Total:</span>
                      <span className="text-gray-300 ml-1">{prop.total}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Correct:</span>
                      <span className="text-orange-400 ml-1 font-medium">{prop.correct}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Edge:</span>
                      <span className="text-blue-400 ml-1">+{(prop.avgEdge * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Prop Type</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Correct</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Accuracy</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Avg Edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {worstPropTypes.slice(0, 5).map((prop, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/30">
                      <td className="px-4 py-3 text-sm font-medium text-white">
                        {prop.type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-400">
                        {prop.total}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-orange-400 font-semibold">
                        {prop.correct}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`font-bold ${prop.accuracy < 0.45 ? 'text-orange-400' : 'text-gray-400'}`}>
                          {(prop.accuracy * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-blue-400">
                        +{(prop.avgEdge * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {worstPropTypes.length > 5 && (
              <div className="mt-4 text-center text-xs text-gray-500">
                Showing top 5 to focus improvement efforts
              </div>
            )}
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 sm:mt-8 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
          <h4 className="font-semibold text-blue-400 mb-2">💡 How to Use These Insights</h4>
          <ul className="text-sm text-gray-300 space-y-1">
            <li>• <strong className="text-white">Focus on strengths:</strong> Prioritize prop types with 55%+ accuracy</li>
            <li>• <strong className="text-white">Reduce weaknesses:</strong> Bet smaller on props below 45% accuracy</li>
            <li>• <strong className="text-white">Track progress:</strong> Monitor your gap to break-even (52.4%)</li>
            <li>• <strong className="text-white">Build on winners:</strong> Increase bet size on consistently accurate prop types</li>
            <li>• <strong className="text-white">Stay patient:</strong> Small improvements compound over time</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
