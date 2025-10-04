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
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Starting Lineups</h2>
        </div>
        <div className="p-6">
          <div className="text-center text-gray-500">Loading starting lineups...</div>
        </div>
      </div>
    )
  }

  if (error || !starters) {
    return (
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Starting Lineups</h2>
        </div>
        <div className="p-6">
          <div className="text-center text-gray-500">
            {error || 'No starting lineup data available'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Starting Lineups</h2>
        <p className="text-sm text-gray-600 mt-1">
          Key offensive players and depth chart positions
        </p>
      </div>
      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Away Team */}
          <div>
            <h3 className="text-md font-semibold text-gray-800 mb-4 flex items-center">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded mr-2">AWAY</span>
              {starters.away.team.name}
            </h3>
            <div className="space-y-3">
              {starters.away.starters.map((player, index) => (
                <PlayerCard key={player.id || index} player={player} />
              ))}
              {starters.away.starters.length === 0 && (
                <div className="text-sm text-gray-500 italic">No starter data available</div>
              )}
            </div>
          </div>

          {/* Home Team */}
          <div>
            <h3 className="text-md font-semibold text-gray-800 mb-4 flex items-center">
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded mr-2">HOME</span>
              {starters.home.team.name}
            </h3>
            <div className="space-y-3">
              {starters.home.starters.map((player, index) => (
                <PlayerCard key={player.id || index} player={player} />
              ))}
              {starters.home.starters.length === 0 && (
                <div className="text-sm text-gray-500 italic">No starter data available</div>
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
      case 'QB': return 'bg-purple-100 text-purple-800'
      case 'RB': return 'bg-green-100 text-green-800'
      case 'WR': case 'WR1': case 'WR2': return 'bg-blue-100 text-blue-800'
      case 'TE': case 'TE1': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getInjuryColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-600'
      case 'questionable': return 'text-yellow-600'
      case 'doubtful': return 'text-orange-600'
      case 'out': case 'ir': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <div className="flex items-center space-x-3">
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${getPositionColor(player.position)}`}>
          {player.position}
        </span>
        <div>
          <div className="font-medium text-gray-900">
            {player.fullName}
            {player.jersey && (
              <span className="text-sm text-gray-500 ml-1">#{player.jersey}</span>
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
