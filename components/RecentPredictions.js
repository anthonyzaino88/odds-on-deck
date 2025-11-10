'use client'

import { useState } from 'react'

export default function RecentPredictions({ records }) {
  const [showCount, setShowCount] = useState(10)
  
  const displayRecords = records.slice(0, showCount)
  const hasMore = records.length > showCount

  return (
    <div>
      {records.length > 0 ? (
        <>
          <div className="space-y-3">
            {displayRecords.map((record) => (
              <div key={record.id} className="border border-slate-700 rounded-lg p-4 bg-slate-900 hover:border-slate-600 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
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
                    <div className="flex gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                      <span>Edge: {(record.edge * 100).toFixed(1)}%</span>
                      <span>Win Prob: {((record.probability || 0.5) * 100).toFixed(1)}%</span>
                      {record.qualityScore && <span>Quality: {record.qualityScore.toFixed(1)}</span>}
                      <span className="capitalize">{(record.source || 'system_generated').replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {/* Show More/Less Button */}
          {records.length > 10 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowCount(hasMore ? showCount + 10 : 10)}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors font-medium"
              >
                {hasMore ? `Show More (${records.length - showCount} remaining)` : 'Show Less'}
              </button>
            </div>
          )}
        </>
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
  )
}

