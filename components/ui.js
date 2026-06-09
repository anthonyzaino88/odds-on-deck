// Shared UI primitives — follow STYLE.md.
// Flat dark surfaces, 4px card radius, 3px badge radius, no shadows/gradients,
// tabular-nums + mono on all numeric values.

import { cn } from '../lib/utils'

export const SPORT_CONFIG = {
  mlb: { label: 'MLB', text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', name: 'Major League Baseball' },
  nhl: { label: 'NHL', text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', name: 'National Hockey League' },
  nfl: { label: 'NFL', text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', name: 'National Football League' },
}

export function SectionHeading({ title, action }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
        {title}
      </h2>
      <div className="flex-1 h-px bg-white/[0.04]" />
      {action}
    </div>
  )
}

export function SportBadge({ sport }) {
  const cfg = SPORT_CONFIG[(sport || '').toLowerCase()]
  if (!cfg) return null
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border',
      cfg.text, cfg.bg, cfg.border,
    )}>
      {cfg.label}
    </span>
  )
}

export function BookBadge({ book }) {
  if (!book) return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium uppercase tracking-wide bg-white/[0.05] text-slate-400">
      {book}
    </span>
  )
}

// edge is a percentage number (e.g. 3.2 means +3.2%)
export function EdgeBadge({ edge }) {
  const isPositive = edge > 0
  const isStrong = edge >= 3
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[11px] font-semibold tabular-nums font-mono',
      isStrong && 'bg-green-500/10 text-green-400 border border-green-500/20',
      isPositive && !isStrong && 'text-green-500/60',
      !isPositive && 'text-slate-500',
    )}>
      {isPositive ? '+' : ''}{edge.toFixed(1)}%
    </span>
  )
}

// Quality score uses the app's 0–100 scale + tier from getQualityTier()
const TIER_COLORS = {
  elite: 'text-green-400 bg-green-500/10',
  premium: 'text-green-400 bg-green-500/10',
  solid: 'text-amber-400 bg-amber-500/10',
  speculative: 'text-amber-400 bg-amber-500/10',
  longshot: 'text-slate-500 bg-white/[0.04]',
}

export function QualityChip({ score, tier }) {
  const color = TIER_COLORS[tier] || TIER_COLORS.longshot
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[11px] font-semibold tabular-nums font-mono',
        color,
      )}
      title="Quality Score — sorting aid combining line deviation from market and number of books offering the prop"
    >
      <span className="opacity-60">Q</span>
      {typeof score === 'number' ? score.toFixed(1) : 'N/A'}
    </span>
  )
}

export function ConfidenceBadge({ confidence }) {
  if (!confidence || confidence === 'low' || confidence === 'very_low') return null
  const map = {
    very_high: { cls: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'V.High' },
    high: { cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'High' },
    medium: { cls: 'text-slate-400 bg-white/[0.05] border-white/[0.06]', label: 'Med' },
  }
  const cfg = map[confidence] || map.medium
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium uppercase tracking-wide border',
      cfg.cls,
    )}>
      {cfg.label}
    </span>
  )
}
