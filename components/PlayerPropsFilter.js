'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { getQualityTier } from '../lib/quality-score.js'

// Helper to get/set saved props in localStorage
const SAVED_PROPS_KEY = 'odds_on_deck_saved_props'

// Learned adjustments from validation analysis
// These prop types have been identified as underperforming (<45% accuracy)
const UNDERPERFORMING_PROP_TYPES = {
  receptions: { accuracy: 38.0, sport: 'nfl', multiplier: 0.85 },
  rushing_yards: { accuracy: 34.4, sport: 'nfl', multiplier: 0.8 },
  receiving_yards: { accuracy: 42.4, sport: 'nfl', multiplier: 0.88 },
  rushing_attempts: { accuracy: 41.7, sport: 'nfl', multiplier: 0.85 },
  player_assists: { accuracy: 41.2, sport: 'nhl', multiplier: 0.85 },
  player_shots_on_goal: { accuracy: 41.2, sport: 'nhl', multiplier: 0.85 }
}

// High performing prop types (>52.4% accuracy)
const HIGH_PERFORMING_PROP_TYPES = {
  pass_attempts: { accuracy: 62.5, sport: 'nfl', multiplier: 1.1 },
  player_blocked_shots: { accuracy: 56.5, sport: 'nhl', multiplier: 1.08 },
  player_pass_yds: { accuracy: 56.4, sport: 'nfl', multiplier: 1.08 },
  player_points: { accuracy: 53.3, sport: 'nhl', multiplier: 1.05 }
}

// Check if prop type is underperforming
function getPropTypePerformance(propType, sport) {
  const key = propType?.toLowerCase()
  
  // Check underperforming
  if (UNDERPERFORMING_PROP_TYPES[key] && 
      (!UNDERPERFORMING_PROP_TYPES[key].sport || UNDERPERFORMING_PROP_TYPES[key].sport === sport)) {
    return { 
      status: 'warning', 
      accuracy: UNDERPERFORMING_PROP_TYPES[key].accuracy,
      message: `⚠️ Low accuracy: ${UNDERPERFORMING_PROP_TYPES[key].accuracy}%`,
      multiplier: UNDERPERFORMING_PROP_TYPES[key].multiplier || 0.85
    }
  }
  
  // Check high performing
  if (HIGH_PERFORMING_PROP_TYPES[key] && 
      (!HIGH_PERFORMING_PROP_TYPES[key].sport || HIGH_PERFORMING_PROP_TYPES[key].sport === sport)) {
    return { 
      status: 'boost', 
      accuracy: HIGH_PERFORMING_PROP_TYPES[key].accuracy,
      message: `🔥 High accuracy: ${HIGH_PERFORMING_PROP_TYPES[key].accuracy}%`,
      multiplier: HIGH_PERFORMING_PROP_TYPES[key].multiplier || 1.05
    }
  }
  
  return null
}

function applyPerformanceAdjustments(props) {
  return props.map(prop => {
    const perf = getPropTypePerformance(prop.type, prop.sport)
    if (!perf?.multiplier) return prop
    
    const multiplier = perf.multiplier
    return {
      ...prop,
      qualityScore: typeof prop.qualityScore === 'number' ? Math.max(0, prop.qualityScore * multiplier) : prop.qualityScore,
      probability: typeof prop.probability === 'number' 
        ? Math.min(1, Math.max(0, prop.probability * multiplier))
        : prop.probability
    }
  })
}

function getSavedProps() {
  if (typeof window === 'undefined') return new Set()
  try {
    const saved = localStorage.getItem(SAVED_PROPS_KEY)
    return saved ? new Set(JSON.parse(saved)) : new Set()
  } catch {
    return new Set()
  }
}

function addSavedProp(propId) {
  if (typeof window === 'undefined') return
  try {
    const saved = getSavedProps()
    saved.add(propId)
    localStorage.setItem(SAVED_PROPS_KEY, JSON.stringify([...saved]))
  } catch (e) {
    console.error('Failed to save to localStorage:', e)
  }
}

