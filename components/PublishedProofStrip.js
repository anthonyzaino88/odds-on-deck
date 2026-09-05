import Link from 'next/link'
import { formatAmericanOdds } from '../lib/odds-units.js'

function formatROI(roi) {
  const pct = roi * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function formatUnits(units) {
  if (typeof units !== 'number') return '—'
  const sign = units >= 0 ? '+' : ''
  return `${sign}${units.toFixed(2)}`
}

/**
 * Mini Published-track teaser. Numbers must come from getPublishedPicksStats()
 * — the same cohort as the /validation card.
 */
export default function PublishedProofStrip({ stats }) {
  const hasSample = (stats?.graded || 0) > 0
  const roiClass = !hasSample
    ? 'text-slate-100'
    : stats.roi >= 0
      ? 'text-green-400'
      : 'text-red-400'
  const unitsClass = !hasSample
    ? 'text-slate-200'
    : stats.units >= 0
      ? 'text-green-400'
      : 'text-red-400'
  const avgOdds = hasSample ? formatAmericanOdds(stats.avgDecimal ?? stats.avgAmerican) : null

  return (
    <section className="mb-8 sm:mb-10" aria-label="Published track">
      <div className="rounded-[4px] border border-white/[0.08] bg-surface overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1.5">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Published track
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              MLB + NFL · ROI first, then units, sample, and average odds
            </p>
          </div>
          <Link
            href="/validation"
            className="text-[11px] font-medium text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap"
          >
            Full track &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.06] border-t border-white/[0.06]">
          <ProofCell
            label="ROI"
            value={hasSample ? formatROI(stats.roi) : '—'}
            valueClass={roiClass}
          />
          <ProofCell
            label="Units"
            value={hasSample ? `${formatUnits(stats.units)}u` : '—'}
            valueClass={unitsClass}
          />
          <ProofCell
            label="Sample"
            value={hasSample ? String(stats.graded) : '0'}
            valueClass="text-slate-100"
          />
          <ProofCell
            label="Avg odds"
            value={avgOdds || '—'}
            valueClass="text-slate-100"
          />
        </div>

        <p className="px-4 sm:px-5 py-3 text-xs text-slate-500 leading-relaxed">
          Methodology locked. Sample still building.
        </p>
      </div>
    </section>
  )
}

function ProofCell({ label, value, valueClass }) {
  return (
    <div className="bg-bg px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-widest">{label}</div>
      <div className={`mt-1.5 text-xl sm:text-2xl font-semibold tabular-nums font-mono ${valueClass}`}>
        {value}
      </div>
    </div>
  )
}
