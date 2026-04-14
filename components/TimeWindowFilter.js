'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const WINDOWS = [
  { key: '7', label: '7 Days' },
  { key: '30', label: '30 Days' },
  { key: '90', label: '90 Days' },
  { key: 'all', label: 'All Time' },
]

const SOURCES = [
  { key: 'all', label: 'All Picks' },
  { key: 'user', label: 'Your Picks' },
  { key: 'system', label: 'System Tracked' },
]

export default function TimeWindowFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentWindow = searchParams.get('window') || 'all'
  const currentSource = searchParams.get('source') || 'all'

  function navigate(windowVal, sourceVal) {
    const params = new URLSearchParams()
    if (windowVal && windowVal !== 'all') params.set('window', windowVal)
    if (sourceVal && sourceVal !== 'all') params.set('source', sourceVal)
    const qs = params.toString()
    router.push(`/validation${qs ? '?' + qs : ''}`)
  }

  return (
    <div className="space-y-3">
      {/* Time window */}
      <div className="flex flex-wrap justify-center gap-2">
        {WINDOWS.map(({ key, label }) => {
          const active = currentWindow === key
          return (
            <button
              key={key}
              onClick={() => navigate(key, currentSource)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'bg-slate-800 text-gray-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      {/* Source filter */}
      <div className="flex flex-wrap justify-center gap-2">
        {SOURCES.map(({ key, label }) => {
          const active = currentSource === key
          return (
            <button
              key={key}
              onClick={() => navigate(currentWindow, key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                active
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800/60 text-gray-500 hover:bg-slate-700 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
