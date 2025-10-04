// Unified data hook for all pages
// Ensures consistent data fetching and auto-refresh across the application

import { useState, useEffect, useCallback } from 'react'

export function useAppData(initialData = null) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchData = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setIsRefreshing(true)
      } else {
        setLoading(true)
      }
      
      setError(null)
      
      const url = forceRefresh ? '/api/data?force=true' : '/api/data'
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch data')
      }
      
      setData(result.data)
      setLastUpdated(new Date(result.data.lastUpdated))
      
      console.log('✅ Data fetched successfully:', {
        mlbGames: result.data.mlbGames.length,
        nflGames: result.data.nflGames.length,
        picks: result.data.picks.length,
        playerProps: result.data.playerProps.length,
        isStale: result.data.isStale
      })
      
    } catch (error) {
      console.error('❌ Error fetching data:', error)
      setError(error.message)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Initial data fetch
  useEffect(() => {
    if (!initialData) {
      fetchData()
    }
  }, [fetchData, initialData])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading && !isRefreshing) {
        fetchData()
      }
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [fetchData, loading, isRefreshing])

  // Force refresh function
  const refresh = useCallback(() => {
    fetchData(true)
  }, [fetchData])

  return {
    data,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    refresh
  }
}
