/** PostgREST default max-rows. Always page with a stable order. */
export const SUPABASE_PAGE_SIZE = 1000

/**
 * Drain a range query. `runPage(from, to)` must apply `.order` + `.range`.
 */
export async function fetchAllPages(runPage, pageSize = SUPABASE_PAGE_SIZE) {
  const rows = []
  let from = 0
  while (true) {
    const result = await runPage(from, from + pageSize - 1)
    if (result?.error) return { data: rows, error: result.error }
    const page = result?.data || []
    rows.push(...page)
    if (page.length < pageSize) return { data: rows, error: null }
    from += pageSize
  }
}

export function uniqueNonEmpty(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )]
}
