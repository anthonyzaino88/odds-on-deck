'use client'

import { useState, useEffect } from 'react'

export default function NFLRosterSection({ gameId }) {
  const [starters, setStarters] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchStarters() {
      try {
        setLoading(true)
        const response = await fetch(`/api/nfl/roster?action=game-starters&gameId=${gameId}`)
        const data = await response.json()
        
        if (response.ok) {
          setStarters(data.starters)
        } else {
          setError(data.error || 'Failed to fetch starters')
        }
      } catch (error) {
        console.error('Error fetching NFL starters:', error)
        setError('Failed to fetch starters')
      } finally {
        setLoading(false)
      }
    }

    if (gameId) {
      fetchStarters()
    }
  }, [gameId])

  if (loading) {
    return (
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Starting Lineups</h2>
          <p className="text-sm text-gray-400 mt-1">
            Key offensive players and depth chart positions
          </p>
        </div>
        <div className="p-6">
          <div className="text-center text-gray-400">Loading starting lineups...</div>
        </div>
      </div>
    )
  }

  if (error || !starters) {
    return (
      <div className="card">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Starting Lineups</h2>
          <p className="text-sm text-gray-400 mt-1">
            Key offensive players and depth chart positions
          </p>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 border border-slate-700 rounded-lg bg-slate-900">
              <div className="flex items-center mb-4">
                <span className="text-xs font-semibold bg-slate-700 text-gray-300 px-3 py-1.5 rounded mr-2">AWAY</span>
              </div>
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">No starter data available</p>
              </div>
            </div>
            <div className="p-6 border border-slate-700 rounded-lg bg-slate-900">
              <div className="flex items-center mb-4">
                <span className="text-xs font-semibold bg-slate-700 text-gray-300 px-3 py-1.5 rounded mr-2">HOME</span>
              </div>
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">No starter data available</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white">Starting Lineups</h2>
        <p className="text-sm text-gray-400 mt-1">
          Key offensive players and depth chart positions
        </p>
      </div>
      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Away Team */}
          <div>
            <h3 className="text-md font-semibold text-white mb-4 flex items-center">
              <span className="text-xs font-semibold bg-slate-700 text-gray-300 px-3 py-1.5 rounded mr-2">AWAY</span>
              {starters.away.team.name}
            </h3>
            <div className="space-y-3">
              {starters.away.starters.map((player, index) => (
                <PlayerCard key={player.id || index} player={player} />
              ))}
              {starters.away.starters.length === 0 && (
                <div className="text-sm text-gray-400 italic">No starter data available</div>
              )}
            </div>
          </div>

          {/* Home Team */}
          <div>
            <h3 className="text-md font-semibold text-white mb-4 flex items-center">
              <span className="text-xs font-semibold bg-slate-700 text-gray-300 px-3 py-1.5 rounded mr-2">HOME</span>
              {starters.home.team.name}
            </h3>
            <div className="space-y-3">
              {starters.home.starters.map((player, index) => (
                <PlayerCard key={player.id || index} player={player} />
              ))}
              {starters.home.starters.length === 0 && (
                <div className="text-sm text-gray-400 italic">No starter data available</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PlayerCard({ player }) {
  const getPositionColor = (position) => {
    switch (position) {
      case 'QB': return 'bg-purple-900/30 text-purple-300 border-purple-500/50'
      case 'RB': return 'bg-green-900/30 text-green-300 border-green-500/50'
      case 'WR': case 'WR1': case 'WR2': return 'bg-blue-900/30 text-blue-300 border-blue-500/50'
      case 'TE': case 'TE1': return 'bg-orange-900/30 text-orange-300 border-orange-500/50'
      default: return 'bg-slate-700 text-gray-300 border-slate-600'
    }
  }

  const getInjuryColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-400'
      case 'questionable': return 'text-yellow-400'
      case 'doubtful': return 'text-orange-400'
      case 'out': case 'ir': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  return (
    <div className="flex items-center justify-between p-3 bg-slate-800 border border-slate-700 rounded-lg">
      <div className="flex items-center space-x-3">
        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${getPositionColor(player.position)}`}>
          {player.position}
        </span>
        <div>
          <div className="font-medium text-white">
            {player.fullName}
            {player.jersey && (
              <span className="text-sm text-gray-400 ml-1">#{player.jersey}</span>
            )}
          </div>
          {player.experience && (
            <div className="text-xs text-gray-500">
              {player.experience} {player.experience === 1 ? 'year' : 'years'} exp.
            </div>
          )}
        </div>
      </div>
      {player.injuryStatus && player.injuryStatus !== 'healthy' && (
        <span className={`text-xs font-medium ${getInjuryColor(player.injuryStatus)}`}>
          {player.injuryStatus.toUpperCase()}
        </span>
      )}
    </div>
  )
}
