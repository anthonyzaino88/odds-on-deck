/**
 * Paged PropValidation lookup for Featured legs.
 * Filters by playerName and gameIdRef so the 1000-row cap cannot
 * silently drop the matching game's row.
 */
import { fetchAllPages, uniqueNonEmpty } from './supabase-page.js'
import { rowGameRef } from './featured-parlays.js'

export const FEATURED_VALIDATION_COLUMNS = 'playerName, propType, prediction, threshold, actualValue, result, status, gameIdRef, parlayId'

export function featuredValidationQueryKeys(legs) {
  const list = Array.isArray(legs) ? legs : []
  return {
    playerNames: uniqueNonEmpty(list.map((leg) => leg?.playerName)),
    gameIdRefs: uniqueNonEmpty(list.map((leg) => rowGameRef(leg))),
  }
}

export async function fetchFeaturedPropValidations(client, legs, columns = FEATURED_VALIDATION_COLUMNS) {
  const { playerNames, gameIdRefs } = featuredValidationQueryKeys(legs)
  if (playerNames.length === 0 && gameIdRefs.length === 0) {
    return { data: [], error: null }
  }

  return fetchAllPages((from, to) => {
    let query = client.from('PropValidation').select(columns)
    if (playerNames.length > 0) query = query.in('playerName', playerNames)
    if (gameIdRefs.length > 0) query = query.in('gameIdRef', gameIdRefs)
    return query.order('id', { ascending: true }).range(from, to)
  })
}
