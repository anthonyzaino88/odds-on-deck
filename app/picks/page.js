// Editor's Picks page - Show recommended bets based on betting edges

'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'
import { getQualityTier } from '../../lib/quality-score.js'
import DataFreshness from '../../components/DataFreshness.js'
import ShareButton from '../../components/ShareButton.js'
import { cn } from '../../lib/utils'
import { SportBadge, BookBadge, EdgeBadge, QualityChip } from '../../components/ui'

const STRATEGIES = [
  { id: 'safe', label: 'Safe', sub: '52%+ win', accent: 'text-green-400' },
  { id: 'balanced', label: 'Balanced', sub: 'Best quality', accent: 'text-blue-400' },
  { id: 'value', label: 'Value', sub: '10%+ edge', accent: 'text-amber-400' },
  { id: 'all', label: 'All', sub: 'Everything', accent: 'text-slate-300' },
]

const MODE_DESCRIPTIONS = {
  safe: 'Picks with 52%+ win probability. The safest, most consistent opportunities.',
  balanced: 'Picks with optimal quality scores. Best combination of probability and edge.',
  value: 'Picks with 10%+ edge. Market inefficiencies with higher potential value.',
  all: 'All available picks sorted by quality, regardless of filters.',
}

// Quality-tier dot legend (matches TIER_DOT colors below)
const TIER_LEGEND = [
  { dot: 'bg-green-400', label: 'Elite', range: '70+' },
  { dot: 'bg-blue-400', label: 'Premium', range: '55–69' },
  { dot: 'bg-amber-400', label: 'Solid', range: '25–54' },
  { dot: 'bg-slate-600', label: 'Longshot', range: '<25' },
]

function TierLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        Quality
      </span>
      {TIER_LEGEND.map((t) => (
        <span key={t.label} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', t.dot)} />
          <span className="text-[11px] text-slate-400">{t.label}</span>
          <span className="text-[11px] text-slate-600 tabular-nums font-mono">{t.range}</span>
        </span>
      ))}
    </div>
  )
}

