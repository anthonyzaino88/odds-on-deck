'use client'

import { useState } from 'react'

export default function MethodologyPanel({ minSampleSize = 25 }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-surface border border-white/[0.06] rounded-[4px] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-elevated transition-colors duration-100"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-[3px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-semibold">
            ?
          </span>
          <div className="text-left">
            <h4 className="text-sm font-semibold text-slate-100">How we track and grade</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              What gets tracked, how results are graded, and how to read the numbers
            </p>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-5 pt-1 border-t border-white/[0.06]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 mt-4">
            <Section title="What gets tracked">
              <p>
                Every prop displayed on the site is recorded the moment it appears, including
                the line, the book offering it, the implied probability, and our market-context
                signals. Once the game finishes, we pull the actual stat and grade it.
              </p>
              <p className="mt-2">
                Both auto-tracked props (for accuracy measurement) and props you save are
                recorded in the same way. They&apos;re shown separately so you can filter to
                just the picks you saved.
              </p>
            </Section>

            <Section title="How results are graded">
              <ul className="list-disc ml-5 space-y-1">
                <li>
                  <span className="text-slate-200 font-medium">Correct</span> &mdash; actual stat
                  finished on the predicted side of the line
                </li>
                <li>
                  <span className="text-slate-200 font-medium">Incorrect</span> &mdash; actual stat
                  finished on the opposite side
                </li>
                <li>
                  <span className="text-slate-200 font-medium">Push</span> &mdash; actual stat
                  exactly equals the line (excluded from win-rate math)
                </li>
                <li>
                  <span className="text-slate-200 font-medium">Needs review</span> &mdash; we
                  couldn&apos;t resolve the stat from official sources
                </li>
              </ul>
            </Section>

            <Section title="How to read the numbers">
              <ul className="list-disc ml-5 space-y-1">
                <li>
                  <span className="text-slate-200 font-medium">Hit Rate</span> &mdash; correct / (correct + incorrect).
                  Pushes are excluded.
                </li>
                <li>
                  <span className="text-slate-200 font-medium">Avg Edge vs Market</span> &mdash;
                  the average difference between the line we surfaced and the broader market
                  consensus (vig-removed).
                </li>
                <li>
                  <span className="text-slate-200 font-medium">Units P/L &amp; ROI</span> &mdash;
                  cumulative profit/loss assuming a flat 1-unit bet at the recorded odds.
                  ROI = units / total resolved bets. We treat -110 as the default when odds
                  weren&apos;t recorded.
                </li>
              </ul>
            </Section>

            <Section title="Why some numbers fluctuate">
              <p>
                Prop types with fewer than <strong className="text-slate-200">50 resolved bets</strong>{' '}
                are flagged as <em>small sample</em>. ROI and hit rate for small samples can swing
                dramatically with each new result, so we visually de-emphasize them and show a
                warning icon if the ROI is extreme.
              </p>
              <p className="mt-2">
                We require at least <strong className="text-slate-200">{minSampleSize} resolved bets</strong>{' '}
                before a prop type appears in the breakdown table at all. Below that threshold we
                hide the row entirely to avoid showing noise.
              </p>
            </Section>
          </div>

          <div className="mt-6 pt-4 border-t border-white/[0.06] text-xs text-slate-500 leading-relaxed">
            <span className="text-slate-400">Important:</span> This is an honest record of every
            tracked prop &mdash; it&apos;s a snapshot of how the lines we surface have performed,
            not a guarantee of future results. Past hit rates don&apos;t predict tomorrow&apos;s
            outcomes. Bet responsibly.
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h5 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">{title}</h5>
      <div className="text-sm text-slate-400 leading-relaxed">{children}</div>
    </div>
  )
}