export default function PlayerPropsFilter({ props }) {
  const [filterMode, setFilterMode] = useState('safe')

  const adjustedProps = useMemo(() => applyPerformanceAdjustments(props), [props])

  // Filter and sort props based on selected mode
  // HONEST EDGE SYSTEM: Most props have edge=0 (honest - no fake edges)
  // We filter by PROBABILITY and QUALITY SCORE instead
  const filteredProps = useMemo(() => {
    let filtered = [...adjustedProps]

    // Apply filters based on mode - NO EDGE REQUIREMENTS (honest system)
    if (filterMode === 'safe') {
      // Safe: Highest win probability (52%+)
      filtered = filtered.filter(p => (p.probability || 0) >= 0.52)
      filtered.sort((a, b) => (b.probability || 0) - (a.probability || 0))
    } else if (filterMode === 'balanced') {
      // Balanced: Good quality score and probability (no fake edge requirement)
      filtered = filtered.filter(p => (p.probability || 0) >= 0.45 && (p.qualityScore || 0) >= 25)
      filtered.sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
    } else if (filterMode === 'value') {
      // Value: Best expected value (EV = probability * odds - 1)
      // HONEST: Sort by EV instead of fake edge
      filtered = filtered.filter(p => (p.probability || 0) >= 0.40)
      filtered.sort((a, b) => {
        const evA = (a.probability || 0.5) * (a.odds || 2) - 1
        const evB = (b.probability || 0.5) * (b.odds || 2) - 1
        return evB - evA
      })
    } else if (filterMode === 'homerun') {
      // Home run: Higher payout props with reasonable probability
      filtered = filtered.filter(p => (p.probability || 0) >= 0.30)
      filtered.sort((a, b) => (b.odds || 0) - (a.odds || 0))
    }

    return filtered
  }, [adjustedProps, filterMode])

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
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Best EV</div>
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
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Big payouts</div>
              {filterMode === 'homerun' && (
                <div className="text-[10px] sm:text-xs text-purple-400 mt-1 sm:mt-2 font-medium">
                  {filteredProps.length} props
                </div>
              )}
            </button>
          </div>

          {/* Mode Description */}
          <div className="mt-3 sm:mt-4 p-2 sm:p-3 bg-slate-800 rounded-lg border border-slate-700">
            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
              {filterMode === 'safe' && '🛡️ Showing props with 52%+ win probability. These are the safest, most consistent picks.'}
              {filterMode === 'balanced' && '⚖️ Showing props with best quality scores (45%+ probability). Best overall picks.'}
              {filterMode === 'value' && '💰 Showing props sorted by Expected Value (EV). Smart money opportunities.'}
              {filterMode === 'homerun' && '🎰 Showing props with higher payouts. Includes higher-variance opportunities.'}
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
              {filterMode === 'safe' ? 'Safest' : filterMode === 'balanced' ? 'Best Quality' : filterMode === 'value' ? 'Best Value' : 'Highest Edge'}
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
                {nhlProps.filter(p => (p.probability || 0) >= 0.55).length} high confidence
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
                {nflProps.filter(p => (p.probability || 0) >= 0.55).length} high confidence
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
  const [isSaved, setIsSaved] = useState(false)
  const qualityTier = getQualityTier(prop.qualityScore || 0)
  
  // Generate a unique key for this prop
  const propKey = prop.propId || `${prop.playerName}-${prop.type}-${prop.gameId}`
  
  // Check localStorage on mount
  useEffect(() => {
    const saved = getSavedProps()
    if (saved.has(propKey)) {
      setIsSaved(true)
    }
  }, [propKey])

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
    
    // Don't save if already saved
    if (isSaved) return
    
    setIsSaving(true)
    try {
      const response = await fetch('/api/props/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prop })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setIsSaved(true) // Stay saved permanently
        addSavedProp(propKey) // Save to localStorage
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
    const numOdds = parseFloat(odds)
    if (isNaN(numOdds)) return null
    return numOdds > 0 ? `+${numOdds}` : numOdds.toString()
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
              <div className="font-semibold text-sm sm:text-base text-white truncate">
                {prop.playerName}
              </div>
              <div className="text-xs sm:text-sm text-gray-400">
                {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
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
          {/* Stats - HONEST: Show probability and EV, not fake edge */}
          <div className="flex flex-col items-end gap-0.5">
            {(() => {
              const perf = getPropTypePerformance(prop.type, prop.sport)
              if (!perf) return null
              return (
                <div
                  className={`text-[10px] font-medium ${
                    perf.status === 'warning' ? 'text-amber-400' : 'text-green-400'
                  }`}
                >
                  {perf.message}
                </div>
              )
            })()}
            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${tierColors[qualityTier.tier]}`}>
              {qualityTier.emoji} {qualityTier.label}
            </div>
            <div className="text-xs sm:text-sm text-gray-400">
              Q: <span className="font-semibold text-white">{prop.qualityScore?.toFixed(1) || 'N/A'}</span>
            </div>
            <div className="text-sm sm:text-base font-bold text-green-400">
              {((prop.probability || 0) * 100).toFixed(0)}% win
            </div>
            <div className="text-xs sm:text-sm text-amber-400">
              {prop.odds?.toFixed(2) || '—'} odds
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
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const qualityTier = getQualityTier(prop.qualityScore || 0)
  
  // Generate a unique key for this prop
  const propKey = prop.propId || `${prop.playerName}-${prop.type}-${prop.gameId}`
  
  // Check localStorage on mount
  useEffect(() => {
    const saved = getSavedProps()
    if (saved.has(propKey)) {
      setIsSaved(true)
    }
  }, [propKey])

  const handleSaveProp = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Don't save if already saved
    if (isSaved) return
    
    setIsSaving(true)
    try {
      const response = await fetch('/api/props/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prop })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setIsSaved(true) // Stay saved permanently
        addSavedProp(propKey) // Save to localStorage
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
    const numOdds = parseFloat(odds)
    if (isNaN(numOdds)) return null
    return numOdds > 0 ? `+${numOdds}` : numOdds.toString()
  }

  const displayOdds = formatOdds(prop.odds)

  return (
    <div className="flex items-center justify-between p-2 sm:p-3 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors border border-slate-700">
      <Link href={`/game/${prop.gameId}`} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 cursor-pointer">
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
      </Link>
      {/* Stats and Save Button */}
      <div className="flex items-center gap-2 sm:gap-3 ml-2">
        <div className="text-right">
          {(() => {
            const perf = getPropTypePerformance(prop.type, prop.sport)
            if (!perf) return null
            return (
              <div
                className={`text-[10px] sm:text-xs font-medium mb-0.5 ${
                  perf.status === 'warning' ? 'text-amber-400' : 'text-green-400'
                }`}
              >
                {perf.message}
              </div>
            )
          })()}
          <div className="text-[10px] sm:text-xs text-gray-500 mb-0.5">
            Q: {prop.qualityScore?.toFixed(1) || 'N/A'}
          </div>
          <div className="font-semibold text-sm sm:text-base text-green-400">
            {((prop.probability || 0) * 100).toFixed(0)}% win
          </div>
          <div className="text-[10px] sm:text-xs text-amber-400">
            {prop.odds?.toFixed(2) || '—'}
          </div>
        </div>
        {/* Save Button */}
        <button
          onClick={handleSaveProp}
          disabled={isSaving || isSaved}
          className={`px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg font-medium transition-all text-[10px] sm:text-xs whitespace-nowrap ${
            isSaved 
              ? 'bg-green-600 text-white' 
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          } disabled:opacity-50`}
        >
          {isSaved ? '✓' : isSaving ? '...' : '💾'}
        </button>
      </div>
    </div>
  )
}

