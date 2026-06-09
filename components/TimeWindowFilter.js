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
    <div className="space-y-2">
      {/* Time window */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-[4px] border border-white/[0.06] bg-surface">
        {WINDOWS.map(({ key, label }) => {
          const active = currentWindow === key
          return (
            <button
              key={key}
              onClick={() => navigate(key, currentSource)}
              className={`px-3 py-1.5 rounded-[3px] text-xs font-medium transition-colors duration-100 ${
                active
                  ? 'bg-elevated text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      {/* Source filter */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-[4px] border border-white/[0.06] bg-surface ml-0 sm:ml-2">
        {SOURCES.map(({ key, label }) => {
          const active = currentSource === key
          return (
            <button
              key={key}
              onClick={() => navigate(currentWindow, key)}
              className={`px-3 py-1.5 rounded-[3px] text-xs font-medium transition-colors duration-100 ${
                active
                  ? 'bg-elevated text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
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
