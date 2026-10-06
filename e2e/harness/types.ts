/** What a block looks like to a test: enough to read it, not the editor's own type. */
export interface Block {
  _key: string
  _type: string
  style?: string
  listItem?: string
  level?: number
  markDefs?: { _key: string; _type: string; [prop: string]: unknown }[]
  children?: { _key: string; _type: string; text: string; marks?: string[] }[]
}

/** The handle the harness page puts on `window.__harness`. */
export interface Harness {
  /** What the editor last reported (or the fixture, before it has reported anything), parsed. */
  value(): Block[]
  /** How many times the editor has reported a change. */
  reports(): number
  /** Replace the content from outside, as «Angre» or a repaired heading does: the editor starts over. */
  set(blocks: Block[]): void
}
