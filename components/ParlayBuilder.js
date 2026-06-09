'use client'

import { useState, useEffect } from 'react'
import { cn } from '../lib/utils'

const STRATEGIES = [
  { id: 'safe', label: 'Safe Mode', sub: '52%+ win rate' },
  { id: 'balanced', label: 'Balanced', sub: 'Best quality' },
  { id: 'value', label: 'Value Hunter', sub: '+EV plays' },
]

const STRATEGY_DESC = {
  safe: 'Highest probability picks (52%+). Consistent wins, lower variance.',
  balanced: 'Optimized quality score. Best overall risk/reward balance.',
  value: 'Positive expected value plays. Best long-term profitability.',
}

const SELECT_CLASS = 'w-full px-3 py-2 bg-bg border border-white/[0.06] rounded-[4px] text-sm text-slate-200 focus:outline-none focus:border-white/20 transition-colors'
const LABEL_CLASS = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1.5'

export default function ParlayBuilder({ onGenerate }) {
  const [sport, setSport] = useState('mlb')
  const [type, setType] = useState('multi_game')
  const [legCount, setLegCount] = useState(3)
  const [maxParlays, setMaxParlays] = useState(10)
  const [minConfidence, setMinConfidence] = useState('low')
  const [filterMode, setFilterMode] = useState('safe')
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState('')
  const [availableGames, setAvailableGames] = useState([])
  const [isLoadingGames, setIsLoadingGames] = useState(false)
  const [allGamesCache, setAllGamesCache] = useState(null)
  const [cacheTimestamp, setCacheTimestamp] = useState(null)
  
  useEffect(() => {
    const shouldFetchGames = type === 'single_game' && (
      !allGamesCache || 
      !cacheTimestamp || 
      Date.now() - cacheTimestamp > 5 * 60 * 1000
    )
    if (shouldFetchGames) fetchAvailableGames()
  }, [type])

  useEffect(() => {
    if (type === 'single_game' && allGamesCache) filterCachedGames()
  }, [sport, allGamesCache])

  useEffect(() => {
    async function detectSport() {
      try {
        const res = await fetch('/api/games/today')
        const result = await res.json()
        if (result.success && result.data) {
          const counts = {
            mlb: (result.data.mlb || []).length,
            nhl: (result.data.nhl || []).length,
            nfl: (result.data.nfl || []).length,
          }
          const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
          if (best && best[1] > 0) setSport(best[0])
          setAllGamesCache({ mlb: result.data.mlb || [], nfl: result.data.nfl || [], nhl: result.data.nhl || [] })
          setCacheTimestamp(Date.now())
        }
      } catch { /* use default */ }
    }
    detectSport()
  }, [])

  const fetchAvailableGames = async () => {
    setIsLoadingGames(true)
    try {
      const response = await fetch('/api/games/today')
      const result = await response.json()
      if (result.success && result.data) {
        const allGames = {
          mlb: result.data.mlb || [],
          nfl: result.data.nfl || [],
          nhl: result.data.nhl || []
        }
        setAllGamesCache(allGames)
        setCacheTimestamp(Date.now())
        filterGamesForSport(allGames, sport)
      }
    } catch { /* non-critical */ }
    finally { setIsLoadingGames(false) }
  }

  const filterCachedGames = () => {
    if (!allGamesCache) return
    filterGamesForSport(allGamesCache, sport)
  }

  const filterGamesForSport = (gamesData, selectedSport) => {
    let games = []
    if (selectedSport === 'mlb') {
      games = gamesData.mlb || []
    } else if (selectedSport === 'nfl') {
      games = gamesData.nfl || []
    } else if (selectedSport === 'nhl') {
      games = gamesData.nhl || []
    } else {
      // Mixed: combine all
      games = [...(gamesData.mlb || []), ...(gamesData.nfl || []), ...(gamesData.nhl || [])]
    }
    
    const activeGames = games.filter(g => 
      // For single-game parlays, prefer scheduled games (more likely to have props)
      // Exclude in_progress and final games as props expire when games start
      ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup'].includes(g.status)
    )
    setAvailableGames(activeGames)
    if (activeGames.length > 0 && !selectedGameId) {
      setSelectedGameId(activeGames[0].id)
    }
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      const requestData = {
        sport: type === 'cross_sport' ? 'mixed' : sport,
        type,
        legCount,
        maxParlays,
        minConfidence,
        filterMode,
        saveToDatabase: false,
        gameId: type === 'single_game' ? selectedGameId : undefined
      }
      const response = await fetch('/api/parlays/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      })
      const data = await response.json()
      if (data.success && onGenerate) onGenerate(data.parlays)
    } catch { /* non-critical */ }
    finally { setIsGenerating(false) }
  }

  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        Build Your Parlay
      </h2>
      <p className="text-sm text-slate-400 mt-1.5 mb-5">
        We combine the best available lines across 10+ sportsbooks into optimized parlays.
      </p>

      <div className="space-y-5">
        {/* Filter Mode Selection */}
        <div>
          <label className={LABEL_CLASS}>Betting Strategy</label>
          <div className="grid grid-cols-3 gap-2">
            {STRATEGIES.map((s) => {
              const active = filterMode === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => setFilterMode(s.id)}
                  className={cn(
                    'p-2.5 rounded-[4px] border text-left transition-colors duration-100',
                    active
                      ? 'bg-elevated border-white/[0.12]'
                      : 'bg-bg border-white/[0.06] hover:border-white/[0.12]',
                  )}
                >
                  <div className={cn('text-xs font-semibold', active ? 'text-slate-100' : 'text-slate-300')}>
                    {s.label}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{s.sub}</div>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            {STRATEGY_DESC[filterMode]}
          </p>
        </div>

        {/* Sport Selection */}
        <div>
          <label className={LABEL_CLASS}>Sport</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={SELECT_CLASS}>
            <option value="mlb">Baseball Only</option>
            <option value="nfl">Football Only</option>
            <option value="nhl">Hockey Only</option>
            <option value="mixed">Mixed Sports</option>
          </select>
        </div>

        {/* Parlay Type */}
        <div>
          <label className={LABEL_CLASS}>Parlay Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={SELECT_CLASS}>
            <option value="single_game">Same-Game Parlay (SGP)</option>
            <option value="multi_game">Multi-Game Parlay</option>
            <option value="cross_sport">Cross-Sport Parlay</option>
          </select>
          <p className="mt-1.5 text-xs text-slate-400">
            {type === 'single_game' && 'Stack multiple props from a single game — the most popular bet type'}
            {type === 'multi_game' && 'Combine props from different games for more variety'}
            {type === 'cross_sport' && 'Mix MLB, NFL, and NHL props into one parlay'}
          </p>
        </div>

        {/* Game Selector (only for single_game) */}
        {type === 'single_game' && (
          <div>
            <label className={LABEL_CLASS}>Select Game</label>
            {isLoadingGames ? (
              <div className="text-sm text-slate-400">Loading games...</div>
            ) : availableGames.length > 0 ? (
              <select value={selectedGameId} onChange={(e) => setSelectedGameId(e.target.value)} className={SELECT_CLASS}>
                {availableGames.map(game => (
                  <option key={game.id} value={game.id}>
                    {game.away?.abbr || 'Away'} @ {game.home?.abbr || 'Home'} 
                    {' '}({game.status === 'in_progress' ? 'Live' : game.status === 'pre-game' ? 'Upcoming' : game.status})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-slate-400">No active games available</div>
            )}
          </div>
        )}

        {/* Leg Count */}
        <div>
          <label className={LABEL_CLASS}>Number of Legs</label>
          <select value={legCount} onChange={(e) => setLegCount(parseInt(e.target.value))} className={SELECT_CLASS}>
            <option value="2">2-Leg Parlay</option>
            <option value="3">3-Leg Parlay</option>
            <option value="4">4-Leg Parlay</option>
            <option value="5">5-Leg Parlay</option>
            <option value="6">6-Leg Parlay</option>
          </select>
        </div>

        {/* Maximum Parlays */}
        <div>
          <label className={LABEL_CLASS}>Maximum Results</label>
          <select value={maxParlays} onChange={(e) => setMaxParlays(parseInt(e.target.value))} className={SELECT_CLASS}>
            <option value="5">5 Parlays</option>
            <option value="10">10 Parlays</option>
            <option value="20">20 Parlays</option>
            <option value="50">50 Parlays</option>
          </select>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={cn(
            'w-full py-2.5 px-4 rounded-[4px] text-sm font-semibold transition-colors duration-100',
            isGenerating
              ? 'bg-elevated text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white',
          )}
        >
          {isGenerating ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </span>
          ) : (
            'Generate Parlays'
          )}
        </button>
      </div>

      {/* Quick Stats */}
      <div className="mt-5 pt-5 border-t border-white/[0.06]">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-2.5">Current Settings</h3>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
          <div>Sport: <span className="font-medium text-slate-200 tabular-nums font-mono">{sport.toUpperCase()}</span></div>
          <div>Type: <span className="font-medium text-slate-200">{type.replace('_', ' ')}</span></div>
          <div>Legs: <span className="font-medium text-slate-200 tabular-nums font-mono">{legCount}</span></div>
          <div>Strategy: <span className="font-medium text-slate-200 capitalize">{filterMode}</span></div>
        </div>
      </div>
    </div>
  )
}
