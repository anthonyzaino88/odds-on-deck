import Link from 'next/link'
import { getAllTerms, getTerm } from '../../lib/glossary.js'

const linkClass =
  'text-slate-300 underline decoration-white/15 underline-offset-2 hover:text-slate-100 transition-colors'

export function GlossaryShell({ children, backHref = '/', backLabel = 'Home' }) {
  return (
    <div className="max-w-2xl pb-8">
      <Link
        href={backHref}
        className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100 mb-3"
      >
        &larr; {backLabel}
      </Link>
      {children}
      <p className="mt-10 text-[11px] text-slate-600 leading-relaxed">
        For entertainment and informational purposes only. Not betting or financial advice.
      </p>
    </div>
  )
}

export function GlossaryArticle({ slug }) {
  const term = getTerm(slug)
  if (!term) return null

  const related = (term.related || [])
    .map((relatedSlug) => getTerm(relatedSlug))
    .filter(Boolean)

  return (
    <GlossaryShell backHref="/glossary" backLabel="Glossary">
      <article>
        <h1 className="text-xl font-semibold text-slate-100 tracking-tight">{term.title}</h1>
        <p className="text-sm text-slate-400 mt-3 leading-relaxed">{term.definition}</p>

        <div className="mt-6 space-y-4">
          {term.body.map((paragraph, index) => (
            <p key={index} className="text-sm text-slate-300 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>

        {term.example && (
          <div className="mt-6 bg-surface border border-white/[0.06] rounded-[4px] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Example
            </p>
            <p className="text-sm text-slate-400 leading-relaxed">{term.example}</p>
          </div>
        )}

        <div className="mt-8 pt-5 border-t border-white/[0.06] space-y-3">
          {related.length > 0 && (
            <p className="text-sm text-slate-400 leading-relaxed">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mr-2">
                Related
              </span>
              {related.map((item, index) => (
                <span key={item.slug}>
                  {index > 0 && <span className="text-slate-600"> &middot; </span>}
                  <Link href={`/glossary/${item.slug}`} className={linkClass}>
                    {item.title}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <p className="text-sm text-slate-400 leading-relaxed">
            <Link href="/glossary" className={linkClass}>
              All glossary terms
            </Link>
            {term.tool && (
              <>
                <span className="text-slate-600"> &middot; </span>
                <Link href={term.tool.href} className={linkClass}>
                  {term.tool.label}
                </Link>
              </>
            )}
          </p>
        </div>
      </article>
    </GlossaryShell>
  )
}

export function GlossaryIndex() {
  const terms = getAllTerms()
  const linkClassQuiet =
    'text-slate-400 hover:text-slate-100 transition-colors duration-100 underline decoration-white/15 underline-offset-2'

  return (
    <GlossaryShell>
      <h1 className="text-xl font-semibold text-slate-100 tracking-tight">Glossary</h1>
      <p className="text-sm text-slate-400 mt-2 leading-relaxed">
        The six terms we use on the board, written the same way as the homepage.
      </p>

      <dl className="mt-6 space-y-3">
        {terms.map((term) => (
          <div
            key={term.slug}
            className="bg-surface border border-white/[0.06] rounded-[4px] p-4"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              <Link
                href={`/glossary/${term.slug}`}
                className="hover:text-slate-300 transition-colors"
              >
                {term.title}
              </Link>
            </dt>
            <dd className="text-xs text-slate-300 leading-relaxed">{term.definition}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-sm text-slate-500 leading-relaxed">
        See the{' '}
        <Link href="/validation" className={linkClassQuiet}>
          public record
        </Link>{' '}
        for graded results, or compare live numbers on{' '}
        <Link href="/props" className={linkClassQuiet}>
          player props
        </Link>
        .
      </p>
    </GlossaryShell>
  )
}