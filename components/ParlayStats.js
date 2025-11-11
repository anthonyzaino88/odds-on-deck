'use client'

import { useState, useEffect } from 'react'

export default function ParlayStats({ mode = 'full' }) {
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSport, setSelectedSport] = useState('all')

  useEffect(() => {
    fetchParlayHistory()
  }, [selectedSport])

  async function fetchParlayHistory() {
    setLoading(true)
    try {
      const sportParam = selectedSport !== 'all' ? `&sport=${selectedSport}` : ''
      const response = await fetch(`/api/parlays/history?limit=50${sportParam}`)
      const data = await response.json()
      
      if (data.success) {
        setStats(data.stats)
        setHistory(data.history || [])
      }
    } catch (error) {
      console.error('Error fetching parlay history:', error)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        <p className="text-gray-400 mt-4">Loading parlay stats...</p>
      </div>
    )
  }

  if (!stats || stats.total === 0) {
    return mode === 'simple' ? null : (
      <div className="bg-slate-800 rounded-lg p-6 text-center border border-slate-700">
        <p className="text-gray-400 mb-2">No parlay history yet.</p>
        <p className="text-sm text-gray-500">
          Save and validate parlays to start tracking your performance!
        </p>
      </div>
    )
  }

  // SIMPLE MODE for Parlay Generator page
  if (mode === 'simple') {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Your Parlay Record</h3>
            <p className="text-sm text-gray-400">Last {stats.total} validated parlays</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">
              <span className="text-green-400">{stats.won}</span>
              <span className="text-gray-500 mx-1">-</span>
              <span className="text-red-400">{stats.lost}</span>
            </div>
            <div className={`text-sm font-semibold ${stats.winRate >= 50 ? 'text-green-400' : 'text-orange-400'}`}>
              {stats.winRate}% Win Rate
            </div>
          </div>
        </div>
        
        {/* Sport breakdown */}
        {Object.keys(stats.bySport).length > 1 && (
          <div className="mt-4 pt-4 border-t border-slate-700 flex gap-4 text-sm">
            {Object.entries(stats.bySport).map(([sport, data]) => (
              <div key={sport} className="flex-1">
                <div className="text-gray-400 uppercase text-xs mb-1">{sport}</div>
                <div className="text-white font-semibold">
                  {data.won}-{data.lost} ({data.winRate}%)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // FULL MODE for Validation page
  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Parlay Performance</h2>
        <select
          value={selectedSport}
          onChange={(e) => setSelectedSport(e.target.value)}
          className="bg-slate-800 text-white border border-slate-700 rounded-lg px-4 py-2"
        >
          <option value="all">All Sports</option>
          <option value="nfl">NFL</option>
          <option value="nhl">NHL</option>
          <option value="mlb">MLB</option>
        </select>
      </div>

      {/* Main stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <div className="text-gray-400 text-sm mb-2">Total Parlays</div>
          <div className="text-3xl font-bold text-white">{stats.total}</div>
        </div>
        
        <div className="bg-gradient-to-br from-green-900/30 to-slate-800 rounded-lg p-6 border border-green-500/30">
          <div className="text-gray-400 text-sm mb-2">Wins</div>
          <div className="text-3xl font-bold text-green-400">{stats.won}</div>
        </div>
        
        <div className="bg-gradient-to-br from-red-900/30 to-slate-800 rounded-lg p-6 border border-red-500/30">
          <div className="text-gray-400 text-sm mb-2">Losses</div>
          <div className="text-3xl font-bold text-red-400">{stats.lost}</div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-900/30 to-slate-800 rounded-lg p-6 border border-blue-500/30">
          <div className="text-gray-400 text-sm mb-2">Win Rate</div>
          <div className={`text-3xl font-bold ${stats.winRate >= 50 ? 'text-green-400' : 'text-orange-400'}`}>
            {stats.winRate}%
          </div>
        </div>
      </div>

      {/* Performance by sport */}
      {Object.keys(stats.bySport).length > 0 && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-xl font-bold text-white mb-4">Performance by Sport</h3>
          <div className="space-y-3">
            {Object.entries(stats.bySport).map(([sport, data]) => (
              <div key={sport} className="flex items-center justify-between">
                <div>
                  <span className="text-white font-semibold uppercase">{sport}</span>
                  <span className="text-gray-400 text-sm ml-2">({data.total} parlays)</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-white font-mono">
                    {data.won}-{data.lost}
                  </span>
                  <span className={`font-bold ${parseFloat(data.winRate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {data.winRate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance by leg count */}
      {Object.keys(stats.byLegCount).length > 0 && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-xl font-bold text-white mb-4">Performance by Leg Count</h3>
          <div className="space-y-3">
            {Object.entries(stats.byLegCount)
              .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
              .map(([legCount, data]) => (
                <div key={legCount} className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-semibold">{legCount}-Leg Parlays</span>
                    <span className="text-gray-400 text-sm ml-2">({data.total} total)</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-white font-mono">
                      {data.won}-{data.lost}
                    </span>
                    <span className={`font-bold ${parseFloat(data.winRate) >= 40 ? 'text-green-400' : 'text-red-400'}`}>
                      {data.winRate}%
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent parlays */}
      {history.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h3 className="text-xl font-bold text-white mb-4">Recent Parlays</h3>
          <div className="space-y-3">
            {history.slice(0, 10).map((parlay) => (
              <div 
                key={parlay.id} 
                className={`p-4 rounded-lg border ${
                  parlay.outcome === 'won' 
                    ? 'bg-green-900/20 border-green-500/30' 
                    : 'bg-red-900/20 border-red-500/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold px-2 py-1 rounded ${
                      parlay.outcome === 'won' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {parlay.outcome === 'won' ? 'WON' : 'LOST'}
                    </span>
                    <span className="text-white font-semibold">{parlay.legCount}-Leg {parlay.sport?.toUpperCase()}</span>
                    <span className="text-gray-400 text-sm">+{((parlay.totalOdds - 1) * 100).toFixed(0)}</span>
                  </div>
                  <span className="text-gray-400 text-sm">
                    {new Date(parlay.completedAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-sm text-gray-400">{parlay.actualResult}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

