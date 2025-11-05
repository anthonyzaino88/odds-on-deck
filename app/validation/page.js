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
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">
              📊 Validation Dashboard
            </h1>
            <p className="text-lg text-gray-400 mt-2">
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
          <div className="card p-6">
            <div className="text-sm font-medium text-gray-400">Total Predictions</div>
            <div className="mt-2 text-3xl font-bold text-white">{stats.total}</div>
          </div>
          
          <div className="bg-green-900/20 rounded-lg shadow p-6 border-2 border-green-500/50">
            <div className="text-sm font-medium text-green-400">Win Rate</div>
            <div className="mt-2 text-3xl font-bold text-green-400">
              {stats.total > 0 ? `${(stats.accuracy * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-green-300 mt-1">
              {stats.correct} correct / {stats.total} completed
            </div>
          </div>
          
          <div className="bg-blue-900/20 rounded-lg shadow p-6 border-2 border-blue-500/50">
            <div className="text-sm font-medium text-blue-400">Average Edge</div>
            <div className="mt-2 text-3xl font-bold text-blue-400">
              {stats.total > 0 ? `${(stats.avgEdge * 100).toFixed(1)}%` : 'N/A'}
            </div>
          </div>
          
          <div className="bg-purple-900/20 rounded-lg shadow p-6 border-2 border-purple-500/50">
            <div className="text-sm font-medium text-purple-400">ROI</div>
            <div className="mt-2 text-3xl font-bold text-purple-400">
              {stats.total > 0 ? `${(stats.roi * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-purple-300 mt-1">
              Estimated return on investment
            </div>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">⏳ Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Pending</span>
                <span className="font-bold text-yellow-400">{pendingRecords.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Needs Review</span>
                <span className="font-bold text-blue-400">{needsReviewRecords.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Completed</span>
                <span className="font-bold text-green-400">{completedRecords.length}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-700">
                <span className="font-semibold text-white">Total Tracked</span>
                <span className="font-bold text-white">{recentRecords.length}</span>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">📍 Source Tracking</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">👤 Individual Props</span>
                <span className="font-bold text-blue-400">{bySource.user_saved.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">🎯 Saved Parlays</span>
                <span className="font-bold text-purple-400">{bySource.parlay_leg.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">🤖 Auto-Generated</span>
                <span className="font-bold text-gray-400">{bySource.system_generated.length}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-700">
                <span className="font-semibold text-white">💾 Your Saved Picks</span>
                <span className="font-bold text-green-400">{bySource.user_saved.length + bySource.parlay_leg.length}</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700 text-xs text-gray-400">
              💡 "Saved Parlays" = Props from parlays you saved. "Auto-Generated" = Props tracked for accuracy (not explicitly saved).
            </div>
          </div>
        </div>

        {/* Performance by Prop Type */}
        {Object.keys(stats.byPropType).length > 0 && (
          <div className="card p-6 mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">📊 Performance by Prop Type</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Prop Type
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Correct
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Win Rate
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      ROI
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-slate-800 divide-y divide-slate-700">
                  {Object.entries(stats.byPropType)
                    .sort((a, b) => b[1].accuracy - a[1].accuracy)
                    .map(([propType, propStats]) => (
                      <tr key={propType} className="hover:bg-slate-700/50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                          {propType.replace(/_/g, ' ')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-400">
                          {propStats.total}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-400">
                          {propStats.correct}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          <span className={`font-semibold ${propStats.accuracy >= 0.55 ? 'text-green-400' : propStats.accuracy >= 0.50 ? 'text-blue-400' : 'text-red-400'}`}>
                            {(propStats.accuracy * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          <span className={`font-semibold ${propStats.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">📋 Recent Predictions</h3>
          
          {recentRecords.length > 0 ? (
            <div className="space-y-3">
              {recentRecords.slice(0, 20).map((record) => (
                <div key={record.id} className="border border-slate-700 rounded-lg p-4 bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">
                          {record.playerName}
                        </span>
                        <span className="text-sm text-gray-400">
                          {record.propType.replace(/_/g, ' ')}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          record.status === 'pending' ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/50' :
                          record.status === 'needs_review' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                          record.result === 'correct' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                          record.result === 'push' ? 'bg-slate-700 text-gray-400 border border-slate-600' :
                          'bg-red-900/30 text-red-400 border border-red-500/50'
                        }`}>
                          {record.status === 'pending' ? 'Pending' : 
                           record.status === 'needs_review' ? 'Needs Review' :
                           record.result}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400 mt-1">
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
                    <div className="text-right text-sm text-gray-400">
                      {format(new Date(record.timestamp), 'MMM d, h:mm a')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-500 text-6xl mb-4">📊</div>
              <h3 className="text-lg font-medium text-white mb-2">No Validation Records Yet</h3>
              <p className="text-gray-400">
                Save some parlays or generate props to start tracking accuracy
              </p>
            </div>
          )}
        </div>

        {/* Completed Props History */}
        {completedRecords.length > 0 && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">📜 Completed Props History</h3>
              <span className="text-sm text-gray-400">
                {completedRecords.length} completed
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Result
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Player & Prop
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Prediction
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Actual
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Metrics
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Source
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-slate-800 divide-y divide-slate-700">
                  {completedRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-medium ${
                          record.result === 'correct' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                          record.result === 'push' ? 'bg-slate-700 text-gray-400 border border-slate-600' :
                          'bg-red-900/30 text-red-400 border border-red-500/50'
                        }`}>
                          {record.result === 'correct' ? '✓ WIN' : 
                           record.result === 'push' ? '− PUSH' : 
                           '✗ LOSS'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-white">{record.playerName}</div>
                        <div className="text-xs text-gray-400">{record.propType.replace(/_/g, ' ')}</div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="text-sm font-semibold text-white">
                          {record.prediction.toUpperCase()} {record.threshold}
                        </div>
                        {record.projectedValue && (
                          <div className="text-xs text-gray-400">
                            Proj: {record.projectedValue.toFixed(1)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className={`text-sm font-bold ${
                          record.result === 'correct' ? 'text-green-400' :
                          record.result === 'push' ? 'text-gray-400' :
                          'text-red-400'
                        }`}>
                          {record.actualValue !== null ? record.actualValue.toFixed(1) : 'N/A'}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="text-xs space-y-1">
                          <div className="text-gray-400">
                            Win: {((record.probability || 0.5) * 100).toFixed(0)}%
                          </div>
                          <div className="text-blue-400">
                            Edge: +{(record.edge * 100).toFixed(1)}%
                          </div>
                          {record.qualityScore && (
                            <div className="text-purple-400">
                              Q: {record.qualityScore.toFixed(0)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          record.source === 'user_saved' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                          record.source === 'parlay_leg' ? 'bg-purple-900/30 text-purple-400 border border-purple-500/50' :
                          'bg-slate-700 text-gray-400 border border-slate-600'
                        }`}>
                          {record.source === 'user_saved' ? '👤 Saved' :
                           record.source === 'parlay_leg' ? '🎯 Parlay' :
                           '🤖 Auto'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-xs text-gray-400 whitespace-nowrap">
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
              <div className="mt-4 text-center text-sm text-gray-400">
                Showing {Math.min(20, completedRecords.length)} of {completedRecords.length} completed props
              </div>
            )}
          </div>
        )}

        {/* Info Box */}
        <div className="mt-8 p-4 bg-blue-900/20 border border-blue-500/50 rounded-lg">
          <h4 className="font-semibold text-blue-300 mb-2">📊 How Validation Works</h4>
          <ul className="text-sm text-blue-200 space-y-1">
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
