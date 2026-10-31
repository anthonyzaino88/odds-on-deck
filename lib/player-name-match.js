/**
 * Shared player-name normalization for MLB / NHL / NFL grading.
 *
 * Strip accents, parenthetical text, dots and apostrophes; turn remaining
 * punctuation into spaces; drop Jr/Sr/II/III/IV. First-name aliases are
 * tried only after an exact miss, and only when exactly one candidate hits.
 * Last-name-only matches are not part of this helper.
 */

const GENERATIONAL_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

export const PLAYER_FIRST_NAME_ALIASES = Object.freeze({
  mitch: ['mitchell'],
  mitchell: ['mitch'],
  alex: ['alexander'],
  alexander: ['alex'],
  matt: ['matthew'],
  matthew: ['matt'],
  nick: ['nicholas'],
  nicholas: ['nick'],
  cam: ['cameron'],
  cameron: ['cam'],
  mike: ['michael'],
  michael: ['mike'],
  will: ['william'],
  william: ['will'],
  josh: ['joshua'],
  joshua: ['josh'],
  jake: ['jacob'],
  jacob: ['jake'],
  zach: ['zachary'],
  zachary: ['zach'],
  leo: ['leonardo'],
  leonardo: ['leo'],
  yegor: ['egor'],
  egor: ['yegor'],
})

export function normalizeGradePlayerName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[''`´\u2018\u2019.]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((part) => part && !GENERATIONAL_SUFFIXES.has(part))
    .join(' ')
}

export function expandFirstNameAliasNames(normalizedFull) {
  const parts = String(normalizedFull || '').split(' ').filter(Boolean)
  if (parts.length < 2) return []
  const aliases = PLAYER_FIRST_NAME_ALIASES[parts[0]] || []
  const rest = parts.slice(1).join(' ')
  return aliases.map((alias) => `${alias} ${rest}`)
}

/**
 * Unique first-name-alias match after an exact normalized miss.
 * @returns {string|null} the matched raw name, or null
 */
export function uniqueFirstNameAliasMatch(names, targetNormalized) {
  const list = Array.isArray(names) ? names.filter(Boolean) : []
  const target = String(targetNormalized || '')
  if (!target) return null
  const aliasTargets = new Set([target, ...expandFirstNameAliasNames(target)])
  const hits = list.filter((name) => {
    const cand = normalizeGradePlayerName(name)
    if (aliasTargets.has(cand)) return true
    return expandFirstNameAliasNames(cand).some((alias) => aliasTargets.has(alias) || alias === target)
  })
  return hits.length === 1 ? hits[0] : null
}
