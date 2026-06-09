import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names, resolving conflicts (later classes win).
 * @param {...any} inputs - class values (strings, arrays, conditional objects)
 * @returns {string}
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
