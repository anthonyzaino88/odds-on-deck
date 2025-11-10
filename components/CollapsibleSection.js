'use client'

import { useState } from 'react'

export default function CollapsibleSection({ title, children, defaultOpen = true, badge = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="card p-6 mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-left hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {badge && (
            <span className="px-2 py-1 text-xs font-medium bg-blue-900/30 text-blue-400 border border-blue-500/50 rounded">
              {badge}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="mt-4">
          {children}
        </div>
      )}
    </div>
  )
}