export default function PicksPage() {
  const [picks, setPicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState('safe')
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    fetchPicks()
  }, [filterMode])

  async function fetchPicks() {
    try {
      setLoading(true)
      const response = await fetch(`/api/picks?mode=${filterMode}`)
      const data = await response.json()
      
      if (data.success) {
        setPicks(data.picks || [])
        setLastUpdated(new Date())
      } else {
        console.error('Failed to fetch picks:', data.error)
        setPicks([])
      }
    } catch (err) {
      console.error('Error fetching picks:', err)
      setPicks([])
    } finally {
      setLoading(false)
    }
  }

  // Separate picks by sport and type
  const nhlProps = picks.filter(p => p.type === 'player_prop' && p.sport === 'nhl')
  const nhlMoneyline = picks.filter(p => p.type === 'moneyline' && p.sport === 'nhl')
  const nhlTotals = picks.filter(p => p.type === 'total' && p.sport === 'nhl')
  
  const nflProps = picks.filter(p => p.type === 'player_prop' && p.sport === 'nfl')
  const nflMoneyline = picks.filter(p => p.type === 'moneyline' && p.sport === 'nfl')
  const nflTotals = picks.filter(p => p.type === 'total' && p.sport === 'nfl')
  
  const mlbProps = picks.filter(p => p.type === 'player_prop' && p.sport === 'mlb')
  const mlbMoneyline = picks.filter(p => p.type === 'moneyline' && p.sport === 'mlb')
  const mlbTotals = picks.filter(p => p.type === 'total' && p.sport === 'mlb')
  
  const hasNHL = nhlProps.length > 0 || nhlMoneyline.length > 0 || nhlTotals.length > 0
  const hasNFL = nflProps.length > 0 || nflMoneyline.length > 0 || nflTotals.length > 0
  const hasMLB = mlbProps.length > 0 || mlbMoneyline.length > 0 || mlbTotals.length > 0
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100 mb-3"
        >
          ← Home
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">Editor&apos;s Picks</h1>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
          A smaller, curated view of the board &mdash; props that stand out based on line
          differences, market consensus, and current context. Meant to narrow the board,
          not replace your judgment.
        </p>
        <div className="flex items-center gap-3 mt-2.5">
          {lastUpdated && (
            <span className="text-[11px] text-slate-500 tabular-nums font-mono" suppressHydrationWarning>
              Updated {format(lastUpdated, 'h:mm a')}
            </span>
          )}
          <DataFreshness />
        </div>
      </div>

      {/* Filter Mode Selector */}
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
          Pick Strategy
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STRATEGIES.map((s) => {
            const active = filterMode === s.id
            return (
              <button
                key={s.id}
                onClick={() => setFilterMode(s.id)}
                className={cn(
                  'p-3 rounded-[4px] border text-left transition-colors duration-100',
                  active
                    ? 'bg-elevated border-white/[0.12]'
                    : 'bg-bg border-white/[0.06] hover:border-white/[0.12]',
                )}
              >
                <div className={cn('text-sm font-semibold', active ? 'text-slate-100' : 'text-slate-300')}>
                  {s.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{s.sub}</div>
                {active && !loading && (
                  <div className={cn('text-[11px] mt-1.5 font-medium tabular-nums font-mono', s.accent)}>
                    {picks.length} picks
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Mode Description */}
        <div className="mt-3 px-3 py-2 bg-bg rounded-[4px] border border-white/[0.06]">
          <p className="text-xs text-slate-400 leading-relaxed">
            {MODE_DESCRIPTIONS[filterMode]}
          </p>
        </div>

        {/* Quality tier legend */}
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <TierLegend />
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="h-3 w-40 bg-white/[0.06] rounded animate-pulse" />
          </div>
          <div className="divide-y divide-white/[0.06]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 animate-pulse">
                <div className="w-6 h-3 bg-white/[0.06] rounded shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-white/[0.06] rounded" />
                  <div className="h-3 w-56 bg-white/[0.04] rounded" />
                  <div className="h-3 w-24 bg-white/[0.04] rounded" />
                </div>
                <div className="h-5 w-14 bg-white/[0.06] rounded shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Picks Display */}
      {!loading && picks.length > 0 ? (
        <div className="space-y-6">
          {/* Top 5 Best Picks Overall */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
                Today&apos;s Shortlist
              </h2>
              <div className="flex-1 h-px bg-white/[0.04]" />
              <span className="text-[11px] text-slate-600 tabular-nums font-mono">
                {Math.min(picks.length, 5)}
              </span>
            </div>
            <div className="rounded-[4px] border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
              {picks.slice(0, 5).map((pick, index) => (
                <PickCard key={`${pick.propId || pick.gameId}-${pick.type}-${pick.pick}-${index}`} pick={pick} rank={index + 1} />
              ))}
            </div>
          </section>

          {/* NHL Picks */}
          {hasNHL && (
            <SportPicksSection
              sport="nhl"
              count={nhlProps.length + nhlMoneyline.length + nhlTotals.length}
              props={nhlProps}
              moneyline={nhlMoneyline}
              totals={nhlTotals}
            />
          )}

          {/* NFL Picks */}
          {hasNFL && (
            <SportPicksSection
              sport="nfl"
              count={nflProps.length + nflMoneyline.length + nflTotals.length}
              props={nflProps}
              moneyline={nflMoneyline}
              totals={nflTotals}
            />
          )}

          {/* MLB Picks */}
          {hasMLB && (
            <SportPicksSection
              sport="mlb"
              count={mlbProps.length + mlbMoneyline.length + mlbTotals.length}
              props={mlbProps}
              moneyline={mlbMoneyline}
              totals={mlbTotals}
            />
          )}
        </div>
      ) : !loading && (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface px-4 py-12 text-center">
          <h3 className="text-sm font-medium text-slate-200 mb-1">No picks match this strategy</h3>
          <p className="text-sm text-slate-500">
            Try a different filter mode or check back later as odds update throughout the day.
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="p-4 bg-amber-500/[0.08] border border-amber-500/20 rounded-[4px]">
        <p className="text-xs text-amber-400/90 leading-relaxed">
          <span className="font-semibold">Disclaimer:</span> These picks are for educational purposes based on
          statistical models. Always gamble responsibly and within your means. Past performance does not
          guarantee future results.
        </p>
      </div>
    </div>
  )
}

function SportPicksSection({ sport, count, props, moneyline, totals }) {
  const hasGamePicks = moneyline.length > 0 || totals.length > 0
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <SportBadge sport={sport} />
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
          Picks
        </h2>
        <div className="flex-1 h-px bg-white/[0.04]" />
        <span className="text-[11px] text-slate-600 tabular-nums font-mono">{count}</span>
      </div>

      <div className="space-y-4">
        {props.length > 0 && (
          <div>
            <GroupLabel>Player Props ({props.length})</GroupLabel>
            <RowList>
              {props.map((pick) => (
                <PickRow key={`${pick.propId}-${pick.pick}`} pick={pick} />
              ))}
            </RowList>
          </div>
        )}

        {hasGamePicks && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {moneyline.length > 0 && (
              <div>
                <GroupLabel>Moneyline ({moneyline.length})</GroupLabel>
                <RowList>
                  {moneyline.map((pick) => (
                    <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                  ))}
                </RowList>
              </div>
            )}
            {totals.length > 0 && (
              <div>
                <GroupLabel>Over / Under ({totals.length})</GroupLabel>
                <RowList>
                  {totals.map((pick) => (
                    <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                  ))}
                </RowList>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const TIER_DOT = {
  elite: 'bg-green-400',
  premium: 'bg-blue-400',
  solid: 'bg-amber-400',
  speculative: 'bg-amber-400',
  longshot: 'bg-slate-600',
}

function TierDot({ tier, label }) {
  return (
    <span
      className={cn('h-2 w-2 rounded-full shrink-0', TIER_DOT[tier] || 'bg-slate-600')}
      title={label}
    />
  )
}

function GroupLabel({ children }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
      {children}
    </h3>
  )
}

function RowList({ children }) {
  return (
    <div className="rounded-[4px] border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
      {children}
    </div>
  )
}

function decimalToAmerican(decimalOdds) {
  if (!decimalOdds || decimalOdds === 1) return '+100'
  const d = parseFloat(decimalOdds)
  if (isNaN(d)) return null
  if (d >= 2.0) return `+${Math.round((d - 1) * 100)}`
  return `${Math.round(-100 / (d - 1))}`
}

function pickLabel(pick) {
  const isPlayerProp = pick.type === 'player_prop'
  if (isPlayerProp) {
    return pick.playerName
  }
  if (pick.type === 'total' && pick.awayTeam && pick.homeTeam) {
    return `${pick.awayTeam} @ ${pick.homeTeam}`
  }
  return pick.team
}

function pickDetail(pick, fallback) {
  const isPlayerProp = pick.type === 'player_prop'
  if (isPlayerProp) {
    return `${pick.pick?.toUpperCase()} ${pick.threshold} ${(pick.propType || '').replace(/_/g, ' ')}`
  }
  if (pick.type === 'moneyline') return `${pick.pick} ML`
  if (pick.type === 'total') return `${pick.pick.toUpperCase()} ${pick.threshold || ''}`
  return fallback
}

function PickCard({ pick, rank }) {
  const qualityTier = getQualityTier(pick.qualityScore || 0)
  const displayOdds = decimalToAmerican(pick.odds)
  const edge = pick.edge || 0
  const probability = (pick.probability || 0.5) * 100

  return (
    <Link href={`/game/${pick.gameId}`} className="block">
      <div className="flex items-start gap-3 px-3 py-3 hover:bg-elevated transition-colors duration-100 cursor-pointer">
        <span className="text-[11px] font-semibold text-slate-600 tabular-nums font-mono w-6 shrink-0 pt-0.5">
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100 truncate">
              {pickLabel(pick)}
            </span>
            <SportBadge sport={pick.sport} />
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {pickDetail(pick, pick.reasoning)}
          </div>
          {pick.quickInsight && (
            <div className="flex items-start gap-1.5 mt-1">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-blue-400 flex-shrink-0" />
              <span className="text-[11px] text-blue-400 leading-snug">{pick.quickInsight}</span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {displayOdds && (
              <span className="text-xs text-amber-400 font-semibold tabular-nums font-mono">
                {displayOdds}
              </span>
            )}
            <BookBadge book={pick.bookmaker} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-end gap-1">
            {pick.qualityScore > 0 && (
              <QualityChip score={pick.qualityScore} tier={qualityTier.tier} />
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-green-400 tabular-nums font-mono">
                {probability.toFixed(0)}%
              </span>
              {edge > 0.01 && <EdgeBadge edge={edge * 100} />}
            </div>
          </div>
          <ShareButton prop={pick} variant="icon" />
        </div>
      </div>
    </Link>
  )
}

function PickRow({ pick }) {
  const qualityTier = getQualityTier(pick.qualityScore || 0)
  const displayOdds = decimalToAmerican(pick.odds)
  const edge = pick.edge || 0
  const probability = (pick.probability || 0.5) * 100

  return (
    <Link href={`/game/${pick.gameId}`} className="block">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-elevated transition-colors duration-100 cursor-pointer">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <TierDot tier={qualityTier.tier} label={qualityTier.label} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-100 truncate">
              {pickLabel(pick)}
            </div>
            <div className="text-xs text-slate-400 truncate">
              {pickDetail(pick, pick.pick?.toUpperCase())}
            </div>
            {pick.quickInsight && (
              <div className="text-[11px] text-blue-400 mt-0.5 truncate">
                {pick.quickInsight}
              </div>
            )}
            {displayOdds && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-amber-400 font-semibold tabular-nums font-mono">
                  {displayOdds}
                </span>
                <BookBadge book={pick.bookmaker} />
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-sm font-semibold text-green-400 tabular-nums font-mono">
              {probability.toFixed(0)}%
            </span>
            {edge > 0.01 && (
              <span className="text-[11px] text-blue-400 tabular-nums font-mono">
                +{(edge * 100).toFixed(1)}%
              </span>
            )}
          </div>
          <ShareButton prop={pick} variant="icon" />
        </div>
      </div>
    </Link>
  )
}
