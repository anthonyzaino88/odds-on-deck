import Link from 'next/link'

/**
 * Locked homepage hero. Copy is product-owned — do not improvise.
 */
export default function HomeHero() {
  return (
    <header className="mb-8 sm:mb-10">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
        Odds on Deck
      </p>
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-100 tracking-tight max-w-2xl leading-tight">
        Sports props with a public track record
      </h1>
      <p className="text-sm sm:text-base text-slate-400 mt-3 max-w-2xl leading-relaxed">
        Curated picks, graded from box scores, ROI first &mdash; not vanity win rate.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 mt-5">
        <Link
          href="/validation"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-[4px] bg-elevated hover:bg-[#283548] border border-white/[0.12] text-slate-100 text-sm font-medium transition-colors duration-100"
        >
          See Published track
        </Link>
        <a
          href="#todays-board"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-[4px] bg-surface hover:bg-elevated border border-white/[0.06] text-slate-300 text-sm font-medium transition-colors duration-100"
        >
          Today&apos;s picks
        </a>
      </div>
    </header>
  )
}
