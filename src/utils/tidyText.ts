/**
 * Trim a free-text field from the Sanity import and collapse runs of
 * whitespace (spaces, tabs, line breaks) to a single space. Sanity values
 * carry stray whitespace (`" 42-7612"`, `"Ford Liberator  B-24L-5"`).
 * Returns null for empty or missing input.
 */
export function tidyText(value: string | null | undefined): string | null {
  if (value == null) return null
  const out = value.replace(/\s+/g, ' ').trim()
  return out === '' ? null : out
}
