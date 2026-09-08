import Link from 'next/link'
import { formatAmericanOdds } from '../lib/odds-units.js'
import { gameLineDetail, gameLineLabel, partitionGameLines } from '../lib/game-lines.js'
import { SportBadge, SectionHeading, EdgeBadge } from './ui'

function formatUnits(units) {
  if (typeof units !== 'number') return '—'
  const sign = units >= 0 ? '+' : ''
  return `${sign}${units.toFixed(1)}u`
}

function RecordTeaser({ summary }) {
  if (!summary) return null
  const empty = !summary.graded
  return (
    <p className="text-xs text-slate-500 leading-relaxed">
      {empty
        ? 'No graded sides or totals yet. The record stays empty until games finish.'
        : `Record so far: ${summary.record} · ${formatUnits(summary.units)}. Separate from the props track.`}
      {' '}
      <Link
        href="/validation"
        className="text-slate-400 underline decoration-white/10 underline-offset-2 hover:text-slate-200"
      >
        public track record
      </Link>
    </p>
  )
}

function LineRow({ line }) {
  const odds = formatAmericanOdds(line.odds)
  const edge = Number(line.edge)
  const inner = (
    <div className="px-3 py-3 sm:px-4 hover:bg-elevated transition-colors duration-100">
      <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100 truncate">
              {gameLineLabel(line)}
            </span>
            {line.sport && <SportBadge sport={line.sport} />}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {gameLineDetail(line)}
          </div>
          {line.why && (
            <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
              {line.why}
            </p>
          )}
          {line.matchupInsight && (
            <p className="text-[11px] text-blue-400 mt-1 leading-snug">
              {line.matchupInsight}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {odds && (
            <span className="text-[15px] font-semibold text-amber-400 tabular-nums font-mono">
              {odds}
            </span>
          )}
          {Number.isFinite(edge) && edge > 0 && (
            <EdgeBadge edge={edge * 100} />
          )}
        </div>
      </div>
    </div>
  )

  if (!line.gameId) return inner
  return <Link href={`/game/${line.gameId}`} className="block">{inner}</Link>
}

function LineGroup({ title, lines }) {
  if (!lines.length) return null
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 px-3 sm:px-4 pt-3 pb-1.5">
        {title}
      </h3>
      <div className="divide-y divide-white/[0.04]">
        {lines.map((line, index) => (
          <LineRow
            key={`${line.gameId}-${line.type}-${line.pick}-${line.threshold}-${index}`}
            line={line}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Public sides & totals shortlist. Not the props board.
 */
export default function SidesAndTotalsCard({
  lines = [],
  loading = false,
  summary = null,
  heading = 'Sides & totals',
}) {
  const empty = !loading && lines.length === 0
  const { moneylines, totals } = partitionGameLines(lines)

  return (
    <section id="sides-and-totals" className="scroll-mt-16">
      <SectionHeading title={heading} />
      <div className="rounded-[4px] border border-white/[0.06] bg-surface overflow-hidden">
        <div className="px-3 sm:px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <p className="text-sm text-slate-400 leading-relaxed">
            Game moneylines and overs/unders where the model has an edge.
            Not the props shortlist. A short list, or none, is the honest count.
            We don&apos;t invent locks.
          </p>
          <div className="mt-2">
            <RecordTeaser summary={summary} />
          </div>
        </div>

        {loading && (
          <div className="divide-y divide-white/[0.04]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-3 py-3 sm:px-4 animate-pulse">
                <div className="h-4 w-40 bg-white/[0.06] rounded" />
                <div className="h-3 w-56 bg-white/[0.04] rounded mt-2" />
                <div className="h-3 w-64 bg-white/[0.04] rounded mt-2" />
              </div>
            ))}
          </div>
        )}

        {!loading && empty && (
          <div className="px-4 py-10 text-center">
            <h3 className="text-sm font-medium text-slate-200 mb-1">
              No sides or totals with an edge right now
            </h3>
            <p className="text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
              That&apos;s the honest count. When an upcoming MLB or NFL moneyline
              or game total clears a real model edge, it lands here.
            </p>
          </div>
        )}

        {!loading && !empty && (
          <div className="divide-y divide-white/[0.06]">
            <LineGroup title="Moneyline" lines={moneylines} />
            <LineGroup title="Game totals" lines={totals} />
          </div>
        )}
      </div>
    </section>
  )
}
