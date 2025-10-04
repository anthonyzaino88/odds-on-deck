'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AutoRefreshWrapper({ children, refreshInterval = 60000, refreshEndpoint = '/api/cron/live-refresh' }) {
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(async () => {
      if (!isRefreshing) {
        setIsRefreshing(true)
        try {
          // Trigger data refresh
          const response = await fetch(refreshEndpoint, { method: 'GET' })
          const result = await response.json()
          
          if (result.success) {
            setLastRefresh(new Date())
            // Refresh the page to show updated data
            router.refresh()
          }
        } catch (error) {
          console.error('Auto-refresh error:', error)
        } finally {
          setIsRefreshing(false)
        }
      }
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [refreshInterval, isRefreshing, refreshEndpoint, router])

  return (
    <div>
      {children}
      <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-full text-xs shadow-lg">
        {isRefreshing ? (
          <span>🔄 Refreshing...</span>
        ) : (
          <span suppressHydrationWarning>🔄 Auto-refresh: {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  )
}
