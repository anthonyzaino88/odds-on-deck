'use client'

export default function PendingProps({ pendingRecords }) {
  if (pendingRecords.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-green-400 text-4xl mb-3">✅</div>
        <p className="text-gray-400">No pending props - all caught up!</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pendingRecords.map((record) => (
        <div key={record.id} className="border border-yellow-500/50 rounded-lg p-4 bg-yellow-900/10 hover:bg-yellow-900/20 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-white">
                  {record.playerName}
                </span>
                <span className="text-sm text-gray-400">
                  {record.propType.replace(/_/g, ' ')}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400 border border-yellow-500/50">
                  ⏳ Waiting for game
                </span>
                {record.sport && (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    record.sport === 'nfl' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                    record.sport === 'nhl' ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-500/50' :
                    'bg-green-900/30 text-green-400 border border-green-500/50'
                  }`}>
                    {record.sport.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-400 mt-1">
                {record.prediction.toUpperCase()} {record.threshold}
                {record.projectedValue && ` • Projected: ${record.projectedValue.toFixed(1)}`}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                <span className="text-yellow-400">Edge: {(record.edge * 100).toFixed(1)}%</span>
                <span>Win Prob: {((record.probability || 0.5) * 100).toFixed(1)}%</span>
                {record.qualityScore && <span>Quality: {record.qualityScore.toFixed(1)}</span>}
                <span className="capitalize">{(record.source || 'system_generated').replace(/_/g, ' ')}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

