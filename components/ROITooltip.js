'use client'

import { useState } from 'react'

export default function ROITooltip() {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="ml-1 w-4 h-4 rounded-full bg-slate-700 text-gray-400 text-[10px] font-bold inline-flex items-center justify-center hover:bg-slate-600 hover:text-white transition-colors"
        aria-label="How ROI is calculated"
      >
        ?
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-4 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl text-left">
            <h4 className="text-sm font-semibold text-white mb-2">How ROI is calculated</h4>
            <p className="text-xs text-gray-300 leading-relaxed mb-2">
              Each prediction is treated as a 1-unit flat bet. When recorded odds are available, 
              wins pay (decimal odds - 1) units. Without recorded odds, we assume standard -110 
              (0.91 units per win).
            </p>
            <div className="text-xs text-gray-400 bg-slate-900 rounded-lg p-2 font-mono">
              ROI = Total Units P/L / Total Bets
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Pushes are excluded from both the numerator and denominator.
            </p>
          </div>
        </>
      )}
    </span>
  )
}
