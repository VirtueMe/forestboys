/**
 * Walking a description that holds containers (#308, #314).
 *
 * A description is a list of blocks, and some of them are containers that hold lists of blocks of their own:
 * a box (`infoBox › content`) and a table (`table › rows › row › cells › cell › content`). The checks, the link
 * repairs and the list numbering all have to see the text blocks inside them, so they share this one walk
 * instead of each deciding what a container is.
 *
 * A text block is a leaf: its spans and mark definitions are not walked. A container is any other typed object
 * that holds typed objects in an array field, a type this app does not know included, so a container that
 * arrives before its own reader is still walked. A typed object that holds none (an image) is neither.
 */

import type { SanityBlock } from './portableText.ts'

export interface TreeNode {
  _type?: string
  _key?:  string
  [field: string]: unknown
}

/** Where a text block sits. */
export interface Place {
  /** The types of the containers around it, outermost first: `[]` at the top, `['infoBox', 'table', 'row', 'cell']` in a cell. */
  ancestors: readonly string[]
  /** The sibling before it in its own list, a container or an image included; undefined for the first. */
  previous:  TreeNode | undefined
}

export const isTextBlock = (node: unknown): node is SanityBlock =>
  !!node && typeof node === 'object' && (node as TreeNode)._type === 'block'

const isTyped = (x: unknown): x is TreeNode => !!x && typeof x === 'object' && '_type' in x

/** The typed objects inside a container, in the order its fields come: a box's `content`, a table's `rows`, a row's `cells`. */
export const containedBy = (node: TreeNode): TreeNode[] =>
  Object.values(node).flatMap(v => Array.isArray(v) ? v.filter(isTyped) : [])

/** The lists of siblings in a container, one per array field that holds typed objects. */
const listsIn = (node: TreeNode): [string, unknown[]][] =>
  Object.entries(node).filter((e): e is [string, unknown[]] => Array.isArray(e[1]) && e[1].some(isTyped))

export const isContainer = (node: unknown): node is TreeNode =>
  isTyped(node) && node._type !== 'block' && listsIn(node).length > 0

/** Every text block in reading order, with where it sits. Containers are entered, not reported. */
export function walkBlocks(nodes: unknown, visit: (block: SanityBlock, place: Place) => void, ancestors: readonly string[] = []): void {
  if (!Array.isArray(nodes)) return
  let previous: TreeNode | undefined
  for (const node of nodes) {
    if (isTextBlock(node)) visit(node, { ancestors, previous })
    else if (isContainer(node)) {
      for (const [, list] of listsIn(node)) walkBlocks(list, visit, [...ancestors, node._type as string])
    }
    previous = isTyped(node) ? node : undefined
  }
}

/** Every list of siblings, the top one and each one inside a container, with the containers around it. */
export function siblingLists(nodes: unknown, ancestors: readonly string[] = []): { list: TreeNode[]; ancestors: readonly string[] }[] {
  if (!Array.isArray(nodes)) return []
  const out = [{ list: nodes as TreeNode[], ancestors }]
  for (const node of nodes) {
    if (!isContainer(node)) continue
    for (const [, list] of listsIn(node)) out.push(...siblingLists(list, [...ancestors, node._type as string]))
  }
  return out
}

/**
 * The same list with `change` applied to every text block, in or out of containers. Nothing changed gives back the
 * same array (and the same containers), so a caller can tell by identity whether anything moved, as the sync does.
 * Entries that are not typed objects are kept as they are.
 */
export function mapBlocks<T>(nodes: T, change: (block: SanityBlock, place: Place) => SanityBlock, ancestors: readonly string[] = []): T {
  if (!Array.isArray(nodes)) return nodes
  let previous: TreeNode | undefined
  let moved = false
  const out = nodes.map(node => {
    let next: unknown = node
    if (isTextBlock(node)) next = change(node, { ancestors, previous })
    else if (isContainer(node)) next = mapContainer(node, change, ancestors)
    if (next !== node) moved = true
    previous = isTyped(node) ? node : undefined
    return next
  })
  return (moved ? out : nodes) as T
}

function mapContainer(node: TreeNode, change: (block: SanityBlock, place: Place) => SanityBlock, ancestors: readonly string[]): TreeNode {
  const inside = [...ancestors, node._type as string]
  let copy: TreeNode | undefined
  for (const [field, list] of listsIn(node)) {
    const mapped = mapBlocks(list, change, inside)
    if (mapped !== list) (copy ??= { ...node })[field] = mapped
  }
  return copy ?? node
}

/** One step of an editor path: a field name, or the `_key` of an item in a list. */
export type PathSegment = string | { _key: string }

/**
 * The node with `_key === key`, a text block or a container, wherever it is: the node, the editor path to it
 * (`[{_key: table}, 'rows', {_key: row}, 'cells', {_key: cell}, 'content', {_key: block}]`) and the containers around it,
 * outermost first. Null when no node has that key.
 */
export function findNode(nodes: unknown, key: string, prefix: PathSegment[] = [], chain: TreeNode[] = []): { node: TreeNode; path: PathSegment[]; containers: TreeNode[] } | null {
  if (!Array.isArray(nodes)) return null
  for (const node of nodes) {
    if (!isTyped(node)) continue
    const path: PathSegment[] = [...prefix, { _key: node._key as string }]
    if (node._key === key) return { node, path, containers: chain }
    if (!isContainer(node)) continue
    for (const [field, list] of listsIn(node)) {
      const found = findNode(list, key, [...path, field], [...chain, node])
      if (found) return found
    }
  }
  return null
}
