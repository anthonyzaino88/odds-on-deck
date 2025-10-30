'use client'

import { useState, useEffect } from 'react'

export default function DemoBanner() {
  const [isDemo, setIsDemo] = useState(false)
  const [apiUsage, setApiUsage] = useState(null)

  useEffect(() => {
    // Check if demo mode (will be set via env var)
    const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
    setIsDemo(demoMode)

    if (demoMode) {
      // Fetch API usage stats
      fetch('/api/demo/stats')
        .then(res => res.json())
        .then(data => setApiUsage(data))
        .catch(() => {})
    }
  }, [])

  if (!isDemo) return null

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎨</span>
          <div className="text-sm">
            <p className="font-semibold">Portfolio Demo Version</p>
            <p className="text-xs opacity-90">
              Using The Odds API free tier • Real live data
            </p>
          </div>
        </div>

        {apiUsage && (
          <div className="flex items-center gap-4 text-xs">
            <div className="bg-white/20 rounded px-3 py-1">
              <span className="opacity-75">Today:</span>
              <span className="font-bold ml-1">{apiUsage.today}/16</span>
            </div>
            <div className="bg-white/20 rounded px-3 py-1">
              <span className="opacity-75">Month:</span>
              <span className="font-bold ml-1">{apiUsage.month}/500</span>
            </div>
            <div className="bg-white/20 rounded px-3 py-1">
              <span className="opacity-75">Cache:</span>
              <span className="font-bold ml-1">{apiUsage.cacheHitRate}%</span>
            </div>
          </div>
        )}

        <a 
          href={process.env.NEXT_PUBLIC_GITHUB_URL || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white/20 hover:bg-white/30 rounded px-4 py-1.5 text-sm font-medium transition flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
          View Source Code
        </a>
      </div>
    </div>
  )
}

