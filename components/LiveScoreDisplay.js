'use client'

import { useState, useEffect } from 'react'

export default function LiveScoreDisplay({ game, refreshInterval = 30000 }) {
  const [liveData, setLiveData] = useState(game)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const refreshLiveData = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/live-scores/refresh')
      const result = await response.json()
      
      if (result.success) {
        // Fetch updated game data
        const gameResponse = await fetch(`/api/games/${game.id}`)
        const gameData = await gameResponse.json()
        
        if (gameData.success) {
          setLiveData(gameData.game)
          setLastUpdate(new Date())
        }
      }
    } catch (error) {
      console.error('Error refreshing live data:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  // Auto-refresh every 30 seconds for live games
  useEffect(() => {
    if (game.status !== 'in_progress' && game.status !== 'pre_game') return

    const interval = setInterval(refreshLiveData, refreshInterval)
    return () => clearInterval(interval)
  }, [game.status, refreshInterval])

  const formatScore = () => {
    if (liveData.homeScore === null || liveData.awayScore === null) {
      return 'TBD'
    }
    return `${liveData.awayScore}-${liveData.homeScore}`
  }

  const formatInning = () => {
    if (liveData.status === 'final') {
      return <span className="text-green-600 font-semibold">FINAL</span>
    }
    
    if (liveData.inning && liveData.inningHalf) {
      return `${liveData.inningHalf} ${liveData.inning}`
    }
    
    return liveData.status
  }

  const getStatusColor = () => {
    switch (liveData.status) {
      case 'final':
        return 'text-green-600'
      case 'in_progress':
        return 'text-blue-600'
      case 'pre_game':
        return 'text-gray-600'
      default:
        return 'text-gray-500'
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="text-sm">
        <div className="font-medium text-gray-900">
          {formatScore()}
        </div>
        <div className={`text-xs ${getStatusColor()}`}>
          {formatInning()}
        </div>
      </div>
      
      {liveData.status === 'in_progress' && (
        <button
          onClick={refreshLiveData}
          disabled={isRefreshing}
          className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          title="Refresh live score"
        >
          {isRefreshing ? (
            <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      )}
      
      {lastUpdate && (
        <div className="text-xs text-gray-400" suppressHydrationWarning>
          {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
