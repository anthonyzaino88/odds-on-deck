/**
 * Shared player-prop settlement: over/under from an actual, and
 * "did this player appear?" → void vs grade vs needs_review.
 *
 * DNP voids use the same result/status as cancelled games
 * (void + manual_closed) so ROI denominators exclude them.
 */

export function gradePropFromActual(prediction, threshold, actualValue) {
  if (actualValue === threshold) return 'push'
  const pick = String(prediction || '').toLowerCase()
  if (
    (pick === 'over' && actualValue > threshold)
    || (pick === 'under' && actualValue < threshold)
  ) {
    return 'correct'
  }
  return 'incorrect'
}

/**
 * @param {{ didNotPlay?: boolean, reason?: string, value?: number|null }|null} lookup
 * @returns {{ action: 'void'|'grade'|'needs_review', reason: string, actualValue?: number }}
 */
export function planPlayerAppearanceGrade(lookup) {
  if (!lookup) return { action: 'needs_review', reason: 'stat_not_found' }
  if (lookup.didNotPlay) {
    return { action: 'void', reason: lookup.reason || 'did_not_play' }
  }
  if (lookup.value === null || lookup.value === undefined) {
    return { action: 'needs_review', reason: lookup.reason || 'stat_not_found' }
  }
  return { action: 'grade', reason: 'appeared', actualValue: lookup.value }
}

export function isZeroActual(value) {
  if (value == null || value === '') return false
  return Number(value) === 0
}
