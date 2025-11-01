'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function BackgroundDataLoader() {
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Loading additional data...')
  const router = useRouter()

  useEffect(() => {
    // Start background refresh
    const startBackgroundRefresh = async () => {
      try {
        // Trigger background refresh
        await fetch('/api/data/background-refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        
        setStatus('processing')
        setMessage('Loading player props and rosters...')
        
        // Poll for completion every 3 seconds
        const pollInterval = setInterval(async () => {
          try {
            const response = await fetch('/api/data/background-refresh')
            const data = await response.json()
            
            if (data.ready) {
              clearInterval(pollInterval)
              setStatus('ready')
              setMessage('✅ All data loaded!')
              
              // Refresh the page to show new data
              setTimeout(() => {
                router.refresh()
              }, 500)
            } else {
              setMessage(`Loading... (${data.propsCount || 0} props found so far)`)
            }
          } catch (error) {
            console.error('Error polling background refresh:', error)
          }
        }, 3000) // Poll every 3 seconds
        
        // Cleanup interval on unmount
        return () => clearInterval(pollInterval)
      } catch (error) {
        console.error('Error starting background refresh:', error)
        setStatus('error')
        setMessage('Failed to load additional data')
      }
    }

    startBackgroundRefresh()
  }, [router])

  // Don't show anything if status is ready
  if (status === 'ready') return null

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
      <div className="flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
        <p className="text-sm text-blue-800">{message}</p>
      </div>
    </div>
  )
}

