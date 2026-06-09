'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { getQualityTier } from '../lib/quality-score.js'
import ShareButton from './ShareButton.js'
import { cn } from '../lib/utils'
import {
  SectionHeading,
  SportBadge,
  BookBadge,
  EdgeBadge,
  QualityChip,
  ConfidenceBadge,
} from './ui'

const FILTER_OPTIONS = [
  { id: 'safe', label: 'Above Breakeven', sub: '52%+ implied' },
  { id: 'balanced', label: 'Quality Score', sub: 'Highest first' },
  { id: 'value', label: 'Expected Value', sub: 'prob × odds − 1' },
  { id: 'homerun', label: 'Highest Payout', sub: 'Long shots' },
]

const MODE_DESCRIPTIONS = {
  safe: 'Filtered to props where the market-implied probability is above the 52% breakeven line. These are the lowest-variance options.',
  balanced: 'Sorted by Quality Score — a composite of line deviation from market consensus and how many books offer the prop. Higher = bigger outlier.',
  value: 'Sorted by Expected Value: implied probability × decimal odds − 1. Positive EV doesn\u2019t guarantee wins, but it favors the bettor over time if the probability holds.',
  homerun: 'Sorted by payout (highest decimal odds first). These are long-shot props with bigger payouts and more variance.',
}

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
    <div className="space-y-8">
      {/* Sort & Filter */}
      <div>
        <SectionHeading
          title="Sort & Filter"
          action={<span className="text-[11px] text-slate-600 whitespace-nowrap">Sorting aids only — not picks</span>}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FILTER_OPTIONS.map((opt) => {
            const active = filterMode === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setFilterMode(opt.id)}
                className={cn(
                  'p-3 rounded-[4px] border text-left transition-colors duration-100',
                  active
                    ? 'border-white/[0.12] bg-elevated'
                    : 'border-white/[0.06] bg-surface hover:bg-elevated hover:border-white/[0.10]',
                )}
              >
                <div className={cn('text-xs font-semibold', active ? 'text-slate-100' : 'text-slate-300')}>
                  {opt.label}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{opt.sub}</div>
                {active && (
                  <div className="text-[10px] text-green-400 mt-1.5 font-medium tabular-nums font-mono">
                    {filteredProps.length} props
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed mt-3 max-w-3xl">
          {MODE_DESCRIPTIONS[filterMode]}
        </p>
      </div>

      {/* Stats Summary - Only show sports with props */}
      {(mlbProps.length > 0 || nflProps.length > 0 || nhlProps.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { key: 'mlb', count: mlbProps.length },
            { key: 'nhl', count: nhlProps.length },
            { key: 'nfl', count: nflProps.length },
          ].filter(s => s.count > 0).map((s) => (
            <div key={s.key} className="bg-surface border border-white/[0.06] rounded-[4px] p-4">
              <div className="flex items-center justify-between mb-2">
                <SportBadge sport={s.key} />
              </div>
              <p className="text-2xl font-semibold text-slate-100 tabular-nums font-mono">{s.count}</p>
              <p className="text-xs text-slate-500 mt-0.5">props compared</p>
            </div>
          ))}
        </div>
      )}

      {/* Top Props */}
      {filteredProps.length > 0 && (
        <div>
          <SectionHeading
            title="Top of the Board"
            action={
              <span className="text-[11px] text-slate-600 whitespace-nowrap">
                {filterMode === 'safe' ? 'By implied probability' :
                 filterMode === 'balanced' ? 'By Quality Score' :
                 filterMode === 'value' ? 'By Expected Value' :
                 'By payout'}
              </span>
            }
          />
          <div className="rounded-[4px] border border-white/[0.06] overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto divide-y divide-white/[0.04]">
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
          {battingProps.length > 0 && (
            <div>
              <SectionHeading title="MLB · Batting" action={<span className="text-[11px] text-slate-600 tabular-nums font-mono">{battingProps.length}</span>} />
              <div className="rounded-[4px] border border-white/[0.06] overflow-hidden">
                <div className="max-h-96 overflow-y-auto divide-y divide-white/[0.04]">
                  {battingProps.map((prop) => (
                    <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {pitchingProps.length > 0 && (
            <div>
              <SectionHeading title="MLB · Pitching" action={<span className="text-[11px] text-slate-600 tabular-nums font-mono">{pitchingProps.length}</span>} />
              <div className="rounded-[4px] border border-white/[0.06] overflow-hidden">
                <div className="max-h-96 overflow-y-auto divide-y divide-white/[0.04]">
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
        <div>
          <SectionHeading
            title="NHL Props"
            action={
              <span className="text-[11px] text-slate-600 whitespace-nowrap tabular-nums">
                {nhlProps.filter(p => (p.probability || 0) >= 0.55).length} @ 55%+
              </span>
            }
          />
          <div className="rounded-[4px] border border-white/[0.06] overflow-hidden">
            <div className="max-h-96 overflow-y-auto divide-y divide-white/[0.04]">
              {nhlProps.map((prop) => (
                <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* NFL Props */}
      {nflProps.length > 0 && (
        <div>
          <SectionHeading
            title="NFL Props"
            action={
              <span className="text-[11px] text-slate-600 whitespace-nowrap tabular-nums">
                {nflProps.filter(p => (p.probability || 0) >= 0.55).length} @ 55%+
              </span>
            }
          />
          <div className="rounded-[4px] border border-white/[0.06] overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto divide-y divide-white/[0.04]">
              {nflProps.map((prop) => (
                <PropRow key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}-${prop.pick}-${prop.threshold}`} prop={prop} />
              ))}
            </div>
          </div>
        </div>
      )}

      {filteredProps.length === 0 && (
        <div className="bg-surface border border-white/[0.06] rounded-[4px] p-8">
          <h3 className="text-sm font-semibold text-slate-100 mb-1">No props match this filter</h3>
          <p className="text-sm text-slate-500">
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
  const perf = getPropTypePerformance(prop.type, prop.sport)

  return (
    <div className="bg-surface hover:bg-elevated transition-colors duration-100 px-3 py-2.5">
      <div className="flex items-center gap-3">
        {/* Rank */}
        <div className="text-sm font-medium text-slate-500 tabular-nums font-mono w-7 shrink-0 text-right">
          {rank}
        </div>

        {/* Main Content */}
        <Link href={`/game/${prop.gameId}`} className="flex-1 min-w-0 cursor-pointer">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-100 truncate">{prop.playerName}</span>
            <SportBadge sport={prop.sport} />
          </div>
          <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">
            {prop.pick} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {displayOdds && (
              <span className="text-[13px] font-medium text-slate-100 tabular-nums font-mono">{displayOdds}</span>
            )}
            <BookBadge book={prop.bookmaker} />
            <ConfidenceBadge confidence={prop.confidence} />
            {prop.edge > 0.01 && <EdgeBadge edge={prop.edge * 100} />}
          </div>
          {prop.projection > 0 && (
            <div className="text-[10px] text-slate-600 mt-1 tabular-nums">
              Proj <span className={cn('font-medium',
                (prop.pick === 'over' && prop.projection > prop.threshold) ||
                (prop.pick === 'under' && prop.projection < prop.threshold)
                  ? 'text-green-400' : 'text-red-400')}>{prop.projection.toFixed(1)}</span> vs {prop.threshold}
            </div>
          )}
        </Link>

        {/* Stats and Button */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end gap-1">
            {perf && (
              <span className={cn('text-[10px] font-medium tabular-nums', perf.status === 'warning' ? 'text-amber-400' : 'text-green-400')}>
                {perf.accuracy}% acc
              </span>
            )}
            <QualityChip score={prop.qualityScore} tier={qualityTier.tier} />
            <span
              className="text-sm font-medium text-green-400 tabular-nums font-mono"
              title="Market-implied probability (vig removed)"
            >
              {((prop.probability || 0) * 100).toFixed(0)}%
            </span>
          </div>

          <div className="flex items-center gap-1">
            <ShareButton prop={prop} variant="icon" />
            <button
              onClick={handleSaveProp}
              disabled={isSaving || isSaved}
              title={isSaved ? 'Tracked — we\u2019ll grade this after the game' : 'Track this prop and grade it after the game'}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors border disabled:opacity-50',
                isSaved
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-elevated hover:bg-[#283548] text-slate-100 border-white/[0.12]',
              )}
            >
              {isSaved ? '✓ Tracking' : isSaving ? '...' : 'Track'}
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
  const perf = getPropTypePerformance(prop.type, prop.sport)

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-surface hover:bg-elevated transition-colors duration-100">
      <Link href={`/game/${prop.gameId}`} className="flex-1 min-w-0 cursor-pointer">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-100 truncate">{prop.playerName}</span>
          <SportBadge sport={prop.sport} />
        </div>
        <div className="text-xs text-slate-500 truncate mt-0.5 uppercase tracking-wide">
          {prop.pick} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {displayOdds && (
            <span className="text-xs font-medium text-slate-100 tabular-nums font-mono">{displayOdds}</span>
          )}
          <BookBadge book={prop.bookmaker} />
          <ConfidenceBadge confidence={prop.confidence} />
          {prop.edge > 0.01 && <EdgeBadge edge={prop.edge * 100} />}
        </div>
      </Link>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex flex-col items-end gap-1">
          {perf && (
            <span className={cn('text-[10px] font-medium tabular-nums', perf.status === 'warning' ? 'text-amber-400' : 'text-green-400')}>
              {perf.accuracy}% acc
            </span>
          )}
          <QualityChip score={prop.qualityScore} tier={qualityTier.tier} />
          <span
            className="text-sm font-medium text-green-400 tabular-nums font-mono"
            title="Market-implied probability (vig removed)"
          >
            {((prop.probability || 0) * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <ShareButton prop={prop} variant="icon" />
          <button
            onClick={handleSaveProp}
            disabled={isSaving || isSaved}
            title={isSaved ? 'Tracked — we\u2019ll grade this after the game' : 'Track this prop and grade it after the game'}
            className={cn(
              'px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors border disabled:opacity-50',
              isSaved
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-elevated hover:bg-[#283548] text-slate-100 border-white/[0.12]',
            )}
          >
            {isSaved ? '✓' : isSaving ? '...' : 'Track'}
          </button>
        </div>
      </div>
    </div>
  )
}

