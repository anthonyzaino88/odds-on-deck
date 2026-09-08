import Link from 'next/link'
import { getQualityTier } from '../lib/quality-score.js'
import { formatAmericanOdds } from '../lib/odds-units.js'
import { todaysBoardSlateState } from '../lib/published-picks.js'
import ShareButton from './ShareButton.js'
import { SportBadge, BookBadge, EdgeBadge, QualityChip } from './ui'

const TIER_LEGEND = [
  { dot: 'bg-green-400', label: 'Elite', range: '70+' },
  { dot: 'bg-blue-400', label: 'Premium', range: '55–69' },
  { dot: 'bg-amber-400', label: 'Solid', range: '40–54' },
  { dot: 'bg-slate-600', label: 'Skip', range: '<40' },
]

const TIER_DOT = {
  elite: 'bg-green-400',
  premium: 'bg-blue-400',
  solid: 'bg-amber-400',
  speculative: 'bg-amber-400',
  longshot: 'bg-slate-600',
}

function TierLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        Quality
      </span>
      {TIER_LEGEND.map((t) => (
        <span key={t.label} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${t.dot}`} />
          <span className="text-[11px] text-slate-400">{t.label}</span>
          <span className="text-[11px] text-slate-600 tabular-nums font-mono">{t.range}</span>
        </span>
      ))}
    </div>
  )
}

function pickLabel(pick) {
  if (pick.type === 'player_prop') return pick.playerName
  if (pick.type === 'total' && pick.awayTeam && pick.homeTeam) {
    return `${pick.awayTeam} @ ${pick.homeTeam}`
  }
  return pick.team
}

function pickDetail(pick, fallback) {
  if (pick.type === 'player_prop') {
    return `${pick.pick?.toUpperCase()} ${pick.threshold} ${(pick.propType || '').replace(/_/g, ' ')}`
  }
  if (pick.type === 'moneyline') return `${pick.pick} ML`
  if (pick.type === 'total') return `${pick.pick?.toUpperCase()} ${pick.threshold || ''}`
  return fallback
}

function PublishedBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border border-white/[0.08] bg-white/[0.04] text-slate-300">
      Published
    </span>
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

function TierDot({ tier, label }) {
  return (
    <span
      className={`h-2 w-2 rounded-full shrink-0 ${TIER_DOT[tier] || 'bg-slate-600'}`}
      title={label}
    />
  )
}

function PickCard({ pick, rank }) {
  const qualityTier = getQualityTier(pick.qualityScore || 0, pick)
  const displayOdds = formatAmericanOdds(pick.odds)
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
            <PublishedBadge />
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
              {edge > 0 && <EdgeBadge edge={edge * 100} />}
            </div>
          </div>
          <ShareButton prop={pick} variant="icon" />
        </div>
      </div>
    </Link>
  )
}

function PickRow({ pick }) {
  const qualityTier = getQualityTier(pick.qualityScore || 0, pick)
  const displayOdds = formatAmericanOdds(pick.odds)
  const edge = pick.edge || 0
  const probability = (pick.probability || 0.5) * 100

  return (
    <Link href={`/game/${pick.gameId}`} className="block">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-elevated transition-colors duration-100 cursor-pointer">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <TierDot tier={qualityTier.tier} label={qualityTier.label} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-100 truncate">
                {pickLabel(pick)}
              </span>
              <PublishedBadge />
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
            {edge > 0 && (
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

function SportPicksSection({ sport, count, props }) {
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
      {props.length > 0 && (
        <div>
          <GroupLabel>Player Props ({props.length})</GroupLabel>
          <RowList>
            {props.map((pick, index) => (
              <PickRow key={`${pick.propId || pick.gameId}-${pick.pick}-${index}`} pick={pick} />
            ))}
          </RowList>
        </div>
      )}
    </section>
  )
}

/**
 * Editor's Picks list. Empty or 1–2 rows is honest —
 * we don't invent extra picks to look busy.
 */
export default function EditorsPicksDesk({ picks = [], loading = false }) {
  const slate = todaysBoardSlateState(picks.length)
  const empty = slate === 'empty'
  const short = slate === 'short'

  const nflProps = picks.filter((p) => p.sport === 'nfl')
  const mlbProps = picks.filter((p) => p.sport === 'mlb')

  return (
    <div className="space-y-6">
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
          What makes the list
        </h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          MLB and NFL player props. Odds roughly −200 to +250 &mdash; no absurd
          juice. The model has to show a positive edge. Quality score of at
          least 40. Ranked by how much better the price is than the market,
          then by quality.
        </p>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          A short list &mdash; or an empty one &mdash; means nothing cleared
          today. We don&apos;t pad this page with prices we wouldn&apos;t take.
        </p>
        <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
          Same bar as Today&apos;s picks on the homepage and the{' '}
          <Link href="/validation" className="text-slate-500 underline decoration-white/10 underline-offset-2 hover:text-slate-300">
            public track record
          </Link>.
        </p>
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <TierLegend />
        </div>
      </div>

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

      {!loading && empty && (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface px-4 py-12 text-center">
          <h3 className="text-sm font-medium text-slate-200 mb-1">
            Nothing we&apos;d bet right now
          </h3>
          <p className="text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
            Slate&apos;s locked &mdash; nothing cleared the bar. Next board
            after the morning odds pull. We don&apos;t pad this page with
            prices we wouldn&apos;t take.
          </p>
        </div>
      )}

      {!loading && !empty && (
        <div className="space-y-6">
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
                Editor&apos;s shortlist
              </h2>
              <div className="flex-1 h-px bg-white/[0.04]" />
              <span className="text-[11px] text-slate-600 tabular-nums font-mono">
                {picks.length}
              </span>
            </div>
            <div className="rounded-[4px] border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
              {picks.slice(0, 5).map((pick, index) => (
                <PickCard
                  key={`${pick.propId || pick.gameId}-${pick.type}-${pick.pick}-${index}`}
                  pick={pick}
                  rank={index + 1}
                />
              ))}
              {short && (
                <div className="bg-surface px-3 py-2.5 sm:px-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Just {picks.length === 1 ? '1 pick' : `${picks.length} picks`} today.
                    We&apos;d rather show a price we like than invent a longer list.
                  </p>
                </div>
              )}
            </div>
          </section>

          {nflProps.length > 0 && (
            <SportPicksSection sport="nfl" count={nflProps.length} props={nflProps} />
          )}
          {mlbProps.length > 0 && (
            <SportPicksSection sport="mlb" count={mlbProps.length} props={mlbProps} />
          )}
        </div>
      )}
    </div>
  )
}
