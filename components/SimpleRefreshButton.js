'use client'

import { useState } from 'react'

export default function SimpleRefreshButton() {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const handleRefresh = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      // Refresh all data using unified API
      const response = await fetch('/api/data?force=true')
      const result = await response.json()
      
      if (result.success) {
        setLastUpdate(new Date())
        const data = result.data
        alert(`✅ Data refreshed successfully!\n\nUpdated:\n• MLB: ${data.mlbGames.length} games\n• NFL: ${data.nflGames.length} games\n• Picks: ${data.picks.length} picks\n• Props: ${data.playerProps.length} props`)
        
        // Refresh the page to show updated data
        window.location.reload()
      } else {
        alert(`❌ Refresh failed: ${result.error}`)
      }
    } catch (error) {
      alert(`❌ Network error: ${error.message}`)
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border mb-4">
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium ${
          isRefreshing 
            ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {isRefreshing ? (
          <>
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
            Refreshing Data...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh All Data
          </>
        )}
      </button>
      
      <div className="text-sm text-gray-600">
        {lastUpdate ? (
          <span suppressHydrationWarning>Last updated: {lastUpdate.toLocaleTimeString()}</span>
        ) : (
          <span>Click to refresh all game data, scores, and odds</span>
        )}
      </div>
    </div>
  )
}
