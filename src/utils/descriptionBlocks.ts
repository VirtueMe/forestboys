/**
 * Portable Text blocks from Description rows. Each row's `content` is a
 * JSON-stringified array of blocks; the rows arrive in section order and are
 * joined into one list. Empty and malformed rows are skipped, not fatal.
 */
export function descriptionBlocks(rows: { content: string | null }[]): unknown[] {
  const blocks: unknown[] = []
  for (const r of rows) {
    if (!r.content) continue
    try {
      const parsed: unknown = JSON.parse(r.content)
      if (Array.isArray(parsed)) blocks.push(...parsed)
    } catch { /* skip malformed */ }
  }
  return blocks
}
