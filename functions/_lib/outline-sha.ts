/**
 * The hash of an outline's text, apart from the graph code so scripts can use the same function (#157, #158): the
 * blocks of its descriptions as a value, with their order, in order. See outline-version.ts for what it is used for.
 */

import { stableSha } from './stable-sha.ts'

export interface DescriptionRow { order: number | null; content: string | null }

const blocksOf = (content: string): unknown => { try { return JSON.parse(content) } catch { return content } }

/** The hash of an outline's text: its descriptions' blocks as a value, with their order, in order. */
export async function outlineContentSha(rows: DescriptionRow[]): Promise<string> {
  const text = rows
    .filter((r): r is { order: number | null; content: string } => typeof r.content === 'string')
    .map(r => ({ order: Number(r.order ?? 0), blocks: blocksOf(r.content) }))
    .sort((a, b) => a.order - b.order)
  return stableSha(text)
}
