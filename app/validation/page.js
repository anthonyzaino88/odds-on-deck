// Validation Dashboard - Track prediction accuracy

import Link from 'next/link'
import { format } from 'date-fns'
import { getValidationStats, getValidationRecords } from '../../lib/validation.js'
import CheckPropsButton from '../../components/CheckPropsButton.js'

export const dynamic = 'force-dynamic'

export default async function ValidationDashboard() {
  const stats = await getValidationStats()
  const recentRecords = await getValidationRecords({ limit: 50 })
  
  // Fetch completed records separately to ensure we get them all
  const allCompletedRecords = await getValidationRecords({ status: 'completed', limit: 100 })

  const pendingRecords = recentRecords.filter(r => r.status === 'pending')
  const completedRecords = allCompletedRecords // Use the dedicated completed query
  const needsReviewRecords = recentRecords.filter(r => r.status === 'needs_review')

  // Group by source
  const bySource = {
    user_saved: recentRecords.filter(r => r.source === 'user_saved'),
    parlay_leg: recentRecords.filter(r => r.source === 'parlay_leg'),
    system_generated: recentRecords.filter(r => r.source === 'system_generated')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">
              📊 Validation Dashboard
            </h1>
            <p className="text-lg text-gray-600 mt-2">
              Track prediction accuracy and system performance
            </p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <CheckPropsButton />
              <Link
                href="/insights"
                className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
              >
                💡 View Insights
              </Link>
            </div>
          </div>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Predictions</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{stats.total}</div>
          </div>
          
          <div className="bg-green-50 rounded-lg shadow p-6 border-2 border-green-200">
            <div className="text-sm font-medium text-green-700">Win Rate</div>
            <div className="mt-2 text-3xl font-bold text-green-600">
              {stats.total > 0 ? `${(stats.accuracy * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-green-600 mt-1">
              {stats.correct} correct / {stats.total} completed
            </div>
          </div>
          
          <div className="bg-blue-50 rounded-lg shadow p-6 border-2 border-blue-200">
            <div className="text-sm font-medium text-blue-700">Average Edge</div>
            <div className="mt-2 text-3xl font-bold text-blue-600">
              {stats.total > 0 ? `${(stats.avgEdge * 100).toFixed(1)}%` : 'N/A'}
            </div>
          </div>
          
          <div className="bg-purple-50 rounded-lg shadow p-6 border-2 border-purple-200">
            <div className="text-sm font-medium text-purple-700">ROI</div>
            <div className="mt-2 text-3xl font-bold text-purple-600">
              {stats.total > 0 ? `${(stats.roi * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-purple-600 mt-1">
              Estimated return on investment
            </div>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">⏳ Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Pending</span>
                <span className="font-bold text-yellow-600">{pendingRecords.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Needs Review</span>
                <span className="font-bold text-blue-600">{needsReviewRecords.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">Completed</span>
                <span className="font-bold text-green-600">{completedRecords.length}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="font-semibold text-gray-900">Total Tracked</span>
                <span className="font-bold text-gray-900">{recentRecords.length}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">📍 Source Tracking</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700">👤 Individual Props</span>
                <span className="font-bold text-blue-600">{bySource.user_saved.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">🎯 Saved Parlays</span>
                <span className="font-bold text-purple-600">{bySource.parlay_leg.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700">🤖 Auto-Generated</span>
                <span className="font-bold text-gray-600">{bySource.system_generated.length}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="font-semibold text-gray-900">💾 Your Saved Picks</span>
                <span className="font-bold text-green-600">{bySource.user_saved.length + bySource.parlay_leg.length}</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t text-xs text-gray-500">
              💡 "Saved Parlays" = Props from parlays you saved. "Auto-Generated" = Props tracked for accuracy (not explicitly saved).
            </div>
          </div>
        </div>

        {/* Performance by Prop Type */}
        {Object.keys(stats.byPropType).length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Performance by Prop Type</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Prop Type
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Correct
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Win Rate
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ROI
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(stats.byPropType)
                    .sort((a, b) => b[1].accuracy - a[1].accuracy)
                    .map(([propType, propStats]) => (
                      <tr key={propType}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {propType.replace(/_/g, ' ')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                          {propStats.total}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                          {propStats.correct}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          <span className={`font-semibold ${propStats.accuracy >= 0.55 ? 'text-green-600' : propStats.accuracy >= 0.50 ? 'text-blue-600' : 'text-red-600'}`}>
                            {(propStats.accuracy * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          <span className={`font-semibold ${propStats.roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {(propStats.roi * 100).toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent Records */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">📋 Recent Predictions</h3>
          
          {recentRecords.length > 0 ? (
            <div className="space-y-3">
              {recentRecords.slice(0, 20).map((record) => (
                <div key={record.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">
                          {record.playerName}
                        </span>
                        <span className="text-sm text-gray-600">
                          {record.propType.replace(/_/g, ' ')}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          record.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          record.status === 'needs_review' ? 'bg-blue-100 text-blue-800' :
                          record.result === 'correct' ? 'bg-green-100 text-green-800' :
                          record.result === 'push' ? 'bg-gray-100 text-gray-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {record.status === 'pending' ? 'Pending' : 
                           record.status === 'needs_review' ? 'Needs Review' :
                           record.result}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {record.prediction.toUpperCase()} {record.threshold} 
                        {record.actualValue !== null && ` • Actual: ${record.actualValue.toFixed(1)}`}
                        {record.projectedValue && ` • Proj: ${record.projectedValue.toFixed(1)}`}
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>Edge: {(record.edge * 100).toFixed(1)}%</span>
                        <span>Win Prob: {((record.probability || 0.5) * 100).toFixed(1)}%</span>
                        {record.qualityScore && <span>Quality: {record.qualityScore.toFixed(1)}</span>}
                        <span className="capitalize">{(record.source || 'system_generated').replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      {format(new Date(record.timestamp), 'MMM d, h:mm a')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-400 text-6xl mb-4">📊</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Validation Records Yet</h3>
              <p className="text-gray-600">
                Save some parlays or generate props to start tracking accuracy
              </p>
            </div>
          )}
        </div>

        {/* Completed Props History */}
        {completedRecords.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">📜 Completed Props History</h3>
              <span className="text-sm text-gray-600">
                {completedRecords.length} completed
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Result
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Player & Prop
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Prediction
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actual
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Metrics
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Source
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {completedRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-medium ${
                          record.result === 'correct' ? 'bg-green-100 text-green-800' :
                          record.result === 'push' ? 'bg-gray-100 text-gray-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {record.result === 'correct' ? '✓ WIN' : 
                           record.result === 'push' ? '− PUSH' : 
                           '✗ LOSS'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-gray-900">{record.playerName}</div>
                        <div className="text-xs text-gray-500">{record.propType.replace(/_/g, ' ')}</div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="text-sm font-semibold text-gray-900">
                          {record.prediction.toUpperCase()} {record.threshold}
                        </div>
                        {record.projectedValue && (
                          <div className="text-xs text-gray-500">
                            Proj: {record.projectedValue.toFixed(1)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className={`text-sm font-bold ${
                          record.result === 'correct' ? 'text-green-600' :
                          record.result === 'push' ? 'text-gray-600' :
                          'text-red-600'
                        }`}>
                          {record.actualValue !== null ? record.actualValue.toFixed(1) : 'N/A'}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="text-xs space-y-1">
                          <div className="text-gray-600">
                            Win: {((record.probability || 0.5) * 100).toFixed(0)}%
                          </div>
                          <div className="text-blue-600">
                            Edge: +{(record.edge * 100).toFixed(1)}%
                          </div>
                          {record.qualityScore && (
                            <div className="text-purple-600">
                              Q: {record.qualityScore.toFixed(0)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          record.source === 'user_saved' ? 'bg-blue-100 text-blue-800' :
                          record.source === 'parlay_leg' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {record.source === 'user_saved' ? '👤 Saved' :
                           record.source === 'parlay_leg' ? '🎯 Parlay' :
                           '🤖 Auto'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-xs text-gray-500 whitespace-nowrap">
                        {format(new Date(record.timestamp), 'MMM d')}
                        <br />
                        {format(new Date(record.timestamp), 'h:mm a')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {completedRecords.length > 20 && (
              <div className="mt-4 text-center text-sm text-gray-600">
                Showing {Math.min(20, completedRecords.length)} of {completedRecords.length} completed props
              </div>
            )}
          </div>
        )}

        {/* Info Box */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold text-blue-900 mb-2">📊 How Validation Works</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>System Generated:</strong> All props are auto-tracked to measure model accuracy</li>
            <li>• <strong>Parlay Legs:</strong> When you save a parlay, each leg is tracked</li>
            <li>• <strong>User Saved:</strong> Individual props you explicitly save</li>
            <li>• <strong>Win Rate:</strong> Percentage of correct predictions</li>
            <li>• <strong>ROI:</strong> Estimated return assuming -110 odds (break-even: 52.4%)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
