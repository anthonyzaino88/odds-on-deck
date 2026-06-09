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
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Starting Lineups</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Key offensive players and depth chart positions
          </p>
        </div>
        <div className="p-4">
          <div className="text-center text-slate-400">Loading starting lineups...</div>
        </div>
      </div>
    )
  }

  if (error || !starters) {
    return (
      <div className="card">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Starting Lineups</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Key offensive players and depth chart positions
          </p>
        </div>
        <div className="p-4">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
              <div className="flex items-center mb-4">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide bg-white/[0.05] text-slate-400 mr-2">AWAY</span>
              </div>
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">No starter data available</p>
              </div>
            </div>
            <div className="p-4 border border-white/[0.06] rounded-[4px] bg-surface">
              <div className="flex items-center mb-4">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide bg-white/[0.05] text-slate-400 mr-2">HOME</span>
              </div>
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">No starter data available</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Starting Lineups</h2>
        <p className="text-sm text-slate-400 mt-1">
          Key offensive players and depth chart positions
        </p>
      </div>
      <div className="p-4">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Away Team */}
          <div>
            <h3 className="text-md font-semibold text-slate-100 mb-4 flex items-center">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide bg-white/[0.05] text-slate-400 mr-2">AWAY</span>
              {starters.away.team.name}
            </h3>
            <div className="space-y-3">
              {starters.away.starters.map((player, index) => (
                <PlayerCard key={player.id || index} player={player} />
              ))}
              {starters.away.starters.length === 0 && (
                <div className="text-sm text-slate-400 italic">No starter data available</div>
              )}
            </div>
          </div>

          {/* Home Team */}
          <div>
            <h3 className="text-md font-semibold text-slate-100 mb-4 flex items-center">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide bg-white/[0.05] text-slate-400 mr-2">HOME</span>
              {starters.home.team.name}
            </h3>
            <div className="space-y-3">
              {starters.home.starters.map((player, index) => (
                <PlayerCard key={player.id || index} player={player} />
              ))}
              {starters.home.starters.length === 0 && (
                <div className="text-sm text-slate-400 italic">No starter data available</div>
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
      case 'QB': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'RB': return 'bg-green-500/10 text-green-400 border-green-500/20'
      case 'WR': case 'WR1': case 'WR2': return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      case 'TE': case 'TE1': return 'bg-red-500/10 text-red-400 border-red-500/20'
      default: return 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
    }
  }

  const getInjuryColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-400'
      case 'questionable': return 'text-amber-400'
      case 'doubtful': return 'text-amber-400'
      case 'out': case 'ir': return 'text-red-400'
      default: return 'text-slate-400'
    }
  }

  return (
    <div className="flex items-center justify-between p-3 bg-surface hover:bg-elevated transition-colors duration-100 border border-white/[0.06] rounded-[4px]">
      <div className="flex items-center space-x-3">
        <span className={`inline-flex items-center justify-center w-9 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-[3px] border ${getPositionColor(player.position)}`}>
          {player.position}
        </span>
        <div>
          <div className="text-sm font-medium text-slate-100">
            {player.fullName}
            {player.jersey && (
              <span className="text-xs text-slate-500 ml-1 tabular-nums font-mono">#{player.jersey}</span>
            )}
          </div>
          {player.experience && (
            <div className="text-xs text-slate-500">
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
