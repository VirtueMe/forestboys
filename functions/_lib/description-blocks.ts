/**
 * The structure of what a bundle writes into a description (#308, #315).
 *
 * A description is a list of blocks, and two of them are containers that hold blocks of their own: a box
 * (`infoBox`, holding blocks and tables) and a table (`table › row › cell`, a cell holding text blocks).
 * For a bundle a top-level container is ONE block: `modify-block` replaces it whole, with the sha of all of it
 * as `expectedSha`, so there is no path to a block inside a cell. What this checks is that the whole is a
 * well-formed tree before it is stored, so the page and the checks (src/utils/blockTree.ts) can read it.
 *
 * Pure, so the ingest and the tests run the same code. A top-level entry of a type that is neither a text block
 * nor one of these containers is not judged here: it is as it always was.
 */

export const CONTAINER_TYPES = ['infoBox', 'table'] as const
export type ContainerType = typeof CONTAINER_TYPES[number]

export const isContainerType = (t: unknown): t is ContainerType => (CONTAINER_TYPES as readonly string[]).includes(t as string)

const FRAMES = ['none', 'topBottom', 'around'] as const
const WIDTHS = ['compact', 'full'] as const
const HEADING = /^h[1-6]$/

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)

/** A text block: `_type: 'block'` with its spans in `children`. Inside a cell, no heading. */
function checkText(node: unknown, at: string, inCell: boolean): string | null {
  if (!isObj(node) || node._type !== 'block')   return `${at}: must be a text block (_type "block")`
  if (typeof node._key !== 'string' || !node._key) return `${at}: _key required`
  if (!Array.isArray(node.children))            return `${at}: children[] required`
  if (inCell && typeof node.style === 'string' && HEADING.test(node.style)) return `${at}: a table cell holds no headings (style "${node.style}")`
  return null
}

function checkList(list: unknown, field: string, at: string, each: (child: unknown, at: string) => string | null, min = 0): string | null {
  if (!Array.isArray(list)) return `${at}: ${field}[] required`
  if (list.length < min)    return `${at}: ${field}[] needs at least ${min}`
  for (let i = 0; i < list.length; i++) {
    const bad = each(list[i], `${at}.${field}[${i}]`)
    if (bad) return bad
  }
  return null
}

function checkCell(node: unknown, at: string): string | null {
  if (!isObj(node) || node._type !== 'cell') return `${at}: must be a cell (_type "cell")`
  if (typeof node._key !== 'string' || !node._key) return `${at}: _key required`
  return checkList(node.content, 'content', at, (c, a) => checkText(c, a, true))
}

function checkRow(node: unknown, at: string): string | null {
  if (!isObj(node) || node._type !== 'row') return `${at}: must be a row (_type "row")`
  if (typeof node._key !== 'string' || !node._key) return `${at}: _key required`
  return checkList(node.cells, 'cells', at, checkCell, 1)
}

function checkTable(node: Obj, at: string): string | null {
  if (typeof node._key !== 'string' || !node._key) return `${at}: _key required`
  if (node.frame !== undefined && !(FRAMES as readonly unknown[]).includes(node.frame)) return `${at}: frame must be one of ${FRAMES.join(', ')}`
  if (node.width !== undefined && !(WIDTHS as readonly unknown[]).includes(node.width)) return `${at}: width must be one of ${WIDTHS.join(', ')}`
  for (const flag of ['rowLines', 'columnLines', 'noWrap'] as const) {
    if (node[flag] !== undefined && typeof node[flag] !== 'boolean') return `${at}: ${flag} must be true or false`
  }
  return checkList(node.rows, 'rows', at, checkRow, 1)
}

/** A box holds text blocks and tables, and nothing else. */
function checkBox(node: Obj, at: string): string | null {
  if (typeof node._key !== 'string' || !node._key) return `${at}: _key required`
  return checkList(node.content, 'content', at, (c, a) =>
    isObj(c) && c._type === 'table' ? checkTable(c, a) : checkText(c, a, false))
}

/** `null` when `node` is a well-formed container; a reason when it is a container that is not. */
export function checkContainer(node: unknown, at: string): string | null {
  if (!isObj(node) || !isContainerType(node._type)) return `${at}: must be a text block or one of ${CONTAINER_TYPES.join(', ')}`
  return node._type === 'infoBox' ? checkBox(node, at) : checkTable(node, at)
}

/** A top-level block of a bundle: a text block, or a well-formed container. */
export function checkTopLevelBlock(node: unknown, at: string): string | null {
  if (isObj(node) && isContainerType(node._type)) return checkContainer(node, at)
  if (!isObj(node) || node._type !== 'block' || !Array.isArray(node.children)) {
    return `${at}: must be a text block (_type "block", children[]) or one of ${CONTAINER_TYPES.join(', ')}`
  }
  return null
}

/**
 * The containers inside a description's JSON (`create-entity` and `set-description` carry it as a string): each
 * one at the top must be well-formed. Other entries pass, as they did before.
 */
export function checkContentContainers(content: string, at: string): string | null {
  let blocks: unknown
  try { blocks = JSON.parse(content) } catch { return null }     // the caller already says «must be JSON»
  if (!Array.isArray(blocks)) return null
  for (let i = 0; i < blocks.length; i++) {
    const b: unknown = blocks[i]
    if (isObj(b) && isContainerType(b._type)) {
      const bad = checkContainer(b, `${at}[${i}]`)
      if (bad) return bad
    }
  }
  return null
}
