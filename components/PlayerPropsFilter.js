'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { getQualityTier } from '../lib/quality-score.js'
import ShareButton from './ShareButton.js'

function decimalToAmerican(decimalOdds) {
  if (!decimalOdds || decimalOdds === 1) return '+100'
  const d = parseFloat(decimalOdds)
  if (isNaN(d)) return null
  if (d >= 2.0) return `+${Math.round((d - 1) * 100)}`
  return `${Math.round(-100 / (d - 1))}`
}

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
      {/* Page Helper */}
      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 sm:p-5">
        <h2 className="text-base sm:text-lg font-semibold text-white mb-1">Compare first, then track.</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          This page is built to help you scan the market faster, spot line differences more
          easily, and save props you want to monitor over time.
        </p>
      </div>

      {/* Sort & Filter */}
      <div className="card">
        <div className="px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h3 className="text-base sm:text-lg font-semibold text-white">
              Sort &amp; filter
            </h3>
            <span className="text-[11px] sm:text-xs text-gray-500">
              Sorting aids only &mdash; not picks
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <button
              onClick={() => setFilterMode('safe')}
              className={`p-3 sm:p-4 rounded-lg border-2 text-left transition-all ${
                filterMode === 'safe'
                  ? 'border-green-500 bg-green-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-green-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-xs sm:text-sm">🛡️ Above Breakeven</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">52%+ implied prob</div>
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
              <div className="font-semibold text-xs sm:text-sm">⚖️ Quality Score</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Highest first</div>
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
              <div className="font-semibold text-xs sm:text-sm">💰 Expected Value</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">EV: prob × odds &minus; 1</div>
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
              <div className="font-semibold text-xs sm:text-sm">🎰 Highest Payout</div>
              <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5 sm:mt-1">Long shots</div>
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
              {filterMode === 'safe' && 'Filtered to props where the market-implied probability is above the 52% breakeven line. These are the lowest-variance options.'}
              {filterMode === 'balanced' && 'Sorted by Quality Score &mdash; a composite of line deviation from market consensus and how many books offer the prop. Higher = bigger outlier.'}
              {filterMode === 'value' && 'Sorted by Expected Value: implied probability × decimal odds &minus; 1. Positive EV doesn\u2019t guarantee wins, but it favors the bettor over time if the probability holds.'}
              {filterMode === 'homerun' && 'Sorted by payout (highest decimal odds first). These are long-shot props with bigger payouts and more variance.'}
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
                  <div className="text-sm text-blue-300">{mlbProps.length} props compared</div>
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
                  <div className="text-sm text-green-300">{nflProps.length} props compared</div>
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
                  <div className="text-sm text-purple-300">{nhlProps.length} props compared</div>
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
              Top of the board
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">
              {filterMode === 'safe' ? 'Sorted by implied probability (52%+)' :
               filterMode === 'balanced' ? 'Sorted by Quality Score' :
               filterMode === 'value' ? 'Sorted by Expected Value' :
               'Sorted by payout'}
            </p>
          </div>
          <div className="p-3 sm:p-6">
            <div className="space-y-2 sm:space-y-3 max-h-[500px] sm:max-h-[600px] overflow-y-auto">
              {filteredProps.slice(0, 20).map((prop, index) => (
                <PlayerPropCard key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} rank={index + 1} />
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
                <div className="text-sm text-gray-400">{battingProps.length} props compared</div>
              </div>
              <div className="p-6">
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {battingProps.map((prop) => (
                    <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
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
                <div className="text-sm text-gray-400">{pitchingProps.length} props compared</div>
              </div>
              <div className="p-6">
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {pitchingProps.map((prop) => (
                    <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
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
                  <div className="text-sm text-purple-300">{nhlProps.length} props compared</div>
                </div>
              </div>
              <div className="text-sm text-gray-400">
                {nhlProps.filter(p => (p.probability || 0) >= 0.55).length} above 55% implied
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {nhlProps.map((prop) => (
                <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
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
                  <div className="text-sm text-green-300">{nflProps.length} props compared</div>
                </div>
              </div>
              <div className="text-sm text-gray-400">
                {nflProps.filter(p => (p.probability || 0) >= 0.55).length} above 55% implied
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {nflProps.map((prop) => (
                <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
              ))}
            </div>
          </div>
        </div>
      )}

      {filteredProps.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-gray-500 text-6xl mb-4">🎯</div>
          <h3 className="text-lg font-medium text-white mb-2">No props match this filter</h3>
          <p className="text-gray-400">
            Try a different sort or filter, or check back when more props are available.
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

  const displayOdds = decimalToAmerican(prop.odds)

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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm sm:text-base text-white truncate">
                  {prop.playerName}
                </span>
                <span className="text-[10px] text-gray-500 uppercase">{prop.sport}</span>
              </div>
              <div className="text-xs sm:text-sm text-gray-400">
                {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {displayOdds && (
                  <span className="text-xs sm:text-sm text-amber-400 font-bold">
                    {displayOdds}
                  </span>
                )}
                {prop.bookmaker && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-700 text-[10px] sm:text-xs text-cyan-400 font-medium border border-slate-600">
                    {prop.bookmaker}
                  </span>
                )}
                {prop.confidence && prop.confidence !== 'low' && prop.confidence !== 'very_low' && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                    prop.confidence === 'very_high' ? 'bg-green-900/40 text-green-400 border-green-500/40' :
                    prop.confidence === 'high' ? 'bg-blue-900/40 text-blue-400 border-blue-500/40' :
                    'bg-slate-700 text-gray-400 border-slate-600'
                  }`}>
                    {prop.confidence === 'very_high' ? 'Very High Conf' :
                     prop.confidence === 'high' ? 'High Conf' : 'Med Conf'}
                  </span>
                )}
              </div>
              {/* Projection vs Line */}
              {prop.projection > 0 && (
                <div className="text-[10px] sm:text-xs text-gray-500 mt-1">
                  Projected: <span className={`font-medium ${
                    (prop.pick === 'over' && prop.projection > prop.threshold) ||
                    (prop.pick === 'under' && prop.projection < prop.threshold)
                      ? 'text-green-400' : 'text-red-400'
                  }`}>{prop.projection.toFixed(1)}</span> vs Line {prop.threshold}
                </div>
              )}
              {/* Edge callout */}
              {prop.edge > 0.01 && (
                <div className="text-[10px] sm:text-xs text-purple-400 mt-0.5">
                  {((prop.edge) * 100).toFixed(1)}% line edge vs market
                </div>
              )}
            </div>
          </div>
        </Link>

        {/* Stats and Button */}
        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 pl-10 sm:pl-0">
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
            <div
              className="text-xs sm:text-sm text-gray-400"
              title="Quality Score — sorting aid combining line deviation from market and number of books offering the prop"
            >
              Q: <span className="font-semibold text-white">{prop.qualityScore?.toFixed(1) || 'N/A'}</span>
            </div>
            <div
              className="text-sm sm:text-base font-bold text-green-400"
              title="Market-implied probability (vig removed)"
            >
              {((prop.probability || 0) * 100).toFixed(0)}% implied
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <ShareButton prop={prop} variant="icon" />
            <button
              onClick={handleSaveProp}
              disabled={isSaving || isSaved}
              title={isSaved ? 'Tracked — we\u2019ll grade this after the game' : 'Track this prop and grade it after the game'}
              className={`px-3 py-2 sm:px-4 sm:py-2 rounded-lg font-medium transition-all text-xs sm:text-sm whitespace-nowrap ${
                isSaved
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              } disabled:opacity-50`}
            >
              {isSaved ? '✓ Tracking' : isSaving ? '...' : 'Track prop'}
            </button>
          </div>
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

  const displayOdds = decimalToAmerican(prop.odds)

  return (
    <div className="flex items-center justify-between p-2 sm:p-3 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors border border-slate-700">
      <Link href={`/game/${prop.gameId}`} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 cursor-pointer">
        <div className="text-base sm:text-lg">{qualityTier.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm sm:text-base text-white truncate">
              {prop.playerName}
            </span>
            <span className="text-[10px] text-gray-500 uppercase flex-shrink-0">{prop.sport}</span>
          </div>
          <div className="text-xs sm:text-sm text-gray-400 truncate">
            {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
          </div>
          <div className="flex items-center gap-1 sm:gap-2 mt-0.5 flex-wrap">
            {displayOdds && (
              <span className="text-[10px] sm:text-xs text-amber-400 font-semibold">
                {displayOdds}
              </span>
            )}
            {prop.bookmaker && (
              <span className="inline-flex items-center px-1 py-px rounded bg-slate-700 text-[10px] text-cyan-400 font-medium border border-slate-600">
                {prop.bookmaker}
              </span>
            )}
            {prop.confidence && prop.confidence !== 'low' && prop.confidence !== 'very_low' && (
              <span className={`inline-flex items-center px-1 py-px rounded text-[10px] font-medium border ${
                prop.confidence === 'very_high' ? 'bg-green-900/40 text-green-400 border-green-500/40' :
                prop.confidence === 'high' ? 'bg-blue-900/40 text-blue-400 border-blue-500/40' :
                'bg-slate-700 text-gray-400 border-slate-600'
              }`}>
                {prop.confidence === 'very_high' ? 'V.High' :
                 prop.confidence === 'high' ? 'High' : 'Med'}
              </span>
            )}
            {prop.edge > 0.01 && (
              <span className="text-[10px] text-purple-400 font-medium">
                +{((prop.edge) * 100).toFixed(1)}% edge
              </span>
            )}
          </div>
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
          <div
            className="text-[10px] sm:text-xs text-gray-500 mb-0.5"
            title="Quality Score — sorting aid combining line deviation from market and number of books offering the prop"
          >
            Q: {prop.qualityScore?.toFixed(1) || 'N/A'}
          </div>
          <div
            className="font-semibold text-sm sm:text-base text-green-400"
            title="Market-implied probability (vig removed)"
          >
            {((prop.probability || 0) * 100).toFixed(0)}% implied
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-0.5">
          <ShareButton prop={prop} variant="icon" />
          <button
            onClick={handleSaveProp}
            disabled={isSaving || isSaved}
            title={isSaved ? 'Tracked — we\u2019ll grade this after the game' : 'Track this prop and grade it after the game'}
            className={`px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg font-medium transition-all text-[10px] sm:text-xs whitespace-nowrap ${
              isSaved
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            } disabled:opacity-50`}
          >
            {isSaved ? '✓' : isSaving ? '...' : 'Track'}
          </button>
        </div>
      </div>
    </div>
  )
}

