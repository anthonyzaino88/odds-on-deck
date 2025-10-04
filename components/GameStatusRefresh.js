'use client'

import { useState, useEffect } from 'react'

export default function GameStatusRefresh({ gameId, onUpdate }) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const refreshGameData = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      // First refresh live scores
      const liveResponse = await fetch('/api/live-scores/refresh')
      const liveResult = await liveResponse.json()
      
      if (liveResult.success) {
        // Then get updated game data
        const gameResponse = await fetch(`/api/games/${gameId}`)
        const gameResult = await gameResponse.json()
        
        if (gameResult.success) {
          setLastUpdate(new Date())
          // Call the parent component's update function
          if (onUpdate) {
            onUpdate(gameResult.game)
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing game data:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  // Auto-refresh every 30 seconds for live games
  useEffect(() => {
    const interval = setInterval(refreshGameData, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refreshGameData}
        disabled={isRefreshing}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50"
        title="Refresh game data"
      >
        {isRefreshing ? (
          <>
            <div className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            Updating...
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </>
        )}
      </button>
      
      {lastUpdate && (
        <span className="text-xs text-gray-400">
          <span suppressHydrationWarning>{lastUpdate.toLocaleTimeString()}</span>
        </span>
      )}
    </div>
  )
}
