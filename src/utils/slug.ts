/**
 * Turn a Norwegian display name into a kebab-case slug.
 * Strips diacritics (å → a, ø → o, æ → ae), lower-cases, and collapses
 * whitespace/punctuation to single hyphens. Not locale-perfect, but
 * good enough for editors to accept-as-is.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export const SLUG_RE = /^[a-z0-9-]+$/
