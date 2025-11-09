'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { getQualityTier } from '../lib/quality-score.js'

export default function PlayerPropsFilter({ props }) {
  const [filterMode, setFilterMode] = useState('safe')

  // Filter and sort props based on selected mode
  const filteredProps = useMemo(() => {
    let filtered = [...props]

    // Debug: Check team context coverage
    if (typeof window !== 'undefined' && props.length > 0) {
      const withContext = props.filter(p => p.teamContext).length
      console.log(`🔍 Team Context Coverage: ${withContext}/${props.length} props (${Math.round(withContext/props.length*100)}%)`)
    }

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
    } else if (filterMode === 'power') {
      // Power Offense: Hot teams with high win probability
      filtered = filtered.filter(p => {
        const ctx = p.teamContext
        return ctx && ctx.isHotOffense && ctx.isFavored && (p.probability || 0) >= 0.50
      })
      filtered.sort((a, b) => (b.teamContext?.offensiveRating || 0) - (a.teamContext?.offensiveRating || 0))
    } else if (filterMode === 'home') {
      // Home Heroes: Strong venue performance
      // NOTE: Odds API doesn't provide player-team mapping, so we can't
      // reliably determine if a player is home or away. Instead, we filter
      // by strong venue performance (65+ venue rating)
      filtered = filtered.filter(p => {
        const ctx = p.teamContext
        if (!ctx) return false
        
        // Show props where team has strong venue performance (home OR away)
        return ctx.venueRating >= 65 && (p.probability || 0) >= 0.45
      })
      filtered.sort((a, b) => (b.teamContext?.venueRating || 0) - (a.teamContext?.venueRating || 0))
    } else if (filterMode === 'scoring') {
      // High Scoring: Props from games expected to be high scoring
      filtered = filtered.filter(p => {
        const ctx = p.teamContext
        return ctx && ctx.isHighScoring && (p.probability || 0) >= 0.50
      })
      filtered.sort((a, b) => (b.teamContext?.expectedTotal || 0) - (a.teamContext?.expectedTotal || 0))
    } else if (filterMode === 'matchup') {
      // Favorable Matchup: Props against weak defenses
      filtered = filtered.filter(p => {
        const ctx = p.teamContext
        return ctx && ctx.isWeakDefense && (p.probability || 0) >= 0.50
      })
      filtered.sort((a, b) => (b.teamContext?.defensiveMatchupRating || 0) - (a.teamContext?.defensiveMatchupRating || 0))
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
    <div className="space-y-6 sm:space-y-8">
      {/* Filter Mode Selector */}
      <div className="card">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">
            🎯 Betting Strategy
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <button
              onClick={() => setFilterMode('safe')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'safe'
                  ? 'border-green-500 bg-green-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-green-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">🛡️ Safe</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">52%+ win</div>
              {filterMode === 'safe' && (
                <div className="text-[10px] sm:text-xs text-green-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('balanced')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'balanced'
                  ? 'border-blue-500 bg-blue-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-blue-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">⚖️ Balanced</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Best quality</div>
              {filterMode === 'balanced' && (
                <div className="text-[10px] sm:text-xs text-blue-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('value')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'value'
                  ? 'border-yellow-500 bg-yellow-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-yellow-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">💰 Value</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">15%+ edge</div>
              {filterMode === 'value' && (
                <div className="text-[10px] sm:text-xs text-yellow-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('homerun')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'homerun'
                  ? 'border-purple-500 bg-purple-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-purple-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">🎰 Home Run</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Big edges</div>
              {filterMode === 'homerun' && (
                <div className="text-[10px] sm:text-xs text-purple-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            {/* Smart Filters - Team Context Based */}
            <button
              onClick={() => setFilterMode('power')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'power'
                  ? 'border-orange-500 bg-orange-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-orange-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">⚡ Power Offense</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Hot teams</div>
              {filterMode === 'power' && (
                <div className="text-[10px] sm:text-xs text-orange-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('home')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'home'
                  ? 'border-cyan-500 bg-cyan-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-cyan-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">🏠 Home Heroes</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Home advantage</div>
              {filterMode === 'home' && (
                <div className="text-[10px] sm:text-xs text-cyan-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('scoring')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'scoring'
                  ? 'border-red-500 bg-red-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-red-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">🎯 High Scoring</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">48+ expected</div>
              {filterMode === 'scoring' && (
                <div className="text-[10px] sm:text-xs text-red-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>

            <button
              onClick={() => setFilterMode('matchup')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'matchup'
                  ? 'border-pink-500 bg-pink-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-pink-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">🎪 Weak Defense</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Soft matchup</div>
              {filterMode === 'matchup' && (
                <div className="text-[10px] sm:text-xs text-pink-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>
          </div>

          {/* Mode Description */}
          <div className="mt-3 sm:mt-4 p-2 sm:p-3 bg-slate-800 rounded-lg border border-slate-700">
            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
              {filterMode === 'safe' && '🛡️ Showing props with 52%+ win probability. These are the safest, most consistent picks.'}
              {filterMode === 'balanced' && '⚖️ Showing props with optimal quality scores (45%+ probability, 5%+ edge). Best overall picks.'}
              {filterMode === 'value' && '💰 Showing props with 15%+ edge. These are market inefficiencies with higher potential value.'}
              {filterMode === 'homerun' && '🎰 Showing all props sorted by edge. Includes higher-variance opportunities.'}
              {filterMode === 'power' && '⚡ Showing props from teams with hot offenses (28+ PPG NFL, 3.5+ GPG NHL) and 55%+ win probability. Offensive powerhouses.'}
              {filterMode === 'home' && '🏠 Showing props from teams with strong venue performance (65+ rating). Teams that perform well at their home venue or on the road!'}
              {filterMode === 'scoring' && '🎯 Showing props from high-scoring games (48+ expected points NFL, 6.5+ NHL). More opportunities for player production.'}
              {filterMode === 'matchup' && '🎪 Showing props against weak defenses (26+ PPG allowed NFL, 3.5+ GA NHL). Favorable matchups for big performances.'}
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
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-700">
            <h2 className="text-lg sm:text-xl font-semibold text-white">
              🔥 Top Props
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">
              {filterMode === 'safe' && 'Safest'}
              {filterMode === 'balanced' && 'Best Quality'}
              {filterMode === 'value' && 'Best Value'}
              {filterMode === 'homerun' && 'Highest Edge'}
              {filterMode === 'power' && 'Power Offenses'}
              {filterMode === 'home' && 'Home Advantage'}
              {filterMode === 'scoring' && 'High Scoring Games'}
              {filterMode === 'matchup' && 'Weak Defense Matchups'}
            </p>
          </div>
          <div className="p-3 sm:p-6">
            <div className="space-y-2 sm:space-y-3 max-h-[500px] sm:max-h-[600px] overflow-y-auto">
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
          <div className="px-6 py-4 border-b border-slate-700 bg-gradient-to-r from-purple-900/20 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🏒</span>
                <div>
                  <h3 className="text-xl font-semibold text-purple-400">
                    NHL Props
            </h3>
                  <div className="text-sm text-purple-300">{nhlProps.length} opportunities</div>
                </div>
              </div>
              <div className="text-sm text-gray-400">
                {nhlProps.filter(p => (p.edge || 0) >= 0.10).length} with 10%+ edge
              </div>
            </div>
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
      
      {/* NFL Props */}
      {nflProps.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b border-slate-700 bg-gradient-to-r from-green-900/20 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🏈</span>
                <div>
                  <h3 className="text-xl font-semibold text-green-400">
                    NFL Props
                  </h3>
                  <div className="text-sm text-green-300">{nflProps.length} opportunities</div>
                </div>
              </div>
              <div className="text-sm text-gray-400">
                {nflProps.filter(p => (p.edge || 0) >= 0.10).length} with 10%+ edge
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {nflProps.map((prop) => (
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
  const [isSaved, setIsSaved] = useState(prop.isSaved || false) // Initialize from API
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
        // Keep saved state permanently to prevent duplicate saves
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

  // Format odds for display
  const formatOdds = (odds) => {
    if (!odds) return null
    const decimalOdds = parseFloat(odds)
    if (isNaN(decimalOdds)) return null
    
    // Convert decimal odds to American format
    if (decimalOdds >= 2.0) {
      // Underdog: convert to positive American odds
      const americanOdds = Math.round((decimalOdds - 1) * 100)
      return `+${americanOdds}`
    } else {
      // Favorite: convert to negative American odds
      const americanOdds = Math.round(-100 / (decimalOdds - 1))
      return americanOdds.toString()
    }
  }

  const displayOdds = formatOdds(prop.odds)

  return (
    <div className="border border-slate-700 rounded-lg p-3 sm:p-4 hover:border-blue-500 hover:shadow-md transition-all bg-slate-800/50">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Rank - Hidden on mobile */}
        <div className="hidden sm:block text-xl font-bold text-blue-400 min-w-[40px]">
          #{rank}
        </div>

        {/* Main Content */}
        <Link href={`/game/${prop.gameId}`} className="flex-1 cursor-pointer min-w-0">
          <div className="flex items-start gap-2">
            {/* Rank on mobile */}
            <div className="sm:hidden text-sm font-bold text-blue-400 min-w-[32px]">
              #{rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-sm sm:text-base text-white truncate">
                  {prop.playerName}
                </div>
                {/* Team Context Badges */}
                {prop.teamContext && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {prop.teamContext.isHotOffense && (
                      <span className="text-xs" title={`Hot Offense: ${prop.teamContext.formattedOffense}`}>🔥</span>
                    )}
                    {prop.teamContext.isHome && prop.teamContext.venueRating >= 65 && (
                      <span className="text-xs" title="Strong Home Record">🏠</span>
                    )}
                    {prop.teamContext.isHighScoring && (
                      <span className="text-xs" title={`High Scoring Game: ${prop.teamContext.formattedTotal}`}>⚡</span>
                    )}
                    {prop.teamContext.isWeakDefense && (
                      <span className="text-xs" title={`Weak Defense: ${prop.teamContext.formattedDefense}`}>🎯</span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-xs sm:text-sm text-gray-400">
                {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
                {prop.teamContext && (
                  <span className="text-gray-500 ml-1">
                    • {prop.teamContext.team} {prop.teamContext.isHome ? 'vs' : '@'} {prop.teamContext.opponent}
                  </span>
                )}
              </div>
              {displayOdds && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs sm:text-sm text-amber-400 font-bold">
                    {displayOdds}
                  </span>
                  {prop.bookmaker && (
                    <span className="text-[10px] sm:text-xs text-gray-500">
                      via {prop.bookmaker}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Link>

        {/* Stats and Button */}
        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 pl-10 sm:pl-0">
          {/* Stats */}
          <div className="flex flex-col items-end gap-0.5">
            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${tierColors[qualityTier.tier]}`}>
              {qualityTier.emoji} {qualityTier.label}
            </div>
            <div className="text-xs sm:text-sm text-gray-400">
              Q: <span className="font-semibold text-white">{prop.qualityScore?.toFixed(1) || 'N/A'}</span>
            </div>
            <div className="text-sm sm:text-base font-bold text-green-400">
              {((prop.probability || 0) * 100).toFixed(0)}%
            </div>
            <div className="text-xs sm:text-sm font-semibold text-blue-400">
              +{((prop.edge || 0) * 100).toFixed(1)}%
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSaveProp}
            disabled={isSaving || isSaved}
            className={`px-3 py-2 sm:px-4 sm:py-2 rounded-lg font-medium transition-all text-xs sm:text-sm whitespace-nowrap ${
              isSaved 
                ? 'bg-green-600 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            } disabled:opacity-50`}
          >
            {isSaved ? '✓ Saved' : isSaving ? '...' : '💾 Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PropRow({ prop }) {
  const qualityTier = getQualityTier(prop.qualityScore || 0)

  // Format odds for display
  const formatOdds = (odds) => {
    if (!odds) return null
    const decimalOdds = parseFloat(odds)
    if (isNaN(decimalOdds)) return null
    
    // Convert decimal odds to American format
    if (decimalOdds >= 2.0) {
      // Underdog: convert to positive American odds
      const americanOdds = Math.round((decimalOdds - 1) * 100)
      return `+${americanOdds}`
    } else {
      // Favorite: convert to negative American odds
      const americanOdds = Math.round(-100 / (decimalOdds - 1))
      return americanOdds.toString()
    }
  }

  const displayOdds = formatOdds(prop.odds)

  return (
    <Link href={`/game/${prop.gameId}`}>
      <div className="flex items-center justify-between p-2 sm:p-3 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer border border-slate-700">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <div className="text-base sm:text-lg">{qualityTier.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm sm:text-base text-white truncate">
              {prop.playerName}
            </div>
            <div className="text-xs sm:text-sm text-gray-400 truncate">
              {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
            </div>
            {displayOdds && (
              <div className="flex items-center gap-1 sm:gap-2 mt-0.5">
                <span className="text-[10px] sm:text-xs text-amber-400 font-semibold">
                  {displayOdds}
                </span>
                {prop.bookmaker && (
                  <span className="text-[10px] text-gray-500">
                    via {prop.bookmaker}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="text-right ml-2">
          <div className="text-[10px] sm:text-xs text-gray-500 mb-0.5">
            Q: {prop.qualityScore?.toFixed(1) || 'N/A'}
          </div>
          <div className="font-semibold text-sm sm:text-base text-green-400">
            {((prop.probability || 0) * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] sm:text-xs text-blue-400">
            +{((prop.edge || 0) * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </Link>
  )
}

