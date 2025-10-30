// Insights Dashboard - Learn what's working and what's not

import Link from 'next/link'
import { analyzePerformance } from '../../lib/performance-analyzer.js'

export const dynamic = 'force-dynamic'

export default async function InsightsDashboard() {
  const analysis = await analyzePerformance()
  const { insights, propTypeStats, playerStats, overallAccuracy } = analysis
  
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
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/validation"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500 mb-4"
          >
            ← Back to Validation
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">
              💡 Performance Insights
            </h1>
            <p className="text-lg text-gray-600 mt-2">
              Learn what's working and improve your picks
            </p>
          </div>
        </div>

        {/* Overall Performance */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Overall Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className={`text-4xl font-bold ${overallAccuracy >= 0.524 ? 'text-green-600' : 'text-red-600'}`}>
                {(overallAccuracy * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600 mt-1">Overall Accuracy</div>
              <div className="text-xs text-gray-500 mt-1">
                Break-even: 52.4%
              </div>
            </div>
            <div className="text-center">
              <div className={`text-4xl font-bold ${overallAccuracy >= 0.524 ? 'text-green-600' : 'text-red-600'}`}>
                {overallAccuracy >= 0.524 ? '📈 Profitable' : '📉 Needs Work'}
              </div>
              <div className="text-sm text-gray-600 mt-1">Status</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-blue-600">
                {insights.length}
              </div>
              <div className="text-sm text-gray-600 mt-1">Insights Generated</div>
            </div>
          </div>
        </div>

        {/* Success Insights */}
        {successInsights.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-green-900 mb-4">✅ What's Working</h3>
            <div className="space-y-3">
              {successInsights.map((insight, idx) => (
                <div key={idx} className="bg-white rounded-lg p-4 border border-green-200">
                  <div className="font-semibold text-green-900">{insight.message}</div>
                  <div className="text-sm text-green-700 mt-1">
                    💡 {insight.recommendation}
                  </div>
                  {insight.boost && (
                    <div className="text-xs text-green-600 mt-2">
                      Confidence Boost: +{((insight.boost - 1) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning Insights */}
        {warningInsights.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-red-900 mb-4">⚠️ What to Avoid</h3>
            <div className="space-y-3">
              {warningInsights.map((insight, idx) => (
                <div key={idx} className="bg-white rounded-lg p-4 border border-red-200">
                  <div className="font-semibold text-red-900">{insight.message}</div>
                  <div className="text-sm text-red-700 mt-1">
                    💡 {insight.recommendation}
                  </div>
                  {insight.boost && (
                    <div className="text-xs text-red-600 mt-2">
                      Confidence Penalty: {((insight.boost - 1) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Best Prop Types */}
        {bestPropTypes.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🏆 Best Performing Prop Types</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prop Type</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Correct</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {bestPropTypes.map((prop, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {prop.type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">
                        {prop.total}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-green-600 font-semibold">
                        {prop.correct}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`font-bold ${prop.accuracy >= 0.55 ? 'text-green-600' : 'text-gray-600'}`}>
                          {(prop.accuracy * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-blue-600">
                        +{(prop.avgEdge * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Worst Prop Types */}
        {worstPropTypes.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">⚠️ Struggling Prop Types</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prop Type</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Correct</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {worstPropTypes.map((prop, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {prop.type.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">
                        {prop.total}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-red-600 font-semibold">
                        {prop.correct}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`font-bold ${prop.accuracy < 0.45 ? 'text-red-600' : 'text-gray-600'}`}>
                          {(prop.accuracy * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-blue-600">
                        +{(prop.avgEdge * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold text-blue-900 mb-2">💡 How to Use These Insights</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>Prioritize</strong> prop types with high accuracy in your parlays</li>
            <li>• <strong>Avoid or reduce</strong> prop types with low accuracy</li>
            <li>• <strong>Track players</strong> you predict well and focus on them</li>
            <li>• <strong>Adjust confidence</strong> based on historical performance</li>
            <li>• <strong>Review regularly</strong> as more data becomes available</li>
          </ul>
        </div>
      </div>
    </div>
  )
}





