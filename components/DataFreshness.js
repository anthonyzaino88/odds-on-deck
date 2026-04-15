'use client'

import { useState, useEffect } from 'react'

export default function DataFreshness() {
  const [lastRefresh, setLastRefresh] = useState(null)

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/api/refresh-status')
        if (res.ok) {
          const data = await res.json()
          if (data.lastRefreshTime) {
            setLastRefresh(new Date(data.lastRefreshTime))
          }
        }
      } catch {
        // Non-critical
      }
    }
    check()
    const interval = setInterval(check, 120000)
    return () => clearInterval(interval)
  }, [])

  if (!lastRefresh) return null

  const now = new Date()
  const diffMs = now - lastRefresh
  const diffMin = Math.floor(diffMs / 60000)

  let label
  if (diffMin < 1) label = 'just now'
  else if (diffMin < 60) label = `${diffMin}m ago`
  else {
    label = lastRefresh.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-slate-500"
      suppressHydrationWarning
    >
      <span className={`w-1.5 h-1.5 rounded-full ${diffMin < 60 ? 'bg-green-500' : 'bg-yellow-500'}`} />
      Data updated {label}
    </span>
  )
}
