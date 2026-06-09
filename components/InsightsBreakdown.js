'use client'

// Organizes the raw "actionable insights" list into grouped, scannable sections:
// System health, prop-type leans, and a filterable/searchable player breakdown.
// Follows STYLE.md — flat surfaces, mono numbers, no emojis/gradients/shadows.

import { useMemo, useState } from 'react'
import { cn } from '../lib/utils'

const PLAYER_PAGE = 36

function Dot({ tone }) {
  return (
    <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', tone === 'success' ? 'bg-green-400' : 'bg-red-400')} />
  )
}

function PropChips({ items, tone, label }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('text-[11px] font-semibold uppercase tracking-wider', tone === 'success' ? 'text-green-400' : 'text-red-400')}>
          {label}
        </span>
        <span className="text-[11px] text-slate-600 tabular-nums font-mono">{items.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((p, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1.5 px-2 py-1 bg-bg border border-white/[0.06] rounded-[3px]"
          >
            <Dot tone={tone} />
            <span className="text-xs text-slate-200 capitalize">{p.name}</span>
            {p.accuracy != null && (
              <span className={cn('text-[11px] tabular-nums font-mono', tone === 'success' ? 'text-green-400' : 'text-red-400')}>
                {p.accuracy}%
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function InsightsBreakdown({ system = [], propTypeSuccess = [], propTypeWarning = [], players = [] }) {
  const [view, setView] = useState('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const trustCount = useMemo(() => players.filter(p => p.tone === 'success').length, [players])
  const avoidCount = players.length - trustCount

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return players
      .filter(p => (view === 'all' ? true : view === 'trust' ? p.tone === 'success' : p.tone === 'warning'))
      .filter(p => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => b.total - a.total)
  }, [players, view, query])

  const visible = expanded ? filtered : filtered.slice(0, PLAYER_PAGE)

  const tabs = [
    { id: 'all', label: 'All', count: players.length },
    { id: 'trust', label: 'Trust', count: trustCount },
    { id: 'avoid', label: 'Avoid', count: avoidCount },
  ]

  return (
    <div className="space-y-6">
      {/* System health */}
      {system.length > 0 && (
        <div className="rounded-[4px] border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
          {system.map((s, idx) => (
            <div key={idx} className="flex items-start gap-2.5 px-3 py-2.5 bg-bg">
              <span className="mt-1.5"><Dot tone={s.type} /></span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200">{s.message}</div>
                {s.recommendation && <div className="text-xs text-slate-500 mt-0.5">{s.recommendation}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Prop type leans */}
      {(propTypeSuccess.length > 0 || propTypeWarning.length > 0) && (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Prop Types</div>
          <PropChips items={propTypeSuccess} tone="success" label="Lean Into" />
          <PropChips items={propTypeWarning} tone="warning" label="Fade" />
        </div>
      )}

      {/* Players */}
      {players.length > 0 && (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Players <span className="text-slate-600 tabular-nums font-mono">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-[3px] border border-white/[0.06] p-0.5 bg-bg">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setView(t.id); setExpanded(false) }}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-[2px] transition-colors duration-100',
                      view === t.id ? 'bg-elevated text-slate-100' : 'text-slate-400 hover:text-slate-200'
                    )}
                  >
                    {t.label} <span className="tabular-nums font-mono text-slate-500">{t.count}</span>
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setExpanded(false) }}
                placeholder="Search player…"
                className="bg-bg border border-white/[0.06] rounded-[3px] px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-white/20 w-full sm:w-44"
              />
            </div>
          </div>

          {visible.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {visible.map((p, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-bg border border-white/[0.06] rounded-[3px]"
                >
                  <Dot tone={p.tone} />
                  <span className="text-sm text-slate-200 truncate flex-1">{p.name}</span>
                  <span className="text-xs text-slate-500 tabular-nums font-mono">{p.correct}/{p.total}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500 py-6 text-center">No players match.</div>
          )}

          {filtered.length > PLAYER_PAGE && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100"
            >
              {expanded ? 'Show less' : `Show all ${filtered.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
