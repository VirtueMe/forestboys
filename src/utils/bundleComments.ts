/**
 * Comments on a proposal bundle (#186): the shape, the checks and the counts. Pure, shared by the endpoints
 * (functions/_lib/bundle-comments.ts) and the page. docs/PROPOSALS.md, «Comments».
 *
 * Two scopes, kept as separate threads: a `bundle` comment is about the bundle as a whole, an `entity` comment about one
 * entity in it. A comment is one object, so two editors never collide; `type` and `entityId` are also its custom metadata, so
 * one listing gives every count without reading a body.
 */

import type { EventActor } from './bundleEvents.ts'

export type CommentType = 'bundle' | 'entity'

export interface BundleComment {
  id:        string
  type:      CommentType
  entityId?: string
  at:        string
  actor:     EventActor
  text:      string
}

/** What a listing of the comments knows about each, with no body read. */
export interface CommentRef { id: string; type: CommentType; entityId?: string }

export interface CommentCounts {
  bundle:   number
  /** By entity: the entities that have a thread. */
  entities: Record<string, number>
}

export const COMMENT_MAX = 2000
export const COMMENT_ID_RE = /^[0-9TZ:.-]+-[0-9a-f]{4}$/
const ENTITY_ID_RE = /^[A-Za-z]+:[A-Za-z0-9-]+$/

export interface CommentInput { type: CommentType; entityId?: string; text: string }

/** The scope and the text of a new comment, or why it is refused. `entityId` is mandatory for `entity`, absent for `bundle`. */
export function validateComment(body: unknown, entityIds?: readonly string[]): CommentInput | string {
  if (!body || typeof body !== 'object') return 'a comment is an object'
  const b = body as Record<string, unknown>
  if (b.type !== 'bundle' && b.type !== 'entity') return 'type must be `bundle` or `entity`'
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  if (!text) return 'text required'
  if (text.length > COMMENT_MAX) return `text is longer than ${COMMENT_MAX} characters`
  if (b.type === 'bundle') {
    if (b.entityId !== undefined && b.entityId !== null) return 'a bundle comment has no entityId'
    return { type: 'bundle', text }
  }
  if (typeof b.entityId !== 'string' || !ENTITY_ID_RE.test(b.entityId)) return 'entityId required for an entity comment'
  if (entityIds && !entityIds.includes(b.entityId)) return `${b.entityId} is not in this bundle`
  return { type: 'entity', entityId: b.entityId, text }
}

export function countComments(refs: readonly CommentRef[]): CommentCounts {
  const c: CommentCounts = { bundle: 0, entities: {} }
  for (const r of refs) {
    if (r.type === 'bundle') c.bundle++
    else if (r.entityId) c.entities[r.entityId] = (c.entities[r.entityId] ?? 0) + 1
  }
  return c
}

export const totalComments = (c: CommentCounts): number => c.bundle + Object.values(c.entities).reduce((a, b) => a + b, 0)
