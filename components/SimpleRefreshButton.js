'use client'

import { useState, useEffect } from 'react'

export default function SimpleRefreshButton() {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [refreshStatus, setRefreshStatus] = useState(null)
  const [countdown, setCountdown] = useState(null)

  // Check refresh status on mount and periodically
  useEffect(() => {
    checkRefreshStatus()
    
    // Check status every minute
    const interval = setInterval(checkRefreshStatus, 60000)
    return () => clearInterval(interval)
  }, [])
  
  // Update countdown timer
  useEffect(() => {
    if (!refreshStatus || refreshStatus.canRefresh) {
      setCountdown(null)
      return
    }
    
    const timer = setInterval(() => {
      const now = new Date()
      const nextRefresh = new Date(refreshStatus.nextRefreshTime)
      const diffMs = Math.max(0, nextRefresh - now)
      const diffMins = Math.floor(diffMs / 60000)
      const diffSecs = Math.floor((diffMs % 60000) / 1000)
      
      if (diffMs <= 0) {
        clearInterval(timer)
        checkRefreshStatus()
      } else {
        setCountdown(`${diffMins}m ${diffSecs}s`)
      }
    }, 1000)
    
    return () => clearInterval(timer)
  }, [refreshStatus])
  
  // Check if refresh is allowed
  const checkRefreshStatus = async () => {
    try {
      const response = await fetch('/api/refresh-status')
      const result = await response.json()
      setRefreshStatus(result)
      
      if (result.lastRefreshTime) {
        setLastUpdate(new Date(result.lastRefreshTime))
      }
    } catch (error) {
      console.error('Error checking refresh status:', error)
    }
  }

  const handleRefresh = async () => {
    if (isRefreshing) return
    
    // Check if refresh is allowed
    await checkRefreshStatus()
    if (refreshStatus && !refreshStatus.canRefresh) {
      alert(`⏳ Refresh cooldown active. Please wait ${refreshStatus.remainingMinutes} minutes before refreshing again.`)
      return
    }
    
    setIsRefreshing(true)
    try {
      // Refresh all data using unified API
      const response = await fetch('/api/data?force=true')
      const result = await response.json()
      
      if (result.success) {
        setLastUpdate(new Date())
        const data = result.data
        alert(`✅ Data refreshed successfully!\n\nUpdated:\n• MLB: ${data.mlbGames.length} games\n• NFL: ${data.nflGames.length} games\n• NHL: ${data.nhlGames.length} games\n• Picks: ${data.picks.length} picks\n• Props: ${data.playerProps.length} props`)
        
        // Refresh the page to show updated data
        window.location.reload()
      } else {
        alert(`❌ Refresh failed: ${result.error}`)
      }
    } catch (error) {
      alert(`❌ Network error: ${error.message}`)
    } finally {
      setIsRefreshing(false)
      checkRefreshStatus() // Update refresh status after attempt
    }
  }

  return (
    <div className="flex flex-col p-4 bg-gray-50 rounded-lg border mb-4">
      <div className="flex items-center gap-4 mb-2">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || (refreshStatus && !refreshStatus.canRefresh)}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium ${
            isRefreshing || (refreshStatus && !refreshStatus.canRefresh)
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
      
      {/* Cooldown information */}
      {refreshStatus && !refreshStatus.canRefresh && (
        <div className="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
          <div className="flex items-center text-yellow-800">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              API cooldown active: {countdown || `${refreshStatus.remainingMinutes}m remaining`}
            </span>
          </div>
          <p className="text-xs text-yellow-700 mt-1">
            To conserve API usage, refreshes are limited to once per hour.
          </p>
        </div>
      )}
    </div>
  )
}
