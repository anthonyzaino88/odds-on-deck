'use client'

import { useState, useEffect } from 'react'

export default function SimpleLiveRefresh() {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [mounted, setMounted] = useState(false)

  // Only set the initial time after component mounts to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
    setLastUpdate(new Date())
  }, [])

  const refreshLiveScores = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/live-scores/refresh')
      const result = await response.json()
      
      if (result.success) {
        setLastUpdate(new Date())
        // Show success message
        alert(`Live scores updated! ${result.gamesUpdated} games refreshed.`)
        // Refresh the page to show updated scores
        window.location.reload()
      } else {
        alert('Failed to refresh live scores. Please try again.')
      }
    } catch (error) {
      console.error('Error refreshing live scores:', error)
      alert('Error refreshing live scores. Please try again.')
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={refreshLiveScores}
        disabled={isRefreshing}
        className="flex items-center gap-2 px-3 py-1 text-sm bg-green-50 text-green-600 rounded-md hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed border border-green-200"
      >
        {isRefreshing ? (
          <>
            <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
            Updating...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Update Live Scores
          </>
        )}
      </button>
      
      <span className="text-xs text-gray-500">
        {mounted && lastUpdate ? (
          <span suppressHydrationWarning>Last: {lastUpdate.toLocaleTimeString()}</span>
        ) : 'Last: --:--:--'}
      </span>
    </div>
  )
}
