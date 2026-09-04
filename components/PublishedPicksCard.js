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
 * Server-rendered Published picks card. ROI / units / sample / avg odds lead;
 * W–L is secondary. Soft tone — methodology locked, sample still building.
 */
export default function PublishedPicksCard({ stats, windowLabel }) {
  const hasSample = (stats?.graded || 0) > 0
  const roiClass = !hasSample
    ? 'text-slate-100'
    : stats.roi >= 0
      ? 'text-green-400'
      : 'text-red-400'
  const unitsClass = !hasSample
    ? 'text-slate-300'
    : stats.units >= 0
      ? 'text-green-400'
      : 'text-red-400'
  const avgOdds = hasSample ? formatAmericanOdds(stats.avgDecimal ?? stats.avgAmerican) : null

  return (
    <section className="rounded-[4px] border border-white/[0.08] bg-surface overflow-hidden">
      <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Published picks</h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              The public track for the curated cohort &mdash; ROI first, then units, sample, and average odds.
              Methodology is locked. The sample is still building.
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-widest text-slate-500 font-medium">
            MLB + NFL · {windowLabel}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/[0.06]">
        <StatCell
          label="ROI"
          value={hasSample ? formatROI(stats.roi) : '—'}
          hint="flat 1u · pushes excluded"
          valueClass={`text-3xl sm:text-4xl ${roiClass}`}
        />
        <StatCell
          label="Units"
          value={hasSample ? `${formatUnits(stats.units)}u` : '—'}
          hint="profit / loss at recorded odds"
          valueClass={`text-2xl sm:text-3xl ${unitsClass}`}
        />
        <StatCell
          label="Sample"
          value={hasSample ? String(stats.graded) : '0'}
          hint={hasSample
            ? `${stats.decided} decided${stats.pushes > 0 ? ` · ${stats.pushes} push` : ''}`
            : 'no graded published picks yet'}
          valueClass="text-2xl sm:text-3xl text-slate-100"
        />
        <StatCell
          label="Avg odds"
          value={avgOdds || '—'}
          hint="mean price, shown American"
          valueClass="text-2xl sm:text-3xl text-slate-100"
        />
      </div>

      <div className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-slate-500">
          Record (secondary)
          <span className="ml-2 text-slate-200 tabular-nums font-mono font-medium">
            {hasSample ? stats.record : '—'}
          </span>
          {hasSample && (
            <span className="ml-2 text-[11px] text-slate-500">W–L{stats.pushes > 0 ? '–P' : ''}</span>
          )}
        </p>
        <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl sm:text-right">
          Not a marketed winning record. This is a working track of the locked filters
          while the sample fills in.
        </p>
      </div>
    </section>
  )
}

function StatCell({ label, value, hint, valueClass }) {
  return (
    <div className="bg-bg p-4 sm:p-5">
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-widest">{label}</div>
      <div className={`mt-2 font-semibold tabular-nums font-mono ${valueClass}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-1.5">{hint}</div>
    </div>
  )
}

export function HowPublishedPicks() {
  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
        What counts as a published pick
      </h2>
      <p className="text-sm text-slate-400 leading-relaxed mb-3">
        The Published card is a subset of the graded archive. A pick is included only when every rule below is true.
      </p>
      <ul className="text-sm text-slate-400 leading-relaxed space-y-1.5 list-disc ml-5">
        <li>
          <span className="text-slate-200 font-medium">Graded</span> &mdash; won, lost, or push.
          Pending rows are excluded from ROI.
        </li>
        <li>
          <span className="text-slate-200 font-medium">Not a juice trap</span> &mdash; counting-stat
          UNDER with a line of 0.5 or lower is dropped.
        </li>
        <li>
          <span className="text-slate-200 font-medium">Odds band</span> &mdash; American −200 to +250
          after an honest American/decimal parse.
        </li>
        <li>
          <span className="text-slate-200 font-medium">Line-shop edge &gt; 0</span> &mdash; same
          edge field stored when the prop was saved.
        </li>
        <li>
          <span className="text-slate-200 font-medium">Quality ≥ 40</span>
        </li>
        <li>
          <span className="text-slate-200 font-medium">MLB and NFL only</span> &mdash; NHL stays
          in the full archive for now.
        </li>
      </ul>
      <p className="text-sm text-slate-400 leading-relaxed mt-3">
        Units and ROI assume a flat 1-unit bet at the recorded odds. Pushes count in the sample
        and are excluded from the ROI denominator.
      </p>
    </div>
  )
}
