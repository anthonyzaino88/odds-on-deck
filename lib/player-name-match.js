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

export function lastNameOfNormalized(normalizedFull) {
  const parts = String(normalizedFull || '').split(' ').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * Unmatched query whose last name equals (or nearly equals) someone in
 * the box — Zach/Zack Wheeler, Kiké Hernández, J. Crawford. Those stay
 * needs_review instead of a DNP void.
 */
export function isNearMissPlayerName(queryName, boxNames) {
  const target = normalizeGradePlayerName(queryName)
  const targetLast = lastNameOfNormalized(target)
  if (!target || !targetLast) return false
  const list = Array.isArray(boxNames) ? boxNames : []
  for (const name of list) {
    const cand = normalizeGradePlayerName(name)
    if (!cand || cand === target) continue
    const candLast = lastNameOfNormalized(cand)
    if (!candLast) continue
    if (candLast === targetLast) return true
    if (targetLast.length >= 4 && candLast.length >= 4 && editDistance(targetLast, candLast) <= 1) {
      return true
    }
  }
  return false
}

function editDistance(a, b) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 1) return 2
  const rows = a.length + 1
  const cols = b.length + 1
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i += 1) grid[i][0] = i
  for (let j = 0; j < cols; j += 1) grid[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + cost,
      )
    }
  }
  return grid[a.length][b.length]
}

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
