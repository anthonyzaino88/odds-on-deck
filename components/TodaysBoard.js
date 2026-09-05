import Link from 'next/link'
import { SectionHeading, SportBadge } from './ui'

function lineLabel(row) {
  const pick = row.pick ? String(row.pick) : ''
  const line = row.line == null || row.line === '' ? '' : String(row.line)
  const market = row.market || 'prop'
  return [pick, line, market].filter(Boolean).join(' ')
}

function BoardRow({ row }) {
  const inner = (
    <div className="bg-surface hover:bg-elevated transition-colors duration-100 px-3 py-2.5 sm:px-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-100 truncate">{row.playerName}</span>
            {row.sport && <SportBadge sport={row.sport} />}
            {row.source === 'editors' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border border-white/[0.08] bg-white/[0.04] text-slate-400">
                Editor&apos;s
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 capitalize">
            {lineLabel(row)}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap">
          {row.odds && (
            <span className="text-[15px] font-medium text-slate-100 tabular-nums font-mono">
              {row.odds}
            </span>
          )}
          {row.why && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium tabular-nums font-mono border border-white/[0.08] bg-white/[0.04] text-slate-300">
              {row.why}
            </span>
          )}
        </div>
      </div>
    </div>
  )

  if (!row.href) return inner
  return <Link href={row.href}>{inner}</Link>
}

function LastNightRow({ row }) {
  const resultClass = row.result === 'Won'
    ? 'text-green-400'
    : row.result === 'Lost'
      ? 'text-red-400'
      : 'text-slate-400'

  const inner = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2 sm:px-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-200 truncate">{row.playerName}</span>
          {row.sport && <SportBadge sport={row.sport} />}
        </div>
        <div className="text-[11px] text-slate-500 capitalize">{lineLabel(row)}</div>
      </div>
      <div className="flex items-center gap-3 tabular-nums font-mono text-xs shrink-0">
        <span className={resultClass}>{row.result}</span>
        <span className="text-slate-400">{row.units}</span>
      </div>
    </div>
  )

  if (!row.href) return inner
  return <Link href={row.href} className="block hover:bg-elevated transition-colors duration-100">{inner}</Link>
}

/**
 * Cap-5 today’s board. Published-eligible first; Editor’s fill is labeled
 * so we never fake the Published cohort.
 */
export default function TodaysBoard({ board }) {
  const rows = board?.rows || []
  const lastNight = board?.lastNight || []
  const nextSlateAt = board?.nextSlateAt
  const empty = rows.length === 0

  return (
    <section id="todays-board" className="mb-8 sm:mb-10 scroll-mt-16">
      <SectionHeading
        title="Today's picks"
        action={
          <Link
            href="/picks"
            className="text-[11px] font-medium text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap"
          >
            Editor&apos;s desk &rarr;
          </Link>
        }
      />

      {empty ? (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface">
          <div className="px-4 py-5">
            <p className="text-sm text-slate-300">
              {nextSlateAt
                ? `Next slate locks at ${nextSlateAt}`
                : 'No Published-eligible props on the board yet.'}
            </p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {nextSlateAt
                ? 'The board fills as the MLB and NFL slate posts and we can line-shop it.'
                : 'Methodology locked. Sample still building.'}
            </p>
          </div>
          {lastNight.length > 0 && (
            <div className="border-t border-white/[0.06]">
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Last night · Published
              </p>
              <div className="divide-y divide-white/[0.04] pb-1">
                {lastNight.map((row) => (
                  <LastNightRow key={row.key} row={row} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[4px] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
          {rows.map((row) => (
            <BoardRow key={row.key} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}
