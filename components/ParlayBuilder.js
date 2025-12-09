'use client'

import { useState, useEffect } from 'react'

export default function ParlayBuilder({ onGenerate }) {
  const [sport, setSport] = useState('nhl') // Changed default from 'mlb' to 'nhl'
  const [type, setType] = useState('multi_game')
  const [legCount, setLegCount] = useState(3)
  const [maxParlays, setMaxParlays] = useState(10)
  const [minConfidence, setMinConfidence] = useState('low') // Allow all confidence levels
  const [filterMode, setFilterMode] = useState('safe') // safe, balanced, value, homerun
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState('')
  const [availableGames, setAvailableGames] = useState([])
  const [isLoadingGames, setIsLoadingGames] = useState(false)

  // HONEST EDGE SYSTEM: No fake minEdge adjustments needed
  // Props are ranked by real probability (Safe) or expected value (Value)

  // ✅ Cache all games data in frontend to avoid repeated API calls
  const [allGamesCache, setAllGamesCache] = useState(null)
  const [cacheTimestamp, setCacheTimestamp] = useState(null)
  
  // ✅ Fetch available games only once on mount, or when cache expires (5 minutes)
  useEffect(() => {
    const shouldFetchGames = type === 'single_game' && (
      !allGamesCache || 
      !cacheTimestamp || 
      Date.now() - cacheTimestamp > 5 * 60 * 1000 // 5 minutes
    )
    
    if (shouldFetchGames) {
      fetchAvailableGames()
    }
  }, [type]) // ✅ Only depend on type, not sport - fetch all games once!

  // ✅ Filter cached games when sport changes (no API call!)
  useEffect(() => {
    if (type === 'single_game' && allGamesCache) {
      filterCachedGames()
    }
  }, [sport, allGamesCache])

  const fetchAvailableGames = async () => {
    console.log('🔄 Fetching games data (cache miss or expired)...')
    setIsLoadingGames(true)
    try {
      // Use /api/games/today instead of disabled /api/data
      const response = await fetch('/api/games/today')
      const result = await response.json()
      
      console.log('📊 API Response:', result)
      
      if (result.success && result.data) {
        // The API returns data in a nested structure: { success, data: { mlb, nfl, nhl } }
        const allGames = {
          mlb: result.data.mlb || [],
          nfl: result.data.nfl || [],
          nhl: result.data.nhl || []
        }
        setAllGamesCache(allGames)
        setCacheTimestamp(Date.now())
        console.log('✅ Cached games data:', 
          allGames.mlb.length, 'MLB,', 
          allGames.nfl.length, 'NFL,', 
          allGames.nhl.length, 'NHL'
        )
        
        // Filter and set available games for current sport
        filterGamesForSport(allGames, sport)
      } else {
        console.error('❌ API response missing data:', result)
      }
    } catch (error) {
      console.error('Error fetching games:', error)
    } finally {
      setIsLoadingGames(false)
    }
  }

  const filterCachedGames = () => {
    if (!allGamesCache) return
    console.log('✅ Filtering cached games for sport:', sport, '(no API call!)')
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
      // HONEST EDGE SYSTEM: No minEdge needed - system uses probability ranking
      const requestData = {
        sport,
        type,
        legCount,
        maxParlays,
        minConfidence,
        filterMode, // Controls ranking: safe=probability, value=EV, etc.
        saveToDatabase: false,
        gameId: type === 'single_game' ? selectedGameId : undefined
      }
      
      console.log('🎯 Generating parlays with:', requestData)
      
      const response = await fetch('/api/parlays/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      })

      const data = await response.json()
      
      if (data.success) {
        console.log('ParlayBuilder: Generated parlays:', data.parlays.length)
        // Pass results to parent component
        if (onGenerate) {
          console.log('ParlayBuilder: Calling onGenerate with:', data.parlays.length, 'parlays')
          onGenerate(data.parlays)
        }
      } else {
        console.error('Failed to generate parlays:', data.error)
      }
    } catch (error) {
      console.error('Error generating parlays:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-2xl font-bold text-white mb-4">
        🎯 Build Your Parlay
      </h2>
      <div className="mb-6 p-3 bg-green-900/20 border border-green-500/50 rounded-lg">
        <p className="text-sm text-green-400 font-medium">
          ✅ System Priority: <strong>HIGHEST WIN PROBABILITY</strong>
        </p>
        <p className="text-xs text-green-300 mt-1">
          Parlays are sorted by win chance (not payout). For safest bets, set Risk Level to 1-5%.
        </p>
      </div>

      <div className="space-y-6">
        {/* Filter Mode Selection */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            🎯 Betting Strategy
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setFilterMode('safe')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                filterMode === 'safe'
                  ? 'border-green-500 bg-green-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-green-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">🛡️ Safe Mode</div>
              <div className="text-xs text-gray-400 mt-1">52%+ win rate</div>
            </button>
            <button
              onClick={() => setFilterMode('balanced')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                filterMode === 'balanced'
                  ? 'border-blue-500 bg-blue-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-blue-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">⚖️ Balanced</div>
              <div className="text-xs text-gray-400 mt-1">Best quality</div>
            </button>
            <button
              onClick={() => setFilterMode('value')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                filterMode === 'value'
                  ? 'border-yellow-500 bg-yellow-900/30 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-yellow-500/50 text-gray-300'
              }`}
            >
              <div className="font-semibold text-sm">💰 Value Hunter</div>
              <div className="text-xs text-gray-400 mt-1">+EV plays</div>
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {filterMode === 'safe' && '🛡️ Highest probability picks (52%+). Consistent wins, lower variance.'}
            {filterMode === 'balanced' && '⚖️ Optimized quality score. Best overall risk/reward balance.'}
            {filterMode === 'value' && '💰 Positive expected value plays. Best long-term profitability.'}
          </p>
        </div>

        {/* Sport Selection */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Sport
          </label>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="mlb">⚾ Baseball Only</option>
            <option value="nfl">🏈 Football Only</option>
            <option value="nhl">🏒 Hockey Only</option>
            <option value="mixed">🏆 Mixed Sports</option>
          </select>
        </div>

        {/* Parlay Type */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Parlay Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="single_game">Single Game Parlay</option>
            <option value="multi_game">Multi-Game Parlay</option>
            <option value="cross_sport">Cross-Sport Parlay</option>
          </select>
          <p className="mt-1 text-xs text-gray-400">
            {type === 'single_game' && 'All props from one specific game'}
            {type === 'multi_game' && 'Mix props from different games'}
            {type === 'cross_sport' && 'Mix MLB, NFL, and NHL props'}
          </p>
        </div>

        {/* Game Selector (only for single_game) */}
        {type === 'single_game' && (
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Select Game
            </label>
            {isLoadingGames ? (
              <div className="text-sm text-gray-400">Loading games...</div>
            ) : availableGames.length > 0 ? (
              <select
                value={selectedGameId}
                onChange={(e) => setSelectedGameId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableGames.map(game => (
                  <option key={game.id} value={game.id}>
                    {game.away?.abbr || 'Away'} @ {game.home?.abbr || 'Home'} 
                    {' '}({game.status === 'in_progress' ? 'Live' : game.status === 'pre-game' ? 'Upcoming' : game.status})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-gray-400">No active games available</div>
            )}
          </div>
        )}

        {/* Leg Count */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Number of Legs
          </label>
          <select
            value={legCount}
            onChange={(e) => setLegCount(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="2">2-Leg Parlay</option>
            <option value="3">3-Leg Parlay</option>
            <option value="4">4-Leg Parlay</option>
            <option value="5">5-Leg Parlay</option>
            <option value="6">6-Leg Parlay</option>
          </select>
        </div>

        {/* Honest System Info */}
        <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
          <p className="text-xs text-gray-400">
            <span className="text-green-400 font-medium">✓ Honest Edge System:</span> Props use real vig-adjusted probabilities. 
            Parlays are ranked by <strong className="text-white">win probability</strong> (Safe mode) or 
            <strong className="text-white"> expected value</strong> (Value mode), not fake edges.
          </p>
        </div>

        {/* Maximum Parlays */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Maximum Results
          </label>
          <select
            value={maxParlays}
            onChange={(e) => setMaxParlays(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
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
          className={`w-full py-3 px-4 rounded-md font-medium text-white transition-colors ${
            isGenerating
              ? 'bg-slate-600 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500'
          }`}
        >
          {isGenerating ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </span>
          ) : (
            '🎯 Generate Parlays'
          )}
        </button>
      </div>

      {/* Quick Stats */}
      <div className="mt-6 pt-6 border-t border-slate-700">
        <h3 className="text-sm font-medium text-white mb-3">Current Settings:</h3>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
          <div>Sport: <span className="font-medium text-white">{sport.toUpperCase()}</span></div>
          <div>Type: <span className="font-medium text-white">{type.replace('_', ' ')}</span></div>
          <div>Legs: <span className="font-medium text-white">{legCount}</span></div>
          <div>Strategy: <span className="font-medium text-white">{filterMode}</span></div>
        </div>
      </div>
    </div>
  )
}
