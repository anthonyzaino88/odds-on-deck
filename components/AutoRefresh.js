'use client'

import { useState, useEffect } from 'react'

export default function AutoRefresh({ refreshInterval = 60000 }) { // Default 1 minute
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [nextRefresh, setNextRefresh] = useState(null)

  useEffect(() => {
    if (!autoRefreshEnabled) return

    const interval = setInterval(async () => {
      await performRefresh()
    }, refreshInterval)

    // Set initial next refresh time
    setNextRefresh(new Date(Date.now() + refreshInterval))

    return () => clearInterval(interval)
  }, [autoRefreshEnabled, refreshInterval])

  // Update next refresh time every second for display
  useEffect(() => {
    if (!autoRefreshEnabled || !nextRefresh) return

    const timer = setInterval(() => {
      const now = new Date()
      const timeLeft = nextRefresh.getTime() - now.getTime()
      
      if (timeLeft <= 0) {
        setNextRefresh(new Date(now.getTime() + refreshInterval))
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [autoRefreshEnabled, nextRefresh, refreshInterval])

  const performRefresh = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/cron/auto-refresh')
      const result = await response.json()
      
      if (result.success) {
        setLastRefresh(new Date())
        setNextRefresh(new Date(Date.now() + refreshInterval))
        // Refresh the page to show updated data
        window.location.reload()
      }
    } catch (error) {
      console.error('Error during auto-refresh:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleManualRefresh = async () => {
    await performRefresh()
  }

  const toggleAutoRefresh = () => {
    setAutoRefreshEnabled(!autoRefreshEnabled)
  }

  const formatTimeLeft = () => {
    if (!nextRefresh) return '--:--'
    
    const now = new Date()
    const timeLeft = nextRefresh.getTime() - now.getTime()
    
    if (timeLeft <= 0) return '00:00'
    
    const minutes = Math.floor(timeLeft / 60000)
    const seconds = Math.floor((timeLeft % 60000) / 1000)
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4 p-3 bg-gray-50 rounded-lg border">
      <div className="flex items-center gap-2">
        <button
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-200"
        >
          {isRefreshing ? (
            <>
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              Refreshing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Now
            </>
          )}
        </button>

        <button
          onClick={toggleAutoRefresh}
          className={`flex items-center gap-2 px-3 py-1 text-sm rounded-md border ${
            autoRefreshEnabled 
              ? 'bg-green-50 text-green-600 hover:bg-green-100 border-green-200' 
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200'
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${autoRefreshEnabled ? 'bg-green-500' : 'bg-gray-400'}`}></div>
          Auto-refresh {autoRefreshEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
      
      <div className="text-xs text-gray-500">
        {autoRefreshEnabled && (
          <>
            Next refresh in: <span className="font-mono font-medium">{formatTimeLeft()}</span>
            {isRefreshing && <span className="ml-2 text-blue-600">• Updating...</span>}
          </>
        )}
        {lastRefresh && (
          <div className="text-xs text-gray-400 mt-1">
            <span suppressHydrationWarning>Last updated: {lastRefresh.toLocaleTimeString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}
