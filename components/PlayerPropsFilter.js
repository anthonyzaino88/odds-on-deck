'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { getQualityTier } from '../lib/quality-score.js'

export default function PlayerPropsFilter({ props }) {
  const [filterMode, setFilterMode] = useState('safe')

  // Filter and sort props based on selected mode
  const filteredProps = useMemo(() => {
    let filtered = [...props]

    // Apply filters based on mode
    if (filterMode === 'safe') {
      filtered = filtered.filter(p => (p.probability || 0) >= 0.52)
      filtered.sort((a, b) => (b.probability || 0) - (a.probability || 0))
    } else if (filterMode === 'balanced') {
      filtered = filtered.filter(p => (p.probability || 0) >= 0.45 && (p.edge || 0) >= 0.05)
      filtered.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    } else if (filterMode === 'value') {
      filtered = filtered.filter(p => (p.edge || 0) >= 0.15)
      filtered.sort((a, b) => (b.edge || 0) - (a.edge || 0))
    } else if (filterMode === 'homerun') {
      // High variance props
      filtered.sort((a, b) => (b.edge || 0) - (a.edge || 0))
    }

    return filtered
  }, [props, filterMode])

  // Group props by sport
  const mlbProps = filteredProps.filter(p => p.sport === 'mlb')
  const nflProps = filteredProps.filter(p => p.sport === 'nfl')
  const nhlProps = filteredProps.filter(p => p.sport === 'nhl')
  
  // MLB subcategories
  const battingProps = mlbProps.filter(p => p.category === 'batting')
  const pitchingProps = mlbProps.filter(p => p.category === 'pitching')

  return (
    <div className="space-y-8">
      {/* Filter Mode Selector */}
      <div className="card">
        <div className="px-6 py-4">
          <h3 className="text-lg font-semibold text-white mb-4">
            🎯 Betting Strategy
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              onClick={() => setFilterMode('safe')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'safe'
                  ? 'border-green-500 bg-green-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-green-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">🛡️ Safe Mode</div>
              <div className="text-xs text-gray-400 mt-1">52%+ win rate</div>
              {filterMode === 'safe' && (
                <div className="text-xs text-green-400 mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('balanced')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'balanced'
                  ? 'border-blue-500 bg-blue-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-blue-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">⚖️ Balanced</div>
              <div className="text-xs text-gray-400 mt-1">Best quality</div>
              {filterMode === 'balanced' && (
                <div className="text-xs text-blue-400 mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('value')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'value'
                  ? 'border-yellow-500 bg-yellow-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-yellow-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">💰 Value Hunter</div>
              <div className="text-xs text-gray-400 mt-1">15%+ edge</div>
              {filterMode === 'value' && (
                <div className="text-xs text-yellow-400 mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('homerun')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'homerun'
                  ? 'border-purple-500 bg-purple-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-purple-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">🎰 Home Run</div>
              <div className="text-xs text-gray-400 mt-1">Big edges</div>
              {filterMode === 'homerun' && (
                <div className="text-xs text-purple-400 mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>
          </div>

          {/* Mode Description */}
          <div className="mt-4 p-3 bg-slate-800 rounded-lg border border-slate-700">
            <p className="text-sm text-gray-300">
              {filterMode === 'safe' && '🛡️ Showing props with 52%+ win probability. These are the safest, most consistent picks.'}
              {filterMode === 'balanced' && '⚖️ Showing props with optimal quality scores (45%+ probability, 5%+ edge). Best overall picks.'}
              {filterMode === 'value' && '💰 Showing props with 15%+ edge. These are market inefficiencies with higher potential value.'}
              {filterMode === 'homerun' && '🎰 Showing all props sorted by edge. Includes higher-variance opportunities.'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Summary - Only show sports with props */}
      {(mlbProps.length > 0 || nflProps.length > 0 || nhlProps.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {mlbProps.length > 0 && (
            <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">⚾</span>
                <div>
                  <div className="font-semibold text-blue-400">MLB Props</div>
                  <div className="text-sm text-blue-300">{mlbProps.length} opportunities</div>
                </div>
              </div>
            </div>
          )}
          {nflProps.length > 0 && (
            <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">🏈</span>
                <div>
                  <div className="font-semibold text-green-400">NFL Props</div>
                  <div className="text-sm text-green-300">{nflProps.length} opportunities</div>
                </div>
              </div>
            </div>
          )}
          {nhlProps.length > 0 && (
            <div className="bg-purple-900/20 border border-purple-500/50 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">🏒</span>
                <div>
                  <div className="font-semibold text-purple-400">NHL Props</div>
                  <div className="text-sm text-purple-300">{nhlProps.length} opportunities</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top Props */}
      {filteredProps.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-xl font-semibold text-white">
              🔥 Top Props ({filterMode === 'safe' ? 'Safest' : filterMode === 'balanced' ? 'Best Quality' : filterMode === 'value' ? 'Best Value' : 'Highest Edge'})
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Sorted by {filterMode === 'safe' ? 'win probability' : filterMode === 'balanced' ? 'quality score' : 'edge'}
            </p>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {filteredProps.slice(0, 20).map((prop, index) => (
                <PlayerPropCard key={`${prop.gameId}-${prop.playerName}-${prop.type}`} prop={prop} rank={index + 1} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MLB Props by Category */}
      {(battingProps.length > 0 || pitchingProps.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Batting Props */}
          {battingProps.length > 0 && (
            <div className="card">
              <div className="px-6 py-4 border-b border-slate-700">
                <h3 className="text-lg font-semibold text-white">
                  ⚾ Batting Props
                </h3>
                <div className="text-sm text-gray-400">{battingProps.length} opportunities</div>
              </div>
              <div className="p-6">
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {battingProps.map((prop) => (
                    <PropRow key={`${prop.gameId}-${prop.playerName}-${prop.type}`} prop={prop} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pitching Props */}
          {pitchingProps.length > 0 && (
            <div className="card">
              <div className="px-6 py-4 border-b border-slate-700">
                <h3 className="text-lg font-semibold text-white">
                  🎯 Pitching Props
                </h3>
                <div className="text-sm text-gray-400">{pitchingProps.length} opportunities</div>
              </div>
              <div className="p-6">
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {pitchingProps.map((prop) => (
                    <PropRow key={`${prop.gameId}-${prop.playerName}-${prop.type}`} prop={prop} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* NHL Props */}
      {nhlProps.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-slate-700">
            <h3 className="text-lg font-semibold text-white">
              🏒 NHL Props
            </h3>
            <div className="text-sm text-gray-400">{nhlProps.length} opportunities</div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {nhlProps.map((prop) => (
                <PropRow key={`${prop.gameId}-${prop.playerName}-${prop.type}`} prop={prop} />
              ))}
            </div>
          </div>
        </div>
      )}

      {filteredProps.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-gray-500 text-6xl mb-4">🎯</div>
          <h3 className="text-lg font-medium text-white mb-2">No Props Match This Strategy</h3>
          <p className="text-gray-400">
            Try a different betting strategy or check back when more props are available.
          </p>
        </div>
      )}
    </div>
  )
}

function PlayerPropCard({ prop, rank }) {
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const qualityTier = getQualityTier(prop.qualityScore || 0)

  const tierColors = {
    elite: 'bg-green-900/30 text-green-400 border-green-500/50',
    premium: 'bg-blue-900/30 text-blue-400 border-blue-500/50',
    solid: 'bg-yellow-900/30 text-yellow-400 border-yellow-500/50',
    speculative: 'bg-orange-900/30 text-orange-400 border-orange-500/50',
    longshot: 'bg-slate-700 text-gray-400 border-slate-600'
  }

  const handleSaveProp = async (e) => {
    e.preventDefault() // Prevent navigation
    e.stopPropagation()
    
    setIsSaving(true)
    try {
      const response = await fetch('/api/props/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prop })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setIsSaved(true)
        setTimeout(() => setIsSaved(false), 2000) // Reset after 2 seconds
      } else {
        alert('Failed to save prop: ' + (data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error saving prop:', error)
      alert('Failed to save prop')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="border border-slate-700 rounded-lg p-4 hover:border-blue-500 hover:shadow-md transition-all bg-slate-800/50">
      <div className="flex items-center justify-between">
        <Link href={`/game/${prop.gameId}`} className="flex items-center space-x-4 flex-1 cursor-pointer">
          <div className="text-2xl font-bold text-blue-400">#{rank}</div>
          <div>
            <div className="font-semibold text-white">
              {prop.playerName} {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
            </div>
            <div className="text-sm text-gray-400">
              {prop.gameTime && format(new Date(prop.gameTime), 'h:mm a')}
            </div>
            {prop.reasoning && (
              <div className="text-sm text-gray-400 mt-1">
                {prop.reasoning}
              </div>
            )}
          </div>
        </Link>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleSaveProp}
            disabled={isSaving || isSaved}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              isSaved 
                ? 'bg-green-600 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            } disabled:opacity-50`}
          >
            {isSaved ? '✓ Saved!' : isSaving ? 'Saving...' : '💾 Save'}
          </button>
          <div className="text-right">
            <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${tierColors[qualityTier.tier]} mb-2`}>
              {qualityTier.emoji} {qualityTier.label}
            </div>
            <div className="text-sm text-gray-400 mb-1">
              Score: <span className="font-semibold text-white">{prop.qualityScore?.toFixed(1) || 'N/A'}</span>
            </div>
            <div className="text-lg font-bold text-green-400">
              {((prop.probability || 0) * 100).toFixed(1)}% win
            </div>
            <div className="text-sm font-semibold text-blue-400">
              +{((prop.edge || 0) * 100).toFixed(1)}% edge
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PropRow({ prop }) {
  const qualityTier = getQualityTier(prop.qualityScore || 0)

  return (
    <Link href={`/game/${prop.gameId}`}>
      <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer border border-slate-700">
        <div className="flex items-center space-x-3 flex-1">
          <div className="text-lg">{qualityTier.emoji}</div>
          <div>
            <div className="font-medium text-white">
              {prop.playerName}
            </div>
            <div className="text-sm text-gray-400">
              {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500 mb-1">
            Q: {prop.qualityScore?.toFixed(1) || 'N/A'}
          </div>
          <div className="font-semibold text-green-400">
            {((prop.probability || 0) * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-blue-400">
            +{((prop.edge || 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </Link>
  )
}

