// Live Scoring Hook - Real-time updates for active games only
// Maintains streamlined data flow while providing live scoring

import { useState, useEffect, useCallback } from 'react'

export function useLiveScoring(initialGames = []) {
  const [liveGames, setLiveGames] = useState(initialGames)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchLiveScoring = useCallback(async (forceUpdate = false) => {
    try {
      setLoading(true)
      setError(null)
      
      const url = forceUpdate ? '/api/live-scoring?force=true' : '/api/live-scoring'
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch live scoring')
      }
      
      setLiveGames(result.data.activeGames)
      setLastUpdate(new Date(result.data.lastUpdate))
      
      console.log('✅ Live scoring updated:', {
        activeGames: result.data.activeGames.length,
        lastUpdate: result.data.lastUpdate
      })
      
    } catch (error) {
      console.error('❌ Error fetching live scoring:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-refresh every 15 seconds for live games
  useEffect(() => {
    // Only start auto-refresh if there are active games
    if (liveGames.length === 0) return
    
    const interval = setInterval(() => {
      fetchLiveScoring()
    }, 15000) // 15 seconds for live scoring

    return () => clearInterval(interval)
  }, [fetchLiveScoring, liveGames.length])

  // Force refresh function
  const refresh = useCallback(() => {
    fetchLiveScoring(true)
  }, [fetchLiveScoring])

  return {
    liveGames,
    loading,
    error,
    lastUpdate,
    refresh
  }
}

