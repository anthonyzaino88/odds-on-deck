'use client'

import { useState } from 'react'

export default function ScoreRefreshButton({ onRefreshComplete }) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [result, setResult] = useState(null)

  const handleRefresh = async () => {
    if (isRefreshing) return
    
    setIsRefreshing(true)
    setResult(null)
    
    try {
      const response = await fetch('/api/scores/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport: 'all' })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setLastRefresh(new Date())
        setResult({
          type: 'success',
          message: `Updated ${data.updated} game${data.updated !== 1 ? 's' : ''}`
        })
        
        // Callback to refresh parent
        if (onRefreshComplete) {
          onRefreshComplete()
        }
        
        // Auto-hide success message
        setTimeout(() => setResult(null), 3000)
      } else {
        setResult({
          type: 'error',
          message: data.error || 'Failed to refresh'
        })
      }
    } catch (error) {
      setResult({
        type: 'error',
        message: error.message
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
          isRefreshing
            ? 'bg-slate-700 text-slate-400 cursor-wait'
            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30'
        }`}
      >
        {isRefreshing ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Refreshing...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh Scores</span>
          </>
        )}
      </button>
      
      {/* Status message */}
      {result && (
        <span className={`text-sm ${
          result.type === 'success' ? 'text-green-400' : 'text-red-400'
        }`}>
          {result.type === 'success' ? '✓' : '✗'} {result.message}
        </span>
      )}
      
      {/* Last refresh time */}
      {lastRefresh && !result && (
        <span className="text-xs text-slate-500">
          Last: {lastRefresh.toLocaleTimeString()}
        </span>
      )}
    </div>
  )
}

