import { formatAmericanOdds } from '../lib/odds-units.js'

export function formatQuoteAge(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs)) return 'age unknown'
  const min = Math.floor(ageMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

/**
 * Shared N-book / vs-cons / expandable ladder / stale flags.
 * Used on /props and Editor's /picks. Hide when there is no shop data.
 */
export function LineShopMeta({ prop }) {
  const quotes = Array.isArray(prop?.quotes) && prop.quotes.length > 0 ? prop.quotes : null
  const books = typeof prop?.numBooks === 'number' && prop.numBooks > 0 ? prop.numBooks : null
  const consensus = formatAmericanOdds(prop?.consensusAmerican)
    || formatAmericanOdds(prop?.consensusOdds)

  return (
    <>
      {books != null && (
        <span className="text-[10px] text-slate-500 tabular-nums font-mono">{books}-book</span>
      )}
      {consensus && (
        <span className="text-[10px] text-slate-500 tabular-nums font-mono">vs cons {consensus}</span>
      )}
      {prop?.staleQuotes && (
        <span className="text-[10px] font-medium text-amber-400">stale</span>
      )}
      {quotes && (
        <details
          className="text-[10px] text-slate-500"
          onClick={(e) => e.stopPropagation()}
        >
          <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
            {books != null ? `${books}-book ladder` : 'Book ladder'}
          </summary>
          <ul className="mt-1 space-y-0.5 text-slate-500">
            {quotes.map((quote) => (
              <li key={`${quote.book}-${quote.decimal}`} className="tabular-nums font-mono">
                {quote.book || 'Unknown'}{' '}
                {formatAmericanOdds(quote.american) || formatAmericanOdds(quote.decimal) || '—'}
                {' · '}
                {formatQuoteAge(quote.ageMs)}
                {quote.stale ? ' · stale' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
