/**
 * Node references in proposal bundles: `<Kind>:<key>`.
 *
 * Reviewable entities (a bundle's entityIds) are `<Kind>:<slug>`. Edge
 * endpoints may also point at a Source, which has no slug — it is keyed by
 * `id`, and image Source ids contain colons (`img:sanity:image-…`). So a
 * Source ref is `Source:<id>` with everything after the first colon as id.
 */

export const ENTITY_ID_RE = /^([A-Za-z]+):([a-z0-9-]+)$/
const SOURCE_REF_RE       = /^Source:(\S+)$/

/** Property that identifies a node of this kind. */
export function keyProp(kind: string): 'id' | 'slug' {
  return kind === 'Source' ? 'id' : 'slug'
}

/** Parse an edge endpoint. Null when malformed. */
export function parseNodeRef(ref: string): { kind: string; key: string } | null {
  const s = ref.match(SOURCE_REF_RE)
  if (s) return { kind: 'Source', key: s[1] }
  const m = ref.match(ENTITY_ID_RE)
  return m ? { kind: m[1], key: m[2] } : null
}

export function isNodeRef(ref: unknown): ref is string {
  return typeof ref === 'string' && parseNodeRef(ref) !== null
}

/** `(<v>:\`Kind\` {slug|id: $<param>})` */
export function nodePattern(v: string, kind: string, param: string): string {
  return `(${v}:\`${kind}\` {${keyProp(kind)}: $${param}})`
}
