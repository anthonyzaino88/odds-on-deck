'use client'

import { useEffect, useState } from 'react'
import DataFreshness from './DataFreshness.js'

/**
 * Tiny client island for the local date + refresh stamp. Kept off the
 * above-the-fold hero so it cannot delay first paint.
 */
export default function HomeFreshness() {
  const [todayStr, setTodayStr] = useState('')

  useEffect(() => {
    setTodayStr(new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }))
  }, [])

  return (
    <div className="flex items-center gap-3 mb-6">
      {todayStr ? (
        <p className="text-xs text-slate-500 tabular-nums">{todayStr}</p>
      ) : null}
      <DataFreshness />
    </div>
  )
}
